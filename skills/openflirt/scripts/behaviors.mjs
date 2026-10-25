#!/usr/bin/env node
// Counts the behaviors a reading of interest rests on from a chat thread.json, week by week: who wrote
// first each day and after a long silence, how long each side took to answer the other, runs of two or
// more messages sent before the other side wrote, each side's call starts, days only one side wrote, and
// every text line that may propose a meeting with the other side's next reply.
// Input: the thread.json that $kakaotalk-chat or $instagram-dm writes. Both skills fix its format, and this
// script reads only the fields named in validateThread.
// Usage: node behaviors.mjs <thread.json> [--me <who>] [--gap-hours 6]
// A file of "-" reads the thread.json from stdin, for a reader run with --out - where nothing can be written.
// Prints markdown with the asker as 나 and the other side as 상대, so no name reaches the answer. --me
// defaults to thread.me.
// Exits 2, with a Korean message on stderr, for a bad argument, a file that is not a thread.json, or an
// asker that cannot be told.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A line that names a meeting or a time and asks something. Honorific proposals (하시지요, 하실래요,
// 어떠세요) ask wherever they sit, since a polite invite is often followed by small talk in the same
// message. A match is a candidate the reader confirms.
const MEET = /만나|만날|보자|볼래|볼까|봬요|뵙|뵐|한잔|술 ?(?:한|마시)|밥 ?(?:먹|한번|어때|살게)|식사|저녁|점심 ?(?:같이|먹자)|커피 ?(?:한|마시)|영화|놀러|가자|갈래|갈까|이번 ?주|다음 ?주|다음 ?달|주말|[월화수목금토일]요일|내일|모레|언제|날짜|시간 (?:돼|되|있|괜찮)/;
const ASKS = /\?|어때|[자래까][.!~ㅎㅋㅠ ]*$|시지요|시죠|실래요|실까요|할까요|어떠세요|어떠신/;

const SOURCES = ["instagram", "kakaotalk"];
const PRECISIONS = ["minute", "block"];
const KINDS = ["text", "media", "call", "story", "system"];
const CALL_EVENTS = ["start", "end", "missed"];
const AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export class ThreadShapeError extends Error {}

const shape = (path, want) => new ThreadShapeError(path + "가 " + want + "이어야 한다.");
const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function parseAt(at, path) {
  const m = typeof at === "string" ? at.match(AT) : null;
  const d = m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  if (!d || d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3]) || d.getHours() !== Number(m[4])) throw shape(path, "YYYY-MM-DDTHH:MM 형식의 실제 시각");
  return d;
}

// The one place the thread.json shape is checked. Returns the thread with every "at" read as a local Date.
export function validateThread(thread) {
  if (!isObject(thread)) throw shape("thread.json", "객체");
  if (!SOURCES.includes(thread.source)) throw shape("source", SOURCES.join(" 또는 "));
  if (!PRECISIONS.includes(thread.timePrecision)) throw shape("timePrecision", PRECISIONS.join(" 또는 "));
  if (thread.me !== null && typeof thread.me !== "string") throw shape("me", "문자열 또는 null");
  if (!Array.isArray(thread.participants) || thread.participants.some((p) => typeof p !== "string")) throw shape("participants", "문자열 배열");
  if (!Array.isArray(thread.messages)) throw shape("messages", "배열");
  let before = -Infinity;
  const messages = thread.messages.map((m, i) => {
    const path = "messages[" + i + "]";
    if (!isObject(m)) throw shape(path, "객체");
    const at = parseAt(m.at, path + ".at");
    if (at < before) throw shape(path + ".at", "앞 메시지보다 늦거나 같은 시각(오래된 것부터)");
    before = at;
    if (m.who !== null && typeof m.who !== "string") throw shape(path + ".who", "문자열 또는 null");
    if (!KINDS.includes(m.kind)) throw shape(path + ".kind", KINDS.join(", ") + " 중 하나");
    if (typeof m.text !== "string") throw shape(path + ".text", "문자열");
    if (m.kind === "call" && !(isObject(m.call) && CALL_EVENTS.includes(m.call.event))) throw shape(path + ".call.event", CALL_EVENTS.join(", ") + " 중 하나");
    return { at, who: m.who, kind: m.kind, text: m.text, event: m.kind === "call" ? m.call.event : undefined };
  });
  return { me: thread.me, participants: thread.participants, timePrecision: thread.timePrecision, messages };
}

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const md = (d) => pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const hm = (d) => pad(d.getHours()) + ":" + pad(d.getMinutes());
const DAY = 86400000;
function span(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return min + "분";
  if (min < 1440) return Math.floor(min / 60) + "시간 " + (min % 60) + "분";
  return Math.floor(min / 1440) + "일 " + Math.floor((min % 1440) / 60) + "시간";
}
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]; };
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const oneLine = (s) => s.replace(/\s*\n\s*/g, " ").trim();
const KIND_TAG = { media: "(사진·영상·음성)", story: "(스토리)" };

