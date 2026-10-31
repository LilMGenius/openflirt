// openflirt studio page. State lives in the crush folders on disk; this page draws what the local server
// returns and sends what the asker types or drops. Writes carry the token the server printed into the page.
import { choicesOf } from "./choices.js";

const TOKEN = document.querySelector('meta[name="openflirt-token"]').content;
const $ = (id) => document.getElementById(id);
const VERDICT = { interest: "관심", ambiguous: "애매", friction: "마찰", over: "끝", unknown: "모름" };
const ACTION = { stop: "멈춤", withdraw: "뺌", let_go: "놓음", ask_meet: "약속 잡기", reciprocate: "정상 반응", hold_standard: "기준 지키기", observe: "지켜봄" };
const KIND = { meet: "만남", plan: "약속", call: "통화", note: "메모", profile: "프로필" };
const RUNTIME_ICON = { codex: "assets/icons/openai.svg", claude: "assets/icons/claude.svg" };
const SVG = {
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-10" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
  clip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 6.5 8.4 14.6a2 2 0 1 0 2.8 2.8l8.1-8.1a4 4 0 0 0-5.6-5.6l-8.4 8.4a6 6 0 0 0 8.5 8.5l6.7-6.7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  bot: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="8" width="16" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 4v4M9 13h.01M15 13h.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};
// Sources the composer can take. "file" opens the picker with the formats the reader parses; "url" puts the
// composer in a mode whose placeholder and check are the source's own. Coming ones show, disabled, in the menu.
const SOURCES = [
  { id: "file", label: "파일과 스크린샷", note: "txt, md, json, 이미지", svg: SVG.clip, kind: "file", accept: ".txt,.md,.json,image/*" },
  { id: "kakaotalk", label: "카카오톡 대화", note: "대화 내보내기 .txt", icon: "assets/icons/kakaotalk.svg", kind: "file", accept: ".txt" },
  { id: "instagram", label: "인스타그램 DM", note: "대화방 주소", icon: "assets/icons/instagram.svg", kind: "url", placeholder: "https://www.instagram.com/direct/t/…", pattern: /^https:\/\/www\.instagram\.com\/direct\/t\/\d+\/?$/ },
  { id: "dating", label: "데이팅앱 연동", note: "곧", svg: SVG.heart, disabled: true },
  { id: "agents", label: "ChatGPT, Claude 앱 연동", note: "곧", svg: SVG.bot, disabled: true },
];

