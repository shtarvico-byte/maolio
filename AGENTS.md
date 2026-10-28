# Maolio - Agent Instructions

Chinese learning app. Static PWA with no build step, no framework, no npm dependencies.

## Project Structure
- `index.html` - Main app file (all markup, styles, and inline scripts)
- `sw.js` - Service worker for PWA functionality
- `manifest.json` - PWA manifest
- `test-maolio.html` - Test page for manual and automated testing
- `.vibe/` - Guardrails and hooks (HUMAN MAINTAINED - DO NOT EDIT)

## Working Rules

### Before Starting
1. **Clarify ambiguities first**: List any unclear points in the request and ask for a decision. Never silently assume an interpretation.

### Code Structure
2. **Single-file principle**: New features go into `index.html` unless the change exceeds ~200 lines. Then propose splitting into a separate module and wait for approval.

3. **Service worker changes**: Any edit to `sw.js` MUST bump the cache version constant at the top of the file, otherwise users will keep the stale cached app.

### Testing & Quality
4. **Test coverage**: New user-visible behavior requires a test case in `test-maolio.html`.

5. **Scope discipline**: If you find a pre-existing bug outside the current ticket, report it in your summary. Do NOT fix it without explicit permission.

### Guardrails & Completion
6. **Done criteria**: Work is only complete when `node .vibe/check.mjs full` passes. Your belief that work is done is not sufficient.

7. **Guardrail files**: NEVER edit files under `.vibe/`, `.github/workflows/check.yml`, or `AGENTS.md`. These are maintained exclusively by humans.

8. **Check integrity**: Never disable a check, silence a warning, or commit secrets. If a check finding appears incorrect, report it and stop work immediately.