// Something a person sent that the other side can answer: any non-call, non-system line with a sender.
// Call starts are counted in their own column; end and missed lines and system lines enter neither side.
const isSent = (m) => m.who !== null && m.kind !== "call" && m.kind !== "system";
const isCallStart = (m) => m.who !== null && m.kind === "call" && m.event === "start";

export function behaviors(thread, { me, gapHours = 6 }) {
  const sent = thread.messages.filter(isSent);
  const starts = thread.messages.filter(isCallStart);
  const dated = [...sent, ...starts];
  const names = [...new Set([...thread.participants, ...dated.map((m) => m.who)])];
  const label = (who) => (who === me ? "나" : "상대");
  const times = dated.map((m) => m.at.getTime());
  const first = startOfDay(new Date(Math.min(...times)));
  const weekOf = (d) => Math.floor((startOfDay(d) - first) / (7 * DAY));
  const weeks = new Map();
  const week = (i) => {
    if (!weeks.has(i)) weeks.set(i, Object.fromEntries(names.map((n) => [n, { msgs: 0, calls: 0, firstOfDay: 0, opened: 0, delays: [], bursts: 0 }])));
    return weeks.get(i);
  };
  for (const m of starts) week(weekOf(m.at))[m.who].calls++;
  const days = new Map();
  let run = 1;
  sent.forEach((m, i) => {
    const w = week(weekOf(m.at))[m.who];
    w.msgs++;
    const day = ymd(m.at);
    if (!days.has(day)) { days.set(day, new Set()); w.firstOfDay++; }
    days.get(day).add(m.who);
    const prev = sent[i - 1];
    if (!prev || m.at - prev.at >= gapHours * 3600000) w.opened++;
    if (prev && prev.who !== m.who) w.delays.push(m.at - prev.at);
    run = prev && prev.who === m.who ? run + 1 : 1;
    const next = sent[i + 1];
    if (run >= 2 && (!next || next.who !== m.who)) w.bursts++;
  });
  const out = ["# 대화에서 센 행동", ""];
  out.push("기간 " + ymd(new Date(Math.min(...times))) + " ~ " + ymd(new Date(Math.max(...times))) + ", 메시지 " + sent.length + "개. " + names.map((n) => label(n) + " " + sent.filter((m) => m.who === n).length + "개").join(", ") + ".");
  if (starts.length > 0) out.push("통화 시작은 메시지에 넣지 않고 따로 센다: " + names.map((n) => label(n) + " " + starts.filter((m) => m.who === n).length + "번").join(", ") + ".");
  out.push("답장 시간은 상대의 마지막 메시지부터 이쪽의 다음 메시지까지(밤을 넘겨도 셈). 먼저 연 대화는 " + gapHours + "시간 넘게 끊긴 뒤 처음 보낸 메시지. 연달아 보냄은 답을 받기 전 두 개 이상 보낸 묶음.");
  if (thread.timePrecision === "block") out.push("시각이 묶음 단위라 같은 묶음 안의 답장은 0분으로 세고 실제 간격은 알 수 없다.");
  out.push("", "## 주별", "", "| 주 | 쪽 | 메시지 | 통화 시작 | 그날 먼저 보낸 날 | 먼저 연 대화 | 답장 수 | 답장 시간 중앙값 | 가장 늦은 답장 | 연달아 보냄 |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const [i, w] of [...weeks].sort((a, b) => a[0] - b[0])) {
    const from = new Date(first.getTime() + i * 7 * DAY), to = new Date(from.getTime() + 6 * DAY);
    for (const n of names) {
      const s = w[n];
      out.push("| " + (i + 1) + "주차 " + md(from) + "~" + md(to) + " | " + label(n) + " | " + s.msgs + " | " + s.calls + " | " + s.firstOfDay + " | " + s.opened + " | " + s.delays.length + " | " + (s.delays.length ? span(median(s.delays)) : "-") + " | " + (s.delays.length ? span(Math.max(...s.delays)) : "-") + " | " + s.bursts + " |");
    }
  }
  const lonely = [...days].filter(([, who]) => who.size === 1).map(([d, who]) => d.slice(5) + " " + label([...who][0]));
  out.push("", "한쪽만 쓴 날: " + (lonely.length ? lonely.join(", ") : "없음"));
  const last = sent.at(-1);
  out.push("마지막 메시지: " + (last ? ymd(last.at) + " " + hm(last.at) + " " + label(last.who) : "없음"), "");
  out.push("## 만남 말 후보와 다음 답", "", "만남이나 날짜를 말하며 묻는 글줄과, 다른 쪽이 그 뒤 처음 보낸 줄이다. 정말 만남 제안인지, 답이 날짜를 잡았는지 미뤘는지는 읽어서 가린다.", "");
  sent.forEach((m, i) => {
    if (m.kind !== "text" || !MEET.test(m.text) || !ASKS.test(m.text)) return;
    const reply = sent.slice(i + 1).find((r) => r.who !== m.who);
    out.push("- " + md(m.at) + " " + hm(m.at) + " " + label(m.who) + ": " + oneLine(m.text));
    out.push("  - " + (reply ? md(reply.at) + " " + hm(reply.at) + " " + label(reply.who) + "(" + span(reply.at - m.at) + " 뒤): " + (oneLine(reply.text) || KIND_TAG[reply.kind] || "(글 없음)") : "답 없음"));
  });
  return out.join("\n") + "\n";
}

