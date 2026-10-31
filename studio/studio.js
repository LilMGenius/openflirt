import { choicesOf } from "./choices.js";
// openflirt studio page. All state lives in the crush folders on disk; this page only draws what the local
// server returns and sends what the asker drops in. Writes carry the token the server printed into the page.
const TOKEN = document.querySelector('meta[name="openflirt-token"]').content;
const $ = (id) => document.getElementById(id);
const VERDICT = { interest: "관심", ambiguous: "애매", friction: "마찰", over: "끝", unknown: "모름" };
const ACTION = { stop: "멈춤", withdraw: "뺌", let_go: "놓음", ask_meet: "약속 잡기", reciprocate: "정상 반응", hold_standard: "기준 지키기", observe: "지켜봄" };
let current = null;
let detail = null;

const api = async (path, { method = "GET", body, headers = {} } = {}) => {
  const res = await fetch("/api/crushes" + path, { method, body, headers: method === "GET" ? headers : { "x-openflirt-token": TOKEN, ...headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? res.statusText);
  return data;
};
const json = (method, path, value) => api(path, { method, body: JSON.stringify(value), headers: { "content-type": "application/json" } });
const status = (text) => { $("status").textContent = text; };
const busy = async (label, work) => {
  status(label + "…");
  for (const b of ["next", "read", "heart"]) $(b).disabled = true;
  try { const r = await work(); status(""); return r; }
  catch (e) { status("실패: " + e.message); throw e; }
  finally { paintButtons(); }
};
const initial = (name) => [...name.trim()][0] ?? "?";
const photoUrl = (c) => (c.photo ? "/api/crushes/" + encodeURIComponent(c.id) + "/photo?" + encodeURIComponent(c.photo) : null);
const when = (at) => at.slice(5, 16).replace("-", "/").replace("T", " ");

function avatar(c) {
  const url = photoUrl(c);
  if (url) { const img = document.createElement("img"); img.className = "avatar"; img.src = url; img.alt = ""; return img; }
  const span = document.createElement("span"); span.className = "avatar"; span.textContent = initial(c.name); return span;
}

async function loadRoster() {
  const list = await api("");
  const ol = $("roster");
  ol.replaceChildren(...list.map((c) => {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-current", String(c.id === current));
    const text = document.createElement("span");
    text.innerHTML = "<strong></strong><small></small>";
    text.querySelector("strong").textContent = c.name;
    text.querySelector("small").textContent = (c.state.day ? "D+" + c.state.day + " · " : "") + c.state.stage;
    const score = document.createElement("span"); score.className = "score"; score.textContent = c.state.gauge.score;
    b.append(avatar(c), text, score);
    b.addEventListener("click", () => select(c.id));
    li.append(b);
    return li;
  }));
  $("roster-empty").hidden = list.length > 0;
  if (!current && list[0]) await select(list[0].id);
}

function paintButtons() {
  const has = Boolean(detail);
  $("next").disabled = !has;
  $("read").disabled = !has || detail.unread === 0;
  const d = detail?.decisions.at(-1);
  $("heart").disabled = !d;
  $("heart").setAttribute("aria-pressed", String(d?.feedback === "like"));
}

function paint() {
  const c = detail;
  const s = c.state;
  $("day").textContent = s.day ? "D+" + s.day : "";
  $("name").textContent = c.name;
  const chips = [c.app, s.stage, s.daysToMeet !== null ? "약속까지 " + s.daysToMeet + "일" : null].filter(Boolean);
  $("chips").replaceChildren(...chips.map((t) => Object.assign(document.createElement("span"), { textContent: t })));
  $("meter-fill").style.width = s.gauge.score + "%";
  $("meter-score").textContent = "♥ " + s.gauge.score;
  $("meter").setAttribute("aria-valuenow", s.gauge.score);
  $("parts").replaceChildren(...s.gauge.parts.map((p) => { const li = document.createElement("li"); li.innerHTML = "<b></b> "; li.querySelector("b").textContent = p.label + " " + p.points + "/" + p.max; li.append(p.why); return li; }));
  const url = photoUrl(c);
  $("portrait").hidden = !url; if (url) $("portrait").src = url;
  $("portrait").parentElement.classList.toggle("framed", Boolean(url) && !/\.png$/i.test(c.photo ?? ""));
  $("portrait-initial").hidden = Boolean(url); $("portrait-initial").textContent = initial(c.name);
  const last = s.last;
  $("speaker").textContent = last ? (last.who === "her" ? c.name : "나") + " · " + when(last.at) : "";
  $("line").textContent = last ? last.text : "아직 기록이 없다. 오른쪽에 대화나 스크린샷을 넣는다.";
  const d = c.decisions.at(-1);
  const box = $("choices");
  if (!d) box.replaceChildren();
  else {
    const head = document.createElement("p"); head.className = "verdict";
    head.textContent = "판정 " + (VERDICT[d.verdict] ?? d.verdict) + " · 할 일 " + (ACTION[d.action] ?? d.action);
    box.replaceChildren(head, ...choicesOf(d).map(({ tone, text }) => {
      const b = document.createElement("button"); b.type = "button";
      b.innerHTML = "<b></b>"; b.querySelector("b").textContent = tone; b.append(text);
      b.addEventListener("click", async () => { await navigator.clipboard?.writeText(text.replaceAll(" / ", "\n")); status("복사했다. 보내는 건 직접."); json("POST", "/" + encodeURIComponent(c.id) + "/feedback", { decision: d.id, feedback: "sent:" + tone }); });
      return b;
    }));
  }
  $("answer").textContent = d ? d.answer : "";
  $("why").hidden = !d;
  $("timeline").replaceChildren(...c.timeline.slice().reverse().slice(0, 120).map((e) => {
    const li = document.createElement("li"); li.className = e.who ?? e.kind; if (e.kind !== "message") li.classList.add(e.kind);
    const t = document.createElement("time"); t.textContent = when(e.at) + " · " + (e.who === "me" ? "나" : e.who === "her" ? c.name : e.kind);
    li.append(t, e.text);
    return li;
  }));
  paintButtons();
}

async function select(id) {
  current = id;
  detail = await api("/" + encodeURIComponent(id));
  paint();
  loadRoster();
}

async function upload(files) {
  if (!current) return status("먼저 상대를 고르거나 등록한다.");
  await busy("올리는 중", async () => {
    for (const f of files) {
      if (/^photo\./i.test(f.name) || (files.length === 1 && f.type.startsWith("image/") && confirm(f.name + "을 프로필 사진으로 쓸까? (취소하면 스크린샷 기록으로 넣는다)"))) {
        await api("/" + encodeURIComponent(current) + "/photo", { method: "POST", body: f, headers: { "x-filename": encodeURIComponent(f.name) } });
      } else {
        await api("/" + encodeURIComponent(current) + "/files", { method: "POST", body: f, headers: { "x-filename": encodeURIComponent(f.name) } });
      }
    }
  });
  await select(current);
}

$("file").addEventListener("change", (e) => upload([...e.target.files]));
const drop = $("drop");
for (const t of ["dragenter", "dragover"]) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); });
for (const t of ["dragleave", "drop"]) drop.addEventListener(t, () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => { e.preventDefault(); upload([...e.dataTransfer.files]); });
$("ig-form").addEventListener("submit", async (e) => { e.preventDefault(); await busy("인스타 DM 읽는 중", () => json("POST", "/" + encodeURIComponent(current) + "/instagram", { url: $("ig").value.trim() })); $("ig").value = ""; await select(current); });
$("read").addEventListener("click", async () => { const r = await busy("스크린샷 읽는 중(1~3분)", () => json("POST", "/" + encodeURIComponent(current) + "/read", {})); status("스크린샷 " + r.read + "장에서 기록 " + r.added + "개를 더했다."); await select(current); });
$("next").addEventListener("click", async () => { await busy("다음 행동 고르는 중(1~2분)", () => json("POST", "/" + encodeURIComponent(current) + "/next", { runtime: $("runtime").value })); await select(current); });
$("heart").addEventListener("click", async () => { const d = detail.decisions.at(-1); await json("POST", "/" + encodeURIComponent(current) + "/feedback", { decision: d.id, feedback: "like" }); await select(current); });
$("note-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("note").value.trim(); if (!text) return;
  const now = new Date(); const pad = (n) => String(n).padStart(2, "0");
  const at = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + "T" + pad(now.getHours()) + ":" + pad(now.getMinutes());
  await json("POST", "/" + encodeURIComponent(current) + "/event", { at, kind: "note", who: null, text });
  $("note").value = ""; await select(current);
});
$("add-open").addEventListener("click", () => $("add-dialog").showModal());
$("add-form").addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  const f = new FormData(e.target);
  const c = await json("POST", "", Object.fromEntries(f));
  e.target.reset(); current = null; await select(c.id);
});
loadRoster().catch((e) => status("불러오지 못했다: " + e.message));
