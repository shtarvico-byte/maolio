#!/usr/bin/env node
// Pre-tool guard: denies edits to guardrail files and dangerous shell commands.
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const PROTECTED_PATHS = [
  ".vibe/hooks.toml",
  ".vibe/check.mjs", 
  ".vibe/protect-paths.mjs",
  ".vibe/",
  ".github/workflows/check.yml",
  "AGENTS.md",
];

const BANNED_BASH = [
  "--no-verify",
  /git\s+push\s+.*--force/i,
  /rm\s+-rf?\s+[\/~]/i,
  /chmod\s+-R\s+777/i,
  /:(){ :|:& };:/,  // fork bomb pattern
];

const BLOCKED_TOOLS = ["bash", "file_system"];

try {
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const input = payload.tool_input ?? {};
  const toolName = payload.tool_name ?? "";
  
  // Block dangerous tools entirely
  if (BLOCKED_TOOLS.includes(toolName)) {
    process.stdout.write(JSON.stringify({
      decision: "deny",
      reason: `Tool '${toolName}' is blocked by guardrails.`
    }));
    process.exit(0);
  }

  let deny = null;
  
  // Check protected file paths
  const target = input.path ?? input.file_path ?? input.file ?? null;
  if (target) {
    const normalizedTarget = resolve(String(target));
    const isProtected = PROTECTED_PATHS.some((p) => 
      normalizedTarget.includes(resolve(p)) || 
      (p.endsWith("/") && normalizedTarget.startsWith(resolve(p)))
    );
    if (isProtected) {
      deny = `Protected file: ${target}. Guardrail files may only be changed by a human.`;
    }
  }

  // Check banned bash commands
  const cmd = String(input.command ?? "");
  if (!deny && cmd) {
    const hit = BANNED_BASH.find((b) => 
      typeof b === "string" ? cmd.includes(b) : b.test(cmd)
    );
    if (hit) {
      deny = `Banned command pattern in: ${cmd}`;
    }
  }

  process.stdout.write(JSON.stringify(deny ? { decision: "deny", reason: deny } : {}));
  process.exit(0);
} catch (e) {
  process.stdout.write(JSON.stringify({
    decision: "deny", 
    reason: `Guardrail error: ${e.message}`
  }));
  process.exit(0);
}