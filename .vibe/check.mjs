#!/usr/bin/env node
// Check script for Maolio. Modes: fast (after edit), full (before completion, CI).
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
const failures = [];
const run = (name, fn) => {
  try { fn(); console.log("ok   " + name); }
  catch (e) { failures.push(name + ": " + e.message); console.error("FAIL " + name + ": " + e.message); }
};
// 1. JS syntax check on every standalone .js file.
run("js-syntax", () => {
  for (const f of ["sw.js"]) { execFileSync("node", ["--check", f], { stdio: "pipe" }); }
});
// 2. Inline <script> blocks in index.html: syntax check.
run("html-script-syntax", () => {
  const html = readFileSync("index.html", "utf8");
  const blocks = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  blocks.forEach((code) => { new Function(code); });
});
// 3. Basic HTML structure checks.
run("html-structure", () => {
  const html = readFileSync("index.html", "utf8");
  if (!/^<!doctype html>/i.test(html.trim())) throw new Error("missing <!DOCTYPE html>");
  const open = (html.match(/<div/gi) || []).length;
  const close = (html.match(/<\/div>/gi) || []).length;
  if (open !== close) throw new Error("<div> mismatch: " + open + " open vs " + close + " close");
});
// 4. Manifest sanity.
run("manifest", () => {
  const m = JSON.parse(readFileSync("manifest.json", "utf8"));
  for (const key of ["name", "start_url", "display", "icons"])
    if (!(key in m)) throw new Error('manifest.json missing "' + key + '"');
});
// 5. Secret scan.
run("secret-scan", () => {
  const patterns = [
    /AIza[0-9A-Za-z_-]{35}/,
    /sk-[A-Za-z0-9]{20,}/,
    /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
    /(api[_-]?key|secret|token)\s*[:=]\s*["'][A-Za-z0-9]{16,}["']/i,
  ];
  const files = ["index.html", "sw.js", "test-maolio.html", "manifest.json"];
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const p of patterns) if (p.test(text)) throw new Error("possible secret in " + f);
  }
});
// 6. Test suite present.
run("test-page", () => { statSync("test-maolio.html"); });
process.exit(failures.length ? 1 : 0);