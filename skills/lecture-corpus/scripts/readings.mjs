#!/usr/bin/env node
// Lines up what each transcript paragraph says in every source for the reconciliation step:
// its current text, the Whisper segments and the burned-in subtitle events that start inside
// it. Subtitle events below the confidence floor are marked ⟨? ⟩ as suspect.
// Usage: node readings.mjs --transcript <md> --video <id> --whisper <json> --subtitles <json> --out <md>
//          [--from <sec>] [--to <sec>] [--low <confidence>]
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { parseTranscript } from "../../../scripts/lib/transcript.mjs";

const { values } = parseArgs({
  options: {
    transcript: { type: "string" },
    video: { type: "string" },
    whisper: { type: "string" },
    subtitles: { type: "string" },
    out: { type: "string" },
    from: { type: "string", default: "0" },
    to: { type: "string", default: "Infinity" },
    low: { type: "string", default: "0.8" },
  },
});
const fail = (message) => {
  console.error("readings.mjs: " + message);
  process.exit(2);
};
const missing = ["transcript", "video", "whisper", "subtitles", "out"].filter((key) => values[key] === undefined);
if (missing.length > 0) fail("missing " + missing.map((key) => "--" + key).join(", "));
const read = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    return fail("cannot read " + file + ": " + (error instanceof Error ? error.message : String(error)));
  }
};
const readJson = (file) => {
  try {
    return JSON.parse(read(file));
  } catch (error) {
    return fail("cannot read " + file + ": " + (error instanceof Error ? error.message : String(error)));
  }
};
const { sections } = parseTranscript(read(values.transcript), values.transcript, values.video);
const whisper = readJson(values.whisper);
const subtitles = readJson(values.subtitles);
const [from, to, low] = [Number(values.from), Number(values.to), Number(values.low)];

const paragraphs = sections.flatMap((section) => section.paragraphs.map((paragraph) => ({ ...paragraph, section: section.title })));
const startingIn = (items, start, end) => items.filter((item) => item.start >= start && item.start < end);
const lines = [];
let shownSection;
paragraphs.forEach((paragraph, index) => {
  if (paragraph.sec < from || paragraph.sec >= to) return;
  const end = paragraphs[index + 1]?.sec ?? Infinity;
  if (paragraph.section !== shownSection) {
    lines.push("## " + paragraph.section, "");
    shownSection = paragraph.section;
  }
  const heard = startingIn(whisper, paragraph.sec, end).map((segment) => segment.text.trim()).join(" ");
  const shown = startingIn(subtitles, paragraph.sec, end).map((event) => (event.confidence < low ? "⟨?" + event.text + "⟩" : event.text)).join(" / ");
  lines.push("### " + paragraph.t + " (" + paragraph.sec + "–" + (Number.isFinite(end) ? end : "끝") + " s)", "", "- 초안: " + paragraph.text, "- 위스퍼: " + heard, "- 자막: " + shown, "");
});
writeFileSync(values.out, lines.join("\n"));
console.log("readings: " + lines.filter((line) => line.startsWith("### ")).length + " paragraphs -> " + values.out);
