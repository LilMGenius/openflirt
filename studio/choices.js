// The send-ready lines an answer offers, read by fixed rules so the page and its tests agree.
// An answer gives the three tones as "담백: 말" lines or as a 담백 line followed by the lines to send, up to a
// blank line. A line may wrap its message in quotes and add a remark after it ("..." (지난번 그 줄)); only the
// quoted part is sent. A message sent as several bubbles is split on " / " or a line break, one bubble each.
const HEAD = /^(담백|장난|티징)\s*(?:[:：]\s*(.*))?$/;
const QUOTED = /^["“'‘](.+?)["”'’](?=\s*(?:[(（].*)?$)/;

export function cleanMessage(raw) {
  const t = String(raw).trim();
  const q = QUOTED.exec(t);
  if (q) return q[1].trim();
  return t.replace(/\s*[(（][^()（）]*[)）]\s*$/, "").replace(/^["“]|["”]$/g, "").trim();
}

export const bubblesOf = (message) => cleanMessage(message).split(/\s*\n\s*|\s+\/\s+/).map((b) => cleanMessage(b)).filter(Boolean);

export function choicesOf(decision) {
  const found = [];
  let open = null;
  for (const raw of (decision.answer ?? "").split("\n")) {
    const line = raw.replace(/^[-*>\s]+/, "").replace(/\*\*/g, "").trim();
    const head = line.match(HEAD);
    if (head) {
      open = { tone: head[1], lines: head[2] ? [head[2]] : [] };
      found.push(open);
      if (head[2]) open = null;
      continue;
    }
    if (!open) continue;
    if (line === "") { if (open.lines.length) open = null; continue; }
    open.lines.push(line);
  }
  const real = found.map((c) => ({ tone: c.tone, bubbles: c.lines.flatMap(bubblesOf) })).filter((c) => c.bubbles.length);
  if (real.length) return real;
  return decision.message ? [{ tone: "보낼 말", bubbles: bubblesOf(decision.message) }] : [];
}
