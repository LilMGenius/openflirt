// Coverage map check: corpus/<video>/coverage.md lists every transcript section once, in order,
// with the principles that cover it or an explicit 제외: reason, and every principle covers a row.
import { markdownLines } from "./markdown.mjs";

const HEADER = ["시각", "소제목", "원칙"];
const SEPARATOR = /^\|(\s*:?-+:?\s*\|)+$/;
const EXCLUDED = "제외:";
const cellsOf = (row) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());

export function parseCoverage(text, file) {
  const lines = markdownLines(text).filter((entry) => !entry.inFence);
  const header = lines.findIndex(({ raw }) => raw.trim().startsWith("|") && cellsOf(raw).join("|") === HEADER.join("|"));
  if (header === -1) return { rows: [], findings: [{ file, line: 1, reason: "no table with the header | 시각 | 소제목 | 원칙 |" }] };
  const findings = [];
  const separator = lines[header + 1];
  if (separator === undefined || !SEPARATOR.test(separator.raw.trim())) findings.push({ file, line: lines[header].line + 1, reason: "header must be followed by a | --- | --- | --- | line" });
  const rows = [];
  for (const { raw, line } of lines.slice(header + 2)) {
    if (!raw.trim().startsWith("|")) break;
    const cells = cellsOf(raw);
    if (cells.length !== 3) findings.push({ file, line, reason: "row must have 3 cells, has " + cells.length });
    else rows.push({ line, t: cells[0], title: cells[1], principles: cells[2] });
  }
  return { rows, endLine: rows.at(-1)?.line ?? lines[header].line, findings };
}

// Two-pointer walk so one missing or extra row is reported once instead of shifting every row after it.
function sectionFindings(rows, sections, file, endLine) {
  const findings = [];
  const missing = (section, line) => ({ file, line, reason: 'no row for section "' + section.title + '" (' + section.paragraphs[0].t + ", transcript line " + section.line + ")" });
  let r = 0;
  let s = 0;
  while (r < rows.length || s < sections.length) {
    const row = rows[r];
    const section = sections[s];
    if (row === undefined) { findings.push(missing(section, endLine)); s += 1; continue; }
    if (section === undefined) { findings.push({ file, line: row.line, reason: 'row "' + row.title + '" matches no transcript section' }); r += 1; continue; }
    if (row.title === section.title) {
      if (row.t !== section.paragraphs[0].t) findings.push({ file, line: row.line, reason: "시각 " + row.t + ' must be the first paragraph time of "' + section.title + '", ' + section.paragraphs[0].t });
      r += 1;
      s += 1;
      continue;
    }
    const sectionAhead = sections.findIndex((entry, index) => index > s && entry.title === row.title);
    const rowAhead = rows.findIndex((entry, index) => index > r && entry.title === section.title);
    if (sectionAhead !== -1 && (rowAhead === -1 || sectionAhead - s <= rowAhead - r)) {
      for (; s < sectionAhead; s += 1) findings.push(missing(sections[s], row.line));
    } else if (rowAhead !== -1) {
      for (; r < rowAhead; r += 1) findings.push({ file, line: rows[r].line, reason: 'row "' + rows[r].title + '" is out of transcript order or matches no section' });
    } else {
      findings.push({ file, line: row.line, reason: '소제목 "' + row.title + '" must be "' + section.title + '" (transcript line ' + section.line + ")" });
      r += 1;
      s += 1;
    }
  }
  return findings;
}

function principleFindings(rows, principles, file) {
  const known = new Set(principles.map((principle) => principle.id));
  const used = new Set();
  const findings = [];
  for (const row of rows) {
    if (row.principles.startsWith(EXCLUDED)) {
      if (row.principles.slice(EXCLUDED.length).trim() === "") findings.push({ file, line: row.line, reason: "제외: must be followed by a reason" });
      continue;
    }
    for (const id of row.principles.split(",").map((part) => part.trim())) {
      if (id === "") findings.push({ file, line: row.line, reason: "원칙 cell has an empty id; list ids or write 제외: <reason>" });
      else if (!known.has(id)) findings.push({ file, line: row.line, reason: 'principle id "' + id + '" does not exist' });
      else used.add(id);
    }
  }
  for (const principle of principles) {
    if (!used.has(principle.id)) findings.push({ file: principle.file, line: principle.line, reason: "principle " + principle.id + " appears in no row of " + file });
  }
  return findings;
}

export function checkCoverage(text, file, sections, principles) {
  const parsed = parseCoverage(text, file);
  if (parsed.rows.length === 0 && parsed.findings.length > 0) return parsed.findings;
  return [...parsed.findings, ...sectionFindings(parsed.rows, sections, file, parsed.endLine), ...principleFindings(parsed.rows, principles, file)];
}
