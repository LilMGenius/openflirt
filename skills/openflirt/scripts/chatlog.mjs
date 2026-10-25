#!/usr/bin/env node
// Turns a KakaoTalk chat export (.txt from the PC or mobile app) into the behaviors a reading of
// interest rests on, counted week by week: who wrote first each day and after a long silence, how
// long each side took to answer the other, runs of two or more messages sent before the other side wrote, days
// only one side wrote, and every line that may propose a meeting with the other side's next reply.
// Usage: node chatlog.mjs <export.txt> [--me <name>] [--gap-hours 6]
// Prints markdown with the asker as 나 and the other side as 상대, so no name reaches the answer. Without
// --me the asker is the participant the PC export header ("<이름> 님과 카카오톡 대화") does not name.
// Exits 2 when no line matches a KakaoTalk export format.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PC_DATE = /^-+\s*(\d{4})년 (\d{1,2})월 (\d{1,2})일 \S+요일\s*-+$/;
const PC_LINE = /^\[(.+?)\] \[(오전|오후) (\d{1,2}):(\d{2})\] (.*)$/;
const MOBILE_LINE = /^(\d{4})(?:년 |\. )(\d{1,2})(?:월 |\. )(\d{1,2})(?:일|\.) (오전|오후) (\d{1,2}):(\d{2}), (.+?) : (.*)$/;
const HEADER = /^(.+?) 님과 카카오톡 대화$/;
const MOBILE_DATE = /^\d{4}년 \d{1,2}월 \d{1,2}일 \S+요일$/;
// A line that names a meeting or a time and asks something. Honorific proposals (하시지요, 하실래요,
// 어떠세요) ask wherever they sit, since a polite invite is often followed by small talk in the same
// message. A match is a candidate the reader confirms.
const MEET = /만나|만날|보자|볼래|볼까|봬요|뵙|뵐|한잔|술 ?(?:한|마시)|밥 ?(?:먹|한번|어때|살게)|식사|저녁|점심 ?(?:같이|먹자)|커피 ?(?:한|마시)|영화|놀러|가자|갈래|갈까|이번 ?주|다음 ?주|다음 ?달|주말|[월화수목금토일]요일|내일|모레|언제|날짜|시간 (?:돼|되|있|괜찮)/;
const ASKS = /\?|어때|[자래까][.!~ㅎㅋㅠ ]*$|시지요|시죠|실래요|실까요|할까요|어떠세요|어떠신/;

const hour24 = (ampm, h) => (Number(h) % 12) + (ampm === "오후" ? 12 : 0);

export function parseExport(text) {
  const messages = [];
  let partner;
  let day = null;
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = messages.length === 0 && line.match(HEADER);
    if (h) { partner = h[1]; continue; }
    const d = line.match(PC_DATE);
    if (d) { day = [Number(d[1]), Number(d[2]), Number(d[3])]; continue; }
    const p = line.match(PC_LINE);
    if (p && day) { messages.push({ at: new Date(day[0], day[1] - 1, day[2], hour24(p[2], p[3]), Number(p[4])), who: p[1], text: p[5] }); continue; }
    const m = line.match(MOBILE_LINE);
    if (m) { messages.push({ at: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour24(m[4], m[5]), Number(m[6])), who: m[7], text: m[8] }); continue; }
    if (messages.length > 0 && line !== "" && !MOBILE_DATE.test(line)) messages.at(-1).text += " " + line.trim();
  }
  return { messages, partner };
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

