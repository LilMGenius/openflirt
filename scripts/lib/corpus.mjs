// The lecture registry: corpus/lectures.json lists every lecture the openflirt skill quotes, oldest
// upload first, with the principle files (skills/openflirt/references/part*.md) that quote it. When
// two lectures conflict the later upload wins, so the order is checked, not left to the writer. The
// repository check, the runner and the golden eval all find each lecture's transcript from here.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTranscript } from "./transcript.mjs";

export const LECTURES_FILE = "corpus/lectures.json";
export const transcriptFile = (video) => "corpus/" + video + "/transcript.md";
export const coverageFile = (video) => "corpus/" + video + "/coverage.md";

const VIDEO = /^[A-Za-z0-9_-]{11}$/;
const PART = /^part[^/\\]*\.md$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = ["video", "title", "uploaded", "parts"];
const isText = (value) => typeof value === "string" && value.trim() !== "";

// Shape check of the registry text; a lecture that fails it is left out of the list it returns.
export function parseLectures(text, file) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return { lectures: [], findings: [{ file, line: 1, reason: "invalid JSON: " + error.message }] };
    throw error;
  }
  if (!Array.isArray(value) || value.length === 0) return { lectures: [], findings: [{ file, line: 1, reason: "the registry must be a non-empty JSON array of lectures" }] };
  const lectures = [];
  const findings = [];
  const videos = new Set();
  const parts = new Map();
  for (const [index, lecture] of value.entries()) {
    const before = findings.length;
    const add = (reason) => findings.push({ file, line: 1, reason: "lecture " + (index + 1) + ": " + reason });
    if (typeof lecture !== "object" || lecture === null || Array.isArray(lecture)) {
      add("must be an object");
      continue;
    }
    const extra = Object.keys(lecture).filter((key) => !KEYS.includes(key));
    if (extra.length > 0) add("unknown keys " + extra.join(", "));
    if (typeof lecture.video !== "string" || !VIDEO.test(lecture.video)) add("video must be an 11-character YouTube id");
    else if (videos.has(lecture.video)) add("video " + lecture.video + " is listed twice");
    else videos.add(lecture.video);
    if (!isText(lecture.title)) add("title must be a non-empty string");
    if (typeof lecture.uploaded !== "string" || !DATE.test(lecture.uploaded)) add("uploaded must be the upload date as YYYY-MM-DD");
    else if (lectures.length > 0 && lecture.uploaded <= lectures.at(-1).uploaded) add("uploaded " + lecture.uploaded + " must be later than the lecture above it (" + lectures.at(-1).uploaded + "); list lectures oldest first");
    if (!Array.isArray(lecture.parts) || lecture.parts.length === 0) add("parts must be a non-empty array of part*.md file names");
    else {
      for (const part of lecture.parts) {
        if (typeof part !== "string" || !PART.test(part)) add("part " + JSON.stringify(part) + " must be a part*.md file name");
        else if (parts.has(part)) add(part + " is already listed under lecture " + parts.get(part));
        else parts.set(part, index + 1);
      }
    }
    if (findings.length === before) lectures.push({ video: lecture.video, title: lecture.title, uploaded: lecture.uploaded, parts: lecture.parts });
  }
  return { lectures, findings };
}

// The upload date a transcript header records ("- 올린 날: YYYY-MM-DD"), which the registry must repeat.
export function uploadDateFinding(text, file, lecture) {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => line.startsWith("- 올린 날: "));
  if (index === -1) return [];
  const date = lines[index].slice("- 올린 날: ".length).trim();
  return date === lecture.uploaded ? [] : [{ file, line: index + 1, reason: "올린 날 " + date + " differs from uploaded " + lecture.uploaded + " in " + LECTURES_FILE }];
}

export function loadLectures(root) {
  if (!existsSync(join(root, LECTURES_FILE))) return { lectures: [], findings: [{ file: LECTURES_FILE, line: 1, reason: "file is missing" }] };
  return parseLectures(readFileSync(join(root, LECTURES_FILE), "utf8"), LECTURES_FILE);
}

// Each lecture's parsed transcript, or undefined where the file is missing.
export const readTranscripts = (root, lectures) =>
  lectures.map((lecture) => {
    const file = transcriptFile(lecture.video);
    const parsed = existsSync(join(root, file)) ? parseTranscript(readFileSync(join(root, file), "utf8"), file, lecture.video) : undefined;
    return { lecture, file, parsed };
  });

// Paragraphs per video for the runner and the eval; a broken registry or a missing transcript is an error.
export function loadParagraphs(root) {
  const { lectures, findings } = loadLectures(root);
  if (findings.length > 0) return { kind: "error", findings };
  const transcripts = readTranscripts(root, lectures);
  const missing = transcripts.filter((entry) => entry.parsed === undefined);
  if (missing.length > 0) return { kind: "error", findings: missing.map(({ file }) => ({ file, line: 1, reason: "file is missing" })) };
  return { kind: "ok", lectures, paragraphsByVideo: new Map(transcripts.map(({ lecture, parsed }) => [lecture.video, parsed.paragraphs])) };
}
