// llms.txt and llms-full.txt: a plain-text entry point for tools that read this public repository
// over the web (the llmstxt.org convention). Measured: claude.ai and chatgpt.com fetch a file they are
// pointed at but not the files it links, github.com/robots.txt disallows /*/raw/ and /*/tree/, and a
// blob page is 220-320 KB of HTML with relative hrefs. So llms.txt indexes the files that matter by
// absolute raw URL, and llms-full.txt carries the skill, the glossary and every principle file in one
// fetch, with their relative links made absolute so they stay followable outside the repository.
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { coverageFile, loadLectures, transcriptFile } from "./corpus.mjs";
import { markdownLines } from "./markdown.mjs";
import { PRINCIPLE_DIR } from "./principles.mjs";
import { SCHEMA_FILE } from "./schema.mjs";

export const BASE_URL = "https://raw.githubusercontent.com/LilMGenius/openflirt/main/";
export const LLMS_FILE = "llms.txt";
export const LLMS_FULL_FILE = "llms-full.txt";
export const LLMS_COMMAND = "node scripts/llms.mjs";
const SKILL_FILE = "skills/openflirt/SKILL.md";
const GLOSSARY_FILE = PRINCIPLE_DIR + "/glossary.md";
const OPTIONAL = [
  [SCHEMA_FILE, "§node bin/openflirt.mjs --json§이 내는 답의 JSON 스키마"],
  ["skills/kakaotalk-chat/SKILL.md", "카카오톡 대화 내보내기(.txt)를 §thread.json§과 §transcript.md§로 바꾸는 스킬"],
  ["skills/instagram-dm/SKILL.md", "인스타그램 DM 대화방 하나를 같은 두 파일로 읽어 내는 스킬"],
  ["skills/crush/SKILL.md", "썸 상대마다 대화와 스크린샷을 로컬 폴더에 모아 타임라인과 게이지를 만들고 다음 행동을 고르는 스킬"],
  ["docs/ROADMAP.md", "MCP 서버와 봇 연동까지의 순서"],
].map(([file, description]) => [file, description.replaceAll("§", "\x60")]);
const LINK = /\]\(([^)\s]+)\)/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const CODE_SPAN = /(\x60[^\x60]*\x60)/;

export const rawUrl = (file) => BASE_URL + file;

// Relative markdown links outside fences and code spans become absolute raw URLs, anchors kept.
export function absoluteLinks(text, file) {
  const resolve = (match, target) => (SCHEME.test(target) || target.startsWith("#") ? match : "](" + rawUrl(posix.normalize(posix.join(posix.dirname(file), target))) + ")");
  return markdownLines(text)
    .map(({ raw, inFence }) => (inFence ? raw : raw.split(CODE_SPAN).map((piece, index) => (index % 2 === 1 ? piece : piece.replace(LINK, resolve))).join("")))
    .join("\n");
}

const entry = (file, description) => "- [" + file + "](" + rawUrl(file) + "): " + description;
const headingOf = (text) => /^# (.+)$/m.exec(text)?.[1].trim();

// Both files as the generator would write them; a file that does not exist is left out, since the
// other checks already report a missing skill, principle file or transcript.
export function buildLlms(root) {
  const read = (file) => (existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n") : undefined);
  const exists = (file) => existsSync(join(root, file));
  const { lectures } = loadLectures(root);
  const parts = lectures.flatMap((lecture) => lecture.parts.map((part) => ({ file: PRINCIPLE_DIR + "/" + part, lecture })));
  const carried = [SKILL_FILE, GLOSSARY_FILE, ...parts.map((part) => part.file)].filter(exists);
  const section = (title, lines) => (lines.length === 0 ? [] : ["## " + title, "", ...lines, ""]);
  const index = [
    "# openflirt",
    "",
    "> 마픽스(마튜브) 연애 강의의 원칙으로 연애와 썸 상황을 판정하고 할 일을 답하는 에이전트 스킬. 원칙마다 강의 원문 인용과 그 시각이 붙어 있다.",
    "",
    "웹에서 이 저장소를 읽는 도구는 [llms-full.txt](" + rawUrl(LLMS_FULL_FILE) + ") 하나만 받으면 된다. 스킬 본문, 용어집, 원칙 파일 전부가 한 번에 들어 있고, 그 안의 링크는 모두 절대 주소다. 아래는 파일마다의 주소다.",
    "",
    ...section("스킬", [
      ...(exists(SKILL_FILE) ? [entry(SKILL_FILE, "판단 순서, 판정과 할 일 표, 답하는 법, 규칙")] : []),
      ...(exists(GLOSSARY_FILE) ? [entry(GLOSSARY_FILE, "강의가 쓰는 말과 그 뜻")] : []),
    ]),
    ...section("원칙", parts.filter((part) => exists(part.file)).map((part) => entry(part.file, (headingOf(read(part.file)) ?? posix.basename(part.file)) + ". 강의 「" + part.lecture.title + "」의 원칙과 원문 인용"))),
    ...section("강의 전문", lectures.flatMap((lecture) => [
      ...(exists(transcriptFile(lecture.video)) ? [entry(transcriptFile(lecture.video), "「" + lecture.title + "」 전문. 문단마다 영상의 그 시각으로 가는 링크가 있다")] : []),
      ...(exists(coverageFile(lecture.video)) ? [entry(coverageFile(lecture.video), "「" + lecture.title + "」의 소제목마다 어느 원칙에 담겼는지, 뺐다면 왜 뺐는지")] : []),
    ])),
    ...section("선택", OPTIONAL.filter(([file]) => exists(file)).map(([file, description]) => entry(file, description))),
  ];
  const full = [
    "# openflirt 전체",
    "",
    "> openflirt 스킬 본문, 용어집, 원칙 파일 전부를 한 파일에 이어 붙였다. 파일마다 §--- FILE: <저장소 경로> (<원본 주소>) ---§ 줄로 시작하고, 파일 안의 상대 링크는 원본 주소로 바꿨다.".replaceAll("§", "\x60"),
    "",
    "이 파일은 저장소에서 §".replaceAll("§", "\x60") + LLMS_COMMAND + "§가 지어 낸 것이라 손으로 고치지 않는다. 강의 전문과 다른 파일의 주소는 [llms.txt](".replaceAll("§", "\x60") + rawUrl(LLMS_FILE) + ")에 있다.",
    "",
    ...carried.flatMap((file) => ["--- FILE: " + file + " (" + rawUrl(file) + ") ---", "", absoluteLinks(read(file), file).replace(/\n*$/, ""), ""]),
  ];
  return { [LLMS_FILE]: index.join("\n").replace(/\n*$/, "\n"), [LLMS_FULL_FILE]: full.join("\n").replace(/\n*$/, "\n") };
}

// The committed files must equal what the builder writes; a finding names the first line that differs.
export function checkLlms(root) {
  return Object.entries(buildLlms(root)).flatMap(([file, built]) => {
    if (!existsSync(join(root, file))) return [{ file, line: 1, reason: "file is missing; run " + LLMS_COMMAND }];
    const committed = readFileSync(join(root, file), "utf8");
    if (committed === built) return [];
    const have = committed.split("\n");
    const want = built.split("\n");
    let line = 0;
    while (line < have.length && have[line] === want[line]) line += 1;
    return [{ file, line: line + 1, reason: "differs from what " + LLMS_COMMAND + " builds from the files it indexes and carries; run " + LLMS_COMMAND + " and commit the result" }];
  });
}
