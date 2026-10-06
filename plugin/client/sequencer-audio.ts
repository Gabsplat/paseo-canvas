// Lookahead scheduler for the step sequencer. Pure: the audio clock and voices arrive through a
// port (web.ts owns the only real one) and timers can be replaced, so nothing here touches a browser API.
export type StepAudioPort = {
  /** Audio clock, in seconds. */
  now(): number;
  running(): boolean;
  /** Schedule one bounded note. False when the voice cap dropped it. */
  note(frequency: number, at: number, duration: number): boolean;
  /** Silence every voice now and release the context. Idempotent. */
  close(): void;
};
/** `key` identifies what is sounding (pattern, tempo, pitches), so steps are credited to the music they belonged to. */
export type SequencerFrame = { frequencies: readonly number[]; pattern: readonly string[]; steps: number; stepSeconds: number; key?: string };
export type SequencerTimers = { every(run: () => void, ms: number): unknown; cancel(handle: unknown): void };
export const SEQUENCER_AUDIO = { tickMs: 25, lookahead: .12, lead: .06, maxNote: .4, noteShare: .9, maxStepsPerTick: 4 } as const;
const realTimers: SequencerTimers = { every: (run, ms) => setInterval(run, ms), cancel: handle => clearInterval(handle as ReturnType<typeof setInterval>) };

/**
 * Plays whatever `read()` returns at each step, so edits and tempo changes are heard on the next step.
 * `onStep` follows the audio clock for the playhead; it is local UI, never an assistant event.
 */
export function createSequencer(options: {
  port: StepAudioPort; read(): SequencerFrame; onStep(step: number): void; onStall(): void; timers?: SequencerTimers;
}) {
  const { port, read, onStep, onStall } = options, timers = options.timers ?? realTimers;
  let handle: unknown = null, nextStep = 0, nextTime = 0, played = 0;
  let due: { step: number; at: number; key: string }[] = [], run = { key: '', steps: 0 };
  const tick = () => {
    if (handle === null) return;
    if (!port.running()) { stop(); onStall(); return; }
    const now = port.now();
    // A throttled timer must not answer with a burst of late notes.
    if (nextTime < now) nextTime = now + SEQUENCER_AUDIO.lead;
    for (let scheduled = 0; nextTime < now + SEQUENCER_AUDIO.lookahead && scheduled < SEQUENCER_AUDIO.maxStepsPerTick; scheduled++) {
      const frame = read(), step = nextStep % frame.steps;
      const duration = Math.min(SEQUENCER_AUDIO.maxNote, frame.stepSeconds * SEQUENCER_AUDIO.noteShare);
      frame.pattern.forEach((row, i) => { if (row[step] === 'x' && Number.isFinite(frame.frequencies[i])) port.note(frame.frequencies[i], nextTime, duration); });
      due.push({ step, at: nextTime, key: frame.key ?? '' });
      nextStep = (step + 1) % frame.steps; nextTime += frame.stepSeconds;
    }
    let shown: number | undefined;
    // Only a step the audio clock has reached counts, and only towards the music it was scheduled with.
    while (due.length && due[0].at <= now) { const reached = due.shift()!; shown = reached.step; played++; run = reached.key === run.key ? { key: run.key, steps: run.steps + 1 } : { key: reached.key, steps: 1 }; }
    if (shown !== undefined && handle !== null) onStep(shown);
  };
  function stop() {
    if (handle !== null) timers.cancel(handle);
    handle = null; due = [];
  }
  return {
    start() {
      if (handle !== null) return;
      nextStep = 0; played = 0; due = []; run = { key: '', steps: 0 }; nextTime = port.now() + SEQUENCER_AUDIO.lead;
      handle = timers.every(tick, SEQUENCER_AUDIO.tickMs); tick();
    },
    /** Stops scheduling. The caller closes the port to silence notes already queued. */
    stop,
    get playing() { return handle !== null; },
    /** Steps whose start time has passed since `start()`. */
    get played() { return played; },
    /** Consecutive reached steps, up to now, that were scheduled with `key`. Steps still in the lookahead never count. */
    reached(key: string) { return run.key === key ? run.steps : 0; },
  };
}
