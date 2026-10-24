// Transcript parse and the quote check: a principle's quote must be the lecture's own words,
// found in order inside the paragraphs that start between 75 s before and 15 s after its time.
import { markdownLines } from "./markdown.mjs";

const HEADING = /^#{2,3} (\S.*)$/;
const WINDOW_BEFORE = 75;
const WINDOW_AFTER = 15;
const IGNORED = /[\s.,?!~\u2026\u00b7"'\u201c\u201d\u2018\u2019()[\]:;-]/gu;

export const normalize = (text) => text.replace(IGNORED, "").replace(/[A-Z]/g, (letter) => letter.toLowerCase());

// A paragraph belongs to the nearest ## or ### heading above it; a heading holding paragraphs is a section.
export function parseTranscript(text, file, videoId) {
  const paragraphLine = new RegExp("^\\[(\\d{2}):([0-5]\\d)\\]\\(https://youtu\\.be/" + videoId + "\\?t=(\\d+)\\) (\\S.*)$");
  const sections = [];
  const paragraphs = [];
  const findings = [];
  let section;
  for (const { raw, line, inFence } of markdownLines(text)) {
    if (inFence) continue;
    const heading = HEADING.exec(raw);
    if (heading !== null) {
      section = { title: heading[1].trim(), line, paragraphs: [] };
      sections.push(section);
      continue;
    }
    if (!raw.startsWith("[")) continue;
    const match = paragraphLine.exec(raw);
    if (match === null) {
      findings.push({ file, line, reason: "paragraph must read [mm:ss](https://youtu.be/" + videoId + "?t=SEC) text" });
      continue;
    }
    const sec = Number(match[1]) * 60 + Number(match[2]);
    if (Number(match[3]) !== sec) findings.push({ file, line, reason: "t=" + match[3] + " does not equal " + match[1] + ":" + match[2] + " (" + sec + " s)" });
    const previous = paragraphs.at(-1);
    if (previous !== undefined && sec < previous.sec) findings.push({ file, line, reason: "paragraph time goes back from " + previous.t });
    const paragraph = { line, sec, t: match[1] + ":" + match[2], text: match[4] };
    paragraphs.push(paragraph);
    if (section === undefined) findings.push({ file, line, reason: "paragraph sits above every ## or ### heading" });
    else section.paragraphs.push(paragraph);
  }
  return { sections: sections.filter((entry) => entry.paragraphs.length > 0), paragraphs, findings };
}

// Longest prefix of the fragment present at or after "from": a hint at where the quote drifts.
function longestPrefix(fragment, haystack, from) {
  let low = 0;
  let high = fragment.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (haystack.indexOf(fragment.slice(0, mid), from) === -1) high = mid - 1;
    else low = mid;
  }
  return fragment.slice(0, low);
}

export function quoteFinding(quote, paragraphs) {
  const fragments = quote.text.split("\u2026").map(normalize).filter((fragment) => fragment.length > 0);
  if (fragments.length === 0) return "quote is empty once whitespace and punctuation are removed";
  const window = paragraphs
    .filter((paragraph) => paragraph.sec >= quote.sec - WINDOW_BEFORE && paragraph.sec <= quote.sec + WINDOW_AFTER)
    .map((paragraph) => normalize(paragraph.text))
    .join("");
  let from = 0;
  for (const [index, fragment] of fragments.entries()) {
    const at = window.indexOf(fragment, from);
    if (at === -1) {
      const prefix = longestPrefix(fragment, window, from);
      const hint = prefix.length === 0 ? "no character of it matches" : "matches up to " + JSON.stringify(prefix.slice(-20)) + " (" + prefix.length + "/" + fragment.length + ")";
      return "quote fragment " + (index + 1) + "/" + fragments.length + " is not in the transcript between " + WINDOW_BEFORE + " s before and " + WINDOW_AFTER + " s after " + quote.t + "; " + hint;
    }
    from = at + fragment.length;
  }
  return undefined;
}

export function checkQuotes(principles, paragraphs) {
  const findings = [];
  for (const principle of principles) {
    for (const quote of principle.quotes) {
      const reason = quoteFinding(quote, paragraphs);
      if (reason !== undefined) findings.push({ file: principle.file, line: quote.line, reason });
    }
  }
  return findings;
}
