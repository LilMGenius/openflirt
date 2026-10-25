// Pure functions for the kakaotalk-chat reader: parseExport(text, {fileName, me}) -> thread object,
// renderTranscript(thread) -> markdown. The message-line parsing is taken over from openflirt
// skills/openflirt/scripts/chatlog.mjs parseExport (same regexes, same hour arithmetic), so every line
// that parser reads gives the same (at, who, text) here. Changes from it: times are strings instead of
// Dates, continuation lines keep their line break, and the app's own system lines become rows with
// who null instead of being glued onto the previous message.

export class ExportError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExportError";
  }
}

const PC_DATE = /^-+\s*(\d{4})년 (\d{1,2})월 (\d{1,2})일 \S+요일\s*-+$/;
const PC_LINE = /^\[(.+?)\] \[(오전|오후) (\d{1,2}):(\d{2})\] (.*)$/;
const MOBILE_LINE = /^(\d{4})(?:년 |\. )(\d{1,2})(?:월 |\. )(\d{1,2})(?:일|\.) (오전|오후) (\d{1,2}):(\d{2}), (.+?) : (.*)$/;
const HEADER = /^(.+?) 님과 카카오톡 대화$/;
const MOBILE_DATE = /^\d{4}년 \d{1,2}월 \d{1,2}일 \S+요일$/;

// Lines the app writes with no sender and no time, measured on real PC exports: a deleted-message
// notice and an invitation notice. Other notices (leaving, joining) did not occur in the measured
// exports and are not recognised, so they stay glued to the previous message like any other line.
const SYSTEM_LINE = /^(?:메시지가 삭제되었습니다\.|.+님이 .+님을 초대했습니다\.)$/;

const hour24 = (ampm, h) => (Number(h) % 12) + (ampm === "오후" ? 12 : 0);
const pad = (n) => String(n).padStart(2, "0");
const stamp = (y, mo, d, h, mi) => String(y).padStart(4, "0") + "-" + pad(mo) + "-" + pad(d) + "T" + pad(h) + ":" + pad(mi);

// A whole-message text the app writes for an attachment or a call. Anything else stays kind "text".
function classify(text) {
  let m;
  if (text === "사진") return { kind: "media", text: "", media: { photos: 1 } };
  if ((m = text.match(/^사진 (\d+)장$/))) return { kind: "media", text: "", media: { photos: Number(m[1]) } };
  if (text === "동영상") return { kind: "media", text: "", media: { videos: 1 } };
  if (text === "이모티콘" || /^파일: ./.test(text)) return { kind: "media", text };
  if (text === "보이스톡 해요") return { kind: "call", text: "음성 통화 시작", call: { type: "voice", event: "start" } };
  if (/^보이스톡 (?:부재중|취소|응답없음)$/.test(text)) return { kind: "call", text: "음성 통화 못 받음", call: { type: "voice", event: "missed" } };
  if (/^보이스톡 (?:\d+:)?\d{1,2}:\d{2}$/.test(text)) return { kind: "call", text: "음성 통화 종료", call: { type: "voice", event: "end" } };
  return { kind: "text", text };
}

export function parseExport(text, { fileName = "chat.txt", me } = {}) {
  const rows = [];
  let partner;
  let day = null;
  let matched = 0;
  const push = (at, who, body) => {
    matched++;
    rows.push({ at, who, raw: body });
  };
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = rows.length === 0 && line.match(HEADER);
    if (h) { partner = h[1]; continue; }
    const d = line.match(PC_DATE);
    if (d) { day = [Number(d[1]), Number(d[2]), Number(d[3])]; continue; }
    const p = line.match(PC_LINE);
    if (p && day) { push(stamp(day[0], day[1], day[2], hour24(p[2], p[3]), Number(p[4])), p[1], p[5]); continue; }
    const m = line.match(MOBILE_LINE);
    if (m) { push(stamp(Number(m[1]), Number(m[2]), Number(m[3]), hour24(m[4], m[5]), Number(m[6])), m[7], m[8]); continue; }
    if (line === "" || MOBILE_DATE.test(line)) continue;
    if (SYSTEM_LINE.test(line.trim())) { rows.push({ at: null, who: null, raw: line.trim(), system: true }); continue; }
    const owner = rows.findLast((r) => !r.system);
    if (owner) owner.raw += "\n" + line.trim();
  }
  if (matched === 0) throw new ExportError("카카오톡 내보내기 형식의 메시지 줄을 찾지 못했다. 대화를 직접 읽는다.");

  // A system line has no time of its own: it takes the minute of the message before it, or of the first message when none came before.
  let lastAt = rows.find((r) => r.at !== null).at;
  for (const r of rows) r.at === null ? (r.at = lastAt) : (lastAt = r.at);

  const messages = rows.map((r) => (r.system ? { at: r.at, who: null, kind: "system", text: r.raw } : { at: r.at, who: r.who, ...classify(r.raw) }));
  const participants = [...new Set(messages.filter((m) => m.who !== null).map((m) => m.who))];
  const others = participants.filter((n) => n !== partner);
  const resolved = me ?? (partner !== undefined && participants.length === 2 && others.length === 1 ? others[0] : null);
  if (resolved !== null && !participants.includes(resolved)) throw new ExportError("--me 이름이 대화에 없다. 대화의 이름: " + participants.join(", "));
  return {
    source: "kakaotalk",
    title: partner ?? fileName.replace(/\.[^.\\/]*$/, ""),
    me: resolved,
    participants,
    timePrecision: "minute",
    messages,
  };
}

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const dayOf = (at) => at.slice(0, 10);
const weekday = (at) => WEEKDAY[new Date(Number(at.slice(0, 4)), Number(at.slice(5, 7)) - 1, Number(at.slice(8, 10))).getDay()];

function prefixes(m) {
  const out = [];
  if (m.media?.photos) out.push("[사진 " + m.media.photos + "장]");
  if (m.media?.videos) out.push("[동영상 " + m.media.videos + "개]");
  return out;
}

export function renderTranscript(thread) {
  const { messages } = thread;
  const counts = thread.participants.map((n) => n + " " + messages.filter((m) => m.who === n).length);
  counts.push("시스템 " + messages.filter((m) => m.who === null).length);
  const out = [
    "# " + thread.title,
    "",
    thread.source + " 대화 " + dayOf(messages[0].at) + " ~ " + dayOf(messages.at(-1).at) + ", 메시지 " + messages.length + "개 (" + counts.join(", ") + ").",
    "시각은 메시지마다 분 단위다.",
  ];
  let day = "";
  for (const m of messages) {
    if (dayOf(m.at) !== day) {
      day = dayOf(m.at);
      out.push("", "## " + day + " (" + weekday(m.at) + ")", "");
    }
    const time = m.at.slice(11);
    if (m.who === null) {
      out.push("- " + time + " (시스템) " + m.text);
      continue;
    }
    const [head, ...rest] = m.text.split("\n");
    const first = [...prefixes(m), head].filter((s) => s !== "").join(" ");
    out.push("- " + time + " " + m.who + ":" + (first === "" ? "" : " " + first));
    for (const l of rest) out.push("  " + l);
  }
  return out.join("\n") + "\n";
}
