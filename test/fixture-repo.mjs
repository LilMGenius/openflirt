// Fresh copy of test/fixtures/repo per test, so a test can break one file without touching others.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "repo");
export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const FIXTURE_IDS = ["action-first", "distance"];

export function fixtureRepo(t) {
  const root = mkdtempSync(join(tmpdir(), "openflirt-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(FIXTURE, root, { recursive: true });
  const schema = JSON.parse(readFileSync(join(REPO_ROOT, "schema", "answer.schema.json"), "utf8"));
  schema.properties.principles.items.enum = FIXTURE_IDS;
  write(root, "schema/answer.schema.json", JSON.stringify(schema, null, 2) + "\n");
  return root;
}

export const read = (root, file) => readFileSync(join(root, file), "utf8");

export function write(root, file, text) {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
}

export const edit = (root, file, from, to) => {
  const before = read(root, file);
  if (!before.includes(from)) throw new RangeError(file + " does not contain " + JSON.stringify(from));
  write(root, file, before.replace(from, to));
};

// Symlinks the fixture would carry in a real git index.
export const fixtureIndex = () => {
  const targets = { CLAUDE: "AGENTS.md", AGENTS: "../../skills/openflirt", CLAUDES: "../../skills/openflirt" };
  const entries = [
    { mode: "120000", sha: "CLAUDE", path: "CLAUDE.md" },
    { mode: "120000", sha: "AGENTS", path: ".agents/skills/openflirt" },
    { mode: "120000", sha: "CLAUDES", path: ".claude/skills/openflirt" },
    { mode: "100644", sha: "x", path: "AGENTS.md" },
  ];
  return { entries, readBlob: (sha) => targets[sha] };
};
