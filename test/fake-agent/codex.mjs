// Stand-in for "codex exec": records its argv and stdin, then writes FAKE_CODEX_ANSWER to the -o file.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const prompt = readFileSync(0, "utf8");
writeFileSync(process.env.FAKE_CODEX_LOG, JSON.stringify({ args, prompt }));
if (process.env.FAKE_CODEX_EXIT !== undefined) {
  process.stderr.write("fake codex failed\n");
  process.exit(Number(process.env.FAKE_CODEX_EXIT));
}
writeFileSync(args[args.indexOf("-o") + 1], process.env.FAKE_CODEX_ANSWER);
