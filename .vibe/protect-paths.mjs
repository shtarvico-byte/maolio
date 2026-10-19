#!/usr/bin/env node
// Pre-tool guard: denies edits to guardrail files and dangerous shell commands.
import { readFileSync } from "node:fs";
const PROTECTED = [".vibe/hooks.toml", ".vibe/check.mjs", ".vibe/protect-paths.mjs"];
const BANNED_BASH = ["--no-verify", /git\s+push\s+.*--force/, /rm\s+-rf?\s+[\/~]/];
const payload = JSON.parse(readFileSync(0, "utf8"));
const input = payload.tool_input ?? {};
let deny = null;
const target = input.path ?? input.file_path ?? input.file ?? null;
if (target && PROTECTED.some((p) => String(target).includes(p))) {
  deny = "Protected file: " + target + ". Guardrail files may only be changed by a human.";
}
const cmd = String(input.command ?? "");
if (!deny && cmd) {
  const hit = BANNED_BASH.find((b) => typeof b === "string" ? cmd.includes(b) : b.test(cmd));
  if (hit) deny = "Banned command pattern in: " + cmd;
}
process.stdout.write(JSON.stringify(deny ? { decision: "deny", reason: deny } : {}));
process.exit(0);