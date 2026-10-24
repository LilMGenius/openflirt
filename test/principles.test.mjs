import assert from "node:assert/strict";
import { test } from "node:test";
import { collectPrinciples, parsePrincipleFile } from "../scripts/lib/principles.mjs";
import { FIXTURE_IDS, fixtureRepo } from "./fixture-repo.mjs";

test("principles come from part*.md only, with their quotes", (t) => {
  const { principles, findings } = collectPrinciples(fixtureRepo(t));
  assert.deepEqual(findings, []);
  assert.deepEqual(principles.map((principle) => principle.id), FIXTURE_IDS);
  assert.deepEqual(principles[0].quotes.map((quote) => [quote.line, quote.sec]), [[8, 12], [9, 41]]);
});

test("a principle without a quote line fails", () => {
  const { findings } = parsePrincipleFile('<a id="bare"></a>\n### 제목\n\n본문만 있다.\n', "part9.md");
  assert.deepEqual(findings.map((finding) => finding.line), [1]);
});

test("an id outside ^[a-z]+(-[a-z]+)*$ fails", () => {
  const { findings } = parsePrincipleFile('<a id="Bad_id"></a>\n### 제목\n> [00:01] 인용\n', "part9.md");
  assert.deepEqual(findings.map((finding) => finding.line), [1]);
});

test("an anchor not followed by a ### heading fails", () => {
  const { findings } = parsePrincipleFile('<a id="no-title"></a>\n\n## 제목\n> [00:01] 인용\n', "part9.md");
  assert.deepEqual(findings.map((finding) => finding.line), [3]);
});

test("a malformed quote line fails", () => {
  const { findings } = parsePrincipleFile('<a id="x"></a>\n### 제목\n> [0:01] 인용\n> [00:02] 인용\n', "part9.md");
  assert.deepEqual(findings.map((finding) => finding.line), [3]);
});