const USAGE = "사용법: node behaviors.mjs <thread.json 또는 -> [--me <who>] [--gap-hours 6]\n";
const fail = (message) => { process.stderr.write(message.endsWith("\n") ? message : message + "\n"); return 2; };

function main(argv) {
  const opts = {};
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--me" || a === "--gap-hours") {
      if (argv[i + 1] === undefined) return fail(a + " 뒤에 값이 없다.\n" + USAGE);
      opts[a] = argv[++i];
    } else if (a.startsWith("--")) return fail("알 수 없는 옵션 " + a + "\n" + USAGE);
    else files.push(a);
  }
  if (files.length !== 1) return fail(USAGE);
  const gapHours = opts["--gap-hours"] === undefined ? 6 : Number(opts["--gap-hours"]);
  if (!(gapHours > 0)) return fail("--gap-hours는 0보다 큰 숫자여야 한다: " + opts["--gap-hours"]);
  let thread;
  try {
    thread = validateThread(JSON.parse(readFileSync(files[0] === "-" ? 0 : files[0], "utf8")));
  } catch (e) {
    if (e instanceof ThreadShapeError) return fail("thread.json 형식이 아니다. " + e.message + " $kakaotalk-chat나 $instagram-dm이 쓴 파일을 넘긴다.");
    if (e instanceof SyntaxError || e.code === "ENOENT" || e.code === "EISDIR") return fail("thread.json을 읽지 못했다: " + e.message);
    throw e;
  }
  const dated = thread.messages.filter((m) => isSent(m) || isCallStart(m));
  if (dated.length === 0) return fail("센 수 있는 메시지나 통화 시작이 없다. 대화를 직접 읽는다.");
  const names = [...new Set([...thread.participants, ...dated.map((m) => m.who)])];
  const me = opts["--me"] ?? thread.me ?? undefined;
  if (me === undefined) return fail("질문자가 누구인지 thread.json에 없다. --me로 정한다. 대화의 이름: " + names.join(", "));
  if (!names.includes(me)) return fail("--me 이름이 대화에 없다. 대화의 이름: " + names.join(", "));
  process.stdout.write(behaviors(thread, { me, gapHours }));
  return 0;
}

// Node loads the main module from its real path, so a call through a linked skill folder is compared by real path too.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
