import assert from "node:assert/strict";
import { test } from "node:test";
import { checkOpenaiYaml, checkSkillMd, checkSkills } from "../scripts/lib/skills.mjs";
import { edit, fixtureRepo } from "./fixture-repo.mjs";

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
