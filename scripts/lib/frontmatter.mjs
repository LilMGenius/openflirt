// Strict YAML for host-read metadata (hostParser in the global AGENTS.md): eemeli/yaml parses every document twice,
// as YAML 1.1 (what PyYAML in Codex's quick_validate.py reads) and 1.2 (what js-yaml in Claude
// Code reads), with duplicate keys rejected, and every problem keeps the file's line and column.
import { LineCounter, parseDocument } from "yaml";

const VERSIONS = ["1.1", "1.2"];

export function splitFrontmatter(text, file) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "---") return { findings: [{ file, line: 1, reason: "frontmatter must open with a --- line on line 1" }] };
  const end = lines.indexOf("---", 1);
  if (end === -1) return { findings: [{ file, line: 1, reason: "frontmatter has no closing --- line" }] };
  return { yaml: lines.slice(1, end).join("\n"), firstLine: 2, body: lines.slice(end + 1), bodyLine: end + 2, findings: [] };
}

const shortMessage = (message) => message.split("\n")[0].replace(/\s+at line \d+, column \d+:?$/, "");

function parseOnce(src, version, file, firstLine, validate) {
  const lineCounter = new LineCounter();
  const doc = parseDocument(src, { version, strict: true, uniqueKeys: true, lineCounter });
  const problems = [...doc.errors, ...doc.warnings];
  if (problems.length > 0) {
    return problems.map((problem) => {
      const pos = problem.linePos?.[0];
      return pos === undefined
        ? { file, line: firstLine, reason: problem.code + ": " + shortMessage(problem.message) }
        : { file, line: pos.line + firstLine - 1, col: pos.col, reason: problem.code + ": " + shortMessage(problem.message) };
    });
  }
  const lineOf = (path) => {
    for (let depth = path.length; depth >= 0; depth -= 1) {
      const node = depth === 0 ? doc.contents : doc.getIn(path.slice(0, depth), true);
      const start = node?.range?.[0];
      if (typeof start === "number") return lineCounter.linePos(start).line + firstLine - 1;
    }
    return firstLine;
  };
  return validate(doc.toJS(), lineOf).map((finding) => ({ file, ...finding }));
}

// One finding per defect: a problem both versions report is printed once, tagged with both.
export function parseYaml(src, file, firstLine, validate) {
  const merged = new Map();
  for (const version of VERSIONS) {
    for (const finding of parseOnce(src, version, file, firstLine, validate)) {
      const key = finding.line + ":" + (finding.col ?? "") + ":" + finding.reason;
      const seen = merged.get(key);
      if (seen === undefined) merged.set(key, { finding, versions: [version] });
      else seen.versions.push(version);
    }
  }
  return [...merged.values()].map(({ finding, versions }) => ({ ...finding, reason: finding.reason + " (YAML " + versions.join(", ") + ")" }));
}
