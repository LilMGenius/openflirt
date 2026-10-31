// The two model steps the crush loop needs, each a run of an installed agent CLI that returns schema-checked
// JSON: reading screenshots into events, and asking openflirt for the next action from a crush's folder.
// Both reuse the headless runner's process handling (scripts/lib/agent.mjs) and only build the prompt.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAgent } from "../../../../scripts/lib/agent.mjs";
import { checkEvent, computeState, evidencePath, readChat, readDecisions, readEvidence, readProfile, REPO_ROOT, timeline, CrushError } from "./store.mjs";

const EVENTS_SCHEMA = {
  type: "object", additionalProperties: false, required: ["events", "profile"],
  properties: {
    events: { type: "array", items: { type: "object", additionalProperties: false, required: ["at", "who", "kind", "text", "source"],
      properties: { at: { type: "string" }, who: { type: ["string", "null"], enum: ["me", "her", null] }, kind: { type: "string", enum: ["message", "meet", "plan", "call", "profile", "note"] }, text: { type: "string" }, source: { type: "string" } } } },
    profile: { type: "object", additionalProperties: false, required: ["name", "app", "notes"], properties: { name: { type: ["string", "null"] }, app: { type: ["string", "null"] }, notes: { type: "string" } } },
  },
};

const READ_PROMPT = (files, year) => [
  "첨부한 스크린샷은 데이팅앱, 메신저, SNS 화면이다. 화면에 보이는 것만 JSON으로 옮긴다. 추측하지 않는다.",
  "- 대화 말풍선 하나는 kind message 이벤트 하나다. 오른쪽(보통 색이 진한 쪽)이 질문자 me, 왼쪽이 상대 her다. text는 보이는 글자 그대로다.",
  "- at은 YYYY-MM-DDTHH:MM이다. 말풍선 아래 시각과 그 위의 날짜 구분선으로 정하고, 연도가 안 보이면 " + year + "년이다. 오전/오후를 24시로 바꾼다. 시각이 묶음에만 있으면 묶음의 말풍선은 같은 시각을 받는다.",
  "- 약속이 날짜와 함께 잡힌 말이 보이면 그 약속 시각으로 kind plan 이벤트를 하나 더 둔다.",
  "- profile.name에는 화면 위 대화 상대나 프로필의 이름, 닉네임을 보이는 대로 쓴다. 안 보이면 null이다.",
  "- 프로필 화면이면 이벤트 대신 profile.notes에 상대가 직접 적은 소개, 관심사, 성향을 한두 줄로 적고 app에 앱 이름을 쓴다(모르면 null).",
  "- source는 그 이벤트가 보인 파일 이름이다: " + files.join(", "),
  "- 같은 말풍선이 두 장에 겹쳐 보이면 한 번만 쓴다.",
].join("\n");

