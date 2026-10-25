#!/usr/bin/env node
// Reads one Instagram DM thread from a signed-in Chrome through BrowserSkill's bsk CLI, oldest message first, and
// writes raw.json (the rows as read), thread.json and transcript.md into --out. It only scrolls the message list
// and reads the page; it never clicks, types or focuses anything, so nothing can be sent.
// Usage: node read.mjs <thread url or id> --out <dir> [--me <handle>] [--browser <instance id>]
//        node read.mjs --raw <raw.json> --out <dir> [--me <handle>]   (normalize a saved capture again)
// --out - prints thread.json on stdout and the summary on stderr and writes no file, for a sandbox that cannot write.
// Exit 0 when every row was read from the top of the thread, 1 when files were written but rows stayed unread,
// 2 on bad arguments, no browser, a page that is not a thread, or rows this reader does not understand
// (a capture still leaves raw.json, so --raw can rerun once the rule is fixed).
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeRows, renderTranscript } from "./lib/rows.mjs";

const VIEW = { width: 1200, height: 3000 }; // a tall viewport renders more rows per step of the virtualized list
const LOAD_WAIT_MS = 1200;
const STABLE_STEPS = 4;
const MAX_LOAD_STEPS = 3000;
const VIEW_WAIT_MS = 700;
const RETRY_WAIT_MS = 1500;
const RETRIES = 3;
const fail = (code, message) => Object.assign(new Error(message), { code });

// Runs in the page. The message list is the lowest common ancestor of the first and last rendered message, and its
// scroller is a column-reverse box whose scrollTop is 0 at the newest message and negative above it. A row is read
// by structure so that a message reading "오후 3:00" is never taken for a timestamp.
const PAGE = String.raw`
const locate = () => {
  const arts = document.querySelectorAll('div[role=article]');
  if (arts.length < 2) return null;
  const chain = (el) => { const a = []; for (let n = el; n; n = n.parentElement) a.push(n); return a; };
  const last = new Set(chain(arts[arts.length - 1]));
  const list = chain(arts[0]).find((n) => last.has(n));
  let scroller = list;
  while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  return scroller ? { list, scroller, reverse: getComputedStyle(scroller).flexDirection === 'column-reverse' } : null;
};
const readRow = (el, rev) => {
  const article = el.querySelector('[role=article]');
  if (article === null) return null;
  let group = article.parentElement ? article.parentElement.closest('[role=group]') : null;
  if (group !== null && !el.contains(group)) group = null;
  const scope = group ?? article;
  const head = [], quote = [], texts = [], after = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    const t = n.nodeValue.trim();
    // Text inside an SVG is an icon's accessible name (the like, reply and more buttons), never message content.
    if (t === '' || n.parentElement.closest('svg') !== null) continue;
    if (!scope.contains(n)) head.push(t);
    else if (article.contains(n)) texts.push(t);
    else if (article.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_PRECEDING) quote.push(t);
    else after.push(t);
  }
  const box = (x) => x.getBoundingClientRect();
  return {
    rev, head, quote, texts, after,
    labels: [...el.querySelectorAll('[aria-label]')].map((x) => x.getAttribute('aria-label')),
    imgs: [...article.querySelectorAll('img')].map((x) => [Math.round(box(x).width), Math.round(box(x).height), x.closest('a[href]') !== null, x.getAttribute('alt') ?? '']),
    hrefs: [...article.querySelectorAll('a[href]')].map((a) => a.href),
    video: article.querySelectorAll('video').length,
    audio: article.querySelectorAll('audio').length,
  };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
`;

const loadStep = "(async () => {" + PAGE + "const at = locate(); if (at === null) return null; if (!at.reverse) return { layout: getComputedStyle(at.scroller).flexDirection }; at.scroller.scrollTop = -at.scroller.scrollHeight; await wait(" + LOAD_WAIT_MS + "); return { rows: at.list.children.length, loading: at.scroller.querySelector('[role=progressbar]') !== null }; })()";

const viewStep = (position) => "(async () => {" + PAGE + "const at = locate(); const sc = at.scroller; sc.scrollTop = " + position + "; await wait(" + VIEW_WAIT_MS + "); const rows = [...at.list.children]; const view = sc.getBoundingClientRect(); const seen = []; rows.forEach((el, i) => { const b = el.getBoundingClientRect(); if (b.bottom <= view.top || b.top >= view.bottom) return; const rev = rows.length - 1 - i; seen.push(readRow(el, rev) ?? { rev, empty: el.innerHTML.length }); }); return { total: rows.length, top: sc.scrollTop, height: sc.scrollHeight, client: sc.clientHeight, seen }; })()";

