#!/usr/bin/env node
// Reads a KakaoTalk chat export (.txt from the PC or mobile app) and writes thread.json and transcript.md.
// Usage: node parse.mjs <export.txt> --out <dir> [--me <name>]
// --out - prints thread.json on stdout and the summary on stderr and writes no file, for a sandbox that cannot write.
// Exit 0 written; 2 bad arguments or input that is not a KakaoTalk export (nothing written).
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ExportError, parseExport, renderTranscript } from "./lib/export.mjs";

const USAGE = "usage: node parse.mjs <export.txt> --out <dir|-> [--me <name>]\n";

function main(argv) {
  let file, out, me;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" || a === "--me") {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) { process.stderr.write(USAGE); return 2; }
      if (a === "--out") out = v; else me = v;
    } else if (a.startsWith("--") || file !== undefined) { process.stderr.write(USAGE); return 2; }
    else file = a;
  }
  if (file === undefined || out === undefined) { process.stderr.write(USAGE); return 2; }
  let text;
  try { text = readFileSync(file, "utf8"); } catch (e) { process.stderr.write("파일을 읽지 못했다: " + e.code + "\n"); return 2; }
  let thread;
  try { thread = parseExport(text, { fileName: basename(file), me }); } catch (e) {
    if (e instanceof ExportError) { process.stderr.write(e.message + "\n"); return 2; }
    throw e;
  }
  const system = thread.messages.filter((m) => m.who === null).length;
  const summary = "kakaotalk-chat: 메시지 " + thread.messages.length + "개 (시스템 " + system + "), 참가자 " + thread.participants.length + "명, me " + (thread.me === null ? "미정(--me로 정한다)" : "지정") + ", " + thread.messages[0].at.slice(0, 10) + " ~ " + thread.messages.at(-1).at.slice(0, 10);
  if (out === "-") {
    process.stdout.write(JSON.stringify(thread, null, 2) + "\n");
    process.stderr.write(summary + ", 표준 출력\n");
    return 0;
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "thread.json"), JSON.stringify(thread, null, 2) + "\n");
  writeFileSync(join(out, "transcript.md"), renderTranscript(thread));
  process.stdout.write(summary + ", 저장 " + out + "\n");
  return 0;
}

// Node loads the main module from its real path, so a call through a linked skill folder is compared by real path too.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
