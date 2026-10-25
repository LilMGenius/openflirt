// Routing eval: does the skill description alone make a host load openflirt? Runs each eval/routing.json
// prompt headless in a scratch repo that holds only junctions to this skill (no AGENTS.md or CLAUDE.md),
// and decides "loaded" from the event stream. Usage:
//   node scripts/routing.mjs --runtime codex|claude [--model <id>] [--only id,id] [--timeout <s>] --out <result.json>
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runAgent } from "./lib/agent.mjs";
import { claudeRoutingArgs, codexRoutingArgs, isRateLimited, loadedSkill, tally } from "./lib/routing.mjs";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const USAGE = "사용법: node scripts/routing.mjs --runtime codex|claude [--model <id>] [--only id,id] [--timeout <초>] --out <result.json>";

const fail = (message) => {
  process.stderr.write(message + "\n");
  process.exit(2);
};

function parse() {
  let values;
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      options: { runtime: { type: "string" }, model: { type: "string" }, only: { type: "string" }, timeout: { type: "string", default: "420" }, out: { type: "string" } },
      strict: true,
    }));
  } catch (error) {
    if (error instanceof TypeError) return fail(error.message + "\n" + USAGE);
    throw error;
  }
  if (!["codex", "claude"].includes(values.runtime)) return fail("--runtime은 codex나 claude여야 한다\n" + USAGE);
  if (values.out === undefined) return fail("--out이 필요하다\n" + USAGE);
  const timeout = Number(values.timeout);
  if (!Number.isFinite(timeout) || timeout <= 0) return fail("--timeout은 0보다 큰 초여야 한다");
  return { ...values, timeoutMs: timeout * 1000 };
}

function scratchRepo() {
  const root = mkdtempSync(join(tmpdir(), "openflirt-routing-"));
  const init = spawnSync("git", ["init", "-q"], { cwd: root, encoding: "utf8" });
  if (init.status !== 0) throw new Error("git init failed: " + init.stderr);
  const links = [".agents", ".claude"].map((dir) => {
    mkdirSync(join(root, dir, "skills"), { recursive: true });
    const link = join(root, dir, "skills", "openflirt");
    symlinkSync(join(REPO_ROOT, "skills", "openflirt"), link, "junction");
    return link;
  });
  return { root, links };
}

// Junctions come off first so the recursive delete can only ever reach the scratch folder itself.
function removeScratch({ root, links }) {
  const real = realpathSync(root);
  const tmp = realpathSync(tmpdir());
  if (!real.startsWith(tmp + sep) || !basename(real).startsWith("openflirt-routing-")) throw new Error("refusing to delete outside the temp dir: " + real);
  for (const link of links) {
    try {
      if (!lstatSync(link).isSymbolicLink()) throw new Error("not a link: " + link);
      unlinkSync(link);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  rmSync(real, { recursive: true, force: true });
}

const options = parse();
const cases = JSON.parse(readFileSync(join(REPO_ROOT, "eval", "routing.json"), "utf8"));
const only = options.only === undefined ? undefined : options.only.split(",").map((id) => id.trim());
const selected = only === undefined ? cases : cases.filter((c) => only.includes(c.id));
if (only !== undefined) {
  const unknown = only.filter((id) => !cases.some((c) => c.id === id));
  if (unknown.length > 0) fail("eval/routing.json에 없는 id: " + unknown.join(","));
}

const outFile = resolve(options.out);
const eventsDir = join(dirname(outFile), "events-" + options.runtime + "-" + basename(outFile, ".json"));
mkdirSync(eventsDir, { recursive: true });
const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout.trim();
const args = options.runtime === "codex" ? codexRoutingArgs(options) : claudeRoutingArgs(options);
const results = [];
const write = () => {
  const status = tally(results);
  const doc = { runtime: options.runtime, model: options.model ?? null, commit, ...status, results };
  writeFileSync(outFile, JSON.stringify(doc, null, 2) + "\n");
  return doc;
};

const scratch = scratchRepo();
let stopped = false;
try {
  for (const c of selected) {
    const entry = { id: c.id, expect: c.expect, loaded: null, ok: null, seconds: 0, exit: null, eventsFile: null };
    results.push(entry);
    if (stopped) {
      entry.exit = "not-run";
      continue;
    }
    const started = Date.now();
    const run = await runAgent({ command: options.runtime, args, cwd: scratch.root, input: c.prompt, timeoutMs: options.timeoutMs });
    entry.seconds = Math.round((Date.now() - started) / 100) / 10;
    if (run.kind === "exit") {
      entry.exit = run.code;
      entry.eventsFile = relative(dirname(outFile), join(eventsDir, c.id + ".jsonl")).split(sep).join("/");
      writeFileSync(join(eventsDir, c.id + ".jsonl"), run.stdout);
      if (isRateLimited(options.runtime, run.stdout)) {
        stopped = true;
        entry.exit = "usage-limit";
      } else {
        entry.loaded = loadedSkill(options.runtime, run.stdout);
        entry.ok = entry.loaded === (c.expect === "load");
      }
    } else {
      entry.exit = run.kind;
    }
    write();
    process.stdout.write(c.id + " expect=" + c.expect + " loaded=" + entry.loaded + " exit=" + entry.exit + " " + entry.seconds + "s\n");
  }
} finally {
  removeScratch(scratch);
}
const doc = write();
process.stdout.write(JSON.stringify({ tp: doc.tp, fn: doc.fn, fp: doc.fp, tn: doc.tn, notRun: doc.notRun, accuracy: doc.accuracy }) + "\n");
if (stopped) process.stdout.write("usage limit reached: the rest were not run\n");