const focusStep = (rev) => "(async () => {" + PAGE + "const at = locate(); const rows = [...at.list.children]; const el = rows[rows.length - 1 - " + rev + "]; el.scrollIntoView({ block: 'center' }); await wait(" + RETRY_WAIT_MS + "); return { total: rows.length, row: readRow(el, " + rev + ") ?? { rev: " + rev + ", empty: el.innerHTML.length } }; })()";

// At the top of a thread the app shows the other side's profile block (name, "<handle> · Instagram", 프로필 보기)
// above the first message, so the text above the list is recorded as proof that the top was reached.
const topStep = "(async () => {" + PAGE + "const at = locate(); const sc = at.scroller; sc.scrollTop = -sc.scrollHeight; await wait(" + VIEW_WAIT_MS + "); const top = at.list.getBoundingClientRect().top; const seen = []; for (const el of sc.querySelectorAll('*')) { if (at.list.contains(el) || el.children.length > 0) continue; const t = (el.textContent || '').trim(); if (t !== '' && el.getBoundingClientRect().bottom <= top + 1) seen.push(t); } return seen; })()";

function bsk(args) {
  const r = spawnSync("bsk", [...args, "--json"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (r.error !== undefined) throw fail("NO_BSK", "bsk를 실행하지 못했다: " + r.error.message + ". BrowserSkill의 bsk가 PATH에 있어야 한다.");
  const text = r.stdout.trim();
  if (r.status !== 0 || !text.startsWith("{")) {
    const detail = (r.stderr.trim() || text).slice(0, 600);
    const hint = detail.includes("multiple_browsers_online") ? " 브라우저가 여럿 붙어 있다. bsk browsers로 id를 보고 --browser로 준다." : "";
    throw fail("BSK", "bsk " + args[0] + " 실패: " + detail + hint);
  }
  return JSON.parse(text);
}

function evaluate(session, expression) {
  const result = bsk(["evaluate", "--session", session, "--timeout", "120s", expression]);
  if (!result.ok) throw fail("PAGE", "페이지 스크립트 실패: " + (result.error?.text ?? JSON.stringify(result.error)));
  return result.value ?? null; // bsk leaves value out when the page returned null
}

const richness = (row) => (row.empty !== undefined ? -1 : row.texts.length + row.quote.length + row.imgs.filter(([w]) => w > 0).length);

function capture(url, browser) {
  const started = bsk(["session", "start", "--name", "instagram-dm", "--width", String(VIEW.width), "--height", String(VIEW.height), "--no-focus", ...(browser ? ["--browser", browser] : [])]);
  const session = started.session_id;
  try {
    const nav = bsk(["navigate", "--session", session, "--wait-until", "load", "--timeout", "60s", url]);
    if (!/\/direct\/t\/\d+/.test(nav.final_url ?? "")) throw fail("NOT_THREAD", "대화방이 열리지 않았다 (" + (nav.final_url ?? "?") + "). 그 브라우저에서 인스타그램에 로그인되어 있는지 본다.");
    bsk(["emulate", "--session", session, "--width", String(VIEW.width), "--height", String(VIEW.height)]);
    const ready = bsk(["wait-for-element", "--session", session, "--selector", "div[role=article]", "--timeout", "30s"]);
    if (!ready.satisfied) throw fail("NOT_THREAD", "대화방에 메시지가 보이지 않는다.");

    let steps = 0, stable = 0, rows = -1, loading = true;
    while (steps < MAX_LOAD_STEPS && (loading || stable < STABLE_STEPS)) {
      const s = evaluate(session, loadStep);
      if (s === null) throw fail("NOT_THREAD", "메시지 목록을 찾지 못했다.");
      if (s.layout !== undefined) throw fail("LAYOUT", "메시지 목록의 방향이 column-reverse가 아니라 " + s.layout + "다. 인스타그램 화면 구조가 바뀌어 이 읽기 방식이 맞지 않는다.");
      steps++;
      stable = s.rows === rows && !s.loading ? stable + 1 : 0;
      rows = s.rows;
      loading = s.loading;
    }
    const top = { reached: !loading && stable >= STABLE_STEPS, loadSteps: steps, above: evaluate(session, topStep) };
    const best = new Map();
    const keep = (row) => {
      const had = best.get(row.rev);
      if (had === undefined || richness(row) > richness(had)) best.set(row.rev, row);
    };
    let view = evaluate(session, viewStep("-(sc.scrollHeight - sc.clientHeight)"));
    const total = view.total;
    view.seen.forEach(keep);
    for (let position = view.top + Math.floor(view.client * 0.6); ; position += Math.floor(view.client * 0.6)) {
      view = evaluate(session, viewStep(String(Math.min(position, 0))));
      view.seen.forEach(keep);
      if (view.total !== total) throw fail("MOVED", "읽는 동안 메시지 수가 " + total + "에서 " + view.total + "로 바뀌었다. 새 메시지가 왔으면 다시 읽는다.");
      if (position >= 0) break;
    }
    for (let rev = 0; rev < total; rev++) {
      for (let attempt = 0; attempt < RETRIES && (best.get(rev)?.empty !== undefined || !best.has(rev)); attempt++) keep(evaluate(session, focusStep(rev)).row);
    }
    const read = [...best.values()].filter((r) => r.empty === undefined);
    const empty = [...best.values()].filter((r) => r.empty !== undefined).map((r) => ({ rev: r.rev, html: r.empty }));
    const missing = [];
    for (let rev = 0; rev < total; rev++) if (!best.has(rev)) missing.push(rev);
    return { top, total, rows: read.sort((a, b) => b.rev - a.rev), empty, missing };
  } finally {
    bsk(["session", "stop", session]);
  }
}

const pad = (n) => String(n).padStart(2, "0");
const localMinute = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());

function parseArgs(argv) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" || a === "--me" || a === "--browser" || a === "--raw") {
      if (argv[i + 1] === undefined) return null;
      opts[a.slice(2)] = argv[++i];
    } else if (a.startsWith("--")) return null;
    else positional.push(a);
  }
  if (opts.out === undefined || (opts.raw === undefined) === (positional.length !== 1)) return null;
  if (positional.length === 1) opts.url = /^\d+$/.test(positional[0]) ? "https://www.instagram.com/direct/t/" + positional[0] + "/" : positional[0];
  return opts;
}

