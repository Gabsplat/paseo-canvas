import { newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSHandle } from "quickjs-emscripten-core";
/*
 * The variant: QuickJS release build, synchronous, with the WebAssembly embedded in the JavaScript, as ES modules.
 * Paseo compiles the plugin server into one CommonJS bundle that it evaluates from memory, and the desktop app bundles
 * everything with esbuild, so there must be no file to load beside the code. Of the embedded builds, this one also
 * survives Paseo's compiler: the CommonJS build loses its exports to the compiler's eager-interop rewrite, and the
 * Node ES module build calls createRequire(import.meta.url), which is empty in a bundle evaluated from a string. This
 * build's loader needs neither: no Node modules, no import.meta, its own base64 decoder (docs/extensions.md, "Packaging").
 */
import variant from "@jitl/quickjs-singlefile-browser-release-sync";


/**
 * Runs untrusted JavaScript in QuickJS compiled to WebAssembly, inside this process. Every run gets a new
 * WebAssembly instance, runtime and context, and drops all of them at the end: nothing is shared between runs or
 * with the host. The code sees only the standard JavaScript built-ins and the one bridge function the prelude is
 * handed; that bridge carries strings both ways, never host objects.
 *
 * Limits: wall-clock time (which is CPU time, since the run is synchronous), memory, the interpreter's stack, and the
 * number of promise jobs. A host stack overflow or a WebAssembly trap is caught too: the instance is simply dropped.
 */
export type SandboxFailure = "timeout" | "memory" | "recursion" | "error" | "unfinished" | "jobs" | "output" | "crashed";
export class SandboxError extends Error {
  constructor(readonly reason: SandboxFailure, message: string, readonly errorName = "Error") { super(message); this.name = "SandboxError"; }
}
export type SandboxLimits = { timeMs: number; memoryBytes: number; stackBytes: number; jobs: number; resultChars: number };
export interface SandboxProgram {
  /**
   * Evaluated first. It must evaluate to a function that takes the bridge `(method: string, json: string) => string`
   * and returns an object whose `start(...args)` returns a string or a promise of one.
   */
  prelude: string;
  /** Global scripts evaluated after the prelude, in order. */
  scripts: { name: string; code: string }[];
  /** The arguments of start, as strings. */
  args: string[];
  /** Answers the bridge. Called synchronously from inside the interpreter; its time counts against the limit. */
  host(method: string, json: string): string;
  /** The longest string the bridge accepts from inside, in characters. */
  bridgeChars: number;
  limits: SandboxLimits;
}

const text = (vm: QuickJSContext, handle: QuickJSHandle, max: number): string | null => {
  if (vm.typeof(handle) !== "string") return null;
  const length = vm.getProp(handle, "length"), size = vm.getNumber(length); length.dispose();
  return size > max ? null : vm.getString(handle);
};
/** Name and message of something thrown inside, read defensively: it may be any value, with getters. */
function described(vm: QuickJSContext, handle: QuickJSHandle): { name: string; message: string } {
  try {
    if (vm.typeof(handle) === "object") {
      const name = vm.getProp(handle, "name"), message = vm.getProp(handle, "message");
      const result = { name: text(vm, name, 100) ?? "Error", message: (text(vm, message, 100_000) ?? "").slice(0, 500) };
      name.dispose(); message.dispose(); return result;
    }
    const plain = text(vm, handle, 100_000);
    return { name: "Error", message: (plain ?? String(vm.dump(handle))).slice(0, 500) };
  } catch { return { name: "Error", message: "An error that could not be read." }; }
}

export async function runSandboxed(program: SandboxProgram): Promise<string> {
  const { limits } = program, module = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = module.newRuntime();
  runtime.setMemoryLimit(limits.memoryBytes);
  runtime.setMaxStackSize(limits.stackBytes);
  const deadline = Date.now() + limits.timeMs;
  let late = false;
  runtime.setInterruptHandler(() => (late ||= Date.now() > deadline));
  const vm = runtime.newContext();
  // Emscripten's exit path sets process.exitCode; QuickJS never exits, but a host process must not inherit one.
  const exitCode = process.exitCode;
  const failure = (handle: QuickJSHandle): SandboxError => {
    const { name, message } = described(vm, handle);
    if (late || name === "InternalError" && message === "interrupted") return new SandboxError("timeout", `It ran longer than ${limits.timeMs / 1000} s.`, name);
    if (name === "InternalError" && /out of memory/.test(message)) return new SandboxError("memory", `It used more than ${limits.memoryBytes / 1024 / 1024} MB of memory.`, name);
    if (/stack overflow/.test(message)) return new SandboxError("recursion", "It recursed too deeply.", name);
    return new SandboxError("error", message || name, name);
  };
  const take = <T extends { error?: QuickJSHandle; value?: QuickJSHandle }>(result: T): QuickJSHandle => {
    if (result.error) throw failure(result.error);
    return result.value!;
  };
  try {
    const prelude = take(vm.evalCode(program.prelude, "lienzo-prelude.js"));
    const bridge = vm.newFunction("host", (method, json) => {
      let answer: string;
      try {
        const name = text(vm, method, 40), payload = text(vm, json, program.bridgeChars);
        answer = name === null ? JSON.stringify({ error: "Unknown call." }) : payload === null ? JSON.stringify({ error: `The data sent to lienzo.${name} is over ${program.bridgeChars} characters.` }) : program.host(name, payload);
      } catch (error) { answer = JSON.stringify({ error: error instanceof Error ? error.message : "The call failed." }); }
      return vm.newString(answer);
    });
    const api = take(vm.callFunction(prelude, vm.undefined, bridge));
    for (const script of program.scripts) take(vm.evalCode(script.code, script.name));
    const start = vm.getProp(api, "start");
    if (vm.typeof(start) !== "function") throw new SandboxError("error", "The prelude has no start.");
    const outcome = take(vm.callFunction(start, api, ...program.args.map(arg => vm.newString(arg))));
    let jobs = 0, value: QuickJSHandle;
    for (;;) {
      const state = vm.getPromiseState(outcome);
      if (state.type === "fulfilled") { value = state.value; break; }
      if (state.type === "rejected") throw failure(state.error);
      const ran = runtime.executePendingJobs(256);
      if (ran.error) throw failure(ran.error);
      if (!ran.value) throw new SandboxError("unfinished", "It never finished: it waited on a promise nothing settles (there are no timers or network here).");
      if ((jobs += ran.value) > limits.jobs) throw new SandboxError("jobs", `It queued more than ${limits.jobs} promise jobs.`);
    }
    if (late) throw new SandboxError("timeout", `It ran longer than ${limits.timeMs / 1000} s.`);
    const result = text(vm, value, limits.resultChars);
    if (result === null) throw new SandboxError("output", vm.typeof(value) === "string" ? `Its result is over ${limits.resultChars} characters.` : "Its result could not be read.");
    return result;
  } catch (error) {
    if (error instanceof SandboxError) throw error;
    // Outside QuickJS's own checks: the host's stack, or a trap inside the WebAssembly. The instance is dropped.
    if (error instanceof RangeError && /call stack/i.test(error.message)) throw new SandboxError("recursion", "It recursed too deeply.", "RangeError");
    if (late) throw new SandboxError("timeout", `It ran longer than ${limits.timeMs / 1000} s.`);
    throw new SandboxError("crashed", "The interpreter stopped on an internal error.");
  } finally {
    // Nothing is disposed one by one: the whole instance (its memory, runtime and handles) is left to the garbage
    // collector, which also holds after a failure that left QuickJS in an unknown state.
    process.exitCode = exitCode;
  }
}
