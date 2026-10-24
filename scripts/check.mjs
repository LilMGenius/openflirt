#!/usr/bin/env node
// Runs every repository check against the checkout this file lives in.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { report, runChecks } from "./lib/checks.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const results = runChecks(root);
process.stdout.write(report(results).join("\n") + "\n");
process.exitCode = results.some((result) => result.findings.length > 0) ? 1 : 0;