const codexJson = async ({ prompt, schema, images = [], timeoutSeconds = 600 }) => {
  const scratch = mkdtempSync(join(tmpdir(), "openflirt-crush-"));
  try {
    const schemaFile = join(scratch, "schema.json");
    const outFile = join(scratch, "out.json");
    writeFileSync(schemaFile, JSON.stringify(schema));
    const args = ["exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "-C", REPO_ROOT, "-o", outFile, "--output-schema", schemaFile, ...images.flatMap((i) => ["-i", i]), "-"];
    const result = await runAgent({ command: "codex", args, cwd: REPO_ROOT, input: prompt, timeoutMs: timeoutSeconds * 1000 });
    if (result.kind !== "exit" || result.code !== 0) throw new CrushError("codex 실행 실패: " + result.kind + (result.stderr ? " " + result.stderr.slice(-400) : ""));
    if (!existsSync(outFile)) throw new CrushError("codex가 답 파일을 남기지 않았다.");
    return JSON.parse(readFileSync(outFile, "utf8"));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

// Reads the unread images of a crush (or the given evidence files) into events and profile notes.
export async function readShots(id, { files, year = new Date().getFullYear() } = {}) {
  const pending = readEvidence(id).filter((e) => e.kind === "image" && (files ? files.includes(e.file) : !e.read));
  if (pending.length === 0) return { files: [], events: [], profile: null };
  const names = pending.map((e) => e.file.split("/").pop());
  const scratch = mkdtempSync(join(tmpdir(), "openflirt-shots-"));
  try {
    const images = pending.map((e, i) => fitImage(evidencePath(id, e.file), join(scratch, i + "-" + names[i].replace(/\.[^.]+$/, "") + ".jpg")));
    const out = await codexJson({ prompt: READ_PROMPT(names, year), schema: EVENTS_SCHEMA, images });
    const events = out.events.map((e, i) => checkEvent({ ...e, source: "evidence/" + e.source }, i));
    return { files: pending.map((e) => e.file), events, profile: out.profile };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// A phone capture is often 1320x2868, past the 2000 px per side a request with several images accepts, so
// each goes in as a JPEG no taller than 1600 px. ffmpeg does the scaling; without it the run stops rather
// than send captures the model would refuse.
function fitImage(src, out) {
  const r = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-i", src, "-vf", "scale='min(1600,iw)':'min(1600,ih)':force_original_aspect_ratio=decrease", "-q:v", "4", out], { windowsHide: true });
  if (r.error || r.status !== 0) throw new CrushError("스크린샷을 줄이지 못했다(ffmpeg가 PATH에 있어야 한다): " + (r.error?.message ?? String(r.stderr)));
  return out;
}

const line = (e) => e.at.replace("T", " ") + " " + (e.who === "me" ? "나" : e.who === "her" ? "상대" : "-") + " [" + e.kind + "] " + e.text.replace(/\s+/g, " ").slice(0, 200);

// The question openflirt answers for the next action: the counts first, then the recent timeline in order.
export function nextQuestion(id, { now = new Date(), ask = "" } = {}) {
  const profile = readProfile(id);
  const items = timeline(id);
  const state = computeState(items, now, { metOn: profile.metOn });
  const decisions = readDecisions(id).slice(-3);
  const parts = [
    "지금은 " + now.toISOString().slice(0, 16).replace("T", " ") + "(UTC)이다. 아래는 한 상대와의 기록을 시간순으로 모은 것이다. 나는 질문자, 상대는 썸 상대다.",
    "상대 메모: " + (profile.app ? profile.app + "에서 만남. " : "") + (profile.notes || "없음"),
    "센 것: 대화 " + state.day + "일째, " + state.stage + (state.nextMeet ? ", 다음 약속 " + state.nextMeet.at + " " + state.nextMeet.text : "") + ". 최근 14일 먼저 연 대화 나 " + state.recent.opened.me + "번, 상대 " + state.recent.opened.her + "번. 상대 답장 중앙값 " + (state.recent.replyMedianMinutes.her ?? "-") + "분.",
    "최근 기록:",
    ...items.slice(-60).map(line),
  ];
  if (decisions.length) parts.push("지난 추천과 내 반응:", ...decisions.map((d) => d.at + " " + d.verdict + "/" + d.action + " 보낼 말: " + (d.message ?? "없음") + " 반응: " + (d.feedback ?? "없음")));
  const chat = readChat(id).filter((t) => t.role === "user" && t.text).slice(-4);
  if (chat.length) parts.push("내가 앞서 openflirt에 한 말:", ...chat.map((t) => t.at + " " + t.text.replace(/\s+/g, " ").slice(0, 300)));
  parts.push(ask.trim() || "마지막 메시지 뒤에 내가 할 다음 행동 하나와, 보낼 말이 있으면 내 말투로 담백, 장난, 티징 세 결을 줘.");
  return parts.join("\n");
}

// Runs the openflirt headless runner on that question and returns its checked JSON answer.
export async function askNext(id, { runtime = "codex", model, ask = "", timeoutSeconds = 600 } = {}) {
  const question = nextQuestion(id, { ask });
  const result = await runAgent({ command: process.execPath, args: [join(REPO_ROOT, "bin", "openflirt.mjs"), "--json", "--runtime", runtime, ...(model ? ["--model", model] : [])], cwd: REPO_ROOT, input: question, timeoutMs: timeoutSeconds * 1000 + 30000 });
  if (result.kind !== "exit" || result.code !== 0) throw new CrushError("openflirt 실행 실패: " + (result.stderr ?? result.kind).slice(-600));
  return { question, answer: JSON.parse(result.stdout) };
}
