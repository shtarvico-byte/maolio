# Maolio 🐯 — Chinese Vocabulary App

A personal vocabulary trainer for a learner of Mandarin Chinese, built for an Android tablet. Self-contained PWA: no backend, no build step, no login. All data lives in the browser's `localStorage`. Tiger-themed UI.

## Run

- **Locally**: open `index.html` directly in a browser, or serve the folder over HTTP (required for the service worker / install prompt):

  ```bash
  cd chinese-vocab-app
  python3 -m http.server 8080
  # then visit http://localhost:8080
  ```

- **Offline**: after the first load the service worker caches the app shell (`index.html`, `manifest.json`, icons), so the app works fully offline. Only the auto-translate feature requires internet.
- **Updates**: when a new version is deployed, the app shows a "A new version is available — Reload" banner. Clicking Reload activates the new version immediately. When releasing an update yourself, bump the cache version in `sw.js` (`CACHE_NAME`, e.g. `zht-vocab-v1` → `zht-vocab-v2`) so clients drop the old cache.

## Install (Android tablet)

1. Open the served URL in Chrome.
2. Menu → **"Add to Home screen"** (Chrome usually offers an install banner automatically).
3. The app launches standalone via `manifest.json` (`display: "standalone"`).
4. If Chrome doesn't offer install, the manifest already includes 192px + 512px PNG icons — check that the app is served over HTTPS (or localhost).

## Features

- **Table tab** — Excel-like editable vocabulary table (English | Pinyin | 汉字 | Memory help). Every edit is saved immediately to `localStorage` (key `zht-vocab-table-v1`); no save button. "+ Add row" appends an empty row; ✕ deletes a row.
- **Learn tab** — hide-and-reveal flashcards: English on the front, "Show answer" reveals hanzi (large), pinyin, and the mnemonic in a highlighted box. Prev/Next navigation, "Card X of Y" counter, only rows with non-empty English participate.
- **Auto-translate (译)** — triggered by Enter in the English cell or the 译 button. Google translate gtx endpoint first (hanzi + romanized pinyin), MyMemory API as fallback (hanzi only). Fills only empty cells — never overwrites manual input. Shows "…" while loading and a clear error message on failure.
- **Pronunciation (▶)** — per row and on the revealed learn card. Web Speech API, `zh-CN` voice, rate 0.85. Disabled when hanzi is empty; failures are silently ignored.
- **Data safety** — storage reads/writes wrapped in try/catch; corrupted storage re-seeds the 3 starter rows (你好 / hello, 谢谢 / thank you, 水 / water) instead of crashing.

## Deploy

Any static host works: GitHub Pages, Netlify Drop, Cloudflare Pages. Just upload the folder — no build step.

## Storage

Data model (JSON array in `localStorage["zht-vocab-table-v1"]`):

```json
{
  "id": "r-1696320000000",
  "en": "hello",
  "pinyin": "nǐ hǎo",
  "hanzi": "你好",
  "note": "你 = 'you' (person walking) + 好 = 'good' (woman + child)"
}
```

## Known limitations / roadmap

- Data is per-browser/per-device (no sync). Export/import needed to move decks.
- Roadmap: CSV import/export · spaced repetition (SRS scheduling per word) · HSK level tags + filtering · shuffle in learn mode · sentence examples · Capacitor wrap for a sideloadable APK.
