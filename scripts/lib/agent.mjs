// Child process for an agent CLI. cross-spawn (MIT, moxystudio/node-cross-spawn) resolves the
// binary through PATH and PATHEXT and runs a Windows .cmd shim through cmd.exe with its arguments
// escaped, so codex.cmd and claude.exe both start; the prompt only ever travels over stdin.
import { spawnSync } from "node:child_process";
import spawn from "cross-spawn";

const IS_WINDOWS = process.platform === "win32";
const CLOSED_PIPE = ["EPIPE", "ECONNRESET", "EOF"];
const errorCode = (error) => (error instanceof Error && "code" in error ? error.code : undefined);

// The agent spawns its own tools, so a timeout ends the whole tree: taskkill /T on Windows, and on
// POSIX the process group the child leads because it was started detached.
export function killTree(child) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (IS_WINDOWS) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (errorCode(error) !== "ESRCH") throw error;
  }
}

export function runAgent({ command, args, cwd, input, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], detached: !IS_WINDOWS, windowsHide: true });
    const stdout = [];
    const stderr = [];
    let stopped;
    let settled = false;
    const stop = (reason) => {
      stopped = reason;
      killTree(child);
    };
    const onSignal = () => stop("interrupted");
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve(result);
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.stdin.on("error", (error) => {
      if (!CLOSED_PIPE.includes(errorCode(error))) throw error;
    });
    child.on("error", (error) => finish(errorCode(error) === "ENOENT" ? { kind: "missing" } : { kind: "failed", reason: error.message }));
    child.on("close", (code) => {
      if (stopped !== undefined) return finish({ kind: stopped });
      return finish({ kind: "exit", code: code ?? 1, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
    child.stdin.end(input);
  });
}