let current = null;
let detail = null;
let pending = [];
let source = null;
let model = JSON.parse(localStorage.getItem("openflirt.model") ?? "null") ?? { runtime: "codex", model: "" };

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k !== null && k !== undefined && k !== false)); return n; };
const svg = (markup) => el("span", { className: "ico", innerHTML: markup });
const api = async (path, { method = "GET", body, headers = {} } = {}) => {
  const res = await fetch("/api" + path, { method, body, headers: method === "GET" ? headers : { "x-openflirt-token": TOKEN, ...headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
};
const json = (method, path, value) => api(path, { method, body: JSON.stringify(value), headers: { "content-type": "application/json" } });
const status = (text, busy = false) => { $("status").textContent = text; $("status").classList.toggle("busy", busy); };
const enc = encodeURIComponent;
const initial = (name) => [...String(name).trim()][0] ?? "?";
const photoUrl = (c) => (c.photo ? "/api/crushes/" + enc(c.id) + "/photo?" + enc(c.photo) : null);
const parts = (...xs) => xs.filter(Boolean).map((x) => el("span", { textContent: x }));

// Popover menu: one floating list anchored to a button, placed in viewport space so no scroll box clips it.
const pop = $("popover");
function openMenu(anchor, items) {
  pop.replaceChildren(...items.map((it) => {
    if (it.group) return el("li", { className: "group", role: "presentation" }, it.icon ? el("img", { src: it.icon, alt: "" }) : null, it.group);
    const b = el("button", { type: "button", role: "menuitem", disabled: Boolean(it.disabled) }, it.icon ? el("img", { src: it.icon, alt: "" }) : it.svg ? svg(it.svg) : null, el("span", { className: "lbl", textContent: it.label }), it.note ? el("small", { textContent: it.note }) : null);
    if (it.selected) b.setAttribute("aria-current", "true");
    b.addEventListener("click", () => { closeMenu(); it.onPick?.(); });
    return el("li", {}, b);
  }));
  pop.hidden = false;
  const r = anchor.getBoundingClientRect(), m = pop.getBoundingClientRect();
  const up = r.top - m.height - 8 > 8;
  pop.style.top = (up ? r.top - m.height - 8 : Math.min(innerHeight - m.height - 8, r.bottom + 8)) + "px";
  pop.style.left = Math.max(8, Math.min(innerWidth - m.width - 8, r.left)) + "px";
  anchor.setAttribute("aria-expanded", "true");
  pop.dataset.anchor = anchor.id;
}
function closeMenu() { if (pop.hidden) return; $(pop.dataset.anchor)?.setAttribute("aria-expanded", "false"); pop.hidden = true; }
document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#popover, [aria-haspopup]")) closeMenu(); });
addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
addEventListener("resize", closeMenu);

// Copy button: the confirmation sits on the button itself, where the eye already is.
function copyButton(text, label = "복사") {
  const b = el("button", { type: "button", className: "copy", innerHTML: SVG.copy, title: label });
  b.setAttribute("aria-label", label);
  b.addEventListener("click", async () => {
    await navigator.clipboard.writeText(text);
    b.innerHTML = SVG.check; b.classList.add("done"); b.dataset.tip = "복사됨";
    setTimeout(() => { b.innerHTML = SVG.copy; b.classList.remove("done"); delete b.dataset.tip; }, 1600);
  });
  return b;
}

// Bubble group: one suggested message as the bubbles it is sent in, each with its own copy button, so a message
// meant to go out as two bubbles is copied and sent as two.
function bubbleGroup({ tone, bubbles }) {
  return el("li", { className: "option" },
    el("p", { className: "tone", textContent: tone }),
    el("div", { className: "bubbles" }, ...bubbles.map((text, i) => el("div", { className: "bubble-row" }, el("p", { className: "bubble", textContent: text }), copyButton(text, tone + " " + (i + 1) + "번째 말풍선 복사")))));
}

function avatar(c) {
  const url = photoUrl(c);
  return url ? el("img", { className: "avatar", src: url, alt: "" }) : el("span", { className: "avatar", textContent: initial(c.name) });
}

async function loadRoster() {
  const list = await api("/crushes");
  $("roster").replaceChildren(...list.map((c) => {
    const b = el("button", { type: "button", title: c.name }, avatar(c), el("span", { className: "who" }, el("strong", { textContent: c.name }), el("small", {}, ...parts(c.state.day ? "D+" + c.state.day : null, c.state.stage))), el("span", { className: "score", textContent: "♥" + c.state.gauge.score }));
    b.dataset.id = c.id;
    b.setAttribute("aria-current", String(c.id === current));
    b.addEventListener("click", () => select(c.id));
    return el("li", {}, b);
  }));
  $("roster-empty").hidden = list.length > 0;
  if (!current && list[0]) await select(list[0].id);
  if (!list.length) paintEmpty();
}

function paintEmpty() {
  $("thread").replaceChildren(el("div", { className: "empty" }, el("h2", { textContent: "던지면 알아서 정리한다" }), el("p", { textContent: "카톡 대화 내보내기, 데이팅앱이나 메신저 스크린샷, 메모를 끌어다 놓거나, 입력창의 + 에서 인스타그램 DM 주소를 넣는다. 이름을 읽어 기존 상대에 붙이거나 새 상대를 만들고, 다음 한 수를 고른다." })));
}

function paintStage() {
  const c = detail, s = c.state;
  $("crumb").textContent = c.name;
  $("dday").textContent = s.day ? "D+" + s.day : "D+?";
  $("name").textContent = c.name;
  $("chips").replaceChildren(...parts(c.app, s.stage, s.daysToMeet !== null ? "약속까지 " + s.daysToMeet + "일" : null));
  const on = Math.round(s.gauge.score / 10);
  $("hearts").replaceChildren(...Array.from({ length: 10 }, (_, i) => el("i", { className: i < on ? "on" : "" })));
  $("hearts").setAttribute("aria-valuenow", s.gauge.score);
  $("hearts").title = "호감 게이지 " + s.gauge.score + "/100";
  $("parts").replaceChildren(...s.gauge.parts.map((p) => el("li", {}, el("b", { textContent: p.label + " " + p.points + "/" + p.max }), " ", p.why)));
  const url = photoUrl(c);
  $("portrait").hidden = !url; if (url) $("portrait").src = url;
  $("initial").hidden = Boolean(url); $("initial").textContent = initial(c.name);
  $("sprite").classList.toggle("photo", Boolean(url) && !/\.png$/i.test(c.photo ?? ""));
  $("speaker").textContent = s.last ? (s.last.who === "her" ? c.name : "나") : "OpenFlirt";
  $("line").textContent = s.last ? s.last.text : "아직 기록이 없다. 아래에 대화나 스크린샷을 넣는다.";
}

function aiTurn(d) {
  const options = choicesOf(d);
  const why = el("details", { className: "why" }, el("summary", { textContent: "왜 이렇게 보나" }), el("div", { textContent: d.answer }), ...(d.citations ?? []).map((c) => el("span", { className: "cite", textContent: "[" + c.t + "] " + c.quote })));
  return el("article", { className: "turn-ai" },
    el("p", { className: "verdict" }, el("span", { className: "tag", textContent: "판정 " + (VERDICT[d.verdict] ?? d.verdict) }), el("span", { className: "tag pink", textContent: ACTION[d.action] ?? d.action })),
    d.reading ? el("p", { className: "reading", textContent: d.reading }) : null,
    options.length ? el("ul", { className: "options" }, ...options.map(bubbleGroup)) : null,
    why);
}

function paintThread() {
  const byId = new Map(detail.decisions.map((d) => [d.id, d]));
  const turns = detail.chat.length ? detail.chat : detail.decisions.map((d) => ({ role: "assistant", decision: d.id }));
  const nodes = turns.map((t) => {
    if (t.role === "user") return el("div", { className: "turn-user" }, t.text || null, t.files?.length ? el("div", { className: "files" }, ...t.files.map((f) => el("span", { className: "file", textContent: f }))) : null);
    if (t.role === "system") return el("p", { className: "turn-sys", textContent: t.text });
    const d = byId.get(t.decision);
    return d ? aiTurn(d) : null;
  }).filter(Boolean);
  if (!nodes.length) nodes.push(el("div", { className: "empty" }, el("h2", { textContent: "다음 한 수를 물어본다" }), el("p", { textContent: "\"마지막 답장에 뭐라고 보낼까\"처럼 묻거나, 새 대화와 스크린샷을 끌어다 놓는다." })));
  $("thread").replaceChildren(...nodes);
}

function paintTimeline() {
  $("count").textContent = detail.timelineTotal + "개";
  const out = [el("li", { className: "edge", id: "edge", textContent: detail.timelineStart === 0 ? "대화의 시작" : "" })];
  let day = null;
  for (const e of detail.timeline) {
    if (e.at.slice(0, 10) !== day) { day = e.at.slice(0, 10); out.push(el("li", { className: "day", textContent: day.replaceAll("-", ".") })); }
    const mark = e.kind !== "message";
    const who = mark ? KIND[e.kind] ?? e.kind : e.who === "me" ? "나" : detail.name;
    out.push(el("li", { className: "ev" + (e.who === "me" ? " me" : "") + (mark ? " mark" : "") }, el("p", { className: "meta" }, ...parts(e.at.slice(11, 16), who)), el("p", { className: "txt", textContent: e.text })));
  }
  $("timeline").replaceChildren(...out);
  if (detail.timelineStart > 0) edgeWatch.observe($("edge"));
}

async function select(id, { scroll = true } = {}) {
  current = id;
  detail = await api("/crushes/" + enc(id));
  paintStage(); paintThread(); paintTimeline();
  if (scroll) $("timeline").scrollTop = $("timeline").scrollHeight;
  for (const b of $("roster").querySelectorAll("button")) b.setAttribute("aria-current", String(b.dataset.id === id));
}

// Older entries load when the reader scrolls to the top of the timeline, the way a chat app pages back;
// the scroll position stays on the entry the reader was looking at.
let loadingOlder = false;
const edgeWatch = new IntersectionObserver(async ([hit]) => {
  if (!hit?.isIntersecting || loadingOlder || !detail || detail.timelineStart === 0) return;
  const box = $("timeline");
  if (box.scrollHeight <= box.clientHeight) return;
  loadingOlder = true;
  $("edge").textContent = "이전 기록 불러오는 중";
  try {
    const id = current;
    const older = await api("/crushes/" + enc(id) + "?before=" + detail.timelineStart);
    if (id !== current) return;
    const h = box.scrollHeight;
    detail.timeline = [...older.timeline, ...detail.timeline];
    detail.timelineStart = older.timelineStart;
    edgeWatch.disconnect();
    paintTimeline();
    box.scrollTop += box.scrollHeight - h;
  } finally { loadingOlder = false; }
}, { root: document.getElementById("timeline") });

// Sidebar: folds to a rail of avatars and remembers the choice.
const setFold = (on) => { $("app").classList.toggle("folded", on); $("fold").setAttribute("aria-expanded", String(!on)); localStorage.setItem("openflirt.fold", on ? "1" : ""); };
$("fold").addEventListener("click", () => setFold(!$("app").classList.contains("folded")));
setFold(localStorage.getItem("openflirt.fold") === "1");

// Model picker: runtimes and models come from the server, which reads each CLI's own catalog.
let runtimes = [];
function paintModel() {
  $("model-icon").src = RUNTIME_ICON[model.runtime];
  $("model-name").textContent = model.model || (model.runtime === "claude" ? "Claude" : "Codex");
}
$("model-btn").addEventListener("click", (e) => {
  if (!pop.hidden && pop.dataset.anchor === "model-btn") return closeMenu();
  openMenu(e.currentTarget, runtimes.flatMap((r) => [{ group: r.label, icon: RUNTIME_ICON[r.runtime] }, ...["", ...r.models].map((m) => ({ label: m || "기본 설정", selected: model.runtime === r.runtime && model.model === m, onPick: () => { model = { runtime: r.runtime, model: m }; localStorage.setItem("openflirt.model", JSON.stringify(model)); paintModel(); } }))]));
});

// Source picker: the composer's plus button, like a chat app's connectors.
function setSource(s) {
  source = s;
  $("source-chip").hidden = !s;
  if (s) { $("source-icon").replaceChildren(s.icon ? el("img", { src: s.icon, alt: "" }) : svg(s.svg)); $("source-name").textContent = s.label; }
$("ask").placeholder = s?.placeholder ?? (matchMedia("(max-width:760px)").matches ? "묻거나 파일을 넣는다. 카톡, DM은 +" : "무엇이든 묻거나 파일을 끌어다 놓는다. 카톡이나 DM은 + 에서 고른다");
  $("ask").focus();
}
$("source-clear").addEventListener("click", () => setSource(null));
$("plus").addEventListener("click", (e) => {
  if (!pop.hidden && pop.dataset.anchor === "plus") return closeMenu();
  openMenu(e.currentTarget, SOURCES.map((s) => ({ ...s, onPick: () => { if (s.kind === "file") { $("file").accept = s.accept; $("file").click(); } else setSource(s); } })));
});

// Composer: files are routed one by one (the server picks the crush), then the text goes to openflirt.
function paintAttached() {
  $("attached").replaceChildren(...pending.map((f, i) => el("span", { className: "file" }, el("span", { textContent: f.name }), Object.assign(el("button", { type: "button", textContent: "×", title: "빼기" }), { onclick: () => { pending.splice(i, 1); paintAttached(); } }))));
}
const addFiles = (files) => { pending.push(...files); paintAttached(); $("ask").focus(); };
$("file").addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });
let drag = 0;
addEventListener("dragenter", (e) => { e.preventDefault(); drag++; $("drop").hidden = false; });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("dragleave", () => { if (--drag <= 0) { drag = 0; $("drop").hidden = true; } });
addEventListener("drop", (e) => { e.preventDefault(); drag = 0; $("drop").hidden = true; addFiles([...e.dataTransfer.files]); });
addEventListener("paste", (e) => { const fs = [...(e.clipboardData?.files ?? [])]; if (fs.length) addFiles(fs); });
const ask = $("ask");
ask.addEventListener("input", () => { ask.style.height = "auto"; ask.style.height = ask.scrollHeight + "px"; });
ask.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("composer").requestSubmit(); } });

