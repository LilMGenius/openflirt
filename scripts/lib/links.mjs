// Git symlink check read from the index, never the working tree, because a Windows clone without
// core.symlinks checks a link out as a plain file holding its target path (repoFloor in the global AGENTS.md).
import { execFileSync } from "node:child_process";

const SYMLINK = "120000";
const LINK_ROOTS = [".agents/skills/", ".claude/skills/"];
const RECORD = /^(\d{6}) ([0-9a-f]+) \d\t(.+)$/s;

export function parseLsFiles(output) {
  return output
    .split("\0")
    .map((record) => RECORD.exec(record))
    .filter((match) => match !== null)
    .map(([, mode, sha, path]) => ({ mode, sha, path }));
}

export function readGitIndex(root) {
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { entries: parseLsFiles(git(["ls-files", "-s", "-z"])), readBlob: (sha) => git(["cat-file", "-p", sha]) };
}

export function expectedLinks(skillNames) {
  return [
    { path: "CLAUDE.md", target: "AGENTS.md" },
    ...skillNames.flatMap((name) => LINK_ROOTS.map((prefix) => ({ path: prefix + name, target: "../../skills/" + name }))),
  ];
}

export function checkSymlinks(entries, readBlob, skillNames) {
  const expected = expectedLinks(skillNames);
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const findings = [];
  for (const { path, target } of expected) {
    const entry = byPath.get(path);
    if (entry === undefined) {
      findings.push({ file: path, line: 1, reason: "is not in the git index; expected a symlink to " + target });
    } else if (entry.mode !== SYMLINK) {
      findings.push({ file: path, line: 1, reason: "has index mode " + entry.mode + "; expected a symlink (mode 120000) to " + target });
    } else {
      const actual = readBlob(entry.sha);
      if (actual !== target) findings.push({ file: path, line: 1, reason: "links to " + JSON.stringify(actual) + "; expected " + JSON.stringify(target) });
    }
  }
  const known = new Set(expected.map((link) => link.path));
  for (const entry of entries) {
    if (LINK_ROOTS.some((prefix) => entry.path.startsWith(prefix)) && !known.has(entry.path)) {
      findings.push({ file: entry.path, line: 1, reason: "is tracked under a skill link folder but is not the link of a skill in skills/" });
    }
  }
  return findings;
}
