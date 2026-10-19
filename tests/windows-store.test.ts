import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncDirectory } from "../plugin/server/store";

test("a directory fsync is skipped on Windows, where opening a directory to sync it fails with EPERM", async t => {
  const directory = await mkdtemp(join(tmpdir(), "lienzo-sync-")); t.after(() => rm(directory, { recursive: true, force: true }));
  await syncDirectory(join(directory, "does-not-exist"), "win32");
  await syncDirectory(directory);
  await assert.rejects(syncDirectory(join(directory, "does-not-exist"), "linux"), /ENOENT/);
});
