// Fresh copy of test/fixtures/repo per test, so a test can break one file without touching others.
// The copy gets llms.txt and llms-full.txt built from its own files, as node scripts/llms.mjs would.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLlms } from "../scripts/lib/llms.mjs";

export const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "repo");
export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const FIXTURE_IDS = ["action-first", "distance"];
export const FIXTURE_VIDEOS = ["RhfqIi3DmWU"];

export function fixtureRepo(t) {
  const root = mkdtempSync(join(tmpdir(), "openflirt-fixture-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(FIXTURE, root, { recursive: true });
  const schema = JSON.parse(readFileSync(join(REPO_ROOT, "schema", "answer.schema.json"), "utf8"));
  schema.properties.principles.items.enum = FIXTURE_IDS;
  schema.properties.citations.items.properties.video.enum = FIXTURE_VIDEOS;
  write(root, "schema/answer.schema.json", JSON.stringify(schema, null, 2) + "\n");
  writeLlms(root);
  return root;
}

const writeLlms = (root) => {
  for (const [file, text] of Object.entries(buildLlms(root))) write(root, file, text);
};

// A second lecture beside the fixture's first: its own transcript, coverage and part2.md, whose one
// quote is in this transcript only, and the registry and schema enums that list it.
export const SECOND_VIDEO = "SecondVideo";
export function addSecondLecture(root) {
  write(root, "corpus/lectures.json", JSON.stringify([
    { video: FIXTURE_VIDEOS[0], title: "픽스처 강의", parts: ["part1.md"] },
    { video: SECOND_VIDEO, title: "둘째 픽스처 강의", parts: ["part2.md"] },
  ], null, 2) + "\n");
  write(root, "corpus/" + SECOND_VIDEO + "/transcript.md", "# 둘째 픽스처 강의\n\n## 편안함\n\n[00:05](https://youtu.be/" + SECOND_VIDEO + "?t=5) 쉽게 허락하는 사람은 편안함을 준다.\n");
  write(root, "corpus/" + SECOND_VIDEO + "/coverage.md", "# 범위 지도\n\n| 시각 | 소제목 | 원칙 |\n| --- | --- | --- |\n| 00:05 | 편안함 | comfort |\n");
  write(root, "skills/openflirt/references/part2.md", '# 2부\n\n<a id="comfort"></a>\n### 편안함\n\n> [00:05] 쉽게 허락하는 사람은 편안함을 준다\n');
  const schema = JSON.parse(read(root, "schema/answer.schema.json"));
  schema.properties.principles.items.enum = [...FIXTURE_IDS, "comfort"];
  schema.properties.citations.items.properties.video.enum = [...FIXTURE_VIDEOS, SECOND_VIDEO];
  write(root, "schema/answer.schema.json", JSON.stringify(schema, null, 2) + "\n");
  writeLlms(root);
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
