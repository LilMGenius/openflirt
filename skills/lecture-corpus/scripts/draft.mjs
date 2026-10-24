#!/usr/bin/env node
// Builds the draft transcript of a lecture from its YouTube auto captions (json3) and the
// section decisions in sections.json: each section starts where its anchor phrase first
// appears after the previous one, and a paragraph closes at a sentence end once it spans
// 25 s, or anywhere once it spans 45 s. The header comes from the video's yt-dlp metadata.
// Usage: node draft.mjs --captions <ko-orig.json3> --meta <info.json> --sections <sections.json> --out <transcript.md>
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { captions: { type: "string" }, meta: { type: "string" }, sections: { type: "string" }, out: { type: "string" } } });
const fail = (message) => {
  console.error("draft.mjs: " + message);
  process.exit(2);
};
const missing = ["captions", "meta", "sections", "out"].filter((key) => values[key] === undefined);
if (missing.length > 0) fail("missing " + missing.map((key) => "--" + key).join(", "));
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return fail("cannot read " + file + ": " + (error instanceof Error ? error.message : String(error)));
  }
};
const captions = readJson(values.captions);
const meta = readJson(values.meta);
const sections = readJson(values.sections);

const pieces = [];
for (const event of captions.events ?? []) {
  if (event.segs === undefined) continue;
  for (const seg of event.segs) {
    const text = (seg.utf8 ?? "").replaceAll("\n", " ");
    if (text !== "") pieces.push({ ms: (event.tStartMs ?? 0) + (seg.tOffsetMs ?? 0), text });
  }
}
const normalize = (text) => text.replace(/[\s.,?!]/gu, "");
let flat = "";
const owner = [];
pieces.forEach((piece, index) => {
  const part = normalize(piece.text);
  flat += part;
  for (let i = 0; i < part.length; i += 1) owner.push(index);
});

let from = 0;
const starts = sections.map(([kind, title, phrase]) => {
  if (phrase === "__START__") return { kind, title, at: 0 };
  if (phrase === "") return { kind, title, at: undefined };
  const found = flat.indexOf(normalize(phrase), from);
  if (found === -1) fail('anchor of "' + title + '" not found after the previous section: ' + phrase);
  from = found;
  return { kind, title, at: owner[found] };
});

const clock = (ms) => {
  const sec = Math.floor(ms / 1000);
  return String(Math.floor(sec / 60)).padStart(2, "0") + ":" + String(sec % 60).padStart(2, "0");
};
const paragraph = (buffer) => {
  const ms = buffer[0].ms;
  const text = buffer.map((piece) => piece.text).join("").replace(/\s+/gu, " ").trim();
  return "[" + clock(ms) + "](https://youtu.be/" + meta.id + "?t=" + Math.floor(ms / 1000) + ") " + text;
};
const lines = [];
starts.forEach((section, index) => {
  lines.push((section.kind === "H2" ? "##" : "###") + " " + section.title, "");
  if (section.at === undefined) return;
  const end = starts.slice(index + 1).find((next) => next.at !== undefined)?.at ?? pieces.length;
  let buffer = [];
  for (const piece of pieces.slice(section.at, end)) {
    if (buffer.length > 0) {
      const span = piece.ms - buffer[0].ms;
      const ended = /[.?!]\s*$/u.test(buffer.map((entry) => entry.text).join(""));
      if ((span >= 25000 && ended) || span >= 45000) {
        lines.push(paragraph(buffer), "");
        buffer = [];
      }
    }
    buffer.push(piece);
  }
  if (buffer.length > 0) lines.push(paragraph(buffer), "");
});

const day = String(meta.upload_date);
const header = [
  "# " + meta.title + " 전문",
  "",
  "- 영상: https://youtu.be/" + meta.id,
  "- 채널: " + meta.channel + " (" + meta.uploader_id + ")",
  "- 올린 날: " + day.slice(0, 4) + "-" + day.slice(4, 6) + "-" + day.slice(6, 8),
  "- 길이: " + meta.duration_string,
  "- 이 판의 본문: YouTube 자동 자막(ko-orig)을 한 글자도 고치지 않은 초안이다. 소제목과 문단은 강의 흐름을 따라 붙였고, 문단 앞 시각을 누르면 그 장면이 열린다.",
];
writeFileSync(values.out, header.join("\n") + "\n\n" + lines.join("\n").trimEnd() + "\n");
console.log("draft: " + pieces.length + " caption pieces, " + starts.length + " sections -> " + values.out);
