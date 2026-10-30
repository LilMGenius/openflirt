// Principle parse: each principle in skills/openflirt/references/part*.md opens with an HTML
// anchor line, then a ### heading, and carries one or more "> [mm:ss] quote" lines.
// Each principle takes the video of the lecture whose registry entry lists its file.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LECTURES_FILE } from "./corpus.mjs";
import { markdownLines } from "./markdown.mjs";

export const PRINCIPLE_DIR = "skills/openflirt/references";
const PRINCIPLE_FILE = /^part.*\.md$/;
const ANCHOR_LINE = /^<a id="([^"]*)"><\/a>\s*$/;
const ID = /^[a-z]+(-[a-z]+)*$/;
const HEADING = /^### \S/;
const QUOTE = /^> \[([0-5]\d):([0-5]\d)\] (\S.*)$/;

export function parsePrincipleFile(text, file) {
  const principles = [];
  const findings = [];
  let current;
  for (const { raw, line, inFence } of markdownLines(text)) {
    if (inFence) continue;
    const anchor = ANCHOR_LINE.exec(raw);
    if (anchor !== null) {
      const id = anchor[1];
      if (!ID.test(id)) findings.push({ file, line, reason: 'principle id "' + id + '" must match ^[a-z]+(-[a-z]+)*$' });
      current = { id, file, line, titled: false, quotes: [] };
      principles.push(current);
      continue;
    }
    if (current === undefined) continue;
    if (!current.titled && raw.trim() !== "") {
      current.titled = true;
      if (!HEADING.test(raw)) findings.push({ file, line, reason: "principle " + current.id + " must be followed by a ### heading" });
      continue;
    }
    if (raw.startsWith("> [")) {
      const quote = QUOTE.exec(raw);
      if (quote === null) findings.push({ file, line, reason: "quote line must read > [mm:ss] text" });
      else current.quotes.push({ line, t: quote[1] + ":" + quote[2], sec: Number(quote[1]) * 60 + Number(quote[2]), text: quote[3] });
    }
  }
  for (const principle of principles) {
    if (principle.quotes.length === 0) findings.push({ file, line: principle.line, reason: "principle " + principle.id + " has no > [mm:ss] quote line" });
  }
  return { principles: principles.map(({ titled, ...principle }) => principle), findings };
}

export function collectPrinciples(root, lectures) {
  const dir = join(root, PRINCIPLE_DIR);
  if (!existsSync(dir)) return { principles: [], findings: [{ file: PRINCIPLE_DIR, line: 1, reason: "principle folder is missing" }] };
  const names = readdirSync(dir).filter((name) => PRINCIPLE_FILE.test(name)).sort();
  if (names.length === 0) return { principles: [], findings: [{ file: PRINCIPLE_DIR, line: 1, reason: "no part*.md principle file" }] };
  const videoOf = new Map(lectures.flatMap((lecture) => lecture.parts.map((part) => [part, lecture.video])));
  const findings = lectures.flatMap((lecture) =>
    lecture.parts.filter((part) => !names.includes(part)).map((part) => ({ file: LECTURES_FILE, line: 1, reason: "lecture " + lecture.video + " lists " + part + ", which is not in " + PRINCIPLE_DIR })),
  );
  const parsed = names.map((name) => {
    const file = PRINCIPLE_DIR + "/" + name;
    const video = videoOf.get(name);
    if (video === undefined) findings.push({ file, line: 1, reason: name + " is listed under no lecture in " + LECTURES_FILE });
    const result = parsePrincipleFile(readFileSync(join(dir, name), "utf8"), file);
    return { principles: result.principles.map((principle) => ({ ...principle, video })), findings: result.findings };
  });
  return { principles: parsed.flatMap((file) => file.principles), findings: [...findings, ...parsed.flatMap((file) => file.findings)] };
}