export function behaviors(messages, { me, gapHours = 6 } = {}) {
  const names = [...new Set(messages.map((m) => m.who))];
  const label = (who) => (me === undefined ? who : who === me ? "나" : "상대");
  const first = startOfDay(messages[0].at);
  const weekOf = (d) => Math.floor((startOfDay(d) - first) / (7 * DAY));
  const weeks = new Map();
  const week = (i) => {
    if (!weeks.has(i)) weeks.set(i, Object.fromEntries(names.map((n) => [n, { msgs: 0, firstOfDay: 0, opened: 0, delays: [], bursts: 0 }])));
    return weeks.get(i);
  };
  const days = new Map();
  let run = 1;
  messages.forEach((m, i) => {
    const w = week(weekOf(m.at))[m.who];
    w.msgs++;
    const day = ymd(m.at);
    if (!days.has(day)) { days.set(day, new Set()); w.firstOfDay++; }
    days.get(day).add(m.who);
    const prev = messages[i - 1];
    if (!prev || m.at - prev.at >= gapHours * 3600000) w.opened++;
    if (prev && prev.who !== m.who) w.delays.push(m.at - prev.at);
    run = prev && prev.who === m.who ? run + 1 : 1;
    const next = messages[i + 1];
    if (run >= 2 && (!next || next.who !== m.who)) w.bursts++;
  });
  const out = ["# 대화에서 센 행동", ""];
  out.push("기간 " + ymd(messages[0].at) + " ~ " + ymd(messages.at(-1).at) + ", 메시지 " + messages.length + "개. " + names.map((n) => label(n) + " " + messages.filter((m) => m.who === n).length + "개").join(", ") + ".");
  out.push("답장 시간은 상대의 마지막 메시지부터 이쪽의 다음 메시지까지(밤을 넘겨도 셈). 먼저 연 대화는 " + gapHours + "시간 넘게 끊긴 뒤 처음 보낸 메시지. 연달아 보냄은 답을 받기 전 두 개 이상 보낸 묶음.", "");
  out.push("## 주별", "", "| 주 | 쪽 | 메시지 | 그날 먼저 보낸 날 | 먼저 연 대화 | 답장 수 | 답장 시간 중앙값 | 가장 늦은 답장 | 연달아 보냄 |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const [i, w] of [...weeks].sort((a, b) => a[0] - b[0])) {
    const from = new Date(first.getTime() + i * 7 * DAY), to = new Date(from.getTime() + 6 * DAY);
    for (const n of names) {
      const s = w[n];
      out.push("| " + (i + 1) + "주차 " + md(from) + "~" + md(to) + " | " + label(n) + " | " + s.msgs + " | " + s.firstOfDay + " | " + s.opened + " | " + s.delays.length + " | " + (s.delays.length ? span(median(s.delays)) : "-") + " | " + (s.delays.length ? span(Math.max(...s.delays)) : "-") + " | " + s.bursts + " |");
    }
  }
  const lonely = [...days].filter(([, who]) => who.size === 1).map(([d, who]) => d.slice(5) + " " + label([...who][0]));
  out.push("", "한쪽만 쓴 날: " + (lonely.length ? lonely.join(", ") : "없음"));
  const last = messages.at(-1);
  out.push("마지막 메시지: " + ymd(last.at) + " " + hm(last.at) + " " + label(last.who), "");
  out.push("## 만남 말 후보와 다음 답", "", "만남이나 날짜를 말하며 묻는 줄과, 다른 쪽이 그 뒤 처음 보낸 줄이다. 정말 만남 제안인지, 답이 날짜를 잡았는지 미뤘는지는 읽어서 가린다.", "");
  messages.forEach((m, i) => {
    if (!MEET.test(m.text) || !ASKS.test(m.text)) return;
    const reply = messages.slice(i + 1).find((r) => r.who !== m.who);
    out.push("- " + md(m.at) + " " + hm(m.at) + " " + label(m.who) + ": " + m.text);
    out.push("  - " + (reply ? md(reply.at) + " " + hm(reply.at) + " " + label(reply.who) + "(" + span(reply.at - m.at) + " 뒤): " + reply.text : "답 없음"));
  });
  return out.join("\n") + "\n";
}

function main(argv) {
  const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
  const file = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--me" && argv[i - 1] !== "--gap-hours");
  if (file === undefined) { process.stderr.write("usage: node chatlog.mjs <export.txt> [--me <name>] [--gap-hours 6]\n"); return 2; }
  const { messages, partner } = parseExport(readFileSync(file, "utf8"));
  if (messages.length === 0) { process.stderr.write("카카오톡 내보내기 형식의 메시지 줄을 찾지 못했다. 대화를 직접 읽는다.\n"); return 2; }
  const names = [...new Set(messages.map((m) => m.who))];
  const others = names.filter((n) => n !== partner);
  const me = opt("--me") ?? (partner !== undefined && names.length === 2 && others.length === 1 ? others[0] : undefined);
  if (me !== undefined && !names.includes(me)) { process.stderr.write("--me 이름이 대화에 없다. 대화의 이름: " + names.join(", ") + "\n"); return 2; }
  process.stdout.write(behaviors(messages, { me, gapHours: Number(opt("--gap-hours") ?? 6) }));
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));

