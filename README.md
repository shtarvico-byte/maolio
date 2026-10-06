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

- **Table tab** — Excel-like editable vocabulary table (English | Pinyin | 汉字 | Memory help). Every edit is saved immediately to `localStorage`; no save button. "+ Add row" appends an empty row; ✕ deletes a row. A "+ Row" button in the top bar is always visible, even in Learn mode.
- **Multiple sheets** — keep separate vocabulary decks (e.g. per HSK level). Use the dropdown to switch. Sheet actions live in the **☰ Menu** button: "+ New sheet" creates one (asks for a name), "✎ Rename sheet" renames it, "↺ Restore backup" recovers data (see Backups & recovery), and "⤓ Update app" checks for a new version and activates it (shows "ready!" when one is already waiting). All sheets live in `localStorage` key `zht-vocab-sheets-v1`; data from the old single-list format is migrated automatically.
- **Learn tab** — hide-and-reveal flashcards: English on the front, a 🔊 button to hear the Chinese word, "Show answer" reveals hanzi (large), pinyin, and the mnemonic in a highlighted box. Prev/Next navigation, "Card X of Y" counter, only rows with non-empty English participate.
- **Auto-translate (译)** — triggered by Enter in the English cell or the 译 button. Google translate gtx endpoint first (hanzi + romanized pinyin), MyMemory API as fallback (hanzi only). Fills only empty cells — never overwrites manual input. Shows "…" while loading and a clear error message on failure.
- **Pronunciation (▶)** — per row and on the revealed learn card. Web Speech API, `zh-CN` voice, rate 0.85. Disabled when hanzi is empty; failures are silently ignored.
- **Data safety** — storage reads/writes wrapped in try/catch; corrupted storage re-seeds the 3 starter rows (你好 / hello, 谢谢 / thank you, 水 / water) instead of crashing.
- **Backups & recovery** — every time your data changes, a safety copy is written to `localStorage["zht-vocab-sheets-backup-v1"]` (up to 10 copies). If the sheets store is ever lost or wiped, the app automatically restores the newest backup. The **↺ Restore backup** item in the ☰ Menu lists backups (timestamped, with word counts per sheet) and lets you restore any of them; the sheets you had before restoring are themselves kept as a backup, so nothing is lost.
- **Legacy rows recovered** — if your old single-list data (`zht-vocab-table-v1`) still exists but was left behind by the multi-sheet migration, the app re-imports it into a separate "Recovered legacy" sheet on startup, instead of ignoring it.

- **Local file backup (permanent)** — via ☰ Menu: **💾 Save backup to file** keeps `maolio-backup.json` in the phone's **Downloads** folder (one-time permission prompt on Android Chrome; browsers without folder access just download the file). After the first save the file is rewritten **automatically every time your words change** — it survives app reinstalls and browser-data clearing. **📂 Restore backup from file** brings it back on any device (with a confirmation; current data is kept as an in-app backup first).

- **Themes** — via ☰ Menu → **🐱 Theme**: switch between **Tiger** (orange) and **Calico cat** (ginger-rose on cream). The choice is remembered per device.

## Restore data from a backup file

If the app ever loses your vocabulary (or you're moving to a new device): open **☰ Menu → 📂 Restore backup from file** and pick `maolio-backup.json` from Downloads (or anywhere you saved it). The app shows what's in the file and asks for confirmation; your current sheets are first kept as an in-app backup, so the restore is reversible.

Notes on automatic file backups (Android Chrome):

- The first **💾 Save backup to file** asks once for file permission — this "connects" the app to that file. From then on every change rewrites it silently.
- The connection lasts while the site has storage permission (Chrome keeps it per site). If automatic saves stop (e.g. after clearing site data), tap **💾 Save backup to file** again to reconnect.
- If you restore the same file from the picker, the app also adopts it for automatic backups.

## Deploy

Any static host works: GitHub Pages, Netlify Drop, Cloudflare Pages. Just upload the folder — no build step.

## Storage

Data model (sheets in `localStorage["zht-vocab-sheets-v1"]`, migrated from the legacy `zht-vocab-table-v1` single list):

```json
{
  "sheets": [
    {
      "id": "s-main",
      "name": "Sheet 1",
      "rows": [
        {
          "id": "r-1696320000000",
          "en": "hello",
          "pinyin": "nǐ hǎo",
          "hanzi": "你好",
          "note": "你 = 'you' (person walking) + 好 = 'good' (woman + child)"
        }
      ]
    }
  ],
  "currentSheetId": "s-main"
}
```

## Known limitations / roadmap

- Data is per-browser/per-device (no sync). Export/import needed to move decks.
- Roadmap: CSV import/export · spaced repetition (SRS scheduling per word) · HSK level tags + filtering · shuffle in learn mode · sentence examples · Capacitor wrap for a sideloadable APK.
