import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { QUICK_VALIDATE_SHA256, checkOpenaiYaml, checkSkillMd, checkSkills } from "../scripts/lib/skills.mjs";
import { edit, fixtureRepo, write } from "./fixture-repo.mjs";

const skillMd = (frontmatter) => "---\n" + frontmatter + "\n---\n\n# body\n";

test("a well-formed skill folder passes", (t) => {
  const root = fixtureRepo(t);
  assert.deepEqual(checkSkills(root), { names: ["openflirt"], findings: [] });
});

test("an unquoted description holding ': ' fails with line and column under both YAML versions", () => {
  const findings = checkSkillMd(skillMd("name: openflirt\ndescription: gamewiki: recommended builds"), "SKILL.md", "openflirt");
  assert.equal(findings.length, 1);
  assert.deepEqual([findings[0].line, findings[0].col], [3, 14]);
  assert.match(findings[0].reason, /\(YAML 1\.1, 1\.2\)$/);
});

test("a duplicate frontmatter key fails", () => {
  const findings = checkSkillMd(skillMd('name: openflirt\nname: openflirt\ndescription: "x"'), "SKILL.md", "openflirt");
  assert.equal(findings[0].line, 3);
  assert.match(findings[0].reason, /DUPLICATE_KEY/);
});

test("a name that differs from its folder fails on the name line", () => {
  const findings = checkSkillMd(skillMd('description: "x"\nname: open-flirt'), "SKILL.md", "openflirt");
  assert.deepEqual(findings.map((finding) => finding.line), [3]);
});

test("a key outside the allowed set fails", () => {
  const findings = checkSkillMd(skillMd('name: openflirt\ndescription: "x"\nversion: 1'), "SKILL.md", "openflirt");
  assert.deepEqual(findings.map((finding) => finding.line), [4]);
});

test("a description with angle brackets fails", () => {
  const findings = checkSkillMd(skillMd('name: openflirt\ndescription: "use <tag>"'), "SKILL.md", "openflirt");
  assert.equal(findings.length, 1);
});

test("a missing closing --- fails", () => {
  assert.equal(checkSkillMd("---\nname: openflirt\n", "SKILL.md", "openflirt").length, 1);
});

test("a short_description under 25 characters fails", () => {
  const yaml = 'interface:\n  display_name: "x"\n  short_description: "too short"\n  default_prompt: "Use $openflirt."\n';
  assert.deepEqual(checkOpenaiYaml(yaml, "openai.yaml", "openflirt").map((finding) => finding.line), [3]);
});

test("a default_prompt that does not name $<skill> fails", (t) => {
  const root = fixtureRepo(t);
  edit(root, "skills/openflirt/agents/openai.yaml", "$openflirt", "openflirt");
  assert.deepEqual(checkSkills(root).findings.map((finding) => [finding.file, finding.line]), [["skills/openflirt/agents/openai.yaml", 4]]);
});

test("a script SKILL.md does not name fails until SKILL.md names it", (t) => {
  const root = fixtureRepo(t);
  write(root, "skills/openflirt/scripts/answer.mjs", "");
  assert.deepEqual(checkSkills(root).findings.map((finding) => [finding.file, finding.reason.split(" ")[0]]), [["skills/openflirt/SKILL.md", "scripts/answer.mjs"]]);
  edit(root, "skills/openflirt/SKILL.md", "먼저", "`scripts/answer.mjs`가 답을 쓴다. 먼저");
  assert.deepEqual(checkSkills(root).findings, []);
});

const withBody = (body) => "---\nname: openflirt\ndescription: \"x\"\n---\n" + body;
const bodyFindings = (body) => checkSkillMd(withBody(body), "SKILL.md", "openflirt").map((finding) => [finding.line, finding.reason]);
const PLACEHOLDER = "Skill instructions contain an unfinished TODO placeholder";
const FENCE = "```";

test("a [TODO: ...] description fails on the description line", () => {
  const findings = checkSkillMd(skillMd('name: openflirt\ndescription: "[TODO: say what it does]"'), "SKILL.md", "openflirt");
  assert.deepEqual(findings.map((finding) => [finding.line, finding.reason]), [[3, "Description contains an unfinished TODO placeholder (YAML 1.1, 1.2)"]]);
});

test("a body [TODO: ...] line fails and reports its SKILL.md line", () => {
  assert.deepEqual(bodyFindings("\n# body\n\n[TODO: write this]\n"), [[8, PLACEHOLDER]]);
});

test("a TODO line inside a backtick or tilde fence passes, and the line after the fence closes fails", () => {
  assert.deepEqual(bodyFindings(FENCE + "\n[TODO: a]\n" + FENCE + "\n[TODO: b]\n"), [[8, PLACEHOLDER]]);
  assert.deepEqual(bodyFindings("~~~\n[TODO: a]\n~~~\n[TODO: b]\n"), [[8, PLACEHOLDER]]);
});

test("a fence opened in a list item hides a TODO line until it closes", () => {
  assert.deepEqual(bodyFindings("- " + FENCE + "\n[TODO: a]\n" + FENCE + "\n[TODO: b]\n"), [[8, PLACEHOLDER]]);
});

test("a longer fence is not closed by a shorter one", () => {
  assert.deepEqual(bodyFindings(FENCE + "`\n" + FENCE + "\n[TODO: a]\n" + FENCE + "`\n[TODO: b]\n"), [[9, PLACEHOLDER]]);
});

test("a fence is closed only by its own character with nothing after it", () => {
  assert.deepEqual(bodyFindings(FENCE + "\n~~~\n" + FENCE + " x\n[TODO: a]\n" + FENCE + "\n[TODO: b]\n"), [[10, PLACEHOLDER]]);
});

test("a TODO-looking line that is not a whole placeholder line passes", () => {
  assert.deepEqual(bodyFindings("    [TODO: indented four]\n[TODO: trailing] text\ntext [TODO: x]\n"), []);
});

test("the installed quick_validate.py is the file the rules were ported from", (t) => {
  const path = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "skills", ".system", "skill-creator", "scripts", "quick_validate.py");
  if (!existsSync(path)) return t.skip("Codex's quick_validate.py is not installed here");
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  assert.equal(actual, QUICK_VALIDATE_SHA256, "the host validator changed: re-read " + path + " and port any rule change into scripts/lib/skills.mjs before updating QUICK_VALIDATE_SHA256");
});
