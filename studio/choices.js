// The answer carries the three tones either as "담백: 말" lines or as a 담백 line followed by the lines to send,
// up to a blank line. Without either, the one message the schema holds is the only choice.
export function choicesOf(decision) {
  const found = [];
  let open = null;
  for (const raw of (decision.answer ?? "").split("\n")) {
    const line = raw.replace(/^[-*>\s]+/, "").replace(/\*\*/g, "").trim();
    const head = line.match(/^(담백|장난|티징)\s*(?:[:：]\s*(.*))?$/);
    if (head) { open = { tone: head[1], text: (head[2] ?? "").replace(/^["“]|["”]$/g, "") }; found.push(open); if (head[2]) open = null; continue; }
    if (open && line === "") { if (open.text) open = null; continue; }
    if (open) open.text += (open.text ? "\n" : "") + line.replace(/^["“]|["”]$/g, "");
  }
  const real = found.filter((c) => c.text);
  return real.length ? real : decision.message ? [{ tone: "보낼 말", text: decision.message }] : [];
}
