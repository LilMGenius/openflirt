// Skill folder check: the SKILL.md rules of Codex's skill-creator quick_validate.py (frontmatter keys, name,
// description, and the unfinished [TODO: ...] placeholders it rejects in the description and in the body outside
// code fences), plus the Agent Skills specification's non-empty description rule, as applied by its skills-ref
// validator (a description that is only whitespace is blank), plus the agents/openai.yaml interface fields hosts
// list and route a skill by (skillCreator in the global AGENTS.md). The rules are rebuilt from reading that file,
// so QUICK_VALIDATE_SHA256 pins the bytes they came from and a test compares it with the installed copy
// (hostParser in the global AGENTS.md).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml, splitFrontmatter } from "./frontmatter.mjs";

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const QUICK_VALIDATE_SHA256 = "6068513d924ed3559e186dfcdead7439129828dcf402167fd925c06dffbf2806";
const TODO_DESCRIPTION = "Description contains an unfinished TODO placeholder";
const TODO_BODY = "Skill instructions contain an unfinished TODO placeholder";
const FENCE = /^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/;
const TODO_LINE = /^ {0,3}\[TODO:[^\n]*\][ \t]*$/;
const FRONTMATTER_KEYS = ["name", "description", "license", "allowed-tools", "metadata"];
const isMapping = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const chars = (text) => [...text].length;

function nameFindings(name, folder, line) {
  if (typeof name !== "string") return [{ line, reason: "name must be a string" }];
  const out = [];
  if (!NAME.test(name)) out.push({ line, reason: "name must match ^[a-z0-9]+(-[a-z0-9]+)*$" });
  if (chars(name) > 64) out.push({ line, reason: "name must be at most 64 characters" });
  if (name !== folder) out.push({ line, reason: 'name "' + name + '" must equal its folder name "' + folder + '"' });
  return out;
}

function descriptionFindings(description, line) {
  if (typeof description !== "string") return [{ line, reason: "description must be a string" }];
  const out = [];
  const length = chars(description);
  if (description.trim() === "") out.push({ line, reason: "description must not be blank" });
  else if (length > 1024) out.push({ line, reason: "description must be 1 to 1024 characters (has " + length + ")" });
  if (/[<>]/.test(description)) out.push({ line, reason: "description must not contain < or >" });
  if (description.trim().startsWith("[TODO:")) out.push({ line, reason: TODO_DESCRIPTION });
  return out;
}

// A fence opens on a backtick or tilde run of three or more (a list marker may precede it), and only a run of the
// same character, at least as long and followed by nothing but whitespace, closes it. Fence lines are never checked.
function bodyFindings(lines, firstLine, file) {
  const out = [];
  let open = null;
  lines.forEach((line, index) => {
    const fence = FENCE.exec(line);
    if (fence) {
      const run = fence[1];
      if (open === null) open = { char: run[0], length: run.length };
      else if (run[0] === open.char && run.length >= open.length && fence[2].trim() === "") open = null;
      return;
    }
    if (open === null && TODO_LINE.test(line)) out.push({ file, line: firstLine + index, reason: TODO_BODY });
  });
  return out;
}

const frontmatterRules = (folder) => (data, lineOf) => {
  if (!isMapping(data)) return [{ line: lineOf([]), reason: "frontmatter must be a YAML mapping" }];
  const unknown = Object.keys(data)
    .filter((key) => !FRONTMATTER_KEYS.includes(key))
    .map((key) => ({ line: lineOf([key]), reason: 'key "' + key + '" is not allowed; allowed keys: ' + FRONTMATTER_KEYS.join(", ") }));
  return [
    ...unknown,
    ...nameFindings(data.name, folder, lineOf(["name"])),
    ...descriptionFindings(data.description, lineOf(["description"])),
  ];
};

const interfaceRules = (name) => (data, lineOf) => {
  const face = isMapping(data) ? data.interface : undefined;
  if (!isMapping(face)) return [{ line: lineOf(["interface"]), reason: "interface must be a mapping" }];
  const at = (key) => lineOf(["interface", key]);
  const out = [];
  const title = face.display_name;
  if (typeof title !== "string" || title.trim() === "") out.push({ line: at("display_name"), reason: "interface.display_name must be a non-empty string" });
  const blurb = face.short_description;
  if (typeof blurb !== "string") out.push({ line: at("short_description"), reason: "interface.short_description must be a string" });
  else if (chars(blurb) < 25 || chars(blurb) > 64) out.push({ line: at("short_description"), reason: "interface.short_description must be 25 to 64 characters (has " + chars(blurb) + ")" });
  const prompt = face.default_prompt;
  if (typeof prompt !== "string" || !prompt.includes("$" + name)) out.push({ line: at("default_prompt"), reason: "interface.default_prompt must be a string that names $" + name });
  return out;
};

export function checkSkillMd(text, file, folder) {
  const split = splitFrontmatter(text, file);
  if (split.yaml === undefined) return split.findings;
  return [
    ...parseYaml(split.yaml, file, split.firstLine, frontmatterRules(folder)),
    ...bodyFindings(split.body, split.bodyLine, file),
  ];
}

export const checkOpenaiYaml = (text, file, name) => parseYaml(text, file, 1, interfaceRules(name));

// The agent that loads a skill reads SKILL.md first, so a script it never names is never run
// (scriptsRunSkillsJudge in the global AGENTS.md); whether the prose says what the script reads
// and writes stays a judgment for review.
export function scriptFindings(root, name, skillText) {
  const dir = join(root, "skills", name, "scripts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => "scripts/" + entry.name)
    .filter((script) => !skillText.includes(script))
    .map((script) => ({ file: "skills/" + name + "/SKILL.md", line: 1, reason: script + " is not named in SKILL.md; name each script with what it reads and writes" }));
}

export function listSkills(root) {
  const dir = join(root, "skills");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}

export function checkSkills(root) {
  const names = listSkills(root);
  if (names.length === 0) return { names, findings: [{ file: "skills", line: 1, reason: "skills/ holds no skill folder" }] };
  const findings = [];
  for (const name of names) {
    const parts = [
      ["SKILL.md", (text, file) => checkSkillMd(text, file, name)],
      ["agents/openai.yaml", (text, file) => checkOpenaiYaml(text, file, name)],
    ];
    for (const [relative, check] of parts) {
      const file = "skills/" + name + "/" + relative;
      const path = join(root, file);
      findings.push(...(existsSync(path) ? check(readFileSync(path, "utf8"), file) : [{ file, line: 1, reason: "file is missing" }]));
    }
    const skillMd = join(root, "skills", name, "SKILL.md");
    if (existsSync(skillMd)) findings.push(...scriptFindings(root, name, readFileSync(skillMd, "utf8")));
  }
  return { names, findings };
}
