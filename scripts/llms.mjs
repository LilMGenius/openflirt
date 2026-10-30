#!/usr/bin/env node
// Writes llms.txt and llms-full.txt at the repository root from the files they index and carry, and
// leaves a file alone when it already holds that text. --check writes nothing and exits 1 naming each
// stale file; --root builds another checkout, such as the test fixture.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildLlms } from "./lib/llms.mjs";

const USAGE = "usage: node scripts/llms.mjs [--check] [--root <dir>]";

function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { check: { type: "boolean", default: false }, root: { type: "string" } }, strict: true, allowPositionals: false }));
  } catch (error) {
    if (error instanceof TypeError) {
      process.stderr.write(error.message + "\n" + USAGE + "\n");
      return 2;
    }
    throw error;
  }
  const root = values.root === undefined ? dirname(dirname(fileURLToPath(import.meta.url))) : resolve(values.root);
  const stale = Object.entries(buildLlms(root)).filter(([file, text]) => !existsSync(join(root, file)) || readFileSync(join(root, file), "utf8") !== text);
  if (values.check) {
    for (const [file] of stale) process.stderr.write(file + " is stale; run node scripts/llms.mjs\n");
    return stale.length === 0 ? 0 : 1;
  }
  for (const [file, text] of stale) {
    writeFileSync(join(root, file), text);
    process.stdout.write("wrote " + file + "\n");
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
