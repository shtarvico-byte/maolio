# Maolio - agent instructions

Chinese learning app. Static PWA: one \`index.html\` (all markup, styles, and
inline scripts), \`sw.js\` (service worker), \`manifest.json\`, \`test-maolio.html\`
(test page). No build step, no framework, no npm dependencies.

## Working rules

1. Before implementing a ticket, list any ambiguous points in the request and
   ask for a decision. Do not silently choose an interpretation.
2. Keep the single-file structure: new features go into \`index.html\` or a new
   section, unless the change exceeds roughly 200 lines - then propose a split
   into a separate module first and wait for approval.
3. Changes to \`sw.js\` must bump the cache version constant at the top of the
   file, otherwise users keep the stale cached app.
4. New user-visible behavior needs a case in \`test-maolio.html\`.
5. Declare scope: if you find a pre-existing bug outside the ticket, report it
   in your summary. Do not fix it without being asked.
6. "Done" means \`node .vibe/check.mjs full\` passes - not that you believe it
   is done. Never edit files under \`.vibe/\`; they are maintained by a human.
7. Never disable a check, silence a warning, or commit secrets. If a check
   finding looks wrong, say so and stop.
