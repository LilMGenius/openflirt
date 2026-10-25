// Pure pieces of the routing eval: each runtime's headless command line, deciding "loaded" from its
// event stream, spotting a usage limit, and tallying the confusion table. scripts/routing.mjs runs the processes.
const SKILL = "openflirt";
const SKILL_PATH = /openflirt[\\/]+SKILL\.md/i;
const LIMIT_TEXT = /usage limit|rate limit|rate_limit|quota|too many requests|hit your limit/i;

// The prompt travels on stdin (trailing "-"), the same way scripts/lib/cli.mjs launches codex.
export const codexRoutingArgs = ({ model }) => [
  "exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only",
  ...(model === undefined ? [] : ["-m", model]),
  "-",
];

// Skill lets a skill load headless and Read lets the model open SKILL.md or its references; claude -p reads stdin.
export const claudeRoutingArgs = ({ model }) => [
  "-p", "--output-format", "stream-json", "--verbose", "--no-session-persistence",
  "--allowed-tools", "Skill", "Read",
  ...(model === undefined ? [] : ["--model", model]),
];

function parseEvents(text) {
  return text.split(/\r?\n/).filter((line) => line.trim() !== "").flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch (error) {
      if (error instanceof SyntaxError) return [];
      throw error;
    }
  });
}

const codexLoaded = (event) =>
  event.item?.type === "command_execution" && typeof event.item.command === "string" && SKILL_PATH.test(event.item.command);

const claudeLoaded = (event) =>
  event.type === "assistant" &&
  (event.message?.content ?? []).some(
    (block) =>
      block.type === "tool_use" &&
      ((block.name === "Skill" && typeof block.input?.skill === "string" && block.input.skill.split(":").at(-1) === SKILL) ||
        (block.name === "Read" && typeof block.input?.file_path === "string" && SKILL_PATH.test(block.input.file_path))),
  );

// Only tool activity counts; a final answer that says the word openflirt never does.
export const loadedSkill = (runtime, text) => parseEvents(text).some(runtime === "codex" ? codexLoaded : claudeLoaded);

export function isRateLimited(runtime, text) {
  return parseEvents(text).some((event) => {
    if (runtime === "claude") {
      if (event.type === "rate_limit_event") return !["allowed", "allowed_warning"].includes(event.rate_limit_info?.status);
      return event.type === "result" && event.is_error === true && LIMIT_TEXT.test(String(event.result ?? ""));
    }
    if (event.type === "turn.failed") return LIMIT_TEXT.test(JSON.stringify(event));
    return (event.type === "error" || event.item?.type === "error") && LIMIT_TEXT.test(String(event.message ?? event.item?.message ?? ""));
  });
}

// loaded === null means the prompt never ran (a usage limit, a timeout or a failed launch).
export function tally(results) {
  const table = { tp: 0, fn: 0, fp: 0, tn: 0, notRun: 0 };
  for (const { expect, loaded } of results) {
    if (loaded === null) table.notRun += 1;
    else if (expect === "load") table[loaded ? "tp" : "fn"] += 1;
    else table[loaded ? "fp" : "tn"] += 1;
  }
  const ran = table.tp + table.fn + table.fp + table.tn;
  return { ...table, accuracy: ran === 0 ? null : (table.tp + table.tn) / ran };
}
