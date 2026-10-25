// Turns the rows read.mjs reads from an Instagram DM thread (Korean web UI) into the chat-reader thread format.
// A row is one child of the thread's message list, read by structure: head (the timestamp shown above it),
// quote (what sits above the bubble: a reply's quoted message, the edited mark, a story marker), texts (the
// bubble), after (what sits under it: reactions, and any status in words), its aria-labels, its images as [width, height, inside a link, alt],
// its link addresses and its video and audio counts. Nothing here touches a browser, so a capture saved as
// raw.json can be normalized again after a rule changes.

const SENDER = /^(.+)님의 메시지에 공감하기$/;
// The other side's messages carry their avatar, labelled in English even in the Korean UI; the reader's never do.
const OTHER = /^Open the profile page of (.+)$/;
const ABSOLUTE = /^(\d{4})\. (\d{1,2})\. (\d{1,2})\. (오전|오후) (\d{1,2}):(\d{2})$/;
const WEEKDAY = /^\((일|월|화|수|목|금|토)\) (오전|오후) (\d{1,2}):(\d{2})$/;
// The forms below were not in the measured thread, which had no message from the capture day or the day before;
// any other form stops the run (UNKNOWN_HEADER) instead of dating messages wrong.
const YESTERDAY = /^어제 (오전|오후) (\d{1,2}):(\d{2})$/;
const TODAY = /^(오전|오후) (\d{1,2}):(\d{2})$/;
const DAYS = "일월화수목금토";
const CALL = /^(?:(.+)님이 )?(음성|영상) 통화(를 시작했습니다|가 종료되었습니다|를 받지 못했습니다)$/;
const CALL_EVENT = { "를 시작했습니다": "start", "가 종료되었습니다": "end", "를 받지 못했습니다": "missed" };
const CALL_WORD = { start: "시작", end: "종료", missed: "못 받음" };
const STORY = /님의 스토리에 (답장을 보냈습니다|공감했습니다)$/;
const STORY_GONE = "스토리를 볼 수 없습니다";
const REPLY = /^.+님이 .+에게 보낸 답장$/;
const ONCE = /^이 (사진|동영상)은 한 번만 다시 볼 수 있습니다/;
const SENT = /^(사진|동영상)(?: (\d+)(?:장|개))?[을를] 보냈습니다$/;
const EDITED = "수정됨";
const MIN_PHOTO_PX = 40; // narrower images are avatars and icons
const PRECISION = {
  minute: "시각은 메시지마다 분 단위다.",
  block: "시각은 앱이 묶음 위에 보여 준 시각이고, 같은 묶음 안의 간격은 알 수 없다.",
};

const pad = (n) => String(n).padStart(2, "0");
const hour24 = (ampm, h) => (Number(h) % 12) + (ampm === "오후" ? 12 : 0);
const dayOf = (capturedAt, back) => {
  const [y, m, d] = capturedAt.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - back));
};
const stamp = (date, ampm, h, min) =>
  date.getUTCFullYear() + "-" + pad(date.getUTCMonth() + 1) + "-" + pad(date.getUTCDate()) + "T" + pad(hour24(ampm, h)) + ":" + pad(Number(min));
const fail = (code, message) => Object.assign(new Error(message), { code });
const dedupe = (texts) => texts.filter((t, i) => t !== texts[i - 1]);

// A timestamp header dates every message below it until the next one. Within the last week the app writes only a
// weekday, which is the latest such day before the capture day.
function parseHeader(text, capturedAt) {
  let m = text.match(ABSOLUTE);
  if (m !== null) return stamp(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))), m[4], m[5], m[6]);
  m = text.match(WEEKDAY);
  if (m !== null) return stamp(dayOf(capturedAt, (dayOf(capturedAt, 0).getUTCDay() - DAYS.indexOf(m[1]) + 7) % 7 || 7), m[2], m[3], m[4]);
  m = text.match(YESTERDAY);
  if (m !== null) return stamp(dayOf(capturedAt, 1), m[1], m[2], m[3]);
  m = text.match(TODAY);
  if (m !== null) return stamp(dayOf(capturedAt, 0), m[1], m[2], m[3]);
  throw fail("UNKNOWN_HEADER", "알 수 없는 시각 머리글: " + text);
}

