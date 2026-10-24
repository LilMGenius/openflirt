#!/usr/bin/env node
// Downloads what a lecture's corpus entry is built from: the video's metadata (<id>.info.json)
// and its original-language auto captions (<id>.<lang>-orig.json3), and with --audio and --video
// the media the transcription and subtitle-reading steps read. yt-dlp (Unlicense) runs through
// uvx at its newest release, because YouTube extraction breaks on older ones, and with node as
// the JavaScript runtime YouTube's player now needs.
// Usage: node fetch.mjs <url> --out <dir> [--lang ko] [--audio] [--video]
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { out: { type: "string" }, lang: { type: "string", default: "ko" }, audio: { type: "boolean", default: false }, video: { type: "boolean", default: false } },
});
const fail = (message) => {
  console.error("fetch.mjs: " + message);
  process.exit(2);
};
if (positionals.length !== 1 || values.out === undefined) fail("usage: node fetch.mjs <url> --out <dir> [--lang ko] [--audio] [--video]");
const [url] = positionals;
const template = join(values.out, "%(id)s.%(ext)s");

function ytdlp(args) {
  const run = spawnSync("uvx", ["yt-dlp@latest", "--js-runtimes", "node", "--no-progress", ...args, url], { stdio: "inherit" });
  if (run.error !== undefined) fail("cannot start uvx: " + run.error.message);
  if (run.status !== 0) fail("yt-dlp exited with " + run.status);
}

mkdirSync(values.out, { recursive: true });
ytdlp(["--skip-download", "--write-info-json", "--write-auto-subs", "--sub-langs", values.lang + "-orig", "--sub-format", "json3", "-o", template]);
if (values.audio) ytdlp(["-f", "ba", "-o", join(values.out, "%(id)s.audio.%(ext)s")]);
if (values.video) ytdlp(["-f", "bv*[height<=1080]", "-o", join(values.out, "%(id)s.video.%(ext)s")]);
console.log("fetch: " + readdirSync(values.out).sort().join(", "));
