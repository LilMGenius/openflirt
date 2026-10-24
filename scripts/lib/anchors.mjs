// Reference link check: every markdown link into skills/<skill>/references/<file>.md must name an
// existing file, and its #fragment an <a id> anchor in that file; anchor ids are unique per skill.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, posix, sep } from "node:path";
import { markdownLines } from "./markdown.mjs";
import { listSkills } from "./skills.mjs";

const ANCHOR = /<a id="([^"]+)"><\/a>/g;
const LINK = /\]\(([^)\s]+)\)/g;
const REFERENCE = /^skills\/[^/]+\/references\/[^/]+\.md$/;
const LINK_SOURCES = ["AGENTS.md", "README.md"];

export function anchorsIn(text) {
  return markdownLines(text)
    .filter((entry) => !entry.inFence)
    .flatMap(({ raw, line }) => [...raw.matchAll(ANCHOR)].map((match) => ({ id: match[1], line })));
}

export function collectAnchors(root) {
  const byFile = new Map();
  const findings = [];
  for (const skill of listSkills(root)) {
    const dir = join(root, "skills", skill, "references");
    if (!existsSync(dir)) continue;
    const seen = new Map();
    for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".md")).sort()) {
      const file = "skills/" + skill + "/references/" + name;
      const anchors = anchorsIn(readFileSync(join(dir, name), "utf8"));
      byFile.set(file, new Set(anchors.map((anchor) => anchor.id)));
      for (const { id, line } of anchors) {
        const first = seen.get(id);
        if (first === undefined) seen.set(id, file + ":" + line);
        else findings.push({ file, line, reason: 'anchor id "' + id + '" is already defined at ' + first });
      }
    }
  }
  return { byFile, findings };
}

export function checkReferenceLinks(text, file, anchorsByFile) {
  const findings = [];
  for (const { raw, line, inFence } of markdownLines(text)) {
    if (inFence) continue;
    const visible = raw.replace(/\x60[^\x60]*\x60/g, (span) => " ".repeat(span.length));
    for (const match of visible.matchAll(LINK)) {
      const target = match[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
      const hash = target.indexOf("#");
      const path = hash === -1 ? target : target.slice(0, hash);
      const resolved = posix.normalize(posix.join(posix.dirname(file), path));
      if (!REFERENCE.test(resolved)) continue;
      const anchors = anchorsByFile.get(resolved);
      const col = match.index + 3;
      if (anchors === undefined) findings.push({ file, line, col, reason: "link target " + resolved + " does not exist" });
      else if (hash !== -1 && !anchors.has(target.slice(hash + 1))) findings.push({ file, line, col, reason: "anchor #" + target.slice(hash + 1) + " does not exist in " + resolved });
    }
  }
  return findings;
}

export function linkSources(root) {
  const skillFiles = existsSync(join(root, "skills"))
    ? readdirSync(join(root, "skills"), { recursive: true }).map((entry) => "skills/" + String(entry).split(sep).join("/"))
    : [];
  return [...LINK_SOURCES, ...skillFiles.filter((file) => file.endsWith(".md")).sort()].filter((file) => existsSync(join(root, file)));
}

export function checkAnchors(root) {
  const { byFile, findings } = collectAnchors(root);
  for (const file of linkSources(root)) findings.push(...checkReferenceLinks(readFileSync(join(root, file), "utf8"), file, byFile));
  return findings;
}
