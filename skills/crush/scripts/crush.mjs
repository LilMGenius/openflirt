#!/usr/bin/env node
// Command line over a crush folder. Every command prints JSON on stdout; errors go to stderr.
// Usage:
//   crush.mjs add <name> [--id <id>] [--app <app>] [--met YYYY-MM-DD] [--notes <text>]
//   crush.mjs list
//   crush.mjs ingest <id> <file>... [--me <name>]     store evidence; KakaoTalk exports and thread.json become threads
//   crush.mjs read <id> [--year 2026]                  read unread screenshots into events with codex (-i)
//   crush.mjs event <id> --at <YYYY-MM-DDTHH:MM> --kind <kind> [--who me|her] --text <text>
//   crush.mjs photo <id> <image>                       set the portrait the studio shows
//   crush.mjs timeline <id> | state <id> [--now <YYYY-MM-DDTHH:MM>]
//   crush.mjs next <id> [--runtime codex|claude] [--ask <text>]   ask openflirt for the next action, record it
//   crush.mjs feedback <id> <decision id> <like|sent|skip>
// The folder root is $OPENFLIRT_CRUSHES or crushes.local/ at the repository root (ignored by *.local*).
// Exit 0 done, 1 a model run failed, 2 a bad argument or an unknown crush.
import { copyFileSync, realpathSync } from "node:fs";
import { extname, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { addCrush, addDecision, addEvents, computeState, crushDir, CrushError, ingestFile, listCrushes, markRead, readProfile, setFeedback, timeline, updateProfile } from "./lib/store.mjs";
import { askNext, readShots } from "./lib/agents.mjs";

const AT = (s) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)), Number(s.slice(11, 13)), Number(s.slice(14, 16)));
const print = (v) => process.stdout.write(JSON.stringify(v, null, 2) + "\n");

async function main(argv) {
  const { values: o, positionals: [cmd, ...rest] } = parseArgs({ args: argv, allowPositionals: true, options: {
    id: { type: "string" }, app: { type: "string" }, met: { type: "string" }, notes: { type: "string" }, me: { type: "string" }, year: { type: "string" },
    at: { type: "string" }, kind: { type: "string" }, who: { type: "string" }, text: { type: "string" }, now: { type: "string" }, runtime: { type: "string" }, ask: { type: "string" },
  } });
  switch (cmd) {
    case "add": return print(addCrush({ name: rest[0], id: o.id, app: o.app ?? null, metOn: o.met ?? null, notes: o.notes ?? "" }));
    case "list": return print(listCrushes());
    case "ingest": return print(rest.slice(1).map((f) => ingestFile(rest[0], f, { me: o.me })));
    case "read": {
      const got = await readShots(rest[0], { year: o.year ? Number(o.year) : undefined });
      const added = addEvents(rest[0], got.events);
      if (got.profile && got.profile.notes) {
        const p = readProfile(rest[0]);
        updateProfile(rest[0], { app: p.app ?? got.profile.app, notes: [p.notes, got.profile.notes].filter(Boolean).join("\n") });
      }
      markRead(rest[0], got.files);
      return print({ read: got.files.length, events: got.events.length, added: added.length, profile: got.profile });
    }
    case "event": return print(addEvents(rest[0], [{ at: o.at, kind: o.kind, who: o.who ?? null, text: o.text ?? "", source: "manual" }]));
    case "photo": {
      const file = "photo" + extname(rest[1]).toLowerCase();
      copyFileSync(rest[1], join(crushDir(rest[0]), file));
      return print(updateProfile(rest[0], { photo: file }));
    }
    case "timeline": return print(timeline(rest[0]));
    case "state": return print(computeState(timeline(rest[0]), o.now ? AT(o.now) : new Date(), { metOn: readProfile(rest[0]).metOn }));
    case "next": {
      const { answer } = await askNext(rest[0], { runtime: o.runtime ?? "codex", ask: o.ask ?? "" });
      return print(addDecision(rest[0], { verdict: answer.verdict, action: answer.action, message: answer.message, answer: answer.answer, citations: answer.citations }));
    }
    case "feedback": return setFeedback(rest[0], rest[1], rest[2]);
    default: throw new CrushError("명령을 모른다: " + cmd + " (add, list, ingest, read, event, photo, timeline, state, next, feedback)");
  }
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (e) {
    if (e instanceof CrushError || e instanceof TypeError) { process.stderr.write(e.message + "\n"); process.exitCode = /실행 실패|답 파일/.test(e.message) ? 1 : 2; }
    else throw e;
  }
}
