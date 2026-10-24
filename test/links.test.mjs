import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkSymlinks, readGitIndex } from "../scripts/lib/links.mjs";
import { fixtureIndex } from "./fixture-repo.mjs";

test("the three links pass when each is a symlink to its target", () => {
  const { entries, readBlob } = fixtureIndex();
  assert.deepEqual(checkSymlinks(entries, readBlob, ["openflirt"]), []);
});

test("a link committed as a regular file fails", () => {
  const { entries, readBlob } = fixtureIndex();
  const asFile = entries.map((entry) => (entry.path === "CLAUDE.md" ? { ...entry, mode: "100644" } : entry));
  assert.deepEqual(checkSymlinks(asFile, readBlob, ["openflirt"]).map((finding) => finding.file), ["CLAUDE.md"]);
});

test("a link with the wrong target fails", () => {
  const { entries } = fixtureIndex();
  const findings = checkSymlinks(entries, () => "../skills/openflirt", ["openflirt"]);
  assert.deepEqual(findings.map((finding) => finding.file), ["CLAUDE.md", ".agents/skills/openflirt", ".claude/skills/openflirt"]);
});

test("a missing skill link and a stray link both fail", () => {
  const { entries, readBlob } = fixtureIndex();
  const stray = [...entries.filter((entry) => entry.path !== ".claude/skills/openflirt"), { mode: "120000", sha: "AGENTS", path: ".agents/skills/old" }];
  assert.deepEqual(checkSymlinks(stray, readBlob, ["openflirt"]).map((finding) => finding.file), [".claude/skills/openflirt", ".agents/skills/old"]);
});

test("the index reader sees a symlink that exists only in the git index", (t) => {
  const root = mkdtempSync(join(tmpdir(), "openflirt-git-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (args, input) => execFileSync("git", args, { cwd: root, encoding: "utf8", input }).trim();
  git(["init", "-q"]);
  const sha = git(["hash-object", "-w", "--stdin"], "AGENTS.md");
  git(["update-index", "--add", "--cacheinfo", "120000," + sha + ",CLAUDE.md"]);
  const index = readGitIndex(root);
  assert.deepEqual(checkSymlinks(index.entries, index.readBlob, []), []);
});
