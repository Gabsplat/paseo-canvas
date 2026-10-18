import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { EventEmitter } from "node:events";
import { allowedUrl, channelFile, compareVersions, DEFAULT_FEED, isNewer, parseUpdateInfo, parseVersion, pickMacZip, resolveFeed, type Feed } from "../apps/desktop/src/main/updater/feed";
import { downloadVerified, fetchText, sha512File, verifySha512 } from "../apps/desktop/src/main/updater/download";
import { BUNDLE_ID, MOVE_TO_APPLICATIONS, blockerMessage, bundleFromExecutable, checkExtracted, installBlocker, leftovers, realOps, swapBundle, type SwapOps } from "../apps/desktop/src/main/updater/mac-bundle";
import { MacZipUpdater } from "../apps/desktop/src/main/updater/mac";
import { describeUpdateError, UpdateController } from "../apps/desktop/src/main/updater/controller";
import type { UpdateEngine } from "../apps/desktop/src/main/updater/engine";
import { updateWords } from "../apps/desktop/src/shared/update-words";
import { updateStateSchema } from "../apps/desktop/src/shared/rpc";

const sha = (data: string | Buffer) => createHash("sha512").update(data).digest("base64");
async function scratch(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "lienzo-updater-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
/** A fake Lienzo.app with an XML Info.plist, the way electron-builder writes it. */
function fakeBundle(parent: string, version: string, id = BUNDLE_ID, name = "Lienzo.app") {
  const bundle = join(parent, name);
  mkdirSync(join(bundle, "Contents", "MacOS"), { recursive: true });
  writeFileSync(join(bundle, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>CFBundleIdentifier</key>\n  <string>${id}</string>\n  <key>CFBundleShortVersionString</key>\n  <string>${version}</string>\n</dict>\n</plist>\n`);
  writeFileSync(join(bundle, "Contents", "MacOS", "Lienzo"), `binary ${version}`);
  return bundle;
}
const marker = (bundle: string) => readFileSync(join(bundle, "Contents", "MacOS", "Lienzo"), "utf8");

/** A local feed server. Routes map a path to a body, a redirect or a status. */
async function feedServer(t: TestContext, routes: Record<string, { body?: string | Buffer; redirect?: string; status?: number }>) {
  const hits: string[] = [];
  const server: Server = createServer((request, response) => {
    const path = request.url ?? "/"; hits.push(path);
    const route = routes[path];
    if (!route) { response.writeHead(404).end(); return; }
    if (route.redirect) { response.writeHead(302, { location: route.redirect }).end(); return; }
    response.writeHead(route.status ?? 200, { "content-length": String(Buffer.byteLength(route.body ?? "")) }).end(route.body ?? "");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, hits, feed: { url: `${base}/feed`, hosts: ["127.0.0.1"], allowHttp: true } satisfies Feed };
}

// ---- Versions

test("versions compare by semver precedence", () => {
  assert.ok(isNewer("0.2.0", "0.1.0"));
  assert.ok(isNewer("0.10.0", "0.9.9"), "numeric, not lexical");
  assert.ok(isNewer("1.0.0", "0.99.99"));
  assert.ok(!isNewer("0.1.0", "0.1.0"));
  assert.ok(!isNewer("0.1.0", "0.2.0"));
  assert.ok(isNewer("1.0.0", "1.0.0-beta.2"), "a release is newer than its pre-release");
  assert.ok(isNewer("1.0.0-beta.11", "1.0.0-beta.2"), "numeric pre-release parts compare as numbers");
  assert.ok(isNewer("1.0.0-beta", "1.0.0-alpha.1"));
  assert.ok(isNewer("1.0.0-alpha.1", "1.0.0-alpha"), "more parts win when the rest is equal");
  assert.equal(compareVersions("v1.2.3", "1.2.3+build.7"), 0, "a leading v and build metadata are ignored");
  assert.equal(parseVersion("1.2"), null);
  assert.equal(parseVersion("desktop-v1.2.3"), null, "tag names are never versions");
  assert.throws(() => compareVersions("1.2", "1.2.0"), /Not a version/);
});

// ---- Feed files

const linuxYml = `version: 0.2.0
files:
  - url: Lienzo-0.2.0-x86_64.AppImage
    sha512: ${sha("appimage")}
    size: 123456789
    blockMapSize: 140000
  - url: Lienzo-0.2.0-amd64.deb
    sha512: ${sha("deb")}
    size: 98765432
path: Lienzo-0.2.0-x86_64.AppImage
sha512: ${sha("appimage")}
releaseDate: '2026-10-18T20:00:00.000Z'
`;
const macYml = `version: 0.2.0
files:
  - url: Lienzo-0.2.0-mac-x64.zip
    sha512: ${sha("x64 zip")}
    size: 120000000
  - url: Lienzo-0.2.0-mac-arm64.zip
    sha512: ${sha("arm64 zip")}
    size: 115000000
  - url: Lienzo-0.2.0-mac-x64.dmg
    sha512: ${sha("x64 dmg")}
    size: 125000000
  - url: Lienzo-0.2.0-mac-arm64.dmg
    sha512: ${sha("arm64 dmg")}
    size: 119000000
path: Lienzo-0.2.0-mac-x64.zip
sha512: ${sha("x64 zip")}
releaseDate: '2026-10-18T20:00:00.000Z'
`;

test("latest*.yml files read as electron-builder writes them", () => {
  const linux = parseUpdateInfo(linuxYml);
  assert.equal(linux.version, "0.2.0");
  assert.deepEqual(linux.files.map(file => file.url), ["Lienzo-0.2.0-x86_64.AppImage", "Lienzo-0.2.0-amd64.deb"]);
  assert.equal(linux.files[0].size, 123456789);
  assert.equal(linux.files[0].sha512, sha("appimage"));
  // No YAML type guessing: 1.10.0 stays a string, and so would 1.10.
  assert.equal(parseUpdateInfo(linuxYml.replace("version: 0.2.0", "version: 1.10.0")).version, "1.10.0");
  const mac = parseUpdateInfo(macYml);
  assert.equal(pickMacZip(mac, "arm64").url, "Lienzo-0.2.0-mac-arm64.zip");
  assert.equal(pickMacZip(mac, "x64").url, "Lienzo-0.2.0-mac-x64.zip");
  assert.throws(() => pickMacZip(parseUpdateInfo(macYml.replace(/  - url: Lienzo-0\.2\.0-mac-arm64\.zip[\s\S]*?size: 115000000\n/, "")), "arm64"), /no Mac download for Apple silicon/);
});

test("malformed or hostile feed files are refused", () => {
  assert.throws(() => parseUpdateInfo("version: [unclosed"), /not readable YAML/);
  assert.throws(() => parseUpdateInfo("just text"), /expected format/);
  assert.throws(() => parseUpdateInfo(linuxYml.replace("version: 0.2.0", "version: latest")), /version/);
  assert.throws(() => parseUpdateInfo(`version: 0.2.0\nfiles: []\n`), /expected format/);
  assert.throws(() => parseUpdateInfo(linuxYml.replace(/sha512: \S+\n    size: 123456789/, "size: 123456789")), /sha512/, "a file without a checksum");
  assert.throws(() => parseUpdateInfo(linuxYml.replace(sha("appimage"), "abc")), /sha512 must be base64/);
  assert.throws(() => parseUpdateInfo(linuxYml.replace("url: Lienzo-0.2.0-x86_64.AppImage", "url: https://evil.example/x.AppImage")), /unexpected file/);
  assert.throws(() => parseUpdateInfo(linuxYml.replace("url: Lienzo-0.2.0-x86_64.AppImage", "url: ../../x.AppImage")), /unexpected file/);
});

test("channel files and the feed's hosts", () => {
  assert.equal(channelFile("darwin", "arm64"), "latest-mac.yml");
  assert.equal(channelFile("linux", "x64"), "latest-linux.yml");
  assert.equal(channelFile("linux", "arm64"), "latest-linux-arm64.yml");
  assert.equal(channelFile("win32", "arm64"), "latest.yml");
  const feed = resolveFeed({});
  assert.equal(feed.url, DEFAULT_FEED);
  assert.ok(allowedUrl(`${DEFAULT_FEED}/latest-mac.yml`, feed));
  assert.ok(allowedUrl("https://objects.githubusercontent.com/github-production-release-asset/1/2", feed));
  assert.ok(allowedUrl("https://release-assets.githubusercontent.com/github-production-release-asset/1/2", feed));
  assert.ok(!allowedUrl("http://github.com/Gabsplat/paseo-canvas/releases/latest/download/latest.yml", feed), "plain http");
  assert.ok(!allowedUrl("https://evil.example/latest.yml", feed));
  assert.ok(!allowedUrl("https://github.com.evil.example/x", feed));
  assert.ok(!allowedUrl("https://user:pass@github.com/x", feed));
  assert.ok(!allowedUrl("file:///etc/passwd", feed));
  assert.ok(!allowedUrl("http://127.0.0.1:8080/latest.yml", feed), "no local feed unless asked for");
  // LIENZO_UPDATE_FEED: https anywhere, or http on this computer only.
  const local = resolveFeed({ LIENZO_UPDATE_FEED: "http://127.0.0.1:8080/feed/" });
  assert.equal(local.url, "http://127.0.0.1:8080/feed");
  assert.ok(allowedUrl("http://127.0.0.1:8080/feed/latest-linux.yml", local));
  assert.ok(!allowedUrl("http://192.168.1.2:8080/x", local));
  assert.throws(() => resolveFeed({ LIENZO_UPDATE_FEED: "http://example.com/feed" }), /https, or http on 127\.0\.0\.1/);
  assert.throws(() => resolveFeed({ LIENZO_UPDATE_FEED: "not a url" }), /not a URL/);
  assert.throws(() => resolveFeed({ LIENZO_UPDATE_FEED: "https://u:p@example.com/" }), /credentials/);
});

// ---- Mac paths

test("the Mac updater refuses translocated, disk image and unwritable copies", () => {
  const writable = { writable: () => true }, readOnly = { writable: () => false };
  assert.equal(bundleFromExecutable("/Applications/Lienzo.app/Contents/MacOS/Lienzo"), "/Applications/Lienzo.app");
  assert.equal(bundleFromExecutable("/usr/local/bin/lienzo"), null);
  assert.equal(installBlocker("/Applications/Lienzo.app", writable), null);
  assert.equal(installBlocker("/Users/ana/Applications/Lienzo.app", writable), null);
  assert.equal(installBlocker("/private/var/folders/xy/T/AppTranslocation/1A2B-3C/d/Lienzo.app", writable), "translocated");
  assert.equal(installBlocker("/Volumes/Lienzo 0.2.0/Lienzo.app", writable), "volume");
  assert.equal(installBlocker("/Applications/Lienzo.app", readOnly), "unwritable");
  assert.equal(installBlocker("/Applications/Lienzo.app", { writable: path => path === "/Applications" }), "unwritable", "the bundle itself must be writable too");
  assert.equal(installBlocker(null, writable), "not-bundle");
  for (const reason of ["translocated", "volume", "unwritable"] as const) assert.equal(blockerMessage(reason), MOVE_TO_APPLICATIONS);
  assert.equal(MOVE_TO_APPLICATIONS, "Move Lienzo to Applications to get updates.");
});

test("an unpacked update must be exactly one Lienzo at the expected version", async t => {
  const root = await scratch(t);
  const good = join(root, "good"); mkdirSync(good); fakeBundle(good, "0.2.0");
  assert.equal(checkExtracted(good, "0.2.0"), join(good, "Lienzo.app"));
  assert.throws(() => checkExtracted(good, "0.3.0"), /says version 0\.2\.0, not 0\.3\.0/);
  const other = join(root, "other"); mkdirSync(other); fakeBundle(other, "0.2.0", "com.evil.app");
  assert.throws(() => checkExtracted(other, "0.2.0"), /not Lienzo/);
  const two = join(root, "two"); mkdirSync(two); fakeBundle(two, "0.2.0"); fakeBundle(two, "0.2.0", BUNDLE_ID, "Other.app");
  assert.throws(() => checkExtracted(two, "0.2.0"), /exactly one app/);
  const none = join(root, "none"); mkdirSync(none);
  assert.throws(() => checkExtracted(none, "0.2.0"), /exactly one app/);
});

// ---- sha512

test("sha512 verification of files and downloads", async t => {
  const root = await scratch(t);
  const file = join(root, "a.bin"); writeFileSync(file, "lienzo");
  assert.equal(await sha512File(file), sha("lienzo"));
  assert.ok(await verifySha512(file, sha("lienzo")));
  assert.ok(!(await verifySha512(file, sha("lienzo!"))));

  const zip = Buffer.from("pretend this is a zip ".repeat(1000));
  const server = await feedServer(t, {
    "/feed/good.zip": { body: zip },
    "/feed/redirected.zip": { redirect: "/assets/good.zip" },
    "/assets/good.zip": { body: zip },
    "/feed/away.zip": { redirect: "https://evil.example/x.zip" },
    "/feed/latest.yml": { body: "version: 0.2.0" },
  });
  const progress: number[] = [];
  await downloadVerified(`${server.base}/feed/good.zip`, join(root, "good.zip"), { sha512: sha(zip), size: zip.length }, server.feed, fraction => progress.push(fraction));
  assert.ok(existsSync(join(root, "good.zip")));
  assert.equal(progress.at(-1), 1);
  await downloadVerified(`${server.base}/feed/redirected.zip`, join(root, "redirected.zip"), { sha512: sha(zip) }, server.feed);
  assert.ok(existsSync(join(root, "redirected.zip")), "same-host redirects are followed");
  // A wrong checksum: the file is deleted, nothing unverified stays.
  await assert.rejects(downloadVerified(`${server.base}/feed/good.zip`, join(root, "bad.zip"), { sha512: sha("something else") }, server.feed), /does not match the release checksum/);
  assert.ok(!existsSync(join(root, "bad.zip")));
  await assert.rejects(downloadVerified(`${server.base}/feed/good.zip`, join(root, "short.zip"), { sha512: sha(zip), size: zip.length - 1 }, server.feed), /larger than the release says/);
  assert.ok(!existsSync(join(root, "short.zip")));
  // A redirect off the feed's hosts is refused before any request goes there.
  await assert.rejects(downloadVerified(`${server.base}/feed/away.zip`, join(root, "away.zip"), { sha512: sha(zip) }, server.feed), /Refused to download from evil\.example/);
  await assert.rejects(fetchText(`${server.base}/feed/missing.yml`, server.feed), /No release was found/);
  assert.equal(await fetchText(`${server.base}/feed/latest.yml`, server.feed), "version: 0.2.0");
  await assert.rejects(fetchText(`${server.base}/feed/latest.yml`, { hosts: ["github.com"], allowHttp: false }), /Refused/);
});

// ---- The swap

test("swapping the bundle replaces the app and removes the old one", async t => {
  const root = await scratch(t);
  const apps = join(root, "Applications"); mkdirSync(apps);
  const current = fakeBundle(apps, "0.1.0");
  const staged = join(root, "staging"); mkdirSync(staged); const next = fakeBundle(staged, "0.2.0");
  assert.deepEqual(swapBundle(current, next, realOps, "t1"), { leftover: null });
  assert.equal(marker(current), "binary 0.2.0");
  assert.deepEqual(readdirSync(apps), ["Lienzo.app"], "no old copy left beside it");
  assert.ok(!existsSync(next));
});

test("a swap that fails midway puts the old app back", async t => {
  const root = await scratch(t);
  const apps = join(root, "Applications"); mkdirSync(apps);
  const current = fakeBundle(apps, "0.1.0");
  const staged = join(root, "staging"); mkdirSync(staged); const next = fakeBundle(staged, "0.2.0");
  const steps: string[] = [];
  // The second move (new app in) fails after leaving half a bundle behind, as a cross-volume copy could.
  const failing: SwapOps = {
    ...realOps,
    move(from, to) {
      steps.push(`move ${from.slice(root.length)} -> ${to.slice(root.length)}`);
      if (from === next) { mkdirSync(join(to, "Contents"), { recursive: true }); throw new Error("disk full"); }
      realOps.move(from, to);
    },
    remove(path) { steps.push(`remove ${path.slice(root.length)}`); realOps.remove(path); },
  };
  assert.throws(() => swapBundle(current, next, failing, "t2"), /disk full/);
  assert.equal(marker(current), "binary 0.1.0", "the old app is back at its path");
  assert.deepEqual(readdirSync(apps), ["Lienzo.app"]);
  assert.ok(existsSync(next), "the update stays staged");
  assert.deepEqual(steps, [
    "move /Applications/Lienzo.app -> /Applications/Lienzo.app.old-t2",
    "move /staging/Lienzo.app -> /Applications/Lienzo.app",
    "remove /Applications/Lienzo.app",
    "move /Applications/Lienzo.app.old-t2 -> /Applications/Lienzo.app",
  ]);
});

test("an old copy that cannot be removed is left and found next time", async t => {
  const root = await scratch(t);
  const apps = join(root, "Applications"); mkdirSync(apps);
  const current = fakeBundle(apps, "0.1.0");
  const staged = join(root, "staging"); mkdirSync(staged); const next = fakeBundle(staged, "0.2.0");
  const result = swapBundle(current, next, { ...realOps, remove: () => { throw new Error("busy"); } }, "t3");
  assert.equal(result.leftover, join(apps, "Lienzo.app.old-t3"));
  assert.equal(marker(current), "binary 0.2.0");
  assert.deepEqual(leftovers(current), [join(apps, "Lienzo.app.old-t3")]);
  assert.throws(() => swapBundle(join(apps, "Gone.app"), next), /not where it was/);
});

// ---- The Mac updater, end to end on a temp folder (ditto replaced by a fake unpacker)

test("the Mac updater downloads, verifies, stages and swaps", async t => {
  const root = await scratch(t);
  const apps = join(root, "Applications"); mkdirSync(apps);
  const current = fakeBundle(apps, "0.1.0");
  const zip = Buffer.from("zip bytes ".repeat(500));
  const yml = (sum: string) => `version: 0.2.0\nfiles:\n  - url: Lienzo-0.2.0-mac-arm64.zip\n    sha512: ${sum}\n    size: ${zip.length}\n  - url: Lienzo-0.2.0-mac-x64.zip\n    sha512: ${sha("x")}\n    size: 1\n`;
  const routes: Record<string, { body?: string | Buffer }> = { "/feed/latest-mac.yml": { body: yml(sha(zip)) }, "/feed/Lienzo-0.2.0-mac-arm64.zip": { body: zip } };
  const server = await feedServer(t, routes);
  const extracted: string[] = [], quitHandlers: (() => void)[] = [], events: string[] = [];
  let quit = 0;
  const updater = new MacZipUpdater({
    currentVersion: "0.1.0", bundle: current, arch: "arm64", feed: server.feed, stagingRoot: join(root, "updates"),
    quit: () => { quit++; }, onQuit: handler => { quitHandlers.push(handler); }, log: { info() {}, warn() {}, error() {} },
    // ditto stands in: it only ever sees a zip whose checksum matched.
    extract: async (file, destination) => { assert.equal(await sha512File(file), sha(zip)); extracted.push(file); fakeBundle(destination, "0.2.0"); },
  });
  for (const name of ["checking-for-update", "update-available", "update-not-available", "download-progress", "update-downloaded", "error"]) updater.on(name, () => events.push(name));
  await updater.checkForUpdates();
  assert.equal(extracted.length, 1);
  assert.deepEqual(events.filter(e => e !== "download-progress"), ["checking-for-update", "update-available", "update-downloaded"]);
  assert.ok(events.includes("download-progress"));
  assert.equal(marker(current), "binary 0.1.0", "nothing changes before the restart");
  await updater.prepareInstall();
  assert.equal(marker(current), "binary 0.2.0");
  assert.deepEqual(readdirSync(apps), ["Lienzo.app"]);
  quitHandlers.forEach(handler => handler());
  assert.equal(marker(current), "binary 0.2.0", "quitting after the swap does not swap again");

  // A zip that does not match its checksum is never unpacked.
  const again = fakeBundle(join(root, "again"), "0.1.0");
  routes["/feed/latest-mac.yml"] = { body: yml(sha("other bytes")) };
  const second = new MacZipUpdater({ currentVersion: "0.1.0", bundle: again, arch: "arm64", feed: server.feed, stagingRoot: join(root, "updates2"), quit() {}, onQuit() {}, extract: async () => { extracted.push("second"); } });
  const errors: Error[] = []; second.on("error", error => errors.push(error));
  await assert.rejects(second.checkForUpdates(), /checksum/);
  assert.equal(errors.length, 1);
  assert.equal(extracted.length, 1, "not unpacked");
  assert.deepEqual(readdirSync(join(root, "updates2", "0.2.0")), ["app"], "the bad zip is gone");
  void quit;
});

test("the Mac updater installs a staged update when the app quits", async t => {
  const root = await scratch(t);
  const apps = join(root, "Applications"); mkdirSync(apps);
  const current = fakeBundle(apps, "0.1.0");
  const zip = Buffer.from("zip");
  const server = await feedServer(t, { "/feed/latest-mac.yml": { body: `version: 0.3.0\nfiles:\n  - url: Lienzo-0.3.0-mac-x64.zip\n    sha512: ${sha(zip)}\n    size: ${zip.length}\n` }, "/feed/Lienzo-0.3.0-mac-x64.zip": { body: zip } });
  let onQuit: () => void = () => {};
  const updater = new MacZipUpdater({ currentVersion: "0.1.0", bundle: current, arch: "x64", feed: server.feed, stagingRoot: join(root, "updates"), quit() {}, onQuit: handler => { onQuit = handler; }, extract: async (_file, destination) => { fakeBundle(destination, "0.3.0"); } });
  await updater.checkForUpdates();
  onQuit();
  assert.equal(marker(current), "binary 0.3.0");
  // Up to date: nothing is downloaded.
  const fresh = new MacZipUpdater({ currentVersion: "0.3.0", bundle: current, arch: "x64", feed: server.feed, stagingRoot: join(root, "updates3"), quit() {}, onQuit() {}, extract: async () => { throw new Error("must not unpack"); } });
  const seen: string[] = []; fresh.on("update-not-available", () => seen.push("none"));
  await fresh.checkForUpdates();
  assert.deepEqual(seen, ["none"]);
  // A bundle that says another version is refused.
  const liar = new MacZipUpdater({ currentVersion: "0.1.0", bundle: fakeBundle(join(root, "liar"), "0.1.0"), arch: "x64", feed: server.feed, stagingRoot: join(root, "updates4"), quit() {}, onQuit() {}, extract: async (_file, destination) => { fakeBundle(destination, "0.2.9"); } });
  liar.on("error", () => {});
  await assert.rejects(liar.checkForUpdates(), /says version 0\.2\.9, not 0\.3\.0/);
  await assert.rejects(liar.prepareInstall(), /No update is ready/);
});

// ---- The controller

class FakeEngine extends EventEmitter {
  autoDownload = false; autoInstallOnAppQuit = false; feed = "";
  checks = 0; installs: [boolean | undefined, boolean | undefined][] = []; prepared = 0;
  next: (engine: FakeEngine) => Promise<void> = async engine => { engine.emit("checking-for-update"); engine.emit("update-not-available"); };
  failInstall = false; failPrepare = false;
  setFeedURL(options: { url: string }) { this.feed = options.url; }
  async checkForUpdates() { this.checks++; await this.next(this); return null; }
  quitAndInstall(silent?: boolean, run?: boolean) { this.installs.push([silent, run]); if (this.failInstall) this.emit("error", new Error("EACCES: cannot write")); }
  async prepareInstall() { this.prepared++; if (this.failPrepare) throw new Error("The update failed and the old app is back."); }
}
function controller(engine: FakeEngine | null, extra: Partial<ConstructorParameters<typeof UpdateController>[0]> = {}) {
  const calls: string[] = [];
  const instance = new UpdateController({
    version: "0.1.0", engine: engine as unknown as UpdateEngine, autoCheck: async () => true,
    beforeRestart: async () => { calls.push("beforeRestart"); }, recover: () => { calls.push("recover"); },
    now: () => new Date("2026-10-18T12:00:00.000Z"), ...extra,
  });
  return { instance, calls };
}

test("the controller turns engine events into the state the app shows", async () => {
  const engine = new FakeEngine(), { instance } = controller(engine);
  assert.ok(engine.autoDownload && engine.autoInstallOnAppQuit, "downloads in the background, installs on quit");
  assert.deepEqual(instance.state, { kind: "idle", checkedAt: null });
  await instance.check(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(instance.state, { kind: "idle", checkedAt: "2026-10-18T12:00:00.000Z" });
  let release!: () => void;
  engine.next = async e => {
    e.emit("checking-for-update"); e.emit("update-available", { version: "0.2.0" }); e.emit("download-progress", { percent: 42.4 });
    await new Promise<void>(resolve => { release = resolve; });
    e.emit("update-downloaded", { version: "0.2.0" });
  };
  void instance.check();
  assert.deepEqual(instance.state, { kind: "downloading", version: "0.2.0", percent: 42.4 });
  assert.deepEqual(await instance.check(), instance.state, "a second check while downloading changes nothing");
  assert.equal(engine.checks, 2);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(instance.state, { kind: "ready", version: "0.2.0" });
  await instance.check();
  assert.equal(engine.checks, 2, "no check once an update is ready");
  for (const state of [instance.state, { kind: "error", message: "x", checkedAt: null }, { kind: "off", reason: "x" }]) assert.ok(updateStateSchema.safeParse(state).success);
});

test("errors become words and never escape", async () => {
  const engine = new FakeEngine(), { instance } = controller(engine);
  engine.next = async () => { throw Object.assign(new Error("getaddrinfo ENOTFOUND github.com"), { code: "ENOTFOUND" }); };
  await instance.check(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(instance.state, { kind: "error", message: "Could not reach the update server. Check the connection and try again.", checkedAt: null });
  engine.next = async e => { e.emit("error", new Error("sha512 checksum mismatch, expected abc, got def")); throw new Error("sha512 checksum mismatch"); };
  await instance.check(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(instance.state.kind === "error" && instance.state.message, "The download did not match its checksum, so it was thrown away.");
  assert.equal(describeUpdateError(new Error("HttpError: 404 \nlong body\nmore")), "No release was found on the update server.");
  assert.equal(describeUpdateError(new Error("net::ERR_BLOCKED_BY_CLIENT")), "The update came from an unexpected address, so it was refused.");
  assert.equal(describeUpdateError(new Error("first line\nstack")), "first line");
  assert.equal(describeUpdateError(new Error("x".repeat(400))).length, 158);
});

test("the schedule: 10 s after start, then every 6 h, only with the setting on", async () => {
  const engine = new FakeEngine();
  const timeouts: [() => void, number][] = [], intervals: [() => void, number][] = [];
  let auto = true;
  const timers = {
    setTimeout: ((fn: () => void, ms: number) => { timeouts.push([fn, ms]); return timeouts.length; }) as unknown as typeof setTimeout,
    setInterval: ((fn: () => void, ms: number) => { intervals.push([fn, ms]); return intervals.length; }) as unknown as typeof setInterval,
    clearTimeout: (() => {}) as typeof clearTimeout, clearInterval: (() => {}) as typeof clearInterval,
  };
  const { instance } = controller(engine, { timers, autoCheck: async () => auto });
  instance.start();
  assert.deepEqual(timeouts.map(([, ms]) => ms), [10_000]);
  assert.deepEqual(intervals.map(([, ms]) => ms), [6 * 60 * 60 * 1000]);
  timeouts[0][0](); await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.checks, 1);
  auto = false;
  intervals[0][0](); await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.checks, 1, "the switch off: no scheduled check");
  await instance.check();
  assert.equal(engine.checks, 2, "the button still checks");
  // A copy without an engine (development, preview) never schedules anything.
  const off = controller(null, { timers, unavailable: { kind: "off", reason: "Updates are off in development builds." } }).instance;
  off.start();
  assert.equal(timeouts.length, 1);
  assert.deepEqual(await off.check(), { kind: "off", reason: "Updates are off in development builds." });
  assert.equal(await off.restart(), false);
});

test("restart installs after closing the app, and recovers when the install fails", async () => {
  const engine = new FakeEngine(), { instance, calls } = controller(engine);
  assert.equal(await instance.restart(), false, "nothing ready");
  engine.next = async e => { e.emit("update-available", { version: "0.2.0" }); e.emit("update-downloaded", { version: "0.2.0" }); };
  await instance.check(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(await instance.restart(), true);
  assert.equal(engine.prepared, 1);
  assert.deepEqual(calls, ["beforeRestart"]);
  assert.deepEqual(engine.installs, [[true, true]]);

  // The Mac swap fails before anything closes: the app keeps running and says why.
  const mac = new FakeEngine(), second = controller(mac);
  mac.next = async e => { e.emit("update-downloaded", { version: "0.2.0" }); };
  await second.instance.check(); await new Promise(resolve => setImmediate(resolve));
  mac.failPrepare = true;
  assert.equal(await second.instance.restart(), false);
  assert.deepEqual(second.calls, [], "nothing closed");
  assert.equal(mac.installs.length, 0);
  assert.equal(second.instance.state.kind, "error");

  // electron-updater's install fails after the app closed: the same version starts again.
  const linux = new FakeEngine(), third = controller(linux);
  linux.next = async e => { e.emit("update-downloaded", { version: "0.2.0" }); };
  await third.instance.check(); await new Promise(resolve => setImmediate(resolve));
  linux.failInstall = true;
  assert.equal(await third.instance.restart(), false);
  assert.deepEqual(third.calls, ["beforeRestart", "recover"]);
});

test("Settings → About words for every state", () => {
  const now = Date.parse("2026-10-18T12:00:00.000Z");
  assert.equal(updateWords({ kind: "idle", checkedAt: "2026-10-18T11:55:00.000Z" }, now).title, "Up to date");
  assert.equal(updateWords({ kind: "idle", checkedAt: "2026-10-18T11:55:00.000Z" }, now).detail, "Checked 5 min ago");
  assert.equal(updateWords({ kind: "idle", checkedAt: null }, now).title, "Not checked yet");
  assert.equal(updateWords({ kind: "checking" }, now).title, "Checking…");
  assert.equal(updateWords({ kind: "downloading", version: "0.2.0", percent: 42.7 }, now).title, "Downloading 42 %");
  assert.equal(updateWords({ kind: "ready", version: "0.2.0" }, now).title, "Ready to restart");
  assert.deepEqual(updateWords({ kind: "error", message: "Could not reach the update server. Check the connection and try again.", checkedAt: null }, now), { title: "Update failed", detail: "Could not reach the update server. Check the connection and try again.", tone: "danger" });
  assert.equal(updateWords({ kind: "blocked", reason: MOVE_TO_APPLICATIONS }, now).detail, MOVE_TO_APPLICATIONS);
});