function systemMessage(line, me) {
  const call = line.match(CALL);
  if (call === null) return { who: null, kind: "system", text: line };
  const event = CALL_EVENT[call[3]];
  // A start without a name is the reader's own call; an end or a miss names nobody.
  const who = event === "start" ? (call[1] ?? me) : null;
  return { who, kind: "call", text: call[2] + " 통화 " + CALL_WORD[event], call: { type: call[2] === "음성" ? "voice" : "video", event } };
}

function personMessage(row, who) {
  const message = { who, kind: "text" };
  let quote = dedupe(row.quote);
  let body = dedupe(row.texts);
  if (quote.includes(EDITED)) {
    message.edited = true;
    quote = quote.filter((t) => t !== EDITED);
  }
  const story = [...quote, ...body].map((t) => t.match(STORY)).find((m) => m !== null);
  if (story !== undefined) {
    message.kind = "story";
    message.story = story[1] === "공감했습니다" ? "like" : "reply";
    quote = quote.filter((t) => !STORY.test(t) && t !== STORY_GONE);
    body = body.filter((t) => !STORY.test(t) && t !== STORY_GONE);
  } else if (quote.length > 0 && REPLY.test(quote[0])) {
    // A quote of a photo has no text, so the reply carries no replyTo.
    if (quote.length > 1) message.replyTo = quote.slice(1).join("\n");
    quote = [];
  }
  const media = {};
  // The app writes "사진 n장을 보냈습니다" above an album and the view-once notice inside the bubble; both are markers.
  const marks = [...quote, ...body];
  const once = marks.map((t) => t.match(ONCE)).find((m) => m !== null);
  if (once !== undefined) {
    media[once[1] === "사진" ? "photos" : "videos"] = 1;
    media.once = true;
  }
  const sent = marks.map((t) => t.match(SENT)).find((m) => m !== null);
  if (sent !== undefined) media[sent[1] === "사진" ? "photos" : "videos"] = Number(sent[2] ?? 1);
  quote = quote.filter((t) => !ONCE.test(t) && !SENT.test(t));
  body = body.filter((t) => !ONCE.test(t) && !SENT.test(t));
  if (message.kind !== "story" && once === undefined && sent === undefined) {
    // Images inside a link are link previews, not photos the sender attached.
    const photos = row.imgs.filter(([width, , inLink]) => width >= MIN_PHOTO_PX && !inLink).length;
    if (photos > 0) media.photos = photos;
    if (row.video > 0) media.videos = row.video;
  }
  if (row.audio > 0) media.audio = row.audio;
  // A link counts when the bubble shows its address; the address line then moves out of the text.
  const links = [...new Set(row.hrefs.filter((h) => /^https?:\/\//.test(h) && body.some((t) => t.includes(h))))];
  body = body
    .map((t) => t.split("\n").filter((line) => !links.includes(line.trim())).join("\n"))
    .filter((t) => t.trim() !== "");
  message.text = [...quote, ...body].join("\n");
  if (Object.keys(media).length > 0) {
    message.media = media;
    if (message.kind === "text" && message.text === "") message.kind = "media";
  }
  if (links.length > 0) message.links = links;
  // Under the bubble sit the reactions, which are emoji, and any status the app prints there in words.
  const reactions = row.after.filter((t) => !/\p{L}/u.test(t));
  const notes = row.after.filter((t) => /\p{L}/u.test(t));
  if (reactions.length > 0) message.reactions = reactions;
  if (notes.length > 0) message.notes = notes;
  return message;
}

export function normalizeRows(raw, { me: chosen } = {}) {
  const rows = [...raw.rows].sort((a, b) => b.rev - a.rev);
  const senders = [];
  const others = [];
  for (const row of rows) {
    for (const label of row.labels) {
      const s = label.match(SENDER);
      if (s !== null && !senders.includes(s[1])) senders.push(s[1]);
      const o = label.match(OTHER);
      if (o !== null && !others.includes(o[1])) others.push(o[1]);
    }
  }
  if (senders.length === 0) throw fail("UI_LANGUAGE", "보낸 사람 표시(\"…님의 메시지에 공감하기\")를 한 줄에서도 찾지 못했다. 인스타그램 화면 언어가 한국어인지 본다.");
  if (chosen !== undefined && !senders.includes(chosen)) throw fail("BAD_ME", "--me " + chosen + "는 이 대화에서 보낸 메시지가 없다. 보낸 사람: " + senders.join(", "));
  const own = senders.filter((s) => !others.includes(s));
  const me = chosen ?? (own.length === 1 ? own[0] : null);
  const messages = [];
  let clock = null;
  for (const row of rows) {
    if (row.head.length > 0) clock = parseHeader(row.head.join(" "), raw.capturedAt);
    const who = row.labels.map((label) => label.match(SENDER)).find((m) => m !== null)?.[1];
    const message = who === undefined ? (row.texts.length > 0 ? systemMessage(dedupe(row.texts).join(""), me) : null) : personMessage(row, who);
    if (message === null) continue;
    if (clock === null) throw fail("NO_TOP", "가장 오래된 줄에 시각 머리글이 없다. 대화방 맨 위에 닿지 못했다.");
    messages.push({ at: clock, ...message });
  }
  const participants = [...new Set(messages.map((m) => m.who).filter((who) => who !== null))];
  const title = (others.length > 0 ? others : participants.filter((p) => p !== me)).join(", ");
  return { source: "instagram", title, me, participants, timePrecision: "block", messages };
}

export function renderTranscript(thread) {
  const { messages } = thread;
  const counts = new Map();
  let system = 0;
  for (const m of messages) {
    if (m.who === null) system++;
    else counts.set(m.who, (counts.get(m.who) ?? 0) + 1);
  }
  const tally = [...counts].map(([who, n]) => who + " " + n).concat("시스템 " + system).join(", ");
  const lines = ["# " + thread.title, "", thread.source + " 대화 " + messages[0].at.slice(0, 10) + " ~ " + messages.at(-1).at.slice(0, 10) + ", 메시지 " + messages.length + "개 (" + tally + ").", PRECISION[thread.timePrecision]];
  let day = null;
  for (const m of messages) {
    const date = m.at.slice(0, 10);
    if (date !== day) {
      day = date;
      lines.push("", "## " + date + " (" + DAYS[new Date(date + "T00:00:00Z").getUTCDay()] + ")", "");
    }
    const [first = "", ...rest] = m.text.split("\n").map((line) => line.trim()).filter((line) => line !== "");
    const parts = [];
    if (m.replyTo !== undefined) parts.push("[답장: " + [...m.replyTo.replace(/\s+/g, " ")].slice(0, 40).join("") + "]");
    if (m.story !== undefined) parts.push(m.story === "reply" ? "[스토리 답장]" : "[스토리 공감]");
    if (m.media?.photos) parts.push("[사진 " + m.media.photos + "장]");
    if (m.media?.videos) parts.push("[동영상 " + m.media.videos + "개]");
    if (m.media?.audio) parts.push("[음성 메시지]");
    if (m.media?.once) parts.push("[한 번 보기]");
    if (first !== "") parts.push(first);
    if (m.edited) parts.push("(수정됨)");
    if (m.reactions !== undefined) parts.push("[공감 " + m.reactions.join(" ") + "]");
    if (m.notes !== undefined) parts.push("(" + m.notes.join(", ") + ")");
    lines.push(("- " + m.at.slice(11) + " " + (m.who === null ? "(시스템)" : m.who + ":") + " " + parts.join(" ")).trimEnd());
    for (const line of rest) lines.push("  " + line);
    for (const url of m.links ?? []) lines.push("  " + url);
  }
  lines.push("");
  return lines.join("\n");
}
