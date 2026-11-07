/* sync-github.js — GitHub-based cloud sync backend for Maolio.
 *
 * Stores the vocabulary sheets as one JSON file per person in a private
 * GitHub repo: data/<storage>/sheets.json. Talks to api.github.com with a
 * fine-grained personal access token (Contents: read+write on that repo).
 *
 * The module is a plain classic script (no build step) and exposes one
 * global: GitHubSync. It reads/writes local data through window.sheets /
 * window.saveSheets when the app is present, and falls back to
 * localStorage directly, so it can also run standalone in test-maolio.html.
 *
 * Storage keys:
 *   zht-vocab-github-sync-v1      - sync settings incl. backend selector
 *   zht-vocab-sheets-lastsync-v1  - local snapshot from the last sync
 * The token is only kept in this key and in memory; it is never rendered
 * back into the UI and never logged.
 */
"use strict";

var GitHubSync = (function () {
  var CONFIG_KEY = "zht-vocab-github-sync-v1";
  var SNAPSHOT_KEY = "zht-vocab-sheets-lastsync-v1";
  var SHEETS_KEY = "zht-vocab-sheets-v1";
  var API_BASE = "https://api.github.com";
  var FETCH_TIMEOUT_MS = 30000;
  var DEBOUNCE_MS = 5000;      /* push debounce after local edits */
  var DELETE_GUARD_RATIO = 0.8; /* merges deleting >20% of rows need confirmation */

  var config = null; /* { backend, token, repo, branch, storage, connected, needsReconnect, lastSyncAt } */
  var inFlight = false;
  var applying = false; /* true while a remote merge is being applied locally */
  var dirtyAt = 0;
  var debounceTimer = null;

  /* ---------- test seams: storage / fetch / confirm can be overridden ---------- */
  function store() {
    if (typeof window !== "undefined" && window.GitHubSyncStorage) return window.GitHubSyncStorage;
    return localStorage;
  }
  function fetchImpl() {
    if (typeof window !== "undefined" && window.GitHubSyncFetch) return window.GitHubSyncFetch;
    return fetch;
  }
  function confirmImpl(msg) {
    if (typeof window !== "undefined" && window.GitHubSyncConfirm) return window.GitHubSyncConfirm(msg);
    return confirm(msg);
  }
  function emitMessage(msg, isError) {
    if (typeof window !== "undefined" && typeof window.GitHubSyncOnMessage === "function") {
      window.GitHubSyncOnMessage(msg, !!isError);
    } else if (isError && typeof alert !== "undefined") {
      alert(msg);
    }
  }
  function emitStateChange() {
    if (typeof window !== "undefined" && typeof window.GitHubSyncOnStateChange === "function") {
      window.GitHubSyncOnStateChange();
    }
  }

  /* ---------- local data adapter (app globals when present, else localStorage) ---------- */
  function getLocal() {
    if (typeof window !== "undefined" && Array.isArray(window.sheets)) {
      return { sheets: window.sheets, currentSheetId: window.currentSheetId };
    }
    try {
      var raw = store().getItem(SHEETS_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && Array.isArray(parsed.sheets)) return parsed;
    } catch (e) { /* fall through */ }
    return { sheets: [], currentSheetId: null };
  }
  function applyLocal(data) {
    applying = true;
    try {
      if (typeof window !== "undefined" && window.sheets !== undefined) {
        window.sheets = data.sheets;
        window.currentSheetId = data.currentSheetId;
        if (typeof window.saveSheets === "function") window.saveSheets();
        if (typeof window.renderSheetSelect === "function") window.renderSheetSelect();
        if (typeof window.renderTable === "function") window.renderTable();
        if (typeof window.renderLearn === "function") window.renderLearn();
        if (typeof window.updateConflictsTab === "function") window.updateConflictsTab();
      } else {
        store().setItem(SHEETS_KEY, JSON.stringify({ sheets: data.sheets, currentSheetId: data.currentSheetId }));
      }
    } finally {
      applying = false;
    }
  }
  /* Safety: write the existing in-app backup before a remote merge is applied. */
  function backupLocal() {
    if (typeof window !== "undefined" && typeof window.backupSheets === "function") window.backupSheets();
  }

  /* ---------- config ---------- */
  function load() {
    try {
      config = JSON.parse(store().getItem(CONFIG_KEY) || "null");
    } catch (e) { config = null; }
    if (!config || typeof config !== "object") config = {};
    if (!config.branch) config.branch = "main";
    if (!config.storage) config.storage = "default";
    if (typeof config.connected !== "boolean") config.connected = false;
    if (typeof config.needsReconnect !== "boolean") config.needsReconnect = false;
    if (!config.lastSyncAt) config.lastSyncAt = 0;
    if (!config.backend) {
      /* default: keep Google Drive as the active backend if it was configured */
      if (typeof window !== "undefined" && typeof window.driveIsConfigured === "function" && window.driveIsConfigured()) {
        config.backend = "drive";
      } else {
        config.backend = "off";
      }
    }
  }
  function save() { try { store().setItem(CONFIG_KEY, JSON.stringify(config)); } catch (e) {} }

  function activeBackend() { return config && config.backend ? config.backend : "off"; }
  function isConfigured() { return !!(config && config.token && config.repo); }
  function isActive() {
    return !!(config && config.backend === "github" && config.connected && isConfigured() && !config.needsReconnect);
  }
  /* Status for the UI — deliberately never includes the token. */
  function state() {
    return {
      backend: activeBackend(),
      connected: !!(config && config.connected),
      needsReconnect: !!(config && config.needsReconnect),
      storage: config ? config.storage : "default",
      repo: config ? config.repo : null,
      branch: config ? config.branch : "main",
      lastSyncAt: config ? config.lastSyncAt : 0,
      pending: dirtyAt > 0 && dirtyAt > (config ? config.lastSyncAt : 0)
    };
  }

  /* ---------- GitHub REST API ---------- */
  function GhError(status, message) {
    var e = new Error(message || ("GitHub HTTP " + status));
    e.status = status;
    return e;
  }
  function filePath() {
    return "/repos/" + config.repo + "/contents/data/" + encodeURIComponent(config.storage) +
      "/sheets.json?ref=" + encodeURIComponent(config.branch);
  }
  function ghFetch(path, options) {
    options = options || {};
    var headers = {
      "Authorization": "Bearer " + config.token,
      "Accept": options.accept || "application/vnd.github+json"
    };
    var init = { method: options.method || "GET", headers: headers };
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = options.body;
    }
    if (typeof AbortController !== "undefined") {
      var ctl = new AbortController();
      var timer = setTimeout(function () { ctl.abort(); }, FETCH_TIMEOUT_MS);
      init.signal = ctl.signal;
      return fetchImpl()(API_BASE + path, init).then(function (res) {
        clearTimeout(timer);
        return res;
      }, function (err) { clearTimeout(timer); throw err; });
    }
    return fetchImpl()(API_BASE + path, init);
  }
  /* Pull the raw file; 404 means "does not exist yet" and resolves to null. */
  function ghPull() {
    return ghFetch(filePath(), { accept: "application/vnd.github.raw+json" }).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw GhError(res.status);
      return res.text().then(function (text) {
        try { return JSON.parse(text); } catch (e) { throw GhError(res.status, "Remote file is not valid JSON"); }
      });
    });
  }
  /* Blob SHA needed for updates; null when the file does not exist yet. */
  function ghGetSha() {
    return ghFetch(filePath()).then(function (res) {
      if (res.status === 404) return null;
      if (!res.ok) throw GhError(res.status);
      return res.json().then(function (meta) { return meta && meta.sha ? meta.sha : null; });
    });
  }
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  /* Create (sha null) or update the file. */
  function ghPush(data, sha) {
    var body = {
      message: "Maolio sync (" + config.storage + ")",
      content: b64encode(JSON.stringify(data, null, 2)),
      branch: config.branch
    };
    if (sha) body.sha = sha;
    return ghFetch(filePath(), { method: "PUT", body: JSON.stringify(body) }).then(function (res) {
      if (!res.ok) throw GhError(res.status);
      return res.json().catch(function () { return null; });
    });
  }

  /* ---------- last-sync snapshot ---------- */
  function loadSnapshot() {
    try {
      var raw = store().getItem(SNAPSHOT_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && Array.isArray(parsed.sheets)) return parsed;
    } catch (e) { /* no snapshot yet */ }
    return null;
  }
  function saveSnapshot(data) {
    try {
      store().setItem(SNAPSHOT_KEY, JSON.stringify({ sheets: data.sheets, currentSheetId: data.currentSheetId, t: Date.now() }));
    } catch (e) {}
  }

  /* ---------- three-way merge ----------
   * base = last-sync snapshot, local = current device state, remote = GitHub file.
   * Sheets are keyed by id, rows by row.id. A row/sheet added, changed or
   * deleted on either side since the snapshot is applied; on conflicting
   * changes the newer updatedAt wins. A deletion is treated as having the
   * base version's updatedAt, so any edit made since the last sync beats a
   * deletion, and a deletion beats an unchanged row. */
  function ts(v) { return (v && typeof v.updatedAt === "number") ? v.updatedAt : 0; }
  function mergeRows(baseRows, localRows, remoteRows) {
    var base = {}, local = {}, remote = {};
    (baseRows || []).forEach(function (r) { if (r && r.id) base[r.id] = r; });
    (localRows || []).forEach(function (r) { if (r && r.id) local[r.id] = r; });
    (remoteRows || []).forEach(function (r) { if (r && r.id) remote[r.id] = r; });
    var ids = {}, out = [];
    Object.keys(base).forEach(function (id) { ids[id] = true; });
    Object.keys(local).forEach(function (id) { ids[id] = true; });
    Object.keys(remote).forEach(function (id) { ids[id] = true; });
    Object.keys(ids).forEach(function (id) {
      var b = base[id], l = local[id], r = remote[id];
      if (l && r) {
        var lChanged = !b || ts(l) !== ts(b) || JSON.stringify(l) !== JSON.stringify(b);
        var rChanged = !b || ts(r) !== ts(b) || JSON.stringify(r) !== JSON.stringify(b);
        if (lChanged && rChanged) out.push(ts(l) >= ts(r) ? l : r); /* conflict: newer updatedAt wins */
        else if (lChanged) out.push(l);
        else if (rChanged) out.push(r);
        else out.push(b || l);
      } else if (l && !r) {
        if (!b) { out.push(l); return; }               /* added locally */
        if (ts(l) !== ts(b) || JSON.stringify(l) !== JSON.stringify(b)) out.push(l); /* edit beats delete */
        /* else: deleted remotely, unchanged locally -> row stays deleted */
      } else if (!l && r) {
        if (!b) { out.push(r); return; }               /* added remotely */
        if (ts(r) !== ts(b) || JSON.stringify(r) !== JSON.stringify(b)) out.push(r); /* edit beats delete */
        /* else: deleted locally, unchanged remotely -> row stays deleted */
      }
      /* only in base: deleted on both sides -> gone */
    });
    return out;
  }
  function mergeSheets(base, local, remote) {
    base = (base && Array.isArray(base.sheets)) ? base : { sheets: [] };
    local = (local && Array.isArray(local.sheets)) ? local : { sheets: [] };
    remote = (remote && Array.isArray(remote.sheets)) ? remote : { sheets: [] };
    var bS = {}, lS = {}, rS = {};
    base.sheets.forEach(function (s) { if (s && s.id) bS[s.id] = s; });
    local.sheets.forEach(function (s) { if (s && s.id) lS[s.id] = s; });
    remote.sheets.forEach(function (s) { if (s && s.id) rS[s.id] = s; });
    var ids = {}, sheets = [];
    Object.keys(bS).forEach(function (id) { ids[id] = true; });
    Object.keys(lS).forEach(function (id) { ids[id] = true; });
    Object.keys(rS).forEach(function (id) { ids[id] = true; });
    Object.keys(ids).forEach(function (id) {
      var b = bS[id], l = lS[id], r = rS[id];
      var lAlive = !!l, rAlive = !!r;
      if (lAlive && rAlive) {
        var lChanged = !b || ts(l) !== ts(b) || JSON.stringify(l) !== JSON.stringify(b);
        var rChanged = !b || ts(r) !== ts(b) || JSON.stringify(r) !== JSON.stringify(b);
        var head = (lChanged && rChanged) ? (ts(l) >= ts(r) ? l : r) : (lChanged ? l : (rChanged ? r : (b || l)));
        sheets.push({ id: head.id, name: head.name, updatedAt: ts(head), rows: mergeRows(b && b.rows, l.rows, r.rows) });
      } else if (lAlive && !rAlive) {
        if (!b || ts(l) !== ts(b) || JSON.stringify(l) !== JSON.stringify(b)) {
          sheets.push({ id: l.id, name: l.name, updatedAt: ts(l), rows: mergeRows(b && b.rows, l.rows, null) });
        } /* else deleted remotely, unchanged locally */
      } else if (!lAlive && rAlive) {
        if (!b || ts(r) !== ts(b) || JSON.stringify(r) !== JSON.stringify(b)) {
          sheets.push({ id: r.id, name: r.name, updatedAt: ts(r), rows: mergeRows(b && b.rows, null, r.rows) });
        } /* else deleted locally, unchanged remotely */
      }
    });
    var currentSheetId = null;
    if (local.currentSheetId && sheets.some(function (s) { return s.id === local.currentSheetId; })) {
      currentSheetId = local.currentSheetId;
    } else if (remote.currentSheetId && sheets.some(function (s) { return s.id === remote.currentSheetId; })) {
      currentSheetId = remote.currentSheetId;
    } else if (sheets.length) {
      currentSheetId = sheets[0].id;
    }
    return { sheets: sheets, currentSheetId: currentSheetId };
  }
  function countRows(data) {
    return (data.sheets || []).reduce(function (n, s) { return n + (s.rows || []).length; }, 0);
  }

  /* ---------- sync orchestration ---------- */
  function finishSync() {
    var local = getLocal();
    saveSnapshot(local);
    config.lastSyncAt = Date.now();
    dirtyAt = 0;
    save();
    emitStateChange();
  }
  /* PUT the merged state; on 409/422 re-pull, re-merge and retry exactly once. */
  function pushWithRetry(data, attempt) {
    return ghGetSha().then(function (sha) {
      return ghPush(data, sha);
    }).catch(function (e) {
      if ((e.status === 409 || e.status === 422) && attempt === 0) {
        return ghPull().then(function (remote2) {
          var merged2 = mergeSheets(loadSnapshot(), getLocal(), remote2 || loadSnapshot());
          backupLocal();
          applyLocal(merged2);
          return pushWithRetry(merged2, 1);
        });
      }
      throw e;
    });
  }
  function syncNow(manual) {
    if (!isActive()) return Promise.resolve(false);
    if (inFlight) return Promise.resolve(false);
    inFlight = true;
    return ghPull().then(function (remote) {
      var local = getLocal();
      var snap = loadSnapshot();
      if (!snap) {
        /* First sync on this device: ask upload vs download when remote data exists. */
        if (remote && Array.isArray(remote.sheets)) {
          var upload = confirmImpl(
            "First GitHub sync — no sync history on this device.\n\n" +
            "OK = Upload local data to GitHub (replaces the remote file)\n" +
            "Cancel = Download from GitHub (replaces local data; a backup is saved first)");
          if (!upload) {
            if (!confirmImpl("Download from GitHub and replace your local data? A safety backup is written first.")) {
              throw GhError(0, "cancelled");
            }
            backupLocal();
            applyLocal(remote);
            finishSync();
            emitMessage("GitHub sync: downloaded from GitHub.", false);
            return true;
          }
          if (!confirmImpl("Upload your local data to GitHub? It replaces the remote file.")) {
            throw GhError(0, "cancelled");
          }
        }
        return pushWithRetry(local, 0).then(function () { finishSync(); return true; });
      }
      /* Normal sync: three-way merge against the snapshot. If the remote file
         is gone (404) treat the remote side as unchanged so deletions are not
         propagated; the push below recreates the file. */
      var merged = mergeSheets(snap, local, remote || snap);
      /* Safety guard: never let a merge delete more than 20% of the rows
         without explicit confirmation. */
      var before = countRows(local), after = countRows(merged);
      if (before > 0 && after < before * DELETE_GUARD_RATIO) {
        var pct = Math.round((1 - after / before) * 100);
        if (!confirmImpl("This sync would delete " + (before - after) + " of " + before + " rows (" + pct + "%). Continue?")) {
          throw GhError(0, "cancelled");
        }
      }
      backupLocal();
      applyLocal(merged);
      var localNow = getLocal();
      if (remote && JSON.stringify(localNow) === JSON.stringify(remote)) {
        finishSync(); /* already in sync, nothing to push */
        return true;
      }
      return pushWithRetry(localNow, 0).then(function () { finishSync(); return true; });
    }).catch(function (e) {
      var status = e && e.status;
      if (status === 401 || status === 403) {
        /* Token invalid or revoked: mark needs-reconnect and stop auto-sync. */
        config.needsReconnect = true;
        save();
        emitStateChange();
        emitMessage("GitHub sync needs reconnect: the personal access token is invalid or was revoked. Open GitHub sync to enter a new token.", true);
      } else if (e && e.message === "cancelled") {
        if (manual) emitMessage("GitHub sync cancelled.", false);
      } else {
        if (manual) emitMessage("GitHub sync error: " + ((e && e.message) || e), true);
      }
      return false;
    }).then(function (ok) {
      inFlight = false;
      emitStateChange();
      if (dirtyAt > (config ? config.lastSyncAt : 0)) schedule();
      return ok;
    });
  }
  /* Debounced push after local edits (~5 s). */
  function schedule() {
    if (!isActive() || applying) return;
    dirtyAt = Date.now();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { syncNow(false); }, DEBOUNCE_MS);
  }
  /* Pull on app start / when the tab becomes visible again. */
  function pullNow() {
    if (!isActive() || inFlight) return Promise.resolve(false);
    return syncNow(false);
  }
  function init() {
    load();
    if (isActive()) syncNow(false);
  }

  /* ---------- settings dialog (markup lives in index.html) ---------- */
  function val(id) {
    var el = (typeof document !== "undefined") ? document.getElementById(id) : null;
    return el ? el.value : "";
  }
  function setText(id, text) {
    var el = (typeof document !== "undefined") ? document.getElementById(id) : null;
    if (el) el.textContent = text;
  }
  function showError(msg) { setText("gh-error", msg || ""); }
  function lastSyncText() {
    if (!config || !config.lastSyncAt) return "never";
    var secs = Math.max(0, Math.floor((Date.now() - config.lastSyncAt) / 1000));
    if (secs < 60) return secs + "s ago";
    var mins = Math.floor(secs / 60);
    if (mins < 60) return mins + "m ago";
    return Math.floor(mins / 60) + "h ago";
  }
  function renderStatus() {
    var st = state();
    setText("gh-status",
      "Storage: " + st.storage + " · Repo: " + (st.repo || "—") + "@" + st.branch +
      " · Last sync: " + lastSyncText() + " · Pending changes: " + (st.pending ? "yes" : "no") +
      (st.needsReconnect ? " · NEEDS RECONNECT (token invalid or revoked)" : ""));
    var btn = (typeof document !== "undefined") ? document.getElementById("gh-sync-now") : null;
    if (btn) btn.disabled = !isActive();
  }
  function openDialog() {
    load();
    var modal = document.getElementById("github-modal");
    if (!modal) return;
    setVal("gh-backend", activeBackend());
    /* Never display the saved token: empty field means "keep the saved one". */
    setVal("gh-token", "");
    var tok = document.getElementById("gh-token");
    if (tok) tok.placeholder = config && config.token ? "Token saved — enter a new one to change" : "ghp_… fine-grained PAT";
    setVal("gh-repo", config && config.repo ? config.repo : "");
    setVal("gh-branch", config && config.branch ? config.branch : "main");
    setVal("gh-storage", config && config.storage ? config.storage : "default");
    showError("");
    renderStatus();
    modal.hidden = false;
  }
  function setVal(id, v) {
    var el = document.getElementById(id);
    if (el) el.value = v;
  }
  function closeDialog() {
    var modal = document.getElementById("github-modal");
    if (modal) modal.hidden = true;
  }
  function toggleHelp() {
    var h = document.getElementById("github-help");
    if (h) h.hidden = !h.hidden;
  }
  function saveDialog() {
    load();
    var backend = val("gh-backend");
    var token = val("gh-token").trim();
    var repo = val("gh-repo").trim();
    var branch = val("gh-branch").trim() || "main";
    var storage = val("gh-storage").trim() || "default";
    if (token) config.token = token; /* empty keeps the stored token */
    config.repo = repo || config.repo;
    config.branch = branch;
    config.storage = storage;
    if (backend === "github") {
      if (!config.token) { showError("Enter a personal access token first (see Setup help)."); return; }
      if (!/^[\w.-]+\/[\w.-]+$/.test(config.repo || "")) { showError("Repository must look like owner/repo."); return; }
      config.backend = "github";
      config.connected = true;
      config.needsReconnect = false;
      save();
      /* Only one backend active at a time: pause Drive auto-sync, keep its config. */
      if (typeof window !== "undefined" && typeof window.stopDriveAutoSync === "function") window.stopDriveAutoSync();
      closeDialog();
      emitStateChange();
      emitMessage("GitHub sync connected. Syncing…", false);
      syncNow(true);
    } else {
      config.backend = backend;
      config.connected = false;
      config.needsReconnect = false;
      save();
      if (typeof window !== "undefined" && typeof window.stopDriveAutoSync === "function") window.stopDriveAutoSync();
      if (backend === "drive" && typeof window !== "undefined" &&
          typeof window.driveIsConfigured === "function" && window.driveIsConfigured() &&
          typeof window.startDriveAutoSync === "function") {
        window.startDriveAutoSync();
      }
      closeDialog();
      emitStateChange();
      emitMessage("Sync backend: " + backend + ". Local data was not changed.", false);
    }
  }
  function disconnect() {
    if (!confirmImpl("Disconnect GitHub sync? Your data stays on this device and the saved token is kept for an easy reconnect.")) return;
    load();
    config.connected = false;
    config.needsReconnect = false;
    config.backend = "off";
    if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
    save();
    closeDialog();
    emitStateChange();
    emitMessage("GitHub sync disconnected. Data kept locally.", false);
  }

  return {
    init: init,
    isActive: isActive,
    activeBackend: activeBackend,
    state: state,
    schedule: schedule,
    syncNow: syncNow,
    pullNow: pullNow,
    mergeSheets: mergeSheets,
    openDialog: openDialog,
    closeDialog: closeDialog,
    saveDialog: saveDialog,
    disconnect: disconnect,
    toggleHelp: toggleHelp,
    renderStatus: renderStatus,
    /* used by index.html wiring */
    _load: load,
    _configure: function (cfg) {
      load();
      config.backend = cfg.backend;
      if (cfg.token) config.token = cfg.token;
      config.repo = cfg.repo;
      config.branch = cfg.branch || "main";
      config.storage = cfg.storage || "default";
      config.connected = !!cfg.connected;
      config.needsReconnect = false;
      save();
    }
  };
})();
