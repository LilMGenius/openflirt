import assert from "node:assert/strict";
import { test } from "node:test";
import { report, runChecks } from "../scripts/lib/checks.mjs";
import { fixtureIndex, fixtureRepo, REPO_ROOT } from "./fixture-repo.mjs";

test("every check passes on the fixture repository", (t) => {
  const results = runChecks(fixtureRepo(t), { gitIndex: fixtureIndex });
  assert.deepEqual(report(results), ["ok skills", "ok symlinks", "ok principles", "ok transcript", "ok quotes", "ok coverage", "ok anchors", "ok schema", "ok eval"]);
});

test("every check passes on this repository", () => {
  assert.deepEqual(report(runChecks(REPO_ROOT)).filter((line) => line.startsWith("FAIL")), []);
});
