#!/usr/bin/env node
// Writes reconciled paragraph lines into a transcript. A paragraph with no text is dropped,
// every other paragraph takes the next reconciled line with the same start time, and any
// mismatch stops the run before anything is written. With --partial, a paragraph with no
// counterpart keeps its text, so one part can be checked before the rest exist.
// Usage: node apply.mjs --transcript <md> --video <id> --lines <md> [--lines <md> ...] --out <md> [--partial]
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { transcript: { type: "string" }, video: { type: "string" }, lines: { type: "string", multiple: true }, out: { type: "string" }, partial: { type: "boolean", default: false } } });
const fail = (message) => {
  console.error("apply.mjs: " + message);
  process.exit(2);
};
const missing = ["transcript", "video", "lines", "out"].filter((key) => values[key] === undefined);
if (missing.length > 0) fail("missing " + missing.map((key) => "--" + key).join(", "));
const read = (file) => {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    return fail("cannot read " + file + ": " + (error instanceof Error ? error.message : String(error)));
  }
};
const slot = new RegExp("^\\[(\\d{2}):([0-5]\\d)\\]\\(https://youtu\\.be/" + values.video + "\\?t=(\\d+)\\)(?: (.*))?$");
const draft = read(values.transcript).split("\n");
const reconciled = values.lines.flatMap((file) => read(file).split("\n").filter((line) => slot.test(line)));
const out = [];
let next = 0;
for (let i = 0; i < draft.length; i += 1) {
  const current = slot.exec(draft[i]);
  if (current === null) {
    out.push(draft[i]);
    continue;
  }
  if ((current[4] ?? "").trim() === "") {
    if (draft[i + 1] === "") i += 1;
    continue;
  }
  const candidate = reconciled[next] === undefined ? null : slot.exec(reconciled[next]);
  if (candidate !== null && candidate[3] === current[3] && (candidate[4] ?? "").trim() !== "") {
    out.push(reconciled[next]);
    next += 1;
  } else if (values.partial) {
    out.push(draft[i]);
  } else {
    fail("paragraph " + current[1] + ":" + current[2] + " (line " + (i + 1) + ") has no reconciled line; the next one is " + (reconciled[next] ?? "missing"));
  }
}
if (next !== reconciled.length) fail(reconciled.length - next + " reconciled lines match no paragraph, first: " + reconciled[next]);
writeFileSync(values.out, out.join("\n"));
console.log("apply: " + next + " paragraphs replaced -> " + values.out);