$("composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = ask.value.trim();
  if (source?.pattern && !source.pattern.test(text)) { status(source.label + " 주소 꼴이 아니다: " + source.placeholder); return; }
  const files = pending.splice(0);
  if (!text && !files.length) return;
  $("send").disabled = true; paintAttached();
  try {
    let target = current;
    const notes = [];
    for (const f of files) {
      status(f.name + " 넣는 중", true);
      let r = await api("/inbox", { method: "POST", body: f, headers: { "x-filename": enc(f.name), ...(target ? { "x-selected": enc(target) } : {}) } });
      if (r.status === "ambiguous") {
        const pick = prompt(f.name + ": 누구의 기록인가? " + r.ambiguous.join(", "), r.ambiguous[0]);
        if (!pick) continue;
        r = await api("/inbox", { method: "POST", body: f, headers: { "x-filename": enc(f.name), "x-selected": enc(pick) } });
      }
      target = r.id; notes.push(f.name + ": " + r.reason);
    }
    if (notes.length) { await loadRoster(); await select(target); }
    if (!target) { status("상대가 없다. 먼저 대화 파일이나 스크린샷을 넣는다."); return; }
    if (detail?.unread) { status("스크린샷 읽는 중", true); await json("POST", "/crushes/" + enc(target) + "/read", {}); }
    ask.value = ""; ask.style.height = "auto"; setSource(null);
    status("OpenFlirt가 읽는 중, 1~2분", true);
    $("thread").append(el("div", { className: "turn-user", textContent: text || files.map((f) => f.name).join(", ") }));
    $("thread").lastElementChild.scrollIntoView({ block: "end", behavior: "smooth" });
    await json("POST", "/crushes/" + enc(target) + "/chat", { text, files: files.map((f) => f.name), runtime: model.runtime, model: model.model || undefined });
    status(notes.join(" / "));
    await select(target);
    $("thread").lastElementChild?.scrollIntoView({ block: "end", behavior: "smooth" });
    loadRoster();
  } catch (err) { status("실패: " + err.message); }
  finally { $("send").disabled = false; }
});

$("feed-btn").addEventListener("click", (e) => { e.stopPropagation(); $("app").classList.toggle("show-feed"); });
document.addEventListener("click", (e) => { if (!e.target.closest(".feed, #feed-btn")) $("app").classList.remove("show-feed"); });
api("/models").then((list) => { runtimes = list; paintModel(); }).catch(() => paintModel());
setSource(null);
loadRoster().catch((e) => status("불러오지 못했다: " + e.message));
