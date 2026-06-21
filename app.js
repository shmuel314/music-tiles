/* Music Tiles — 100% offline, local-files child music player. */
(() => {
  'use strict';

  // ---- Build version (single source of truth) ----
  // Bump this on every change. Keep sw.js CACHE ('music-tiles-<APP_VERSION>') in
  // sync; the admin screen shows both so a mismatch (= stale deploy) is obvious.
  const APP_VERSION = 'v30';

  const DEFAULT_PIN = '1234';
  const TAP_DEBOUNCE_MS = 700;
  const ADMIN_LONG_PRESS_MS = 5000;

  // ---- App state ----
  const state = {
    playlists: [],
    activePlaylistId: null,
    songs: [],          // visible songs in the active playlist (child view)
    playlistSongCount: 0,
    volumeCap: 0.8,
    showPlayPauseButton: true,
    currentSongId: null,
    isPlaying: false,
    lastTapAt: 0,
    objectUrls: new Set()
  };

  const audio = new Audio();
  audio.preload = 'metadata';

  // ---- Element refs ----
  const $ = (id) => document.getElementById(id);
  const el = {
    tiles: $('tiles'),
    emptyHint: $('empty-hint'),
    emptyHintMain: $('empty-hint-main'),
    controls: $('controls'),
    btnPlayPause: $('btn-playpause'),
    iconPlay: $('icon-play'),
    iconPause: $('icon-pause'),
    adminEntry: $('admin-entry'),
    childHeader: $('child-header'),
    adminTrigger: $('admin-trigger'),
    emptyHintAdmin: $('empty-hint-admin'),
    pinScreen: $('pin-screen'),
    pinTitle: $('pin-title'),
    pinDots: $('pin-dots'),
    pinError: $('pin-error'),
    adminScreen: $('admin-screen'),
    adminDone: $('admin-done'),
    adminMainView: $('admin-main-view'),
    adminPlaylistView: $('admin-playlist-view'),
    playlistEditBack: $('playlist-edit-back'),
    playlistEditTitle: $('playlist-edit-title'),
    showAdminButton: $('show-admin-button'),
    showPlayPauseButton: $('show-playpause-button'),
    volumeCap: $('volume-cap'),
    volumeCapLabel: $('volume-cap-label'),
    addPlaylist: $('add-playlist'),
    playlistList: $('playlist-list'),
    addSong: $('add-song'),
    bulkImportSongs: $('bulk-import-songs'),
    bulkAudio: $('bulk-audio'),
    songList: $('song-list'),
    changePin: $('change-pin'),
    appVersion: $('app-version'),
    swCacheVersion: $('sw-cache-version'),
    copyDiagnostics: $('copy-diagnostics'),
    exportDebug: $('export-debug'),
    youtubeApiKey: $('youtube-api-key'),
    youtubeApiSave: $('youtube-api-save'),
    exportFull: $('export-full'),
    exportMeta: $('export-meta'),
    importData: $('import-data'),
    importFile: $('import-file'),
    importModal: $('import-modal'),
    importSummary: $('import-summary'),
    importMerge: $('import-merge'),
    importReplace: $('import-replace'),
    importCancel: $('import-cancel'),
    songModal: $('song-modal'),
    songModalTitle: $('song-modal-title'),
    imgPreview: $('img-preview'),
    songImage: $('song-image'),
    pickAudio: $('pick-audio'),
    audioName: $('audio-name'),
    songAudio: $('song-audio'),
    songTitle: $('song-title'),
    songPlaylist: $('song-playlist'),
    songCancel: $('song-cancel'),
    songSave: $('song-save'),
    youtubeImport: $('youtube-import'),
    youtubeStatus: $('youtube-status'),
    youtubeSpinner: $('youtube-spinner'),
    youtubeStatusText: $('youtube-status-text'),
    youtubeCancel: $('youtube-cancel'),
    copySongModal: $('copy-song-modal'),
    copySongName: $('copy-song-name'),
    copySongTarget: $('copy-song-target'),
    copySongCancel: $('copy-song-cancel'),
    copySongConfirm: $('copy-song-confirm'),
    toast: $('toast')
  };

  // ================= PERSISTENT back-navigation recorder =================
  // A Back that escapes tears down the document, which would lose in-memory and
  // console logs at the exact moment we care about. So every event is written
  // SYNCHRONOUSLY to localStorage (survives pagehide/beforeunload/relaunch) and
  // the full cross-launch timeline is replayed on the next load.
  //
  // Launch once with #debug (…/index.html#debug) to show the on-screen timeline.
  //   ua flags:  A = transient user activation active, H = sticky has-been-active
  //   len = history.length, buf = our buffered sentinel count.
  // Debug is enabled by ANY of: #debug, ?debug=1/true, or localStorage debug=1.
  // Once enabled by URL it is persisted to localStorage so it survives relaunch
  // (the PWA start_url has no hash). Disable with ?debug=0 or #debugoff.
  function computeDebugEnabled() {
    try {
      const href = location.href.toLowerCase();
      const sp = new URLSearchParams(location.search);
      if (sp.get('debug') === '0' || href.indexOf('debugoff') !== -1) {
        try { localStorage.removeItem('debug'); } catch (_) {}
        return false;
      }
      const on = href.indexOf('#debug') !== -1
        || href.indexOf('debug=1') !== -1
        || href.indexOf('debug=true') !== -1
        || sp.get('debug') === '1'
        || sp.get('debug') === 'true'
        || (function () { try { return localStorage.getItem('debug') === '1'; } catch (_) { return false; } })();
      if (on) { try { localStorage.setItem('debug', '1'); } catch (_) {} }
      return on;
    } catch (_) {
      return /debug/i.test(location.href);
    }
  }
  const BACK_DEBUG = computeDebugEnabled();
  const LOG_KEY = 'backDiag.events';
  const SEQ_KEY = 'backDiag.seq';
  const LOG_MAX = 600;

  // Back-trap state declared here so the recorder can read it without TDZ.
  let backTrapInstalled = false;
  let bufferedSentinels = 0;
  let totalSentinelsSeeded = 0;
  let backAbsorbedCount = 0;
  let suppressHistoryLog = false;

  let dbgPanel = null, dbgBody = null;

  function safeJson(v) {
    if (v === undefined || v === '') return '';
    try { return typeof v === 'string' ? v : JSON.stringify(v); }
    catch (_) { return String(v); }
  }
  function activationFlags() {
    const u = navigator.userActivation;
    if (!u) return 'na';
    return (u.isActive ? 'A' : '-') + (u.hasBeenActive ? 'H' : '-');
  }
  function readLog() {
    try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch (_) { return []; }
  }
  function nextSeq() {
    let n = 0;
    try {
      n = (parseInt(localStorage.getItem(SEQ_KEY), 10) || 0) + 1;
      localStorage.setItem(SEQ_KEY, String(n));
    } catch (_) {}
    return n;
  }
  function fmtRow(ev) {
    const clock = new Date(ev.ts).toISOString().slice(11, 23);
    return `#${ev.seq} ${clock} len=${ev.len} buf=${ev.buf} ua=${ev.ua} | ${ev.type}` +
      (safeJson(ev.data) ? ' ' + safeJson(ev.data) : '');
  }
  function logEvent(type, data) {
    const ev = {
      seq: nextSeq(),
      ts: Date.now(),
      type,
      len: (typeof history !== 'undefined' && history.length) || 0,
      buf: bufferedSentinels,
      ua: activationFlags(),
      data: data === undefined ? '' : data
    };
    let arr = readLog();
    arr.push(ev);
    if (arr.length > LOG_MAX) arr = arr.slice(arr.length - LOG_MAX);
    try { localStorage.setItem(LOG_KEY, JSON.stringify(arr)); } catch (_) {}
    try { console.log('[back] ' + fmtRow(ev)); } catch (_) {}
    if (BACK_DEBUG) appendPanelRow(ev);
  }
  // Back-compat alias used throughout the file.
  function dbg(label, data) { logEvent(label, data); }

  // Build a shareable text dump of the persisted timeline.
  function buildDebugText() {
    let raw = '[]';
    try { raw = localStorage.getItem(LOG_KEY) || '[]'; } catch (_) {}
    let body;
    try { body = JSON.parse(raw).map(fmtRow).join('\n'); } catch (_) { body = raw; }
    const header = [
      'Music Tiles — back-navigation debug log',
      'exported: ' + new Date().toISOString(),
      'userAgent: ' + navigator.userAgent,
      'href: ' + location.href,
      'displayMode: ' + (window.matchMedia('(display-mode: standalone)').matches ? 'standalone'
        : window.matchMedia('(display-mode: fullscreen)').matches ? 'fullscreen'
          : window.matchMedia('(display-mode: minimal-ui)').matches ? 'minimal-ui' : 'browser'),
      'history.length: ' + history.length,
      'bufferedSentinels: ' + bufferedSentinels,
      ''
    ].join('\n');
    return header + '\n' + body + '\n';
  }
  // Read the ACTIVE service-worker cache name (reflects the SW build that is
  // really running on the device, independent of APP_VERSION).
  function getActiveCacheVersion() {
    if (!('caches' in self)) return Promise.resolve('(no Cache API)');
    return caches.keys().then(
      (keys) => keys.find((k) => /^music-tiles-/.test(k)) || '(none)',
      () => '(unavailable)'
    );
  }

  function currentDisplayMode() {
    return window.matchMedia('(display-mode: standalone)').matches ? 'standalone'
      : window.matchMedia('(display-mode: fullscreen)').matches ? 'fullscreen'
        : window.matchMedia('(display-mode: minimal-ui)').matches ? 'minimal-ui' : 'browser';
  }

  function copyDiagnostics() {
    return getActiveCacheVersion().then((cache) => {
      const text = [
        'app version: ' + APP_VERSION,
        'sw cache: ' + cache,
        'url: ' + location.href,
        'userAgent: ' + navigator.userAgent,
        'history.length: ' + history.length,
        'displayMode: ' + currentDisplayMode()
      ].join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(
          () => toast('האבחון הועתק', { success: true }),
          () => toast('ההעתקה נכשלה')
        );
      }
      toast('ההעתקה אינה נתמכת בדפדפן זה');
    });
  }

  function exportDebugLog() {
    const text = buildDebugText();
    try {
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'music-tiles-debug-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.txt';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    } catch (_) {}
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        () => toast('יומן הניפוי הועתק והורד', { success: true }),
        () => toast('יומן הניפוי הורד')
      );
    } else {
      toast('יומן הניפוי הורד');
    }
  }

  function appendPanelRow(ev) {
    try {
      if (!dbgPanel) renderPanel();
      const div = document.createElement('div');
      div.textContent = fmtRow(ev);
      if (/pagehide|beforeunload/.test(ev.type)) div.style.color = '#ff6b6b';
      else if (/popstate/.test(ev.type)) div.style.color = '#ffd93d';
      else if (/LOAD|pageshow|user-gesture/.test(ev.type)) div.style.color = '#6bcbff';
      dbgBody.appendChild(div);
      dbgPanel.scrollTop = dbgPanel.scrollHeight;
    } catch (_) {}
  }
  function renderPanel() {
    dbgPanel = document.createElement('div');
    dbgPanel.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;height:48%;overflow:auto;z-index:99999;' +
      'background:rgba(0,0,0,.86);color:#1eff1e;font:10px/1.3 monospace;padding:0 4px 6px;' +
      'white-space:pre-wrap;direction:ltr;text-align:left;';
    const bar = document.createElement('div');
    bar.style.cssText = 'position:sticky;top:0;background:#111;color:#fff;padding:3px 4px;display:flex;gap:8px;align-items:center;';
    const title = document.createElement('span');
    title.textContent = 'BACK DIAG (persisted timeline)';
    const clear = document.createElement('button');
    clear.textContent = 'CLEAR';
    clear.style.cssText = 'font:10px monospace;pointer-events:auto;';
    clear.addEventListener('click', (e) => {
      e.stopPropagation();
      try { localStorage.removeItem(LOG_KEY); localStorage.removeItem(SEQ_KEY); } catch (_) {}
      if (dbgBody) dbgBody.textContent = '';
    });
    bar.appendChild(title);
    bar.appendChild(clear);
    dbgPanel.appendChild(bar);
    dbgBody = document.createElement('div');
    dbgPanel.appendChild(dbgBody);
    (document.body || document.documentElement).appendChild(dbgPanel);
    for (const ev of readLog()) appendPanelRow(ev); // replay previous sessions
  }

  // Wrap history methods to record EVERY mutation app-wide, with the
  // user-activation state AT THE TIME OF THE CALL (gesture vs non-gesture).
  (function instrumentHistory() {
    const _push = history.pushState.bind(history);
    const _replace = history.replaceState.bind(history);
    history.pushState = function (s, t, u) {
      const lenBefore = history.length, act = activationFlags();
      const r = _push(s, t, u);
      if (!suppressHistoryLog) {
        logEvent('pushState', { ua_at_call: act, lenBefore, lenAfter: history.length, url: u || '(current)' });
      }
      return r;
    };
    history.replaceState = function (s, t, u) {
      const lenBefore = history.length, act = activationFlags();
      const r = _replace(s, t, u);
      logEvent('replaceState', { ua_at_call: act, lenBefore, lenAfter: history.length, url: u || '(current)' });
      return r;
    };
  })();

  // Global lifecycle instrumentation — active from the first line, regardless of
  // the trap. These only RECORD; trap logic lives in installBackTrap().
  (function instrumentEvents() {
    window.addEventListener('popstate', (e) => logEvent('popstate', { state: e.state }), true);
    window.addEventListener('hashchange', () => logEvent('hashchange'), true);
    window.addEventListener('pageshow', (e) => logEvent('pageshow', { persisted: e.persisted }), true);
    window.addEventListener('pagehide', (e) => logEvent('pagehide', { persisted: e.persisted }), true);
    window.addEventListener('beforeunload', () => logEvent('beforeunload'), true);
    document.addEventListener('visibilitychange', () => logEvent('visibilitychange', { vis: document.visibilityState }), true);
    ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach((ty) =>
      window.addEventListener(ty, () => logEvent('user-gesture', { kind: ty }), true));
  })();

  // Show the panel IMMEDIATELY at startup when debug is enabled (don't wait for
  // the first lazily-logged event), and stamp the version into the page title.
  if (BACK_DEBUG) {
    try { renderPanel(); } catch (_) {}
    try {
      if (document.title.indexOf('[' + APP_VERSION + ']') === -1) {
        document.title = document.title + ' [' + APP_VERSION + ']';
      }
    } catch (_) {}
  }

  logEvent('=== LOAD ===', {
    version: APP_VERSION,
    href: location.href,
    readyState: document.readyState,
    displayMode: currentDisplayMode()
  });
  getActiveCacheVersion().then((cache) => logEvent('sw cache', { cache }));

  // ---- Helpers ----
  function objectUrl(blob) {
    const url = URL.createObjectURL(blob);
    state.objectUrls.add(url);
    return url;
  }
  function revokeUrls() {
    state.objectUrls.forEach((u) => URL.revokeObjectURL(u));
    state.objectUrls.clear();
  }
  let toastTimer = null;
  function toast(msg, opts) {
    el.toast.textContent = msg;
    el.toast.classList.toggle('success', !!(opts && opts.success));
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.hidden = true;
      el.toast.classList.remove('success');
    }, 2200);
  }

  const buttonDefaults = new WeakMap();

  function rememberButtonLabel(btn) {
    if (!btn || buttonDefaults.has(btn)) return;
    buttonDefaults.set(btn, btn.textContent.trim());
  }

  function setButtonLoading(btn, loading, loadingText) {
    if (!btn) return;
    rememberButtonLabel(btn);
    if (loading) {
      btn.classList.add('is-loading');
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.replaceChildren();
      const spinner = document.createElement('span');
      spinner.className = 'btn-spinner';
      spinner.setAttribute('aria-hidden', 'true');
      btn.appendChild(spinner);
      const label = document.createElement('span');
      label.textContent = loadingText || buttonDefaults.get(btn) || '';
      btn.appendChild(label);
      return;
    }
    btn.classList.remove('is-loading');
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = buttonDefaults.get(btn) || '';
  }

  function titleFromFileName(name) {
    return name.replace(/\.[^.]+$/, '').trim();
  }

  function isSongHidden(song) {
    return !!song.hidden;
  }

  function sortSongsForAdmin(songs) {
    return [...songs].sort((a, b) => {
      const ah = isSongHidden(a), bh = isSongHidden(b);
      if (ah !== bh) return ah ? 1 : -1;
      return (a.order ?? 0) - (b.order ?? 0);
    });
  }

  function visibleSongs(songs) {
    return songs.filter((s) => !isSongHidden(s));
  }

  function songTitleSig(playlistId, title) {
    const t = (title || '').trim().toLowerCase();
    return t ? `${playlistId}|${t}` : null;
  }

  function syncPlaybackState() {
    state.isPlaying = !!state.currentSongId && !audio.paused && !audio.ended;
    updatePlayingIndicator();
  }
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  async function dataURLToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return res.blob();
  }

  // ---- Last-screen persistence + startup recovery ----
  // The cream screen with the icon is the NATIVE PWA launch splash, drawn by
  // Android while the document (re)loads. It has no DOM and cannot receive
  // clicks. To guarantee the app never appears "stuck" on it after a
  // reload/relaunch, we persist which screen was active and restore the songs
  // screen on boot.
  const LAST_SCREEN_KEY = 'lastScreen';

  function rememberScreen(name) {
    try { localStorage.setItem(LAST_SCREEN_KEY, name); } catch (_) {}
  }
  function getLastScreen() {
    try { return localStorage.getItem(LAST_SCREEN_KEY); } catch (_) { return null; }
  }

  // Hide every overlay and present the child/songs screen.
  function showSongsScreen() {
    el.pinScreen.hidden = true;
    el.adminScreen.hidden = true;
    el.songModal.hidden = true;
    el.copySongModal.hidden = true;
    el.importModal.hidden = true;
    rememberScreen('songs');
    dbg('showSongsScreen');
  }

  // ---- Boot ----
  async function init() {
    try {
      await DB.open();
      await ensureSeedData();
      state.volumeCap = Number(await DB.getSetting('volumeCap', 0.8));
      audio.volume = state.volumeCap;
      await loadActivePlaylistView();
      await applyChildDisplaySettings();
      bindEvents();
      registerServiceWorker();

      // Startup recovery: after data is ready, if the songs screen was the last
      // active screen (the default for the child device), restore it so we never
      // remain on the native splash.
      const last = getLastScreen();
      dbg('startup lastScreen', last);
      if (last === 'songs' || last === null) {
        showSongsScreen();
      }
      dbg('init complete', { historyLength: history.length });
    } catch (err) {
      // Never leave the user stranded on the splash if boot throws — show the
      // songs screen anyway (it may be empty until data recovers).
      dbg('init ERROR', err && err.message);
      try { showSongsScreen(); } catch (_) {}
    }
  }

  async function ensureSeedData() {
    const playlists = await DB.getPlaylists();
    if (playlists.length === 0) {
      const id = DB.uid();
      await DB.savePlaylist({ id, name: 'השירים שלי', order: 0 });
      await DB.setSetting('activePlaylistId', id);
    }
    if ((await DB.getSetting('pin', null)) === null) {
      await DB.setSetting('pin', DEFAULT_PIN);
    }
  }

  async function loadActivePlaylistView() {
    revokeUrls();
    state.playlists = await DB.getPlaylists();
    state.activePlaylistId = await DB.getSetting('activePlaylistId', state.playlists[0]?.id ?? null);
    if (!state.playlists.find((p) => p.id === state.activePlaylistId)) {
      state.activePlaylistId = state.playlists[0]?.id ?? null;
      await DB.setSetting('activePlaylistId', state.activePlaylistId);
    }
    const allSongs = state.activePlaylistId
      ? await DB.getSongsByPlaylist(state.activePlaylistId)
      : [];
    state.playlistSongCount = allSongs.length;
    state.songs = visibleSongs(allSongs);
    renderTiles();
  }

  function updateControlsVisibility() {
    const showControls = state.songs.length > 0 && state.showPlayPauseButton;
    el.controls.hidden = !showControls;
  }

  function updateEmptyHintMessage() {
    if (!el.emptyHintMain) return;
    if (state.playlistSongCount > 0 && state.songs.length === 0) {
      el.emptyHintMain.textContent = 'אין שירים גלויים.';
    } else {
      el.emptyHintMain.textContent = 'אין שירים עדיין.';
    }
  }

  // ---- Child screen rendering ----
  function renderTiles() {
    el.tiles.innerHTML = '';
    const count = state.songs.length;
    dbg('songs screen rendered', { count, historyLength: history.length });
    // Record "songs" only when it is the visible screen (no overlay on top),
    // so a relaunch restores tiles rather than getting stuck on the splash.
    if (el.adminScreen.hidden && el.pinScreen.hidden && el.songModal.hidden
        && el.copySongModal.hidden && el.importModal.hidden) {
      rememberScreen('songs');
    }

    if (count === 0) {
      el.emptyHint.hidden = false;
      updateEmptyHintMessage();
      updateControlsVisibility();
      return;
    }
    el.emptyHint.hidden = true;
    updateControlsVisibility();

    for (const song of state.songs) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.id = song.id;
      if (song.id === state.currentSongId && state.isPlaying) tile.classList.add('playing');

      const media = document.createElement('div');
      media.className = 'tile-media';
      if (song.image) {
        const img = document.createElement('img');
        img.src = objectUrl(song.image);
        img.alt = '';
        media.appendChild(img);
      } else {
        const fb = document.createElement('div');
        fb.className = 'tile-fallback';
        fb.textContent = '\u266A';
        media.appendChild(fb);
      }
      tile.appendChild(media);

      const title = document.createElement('div');
      title.className = 'tile-title';
      const titleText = document.createElement('span');
      titleText.className = 'tile-title-text';
      titleText.textContent = song.title || '';
      title.appendChild(titleText);
      tile.appendChild(title);

      tile.addEventListener('click', () => onTileTap(song.id));
      el.tiles.appendChild(tile);
    }
    syncPlaybackState();
  }

  function updatePlayingIndicator() {
    const playing = state.isPlaying;
    el.tiles.querySelectorAll('.tile').forEach((t) => {
      t.classList.toggle('playing', t.dataset.id === state.currentSongId && playing);
    });
    el.iconPlay.classList.toggle('icon-hidden', playing);
    el.iconPause.classList.toggle('icon-hidden', !playing);
    el.btnPlayPause.setAttribute('aria-label', playing ? 'השהיה' : 'ניגון');
  }

  // ---- Playback (with debounce + volume cap) ----
  function onTileTap(songId) {
    const now = Date.now();
    if (now - state.lastTapAt < TAP_DEBOUNCE_MS) return; // ignore rapid/double taps
    state.lastTapAt = now;

    if (songId === state.currentSongId && !audio.paused) return; // already playing this one
    playSong(songId);
  }

  let playbackToken = 0;
  let switchingTrack = false;

  function playSong(songId) {
    const song = state.songs.find((s) => s.id === songId);
    if (!song || !song.audio) return;
    const token = ++playbackToken;
    switchingTrack = true;
    revokeAudioUrl();
    audio.src = objectUrl(song.audio);
    audio.volume = state.volumeCap;
    state.currentSongId = songId;
    audio.play().then(() => {
      if (token !== playbackToken) return;
      switchingTrack = false;
      syncPlaybackState();
    }).catch(() => {
      if (token !== playbackToken) return;
      switchingTrack = false;
      state.isPlaying = false;
      updatePlayingIndicator();
      toast('לא ניתן לנגן את השיר הזה');
    });
  }

  let lastAudioUrl = null;
  function revokeAudioUrl() {
    if (lastAudioUrl) {
      URL.revokeObjectURL(lastAudioUrl);
      state.objectUrls.delete(lastAudioUrl);
    }
    lastAudioUrl = audio.src && audio.src.startsWith('blob:') ? audio.src : null;
  }

  function togglePlayPause() {
    const now = Date.now();
    if (now - state.lastTapAt < TAP_DEBOUNCE_MS) return;
    state.lastTapAt = now;
    if (!state.currentSongId && state.songs.length) {
      playSong(state.songs[0].id);
      return;
    }
    if (!state.currentSongId) return;
    if (!audio.paused) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  }

  // ---- Admin entry (visible button or hidden long-press) ----
  let hiddenAdminBound = false;

  function bindHiddenAdminTrigger() {
    if (hiddenAdminBound) return;
    hiddenAdminBound = true;
    let timer = null;
    const start = (e) => {
      if (el.adminTrigger.hidden) return;
      e.preventDefault();
      timer = setTimeout(openPinScreen, ADMIN_LONG_PRESS_MS);
    };
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    el.adminTrigger.addEventListener('pointerdown', start);
    el.adminTrigger.addEventListener('pointerup', cancel);
    el.adminTrigger.addEventListener('pointerleave', cancel);
    el.adminTrigger.addEventListener('pointercancel', cancel);
  }

  function bindAdminEntry() {
    el.adminEntry.addEventListener('click', openPinScreen);
    bindHiddenAdminTrigger();
  }

  async function applyChildDisplaySettings() {
    const showAdmin = await DB.getSetting('showAdminButton', false);
    const showPlayPause = await DB.getSetting('showPlayPauseButton', true);
    state.showPlayPauseButton = showPlayPause;
    el.adminEntry.hidden = !showAdmin;
    el.childHeader.hidden = !showAdmin;
    el.adminTrigger.hidden = showAdmin;
    if (el.showAdminButton) el.showAdminButton.checked = showAdmin;
    if (el.showPlayPauseButton) el.showPlayPauseButton.checked = showPlayPause;
    updateEmptyHint();
    updateControlsVisibility();
  }

  function updateEmptyHint() {
    if (!el.emptyHintAdmin) return;
    const show = !el.adminEntry.hidden;
    el.emptyHintAdmin.hidden = !show;
    el.emptyHintAdmin.textContent = show
      ? 'לחצו על «אזור הורים» למעלה כדי להוסיף שירים.'
      : '';
  }

  async function saveShowAdminButton() {
    const show = el.showAdminButton.checked;
    await DB.setSetting('showAdminButton', show);
    await applyChildDisplaySettings();
    toast(show ? 'כפתור הניהול יוצג במסך הראשי' : 'כפתור הניהול הוסתר');
  }

  async function saveShowPlayPauseButton() {
    const show = el.showPlayPauseButton.checked;
    await DB.setSetting('showPlayPauseButton', show);
    await applyChildDisplaySettings();
    toast(show ? 'כפתור הניגון יוצג במסך הילד' : 'כפתור הניגון הוסתר');
  }

  // ---- PIN screen ----
  const pin = { entered: '', mode: 'verify', firstEntry: '' };

  function openPinScreen() {
    rememberScreen('pin');
    pin.entered = '';
    pin.mode = 'verify';
    el.pinTitle.textContent = 'הזנת קוד';
    el.pinError.hidden = true;
    renderPinDots();
    el.pinScreen.hidden = false;
  }
  function openChangePin() {
    pin.entered = '';
    pin.mode = 'set-new';
    pin.firstEntry = '';
    el.pinTitle.textContent = 'קוד חדש';
    el.pinError.hidden = true;
    renderPinDots();
    el.adminScreen.hidden = true;
    el.pinScreen.hidden = false;
  }
  function renderPinDots() {
    el.pinDots.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const d = document.createElement('span');
      if (i < pin.entered.length) d.classList.add('filled');
      el.pinDots.appendChild(d);
    }
  }
  async function onPinKey(key) {
    el.pinError.hidden = true;
    if (key === 'cancel') {
      el.pinScreen.hidden = true;
      if (pin.mode !== 'verify') el.adminScreen.hidden = false;
      return;
    }
    if (key === 'back') {
      pin.entered = pin.entered.slice(0, -1);
      renderPinDots();
      return;
    }
    if (pin.entered.length >= 4) return;
    pin.entered += key;
    renderPinDots();
    if (pin.entered.length === 4) await submitPin();
  }
  async function submitPin() {
    if (pin.mode === 'verify') {
      const saved = await DB.getSetting('pin', DEFAULT_PIN);
      if (pin.entered === String(saved)) {
        el.pinScreen.hidden = true;
        openAdmin();
      } else {
        el.pinError.hidden = false;
        pin.entered = '';
        renderPinDots();
      }
    } else if (pin.mode === 'set-new') {
      pin.firstEntry = pin.entered;
      pin.mode = 'set-confirm';
      pin.entered = '';
      el.pinTitle.textContent = 'אישור קוד';
      renderPinDots();
    } else if (pin.mode === 'set-confirm') {
      if (pin.entered === pin.firstEntry) {
        await DB.setSetting('pin', pin.entered);
        el.pinScreen.hidden = true;
        el.adminScreen.hidden = false;
        toast('הקוד שונה', { success: true });
      } else {
        el.pinError.textContent = 'הקודים אינם תואמים';
        el.pinError.hidden = false;
        pin.mode = 'set-new';
        pin.firstEntry = '';
        pin.entered = '';
        el.pinTitle.textContent = 'קוד חדש';
        renderPinDots();
      }
    }
  }

  // ---- Admin ----
  const adminView = { editingPlaylistId: null };

  function showAdminMainView() {
    adminView.editingPlaylistId = null;
    el.adminMainView.hidden = false;
    el.adminPlaylistView.hidden = true;
  }

  function openPlaylistEdit(playlist) {
    adminView.editingPlaylistId = playlist.id;
    el.adminMainView.hidden = true;
    el.adminPlaylistView.hidden = false;
    el.playlistEditTitle.textContent = playlist.name;
    renderPlaylistSongList();
  }

  async function setActivePlaylist(id) {
    if (state.activePlaylistId === id) return;
    await DB.setSetting('activePlaylistId', id);
    state.activePlaylistId = id;
    renderPlaylistList();
    toast('הרשימה הוגדרה כפעילה', { success: true });
  }

  function getAdminPlaylistId() {
    return adminView.editingPlaylistId || state.activePlaylistId;
  }

  async function openAdmin() {
    if (state.isPlaying) audio.pause();
    rememberScreen('admin');
    showAdminMainView();
    await refreshAdmin();
    el.adminScreen.hidden = false;
  }
  function updateVersionInfo() {
    if (el.appVersion) el.appVersion.textContent = APP_VERSION;
    if (el.swCacheVersion) {
      el.swCacheVersion.textContent = '…';
      getActiveCacheVersion().then((c) => { el.swCacheVersion.textContent = c; });
    }
  }

  async function refreshAdmin() {
    updateVersionInfo();
    state.playlists = await DB.getPlaylists();
    state.activePlaylistId = await DB.getSetting('activePlaylistId', state.playlists[0]?.id ?? null);

    el.songPlaylist.innerHTML = '';
    for (const p of state.playlists) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      el.songPlaylist.appendChild(o);
    }

    // Volume
    el.volumeCap.value = Math.round(state.volumeCap * 100);
    el.volumeCapLabel.textContent = el.volumeCap.value + '%';

    el.youtubeApiKey.value = await DB.getSetting('youtubeApiKey', '') || '';
    el.showAdminButton.checked = await DB.getSetting('showAdminButton', false);
    state.showPlayPauseButton = await DB.getSetting('showPlayPauseButton', true);
    el.showPlayPauseButton.checked = state.showPlayPauseButton;

    renderPlaylistList();
    if (adminView.editingPlaylistId) {
      const p = state.playlists.find((pl) => pl.id === adminView.editingPlaylistId);
      if (p) openPlaylistEdit(p);
      else showAdminMainView();
    }
  }

  function renderPlaylistList() {
    el.playlistList.innerHTML = '';
    state.playlists.forEach((p) => {
      const li = document.createElement('li');
      li.className = 'playlist-row';

      const grow = document.createElement('div');
      grow.className = 'grow';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;
      grow.appendChild(name);
      if (p.id === state.activePlaylistId) {
        const pill = document.createElement('span');
        pill.className = 'active-pill';
        pill.textContent = 'פעילה';
        grow.appendChild(pill);
      }
      li.appendChild(grow);

      const actions = document.createElement('div');
      actions.className = 'playlist-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-compact btn-primary';
      editBtn.textContent = 'עריכה';
      editBtn.addEventListener('click', () => openPlaylistEdit(p));
      actions.appendChild(editBtn);

      const activeBtn = document.createElement('button');
      activeBtn.type = 'button';
      activeBtn.className = 'btn btn-compact';
      activeBtn.textContent = 'הגדרה כרשימה פעילה';
      activeBtn.disabled = p.id === state.activePlaylistId;
      activeBtn.addEventListener('click', () => setActivePlaylist(p.id));
      actions.appendChild(activeBtn);

      actions.appendChild(iconBtn('\u270E', 'שינוי שם', () => renamePlaylist(p)));
      const delBtn = iconBtn('\u2715', 'מחיקה', () => removePlaylist(p));
      delBtn.classList.add('danger');
      delBtn.disabled = state.playlists.length <= 1;
      actions.appendChild(delBtn);

      li.appendChild(actions);
      el.playlistList.appendChild(li);
    });
  }

  async function renderPlaylistSongList() {
    const pid = adminView.editingPlaylistId;
    const songs = pid ? sortSongsForAdmin(await DB.getSongsByPlaylist(pid)) : [];
    el.songList.innerHTML = '';
    songs.forEach((s, i) => {
      const hidden = isSongHidden(s);
      const li = document.createElement('li');
      li.className = hidden ? 'song-row song-row-hidden' : 'song-row';

      const main = document.createElement('div');
      main.className = 'song-row-main';

      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      if (s.image) thumb.style.backgroundImage = `url(${objectUrl(s.image)})`;
      main.appendChild(thumb);

      const grow = document.createElement('div');
      grow.className = 'grow';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = s.title || 'ללא שם';
      grow.appendChild(name);
      if (hidden) {
        const badge = document.createElement('span');
        badge.className = 'hidden-pill';
        badge.textContent = 'מוסתר';
        grow.appendChild(badge);
      }
      main.appendChild(grow);

      const actions = document.createElement('div');
      actions.className = 'row-actions';
      const up = iconBtn('\u2191', 'הזזה למעלה', () => moveSong(songs, i, -1));
      up.disabled = i === 0;
      const down = iconBtn('\u2193', 'הזזה למטה', () => moveSong(songs, i, 1));
      down.disabled = i === songs.length - 1;
      const edit = iconBtn('\u270E', 'עריכה', () => openSongModal(s));
      const del = iconBtn('\u2715', 'מחיקה', () => removeSong(s));
      del.classList.add('danger');
      actions.append(up, down, edit, del);
      main.appendChild(actions);
      li.appendChild(main);

      const extra = document.createElement('div');
      extra.className = 'song-extra-actions';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-compact';
      copyBtn.textContent = 'העתקה לרשימה אחרת';
      copyBtn.addEventListener('click', () => openCopySongModal(s));
      extra.appendChild(copyBtn);

      const visBtn = document.createElement('button');
      visBtn.type = 'button';
      visBtn.className = 'btn btn-compact';
      visBtn.textContent = hidden ? 'הצג לילד' : 'הסתר מהילד';
      visBtn.addEventListener('click', () => toggleSongHidden(s));
      extra.appendChild(visBtn);

      li.appendChild(extra);
      el.songList.appendChild(li);
    });
  }

  function iconBtn(label, title, onClick) {
    const b = document.createElement('button');
    b.className = 'icon-btn';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', onClick);
    return b;
  }

  async function moveSong(songs, index, dir) {
    const target = index + dir;
    if (target < 0 || target >= songs.length) return;
    const a = songs[index], b = songs[target];
    if (!!a.hidden !== !!b.hidden) return;
    const ao = a.order ?? index, bo = b.order ?? target;
    a.order = bo; b.order = ao;
    await DB.saveSong(a);
    await DB.saveSong(b);
    await renderPlaylistSongList();
  }

  async function renamePlaylist(p) {
    const name = prompt('שם הרשימה:', p.name);
    if (name && name.trim()) {
      p.name = name.trim();
      await DB.savePlaylist(p);
      await refreshAdmin();
    }
  }
  async function addPlaylist() {
    const name = prompt('שם רשימה חדשה:', '');
    if (name && name.trim()) {
      await DB.savePlaylist({ id: DB.uid(), name: name.trim(), order: state.playlists.length });
      await refreshAdmin();
    }
  }
  async function removePlaylist(p) {
    if (state.playlists.length <= 1) return;
    if (!confirm(`למחוק את הרשימה „${p.name}” ואת כל השירים שבה?`)) return;
    await DB.deletePlaylist(p.id);
    if (state.activePlaylistId === p.id) {
      const remaining = await DB.getPlaylists();
      await DB.setSetting('activePlaylistId', remaining[0]?.id ?? null);
    }
    await refreshAdmin();
  }
  async function removeSong(s) {
    if (!confirm(`למחוק את „${s.title || 'השיר הזה'}”?`)) return;
    await DB.deleteSong(s.id);
    await renderPlaylistSongList();
  }

  let pendingCopySong = null;

  function openCopySongModal(song) {
    const targets = state.playlists.filter((p) => p.id !== song.playlistId);
    if (targets.length === 0) {
      toast('אין רשימה אחרת להעתקה');
      return;
    }
    pendingCopySong = song;
    el.copySongName.textContent = `שיר: ${song.title || 'ללא שם'}`;
    el.copySongTarget.innerHTML = '';
    for (const p of targets) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.name;
      el.copySongTarget.appendChild(o);
    }
    el.copySongModal.hidden = false;
  }

  async function confirmCopySong() {
    if (!pendingCopySong) return;
    const targetId = el.copySongTarget.value;
    if (!targetId) return;
    const song = pendingCopySong;
    const targetName = state.playlists.find((p) => p.id === targetId)?.name || 'הרשימה';
    const title = (song.title || '').trim();

    setButtonLoading(el.copySongConfirm, true, 'מעתיק...');
    el.copySongCancel.disabled = true;
    try {
      const targetSongs = await DB.getSongsByPlaylist(targetId);
      const sig = songTitleSig(targetId, title);
      if (sig && targetSongs.some((s) => songTitleSig(targetId, s.title) === sig)) {
        const ok = confirm(
          `שיר בשם «${title || 'ללא שם'}» כבר קיים ברשימה «${targetName}».\n\nלהעתיק בכל זאת?`
        );
        if (!ok) {
          toast(`השיר כבר קיים ברשימה «${targetName}»`);
          return;
        }
      }

      const copy = {
        id: DB.uid(),
        title: song.title || '',
        playlistId: targetId,
        order: targetSongs.length,
        sourceType: song.sourceType || 'LOCAL',
        hidden: !!song.hidden
      };
      if (song.spotifyUri) copy.spotifyUri = song.spotifyUri;
      if (song.image) copy.image = song.image;
      if (song.audio) copy.audio = song.audio;
      await DB.saveSong(copy);
      el.copySongModal.hidden = true;
      pendingCopySong = null;
      toast(`השיר הועתק ל«${targetName}»`, { success: true });
    } catch {
      toast('ההעתקה נכשלה');
    } finally {
      setButtonLoading(el.copySongConfirm, false);
      el.copySongCancel.disabled = false;
    }
  }

  async function toggleSongHidden(song) {
    const hide = !isSongHidden(song);
    song.hidden = hide;
    const all = await DB.getSongsByPlaylist(song.playlistId);
    const visible = all.filter((s) => !isSongHidden(s) && s.id !== song.id);
    const maxOrder = all.reduce((m, s) => Math.max(m, s.order ?? 0), -1);
    song.order = hide ? maxOrder + 1 : visible.length;
    await DB.saveSong(song);
    await renderPlaylistSongList();
    if (song.playlistId === state.activePlaylistId) {
      await loadActivePlaylistView();
    }
    toast(hide ? 'השיר הוסתר מהילד' : 'השיר יוצג לילד');
  }

  async function saveYoutubeApiKey() {
    setButtonLoading(el.youtubeApiSave, true, 'שומר...');
    try {
      const key = el.youtubeApiKey.value.trim();
      await DB.setSetting('youtubeApiKey', key);
      toast(key ? 'מפתח YouTube נשמר' : 'מפתח YouTube נמחק', { success: true });
    } catch {
      toast('שמירת המפתח נכשלה');
    } finally {
      setButtonLoading(el.youtubeApiSave, false);
    }
  }

  // ---- Song add/edit modal ----
  const draft = {
    id: null,
    imageBlob: null,
    audioBlob: null,
    keepImage: false,
    keepAudio: false,
    imagePreviewRevert: null
  };

  const YT_THUMBNAIL_QUALITIES = [
    { name: 'maxresdefault', minWidth: 200 },
    { name: 'sddefault', minWidth: 640 },
    { name: 'hqdefault', minWidth: 480 },
    { name: 'mqdefault', minWidth: 320 },
    { name: 'default', minWidth: 120 }
  ];

  function normalizeSearchText(text) {
    return (text || '').toLowerCase().replace(/[^\w\s\u0590-\u05ff]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function pickBestYouTubeResult(query, items) {
    const q = normalizeSearchText(query);
    const qWords = q.split(' ').filter(Boolean);
    let bestId = items[0]?.id?.videoId || null;
    let bestScore = -1;

    for (const item of items) {
      const title = normalizeSearchText(item.snippet?.title || '');
      let score = 0;
      if (title === q) score = 100;
      else if (title.includes(q) || q.includes(title)) score = 85;
      else if (qWords.length) {
        score = (qWords.filter((w) => title.includes(w)).length / qWords.length) * 70;
      }
      if (score > bestScore && item.id?.videoId) {
        bestScore = score;
        bestId = item.id.videoId;
      }
    }
    return bestId;
  }

  async function searchYouTubeVideoId(query, apiKey) {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', '5');
    url.searchParams.set('safeSearch', 'strict');
    url.searchParams.set('key', apiKey);

    let res;
    try {
      res = await fetch(url.toString());
    } catch {
      throw new Error('offline');
    }

    if (!res.ok) {
      if (res.status === 403 || res.status === 401) throw new Error('api_key');
      throw new Error('api');
    }

    const data = await res.json();
    if (!Array.isArray(data.items) || data.items.length === 0) throw new Error('no_results');
    const videoId = pickBestYouTubeResult(query, data.items);
    if (!videoId) throw new Error('no_results');
    return videoId;
  }

  function youtubeImportErrorMessage(err) {
    switch (err && err.message) {
      case 'no_title': return 'יש להזין שם שיר לפני ייבוא תמונה';
      case 'no_api_key': return 'יש להגדיר מפתח YouTube API באזור ההורים';
      case 'offline': return 'אין חיבור לאינטרנט';
      case 'no_results': return 'לא נמצאה תמונה מתאימה ביוטיוב';
      case 'api_key': return 'שגיאה במפתח YouTube API — בדקו באזור ההורים';
      case 'api': return 'שגיאה בחיפוש YouTube — נסו שוב';
      case 'thumbnail': return 'לא הצלחנו לייבא את התמונה. נסו שוב';
      default: return 'לא הצלחנו לייבא את התמונה. נסו שוב';
    }
  }

  function setYoutubeImportLoading(loading, text) {
    if (loading) {
      setButtonLoading(el.youtubeImport, true, text || 'מייבא תמונה...');
    } else {
      setButtonLoading(el.youtubeImport, false);
    }
    if (loading && text) {
      el.youtubeStatus.hidden = false;
      el.youtubeStatusText.textContent = text;
      el.youtubeSpinner.hidden = false;
    } else {
      el.youtubeStatus.hidden = true;
      el.youtubeSpinner.hidden = true;
      el.youtubeStatusText.textContent = '';
    }
  }

  function readImageDimensionsFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('image'));
      };
      img.src = url;
    });
  }

  function blobFromImageElement(img) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('canvas'));
      }, 'image/jpeg', 0.92);
    });
  }

  function loadRemoteImageAsBlob(imageUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = async () => {
        try {
          const blob = await blobFromImageElement(img);
          resolve({ blob, width: img.naturalWidth, height: img.naturalHeight });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('load'));
      img.src = imageUrl;
    });
  }

  async function downloadImageAsBlob(imageUrl) {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error('http');
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) throw new Error('type');
    const dims = await readImageDimensionsFromBlob(blob);
    return { blob, width: dims.width, height: dims.height };
  }

  async function fetchYouTubeThumbnailBlob(videoId) {
    let lastError = null;
    for (const quality of YT_THUMBNAIL_QUALITIES) {
      const url = `https://i.ytimg.com/vi/${videoId}/${quality.name}.jpg`;
      try {
        let result;
        try {
          result = await downloadImageAsBlob(url);
        } catch {
          result = await loadRemoteImageAsBlob(url);
        }
        if (result.width >= quality.minWidth) {
          return { blob: result.blob, quality: quality.name };
        }
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error('thumbnail');
  }

  function snapshotImagePreview() {
    return {
      backgroundImage: el.imgPreview.style.backgroundImage,
      text: el.imgPreview.textContent
    };
  }

  function applyImagePreview(snapshot) {
    el.imgPreview.style.backgroundImage = snapshot.backgroundImage || '';
    el.imgPreview.textContent = snapshot.text || '';
  }

  function setImagePreviewBlob(blob) {
    const url = objectUrl(blob);
    el.imgPreview.style.backgroundImage = `url(${url})`;
    el.imgPreview.textContent = '';
  }

  function hideYoutubeRevert() {
    el.youtubeCancel.hidden = true;
    draft.imagePreviewRevert = null;
  }

  function openSongModal(song) {
    draft.id = song ? song.id : null;
    draft.imageBlob = null;
    draft.audioBlob = null;
    draft.keepImage = !!(song && song.image);
    draft.keepAudio = !!(song && song.audio);
    hideYoutubeRevert();
    setYoutubeImportLoading(false, '');

    el.songModalTitle.textContent = song ? 'עריכת שיר' : 'הוספת שיר';
    el.songTitle.value = song ? (song.title || '') : '';
    el.songPlaylist.value = song
      ? song.playlistId
      : (adminView.editingPlaylistId || state.activePlaylistId || '');
    const playlistField = el.songPlaylist.closest('.field');
    if (playlistField) playlistField.hidden = !!adminView.editingPlaylistId;
    el.audioName.textContent = draft.keepAudio ? 'הקובץ הקיים נשמר' : 'לא נבחר קובץ';
    el.youtubeImport.disabled = false;
    if (song && song.image) {
      setImagePreviewBlob(song.image);
    } else {
      applyImagePreview({ backgroundImage: '', text: 'בחירת תמונה' });
    }
    el.songModal.hidden = false;
  }

  function onImagePicked(file) {
    if (!file) return;
    hideYoutubeRevert();
    draft.imageBlob = file;
    draft.keepImage = false;
    setImagePreviewBlob(file);
  }

  async function importYoutubeThumbnail() {
    const title = el.songTitle.value.trim();
    if (!title) {
      toast('יש להזין שם שיר לפני ייבוא תמונה');
      return;
    }

    const apiKey = (await DB.getSetting('youtubeApiKey', '')) || '';
    if (!apiKey) {
      toast('יש להגדיר מפתח YouTube API באזור ההורים');
      return;
    }

    if (!navigator.onLine) {
      toast('אין חיבור לאינטרנט');
      return;
    }

    draft.imagePreviewRevert = snapshotImagePreview();
    const revertDraft = { imageBlob: draft.imageBlob, keepImage: draft.keepImage };
    setYoutubeImportLoading(true, 'מחפש תמונה ביוטיוב...');

    try {
      const videoId = await searchYouTubeVideoId(title, apiKey);
      setYoutubeImportLoading(true, 'מייבא תמונה...');
      const { blob } = await fetchYouTubeThumbnailBlob(videoId);
      draft.imageBlob = blob;
      draft.keepImage = false;
      setImagePreviewBlob(blob);
      el.youtubeCancel.hidden = false;
      setYoutubeImportLoading(false, '');
      toast('התמונה יובאה בהצלחה — לחצו «שמירה» לשמירה', { success: true });
    } catch (err) {
      if (draft.imagePreviewRevert) applyImagePreview(draft.imagePreviewRevert);
      draft.imageBlob = revertDraft.imageBlob;
      draft.keepImage = revertDraft.keepImage;
      hideYoutubeRevert();
      setYoutubeImportLoading(false, '');
      toast(youtubeImportErrorMessage(err));
    }
  }

  function cancelYoutubeThumbnail() {
    if (draft.imagePreviewRevert) applyImagePreview(draft.imagePreviewRevert);
    draft.imageBlob = null;
    draft.keepImage = !!draft.imagePreviewRevert?.backgroundImage;
    hideYoutubeRevert();
    toast('התמונה בוטלה');
  }
  function onAudioPicked(file) {
    if (!file) return;
    draft.audioBlob = file;
    draft.keepAudio = false;
    el.audioName.textContent = file.name;
    el.songTitle.value = titleFromFileName(file.name);
  }

  async function bulkImportSongs(files) {
    const playlistId = getAdminPlaylistId();
    if (!playlistId) {
      toast('יש לבחור רשימת השמעה');
      return;
    }
    const audioFiles = Array.from(files || []).filter((f) => {
      if (!f) return false;
      if (f.type.startsWith('audio/')) return true;
      return /\.(mp3|m4a|wav|ogg|aac|flac|webm|opus)$/i.test(f.name);
    });
    if (audioFiles.length === 0) {
      toast('לא נבחרו קבצי שמע');
      return;
    }

    setButtonLoading(el.bulkImportSongs, true, 'מייבא שירים...');
    const existing = await DB.getSongsByPlaylist(playlistId);
    let order = existing.length;
    let imported = 0;

    try {
      for (const file of audioFiles) {
        await DB.saveSong({
          id: DB.uid(),
          title: titleFromFileName(file.name),
          playlistId,
          order: order++,
          sourceType: 'LOCAL',
          audio: file
        });
        imported++;
      }
      await renderPlaylistSongList();
      toast(imported === 1 ? 'שיר אחד יובא' : `${imported} שירים יובאו`, { success: true });
    } catch {
      toast('ייבוא השירים נכשל');
    } finally {
      setButtonLoading(el.bulkImportSongs, false);
    }
  }

  async function saveSongDraft() {
    const playlistId = el.songPlaylist.value;
    if (!playlistId) { toast('יש לבחור רשימת השמעה'); return; }
    if (!draft.id && !draft.audioBlob) { toast('יש לבחור קובץ שמע'); return; }

    setButtonLoading(el.songSave, true, 'שומר...');
    try {
      let song;
      if (draft.id) {
        const all = await DB.getAllSongs();
        song = all.find((s) => s.id === draft.id);
      }
      if (!song) {
        const existing = await DB.getSongsByPlaylist(playlistId);
        song = { id: DB.uid(), order: existing.length, sourceType: 'LOCAL' };
      }
      song.title = el.songTitle.value.trim();
      song.playlistId = playlistId;
      if (draft.audioBlob) song.audio = draft.audioBlob;
      if (draft.imageBlob) song.image = draft.imageBlob;

      await DB.saveSong(song);
      el.songModal.hidden = true;
      toast('נשמר', { success: true });
      await renderPlaylistSongList();
    } catch {
      toast('השמירה נכשלה');
    } finally {
      setButtonLoading(el.songSave, false);
    }
  }

  // ---- Backup / share ----
  // Export format (one self-contained JSON file that can be sent to the other parent):
  //   { app, version, exportedAt, includesAudio, settings:{activePlaylistId, volumeCap, offlineMode},
  //     playlists:[...], songs:[{ id, title, playlistId, order, sourceType, spotifyUri, image, audio }] }
  async function exportData(includeAudio, btn) {
    const songsRaw = await DB.getAllSongs();

    // Warn about large full exports (audio dominates the size).
    if (includeAudio) {
      let audioBytes = 0;
      for (const s of songsRaw) if (s.audio) audioBytes += s.audio.size || 0;
      const mb = audioBytes / (1024 * 1024);
      if (mb > 75) {
        const ok = confirm(
          `קובץ הייצוא המלא גדול (~${Math.round(mb)} מ"ב) ועלול לקחת זמן ולהיכשל בשליחה.\n` +
          `אפשר לבחור במקום זאת "ייצוא מטא־דאטה בלבד" (קובץ קטן).\n\nלהמשיך בייצוא המלא?`
        );
        if (!ok) return;
      }
    }

    const otherBtn = includeAudio ? el.exportMeta : el.exportFull;
    setButtonLoading(btn, true, 'מייצא...');
    otherBtn.disabled = true;
    try {
      const playlists = (await DB.getPlaylists()).map((p) => ({ id: p.id, name: p.name, order: p.order ?? 0 }));
      const songs = [];
      for (const s of songsRaw) {
        songs.push({
          id: s.id,
          title: s.title || '',
          playlistId: s.playlistId,
          order: s.order ?? 0,
          sourceType: s.sourceType || 'LOCAL',
          spotifyUri: s.spotifyUri || null,
          hidden: !!s.hidden,
          image: s.image ? await blobToDataURL(s.image) : null,
          audio: includeAudio && s.audio ? await blobToDataURL(s.audio) : null
        });
      }
      const payload = {
        app: 'music-tiles',
        version: 2,
        exportedAt: new Date().toISOString(),
        includesAudio: !!includeAudio,
        settings: {
          activePlaylistId: await DB.getSetting('activePlaylistId', null),
          volumeCap: state.volumeCap,
          offlineMode: await DB.getSetting('offlineMode', true),
          youtubeApiKey: await DB.getSetting('youtubeApiKey', ''),
          showAdminButton: await DB.getSetting('showAdminButton', false),
          showPlayPauseButton: await DB.getSetting('showPlayPauseButton', true)
        },
        playlists,
        songs
      };

      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const kind = includeAudio ? 'full' : 'meta';
      a.download = `arhazei-muzika-${kind}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      toast(includeAudio ? 'הייצוא המלא נוצר' : 'ייצוא המטא־דאטה נוצר', { success: true });
    } catch {
      toast('הייצוא נכשל');
    } finally {
      setButtonLoading(btn, false);
      otherBtn.disabled = false;
    }
  }

  // Holds a validated import payload between picking the file and choosing merge/replace.
  let pendingImport = null;

  async function pickImportFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data || data.app !== 'music-tiles' || !Array.isArray(data.playlists) || !Array.isArray(data.songs)) {
        throw new Error('format');
      }
      pendingImport = data;
      const hasAudio = data.includesAudio || data.songs.some((s) => s.audio);
      el.importSummary.textContent =
        `נמצאו ${data.playlists.length} רשימות ו-${data.songs.length} שירים ` +
        (hasAudio ? '(כולל קבצי שמע).' : '(ללא קבצי שמע — השירים יתווספו אך לא ינוגנו עד שיתווסף קובץ שמע).');
      el.importModal.hidden = false;
    } catch (e) {
      toast(e.message === 'format' ? 'הקובץ אינו קובץ גיבוי תקין של היישום' : 'הייבוא נכשל: קובץ פגום');
    } finally {
      el.importFile.value = '';
    }
  }

  function toSongRecord(s, playlistId) {
    const rec = {
      id: s.id,
      title: s.title || '',
      playlistId,
      order: s.order ?? 0,
      sourceType: s.sourceType || 'LOCAL'
    };
    if (s.spotifyUri) rec.spotifyUri = s.spotifyUri;
    if (s.hidden) rec.hidden = true;
    return rec;
  }

  async function doReplace(data) {
    await DB.clearStore('songs');
    await DB.clearStore('playlists');
    for (const p of data.playlists) {
      await DB.savePlaylist({ id: p.id, name: p.name, order: p.order ?? 0 });
    }
    for (const s of data.songs) {
      const rec = toSongRecord(s, s.playlistId);
      if (s.image) rec.image = await dataURLToBlob(s.image);
      if (s.audio) rec.audio = await dataURLToBlob(s.audio);
      await DB.saveSong(rec);
    }
    if (data.settings) {
      if (data.settings.activePlaylistId) await DB.setSetting('activePlaylistId', data.settings.activePlaylistId);
      if (typeof data.settings.volumeCap === 'number') {
        state.volumeCap = data.settings.volumeCap;
        await DB.setSetting('volumeCap', data.settings.volumeCap);
      }
      if (typeof data.settings.offlineMode === 'boolean') await DB.setSetting('offlineMode', data.settings.offlineMode);
      if (typeof data.settings.youtubeApiKey === 'string') await DB.setSetting('youtubeApiKey', data.settings.youtubeApiKey);
      if (typeof data.settings.showAdminButton === 'boolean') await DB.setSetting('showAdminButton', data.settings.showAdminButton);
      if (typeof data.settings.showPlayPauseButton === 'boolean') {
        await DB.setSetting('showPlayPauseButton', data.settings.showPlayPauseButton);
      }
    }
  }

  async function doMerge(data) {
    const existingPlaylists = await DB.getPlaylists();
    const byId = new Map(existingPlaylists.map((p) => [p.id, p]));
    const byName = new Map(existingPlaylists.map((p) => [p.name.trim().toLowerCase(), p]));
    const idMap = new Map(); // imported playlist id -> local playlist id
    let order = existingPlaylists.length;

    for (const p of data.playlists) {
      if (byId.has(p.id)) {
        idMap.set(p.id, p.id);
      } else {
        const sameName = byName.get((p.name || '').trim().toLowerCase());
        if (sameName) {
          idMap.set(p.id, sameName.id);
        } else {
          await DB.savePlaylist({ id: p.id, name: p.name, order: order++ });
          idMap.set(p.id, p.id);
        }
      }
    }

    const allSongs = await DB.getAllSongs();
    const existingIds = new Set(allSongs.map((s) => s.id));
    // (playlistId|title) signature to skip obvious duplicate titles
    const titleSig = new Set(
      allSongs.filter((s) => (s.title || '').trim()).map((s) => s.playlistId + '|' + s.title.trim().toLowerCase())
    );
    // next order per playlist
    const maxOrder = {};
    for (const s of allSongs) maxOrder[s.playlistId] = Math.max(maxOrder[s.playlistId] ?? -1, s.order ?? 0);

    for (const s of data.songs) {
      const targetPid = idMap.get(s.playlistId) || s.playlistId;
      if (existingIds.has(s.id)) continue; // already have this exact song -> skip (dedupe)
      const sig = (s.title || '').trim() ? targetPid + '|' + s.title.trim().toLowerCase() : null;
      if (sig && titleSig.has(sig)) continue; // same title in same playlist -> skip duplicate

      const rec = toSongRecord(s, targetPid);
      rec.order = (maxOrder[targetPid] = (maxOrder[targetPid] ?? -1) + 1);
      if (s.image) rec.image = await dataURLToBlob(s.image);
      if (s.audio) rec.audio = await dataURLToBlob(s.audio);
      await DB.saveSong(rec);
      existingIds.add(s.id);
      if (sig) titleSig.add(sig);
    }

    // Keep current active playlist if it still exists; otherwise adopt the imported one.
    const current = await DB.getSetting('activePlaylistId', null);
    const stillExists = (await DB.getPlaylists()).some((p) => p.id === current);
    if (!stillExists && data.settings && data.settings.activePlaylistId) {
      await DB.setSetting('activePlaylistId', idMap.get(data.settings.activePlaylistId) || data.settings.activePlaylistId);
    }
  }

  async function runImport(mode, btn) {
    if (!pendingImport) return;
    const data = pendingImport;
    const otherBtn = mode === 'merge' ? el.importReplace : el.importMerge;
    const loadingText = mode === 'merge' ? 'ממזג...' : 'מייבא...';

    if (mode === 'replace') {
      if (!confirm('פעולה זו תמחק את כל השירים והרשימות הקיימים במכשיר זה ותחליף אותם בקובץ. להמשיך?')) {
        return;
      }
    }

    el.importModal.hidden = true;
    setButtonLoading(btn, true, loadingText);
    otherBtn.disabled = true;
    el.importCancel.disabled = true;
    try {
      if (mode === 'replace') {
        await doReplace(data);
        toast('הספרייה שוחזרה', { success: true });
      } else {
        await doMerge(data);
        toast('המיזוג הושלם', { success: true });
      }
      pendingImport = null;
      await refreshAdmin();
    } catch (err) {
      el.importModal.hidden = false;
      toast('הייבוא נכשל: ' + err.message);
    } finally {
      setButtonLoading(btn, false);
      otherBtn.disabled = false;
      el.importCancel.disabled = false;
    }
  }

  // ---- Back navigation (Android standalone / screen pinning) ----
  function isInstalledDisplayMode() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
      || navigator.standalone === true;
  }

  function handleBackAction() {
    if (!el.songModal.hidden) {
      dbg('handleBackAction: close song modal');
      el.songModal.hidden = true;
      return;
    }
    if (!el.copySongModal.hidden) {
      dbg('handleBackAction: close copy modal');
      el.copySongModal.hidden = true;
      pendingCopySong = null;
      return;
    }
    if (!el.importModal.hidden) {
      dbg('handleBackAction: close import modal');
      el.importModal.hidden = true;
      pendingImport = null;
      el.importFile.value = '';
      return;
    }
    if (!el.pinScreen.hidden) {
      dbg('handleBackAction: cancel pin');
      onPinKey('cancel');
      return;
    }
    if (!el.adminScreen.hidden) {
      if (!el.adminPlaylistView.hidden) {
        dbg('handleBackAction: admin playlist -> main');
        showAdminMainView();
        return;
      }
      dbg('handleBackAction: close admin');
      el.adminScreen.hidden = true;
      loadActivePlaylistView();
      return;
    }
    // On the child/songs screen: intentionally do nothing (stay on tiles).
    dbg('handleBackAction: songs screen -> no-op');
  }

  // Universal "Back trap" for installed/pinned PWAs.
  //
  // THE RULE (from Chromium's History Manipulation Intervention docs):
  //   * With a user activation, a document may create MANY unskippable
  //     same-document history entries — until a cross-document nav or a
  //     back/forward occurs.
  //   * But if a document adds ANY history entry WITHOUT a (currently honored)
  //     user activation, the skippable flag is set to `true` for ALL of that
  //     document's same-document entries at once. After a back/forward, prior
  //     activations are no longer honored for creating new entries.
  //
  // WHY the previous attempts failed:
  //   - A single gesture-less sentinel at load was skipped -> Back left the doc.
  //   - The 100-entry buffer was actually fine, BUT we also did pushState inside
  //     the popstate handler. After Back #1 the gesture is no longer honored, so
  //     that one gesture-less pushState flipped the ENTIRE buffer to skippable —
  //     Back #2 then found everything skippable and exited. (Back #1 stayed,
  //     Back #2 escaped — exactly the reported symptom.)
  //
  // THE FIX:
  //   - Seed a deep buffer of unskippable entries INSIDE a real user gesture
  //     (the child's first tile tap). These survive repeated Backs.
  //   - NEVER pushState again without a fresh gesture (no popstate replacement),
  //     so the buffer is never poisoned. Each Back consumes one entry and fires
  //     popstate; the rest stay unskippable.
  //   - Re-seed/top-up only inside subsequent user-gesture handlers.
  //   - Sentinels use pushState(state, '') (empty url) -> same document, no
  //     scope/start_url drift.
  //
  // Belt-and-suspenders: the service worker serves the shell cache-first and
  // init() restores the songs screen, so even if the buffer is ever exhausted
  // (after a very long Back streak) a relaunch recovers instantly, never stuck.
  const KIOSK_STATE = { kiosk: true };
  const SENTINEL_BUFFER_SIZE = 100;

  // Top the buffer up to full. MUST run inside a user-gesture call stack so the
  // pushed entries are unskippable. Pushing here is the ONLY place we pushState.
  // The individual pushes are summarized into a single log row (with the actual
  // history growth, which proves how many entries Chrome accepted).
  function seedSentinelBuffer() {
    if (bufferedSentinels >= SENTINEL_BUFFER_SIZE) return;
    const before = history.length;
    const act = activationFlags();
    let pushed = 0;
    suppressHistoryLog = true;
    while (bufferedSentinels < SENTINEL_BUFFER_SIZE) {
      try {
        history.pushState(KIOSK_STATE, ''); // empty url -> same-document entry
      } catch (e) {
        suppressHistoryLog = false;
        dbg('seed pushState FAILED', e && e.message);
        break;
      }
      bufferedSentinels++;
      totalSentinelsSeeded++;
      pushed++;
    }
    suppressHistoryLog = false;
    dbg('seed-burst pushState', {
      ua_at_call: act,
      pushed,
      historyGrew: history.length - before,
      buf: bufferedSentinels,
      totalSeeded: totalSentinelsSeeded
    });
  }

  function installBackTrap() {
    if (backTrapInstalled) return;
    backTrapInstalled = true;

    dbg('installBackTrap', {
      displayMode: isInstalledDisplayMode() ? 'installed' : 'browser',
      bufferSize: SENTINEL_BUFFER_SIZE
    });

    // Keep the current entry (replaceState does NOT add an entry). Logged by the
    // history wrapper automatically.
    try { history.replaceState(KIOSK_STATE, ''); } catch (e) { dbg('replaceState FAILED', e && e.message); }

    window.addEventListener('popstate', () => {
      backAbsorbedCount++;
      if (bufferedSentinels > 0) bufferedSentinels--;
      dbg('back-absorbed (trap)', { backAbsorbedCount, buf: bufferedSentinels });
      // Useful in-app back (close modal / leave admin). No-op on songs.
      // IMPORTANT: do NOT pushState here — a gesture-less push would mark the
      // whole sentinel buffer skippable and let the next Back escape.
      handleBackAction();
    });

    // Seed / top up the buffer on every real user gesture.
    ['pointerdown', 'touchstart', 'mousedown', 'keydown'].forEach((type) => {
      window.addEventListener(type, seedSentinelBuffer, { capture: true, passive: true });
    });

    // bfcache restore: history may have been reset — require a fresh re-seed.
    window.addEventListener('pageshow', (e) => { if (e.persisted) bufferedSentinels = 0; });
  }

  // ---- Events ----
  function bindEvents() {
    bindAdminEntry();

    el.btnPlayPause.addEventListener('click', togglePlayPause);

    audio.addEventListener('play', syncPlaybackState);
    audio.addEventListener('pause', () => {
      if (switchingTrack) return;
      syncPlaybackState();
    });
    audio.addEventListener('ended', () => {
      state.isPlaying = false;
      updatePlayingIndicator();
    });

    // PIN pad
    el.pinDots.parentElement.querySelectorAll('.pin-pad button').forEach((b) => {
      b.addEventListener('click', () => onPinKey(b.dataset.key));
    });

    // Admin
    el.adminDone.addEventListener('click', async () => {
      showAdminMainView();
      el.adminScreen.hidden = true;
      await loadActivePlaylistView();
      await applyChildDisplaySettings();
    });
    el.playlistEditBack.addEventListener('click', () => {
      showAdminMainView();
      renderPlaylistList();
    });
    el.showAdminButton.addEventListener('change', saveShowAdminButton);
    el.showPlayPauseButton.addEventListener('change', saveShowPlayPauseButton);
    el.volumeCap.addEventListener('input', () => {
      el.volumeCapLabel.textContent = el.volumeCap.value + '%';
    });
    el.volumeCap.addEventListener('change', async () => {
      state.volumeCap = Number(el.volumeCap.value) / 100;
      audio.volume = state.volumeCap;
      await DB.setSetting('volumeCap', state.volumeCap);
    });
    el.addPlaylist.addEventListener('click', addPlaylist);
    el.addSong.addEventListener('click', () => openSongModal(null));
    el.bulkImportSongs.addEventListener('click', () => el.bulkAudio.click());
    el.bulkAudio.addEventListener('change', (e) => {
      bulkImportSongs(e.target.files);
      e.target.value = '';
    });
    el.changePin.addEventListener('click', openChangePin);
    if (el.copyDiagnostics) el.copyDiagnostics.addEventListener('click', copyDiagnostics);
    if (el.exportDebug) el.exportDebug.addEventListener('click', exportDebugLog);
    el.youtubeApiSave.addEventListener('click', saveYoutubeApiKey);
    el.exportFull.addEventListener('click', () => exportData(true, el.exportFull));
    el.exportMeta.addEventListener('click', () => exportData(false, el.exportMeta));
    el.importData.addEventListener('click', () => el.importFile.click());
    el.importFile.addEventListener('change', (e) => pickImportFile(e.target.files[0]));
    el.importMerge.addEventListener('click', () => runImport('merge', el.importMerge));
    el.importReplace.addEventListener('click', () => runImport('replace', el.importReplace));
    el.importCancel.addEventListener('click', () => { el.importModal.hidden = true; pendingImport = null; el.importFile.value = ''; });

    // Song modal
    el.imgPreview.addEventListener('click', () => el.songImage.click());
    el.songImage.addEventListener('change', (e) => onImagePicked(e.target.files[0]));
    el.pickAudio.addEventListener('click', () => el.songAudio.click());
    el.songAudio.addEventListener('change', (e) => onAudioPicked(e.target.files[0]));
    el.songCancel.addEventListener('click', () => (el.songModal.hidden = true));
    el.songSave.addEventListener('click', saveSongDraft);
    el.youtubeImport.addEventListener('click', importYoutubeThumbnail);
    el.youtubeCancel.addEventListener('click', cancelYoutubeThumbnail);

    el.copySongCancel.addEventListener('click', () => {
      el.copySongModal.hidden = true;
      pendingCopySong = null;
    });
    el.copySongConfirm.addEventListener('click', confirmCopySong);

    // Keep audio playing within the cap if volume is changed programmatically
    audio.addEventListener('volumechange', enforceVolumeCap);

    // During playback, re-apply cap (browsers cannot block hardware volume buttons)
    setInterval(() => {
      if (!audio.paused && !audio.ended) enforceVolumeCap();
    }, 500);
  }

  function enforceVolumeCap() {
    if (audio.volume > state.volumeCap + 0.001) audio.volume = state.volumeCap;
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  // Install the Back trap FIRST, synchronously, before any async init/await,
  // so the songs screen is protected from the very first paint.
  installBackTrap();

  init();
})();
