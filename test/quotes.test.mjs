import assert from "node:assert/strict";
import { test } from "node:test";
import { loadLectures } from "../scripts/lib/corpus.mjs";
import { collectPrinciples } from "../scripts/lib/principles.mjs";
import { checkQuotes, normalize, parseTranscript, quoteFinding } from "../scripts/lib/transcript.mjs";
import { edit, fixtureRepo, read } from "./fixture-repo.mjs";

const TRANSCRIPT = "corpus/RhfqIi3DmWU/transcript.md";
const paragraphsOf = (root) => parseTranscript(read(root, TRANSCRIPT), TRANSCRIPT, "RhfqIi3DmWU").paragraphs;
const principlesOf = (root) => collectPrinciples(root, loadLectures(root).lectures).principles;
const at = (t, text) => ({ t, sec: Number(t.slice(0, 2)) * 60 + Number(t.slice(3)), text });

test("quotes found in their time window pass, elisions and punctuation included", (t) => {
  const root = fixtureRepo(t);
  assert.deepEqual(checkQuotes(principlesOf(root), paragraphsOf(root)), []);
});

test("normalize drops whitespace and the listed punctuation and lowercases ASCII", () => {
  assert.equal(normalize("“OK,” 그지? (말…보다) - 행동!"), "ok그지말보다행동");
});

test("a quote absent from the transcript fails at its line", (t) => {
  const root = fixtureRepo(t);
  edit(root, "skills/openflirt/references/part1.md", "말보다 행동을 봐라", "말보다 마음을 봐라");
  const findings = checkQuotes(principlesOf(root), paragraphsOf(root));
  assert.deepEqual(findings.map((finding) => [finding.file, finding.line]), [["skills/openflirt/references/part1.md", 8]]);
});

test("a quote outside its time window fails", (t) => {
  const root = fixtureRepo(t);
  assert.match(quoteFinding(at("00:30", "좋아할수록 거리를 둬라"), paragraphsOf(root)) ?? "", /not in the transcript/);
});

test("the window reaches 75 s back and 15 s ahead", (t) => {
  const paragraphs = paragraphsOf(fixtureRepo(t));
  assert.equal(quoteFinding(at("03:15", "좋아할수록 거리를 둬라"), paragraphs), undefined);
  assert.equal(quoteFinding(at("01:45", "좋아할수록 거리를 둬라"), paragraphs), undefined);
  assert.notEqual(quoteFinding(at("03:16", "좋아할수록 거리를 둬라"), paragraphs), undefined);
});

test("elided fragments out of order fail", (t) => {
  assert.notEqual(quoteFinding(at("00:41", "신호야…약속을 미루면"), paragraphsOf(fixtureRepo(t))), undefined);
});

test("a paragraph whose t= disagrees with its time fails", () => {
  const { findings } = parseTranscript("## 소제목\n\n[00:10](https://youtu.be/RhfqIi3DmWU?t=11) 문장\n", "t.md", "RhfqIi3DmWU");
  assert.deepEqual(findings.map((finding) => finding.line), [3]);
});
