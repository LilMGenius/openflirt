// Markdown line walk shared by the checks: CRLF tolerant, fenced code blocks flagged so that
// anchors, quotes and links written inside a fence are never read as live content.
const FENCE = /^\s{0,3}(\x60{3,}|~{3,})/;

export function markdownLines(text) {
  const lines = [];
  let fence;
  text.replace(/\r\n/g, "\n").split("\n").forEach((raw, index) => {
    const line = index + 1;
    const marker = FENCE.exec(raw)?.[1];
    if (fence === undefined) {
      if (marker !== undefined) fence = marker;
      lines.push({ raw, line, inFence: marker !== undefined });
      return;
    }
    const closes = marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length && raw.trim() === marker;
    if (closes) fence = undefined;
    lines.push({ raw, line, inFence: true });
  });
  return lines;
}