function main(argv) {
  const opts = parseArgs(argv);
  if (opts === null) {
    process.stderr.write("usage: node read.mjs <thread url or id> --out <dir|-> [--me <handle>] [--browser <id>]\n       node read.mjs --raw <raw.json> --out <dir|-> [--me <handle>]\n");
    return 2;
  }
  const toStdout = opts.out === "-";
  let raw;
  if (opts.raw !== undefined) raw = JSON.parse(readFileSync(opts.raw, "utf8"));
  else {
    const capturedAt = localMinute(new Date());
    raw = { url: opts.url, capturedAt, ...capture(opts.url, opts.browser) };
    if (!toStdout) {
      mkdirSync(opts.out, { recursive: true });
      writeFileSync(join(opts.out, "raw.json"), JSON.stringify(raw, null, 2) + "\n");
    }
  }
  const thread = normalizeRows(raw, { me: opts.me });
  if (toStdout) process.stdout.write(JSON.stringify(thread, null, 2) + "\n");
  else {
    mkdirSync(opts.out, { recursive: true });
    writeFileSync(join(opts.out, "thread.json"), JSON.stringify(thread, null, 2) + "\n");
    writeFileSync(join(opts.out, "transcript.md"), renderTranscript(thread));
  }
  const counts = new Map();
  for (const m of thread.messages) counts.set(m.who ?? "시스템", (counts.get(m.who ?? "시스템") ?? 0) + 1);
  const first = thread.messages[0], last = thread.messages.at(-1);
  const lines = [
    "top: " + (raw.top.reached ? "reached after " + raw.top.loadSteps + " load steps" : "NOT REACHED after " + raw.top.loadSteps + " load steps") + "; above the first message: " + (raw.top.above.join(" / ") || "-"),
    "rows " + raw.total + ": read " + raw.rows.length + (raw.empty?.length ? ", empty " + raw.empty.map((e) => e.rev).join(" ") : "") + (raw.missing.length ? ", UNREAD " + raw.missing.join(" ") : ""),
    "messages " + thread.messages.length + ": " + [...counts].map(([k, v]) => k + " " + v).join(", "),
    "first " + first.at + " " + (first.who ?? "시스템") + ", last " + last.at + " " + (last.who ?? "시스템"),
    toStdout ? "wrote thread.json to stdout" : "wrote " + opts.out,
  ];
  (toStdout ? process.stderr : process.stdout).write(lines.join("\n") + "\n");
  return raw.missing.length > 0 || !raw.top.reached ? 1 : 0;
}

// Node loads the main module from its real path, so a call through a linked skill folder is compared by real path too.
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    if (error.code === undefined) throw error;
    process.stderr.write(error.message + "\n");
    process.exitCode = 2;
  }
}
