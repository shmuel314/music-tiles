/* Music Tiles — 100% offline, local-files child music player. */
(() => {
  'use strict';

  const DEFAULT_PIN = '1234';
  const TAP_DEBOUNCE_MS = 700;

  // ---- App state ----
  const state = {
    playlists: [],
    activePlaylistId: null,
    songs: [],          // songs in the active playlist (child view)
    volumeCap: 0.8,
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
    controls: $('controls'),
    btnPrev: $('btn-prev'),
    btnNext: $('btn-next'),
    btnPlayPause: $('btn-playpause'),
    iconPlay: $('icon-play'),
    iconPause: $('icon-pause'),
    adminTrigger: $('admin-trigger'),
    pinScreen: $('pin-screen'),
    pinTitle: $('pin-title'),
    pinDots: $('pin-dots'),
    pinError: $('pin-error'),
    adminScreen: $('admin-screen'),
    adminDone: $('admin-done'),
    activePlaylistSelect: $('active-playlist-select'),
    volumeCap: $('volume-cap'),
    volumeCapLabel: $('volume-cap-label'),
    addPlaylist: $('add-playlist'),
    playlistList: $('playlist-list'),
    songsTitle: $('songs-title'),
    addSong: $('add-song'),
    songList: $('song-list'),
    changePin: $('change-pin'),
    exportData: $('export-data'),
    importData: $('import-data'),
    importFile: $('import-file'),
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
    toast: $('toast')
  };

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
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.toast.hidden = true), 2200);
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

  // ---- Boot ----
  async function init() {
    await DB.open();
    await ensureSeedData();
    state.volumeCap = Number(await DB.getSetting('volumeCap', 0.8));
    audio.volume = state.volumeCap;
    await loadActivePlaylistView();
    bindEvents();
    registerServiceWorker();
  }

  async function ensureSeedData() {
    const playlists = await DB.getPlaylists();
    if (playlists.length === 0) {
      const id = DB.uid();
      await DB.savePlaylist({ id, name: 'My Songs', order: 0 });
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
    state.songs = state.activePlaylistId
      ? await DB.getSongsByPlaylist(state.activePlaylistId)
      : [];
    renderTiles();
  }

  // ---- Child screen rendering ----
  function renderTiles() {
    el.tiles.innerHTML = '';
    const count = state.songs.length;

    el.tiles.classList.toggle('one', count === 1);
    el.tiles.classList.toggle('few', count > 1 && count <= 4);

    if (count === 0) {
      el.emptyHint.hidden = false;
      el.controls.hidden = true;
      return;
    }
    el.emptyHint.hidden = true;
    el.controls.hidden = false;

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
      title.textContent = song.title || '';
      tile.appendChild(title);

      tile.addEventListener('click', () => onTileTap(song.id));
      el.tiles.appendChild(tile);
    }
  }

  function updatePlayingIndicator() {
    el.tiles.querySelectorAll('.tile').forEach((t) => {
      t.classList.toggle('playing', t.dataset.id === state.currentSongId && state.isPlaying);
    });
    el.iconPlay.hidden = state.isPlaying;
    el.iconPause.hidden = !state.isPlaying;
  }

  // ---- Playback (with debounce + volume cap) ----
  function onTileTap(songId) {
    const now = Date.now();
    if (now - state.lastTapAt < TAP_DEBOUNCE_MS) return; // ignore rapid/double taps
    state.lastTapAt = now;

    if (songId === state.currentSongId && state.isPlaying) return; // already playing this one
    playSong(songId);
  }

  function playSong(songId) {
    const song = state.songs.find((s) => s.id === songId);
    if (!song || !song.audio) return;
    revokeAudioUrl();
    audio.src = objectUrl(song.audio);
    audio.volume = state.volumeCap;
    state.currentSongId = songId;
    audio.play().then(() => {
      state.isPlaying = true;
      updatePlayingIndicator();
    }).catch(() => {
      toast('Could not play this song');
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

  function currentIndex() {
    return state.songs.findIndex((s) => s.id === state.currentSongId);
  }
  function playByOffset(offset) {
    if (state.songs.length === 0) return;
    let idx = currentIndex();
    if (idx === -1) idx = 0;
    else idx = (idx + offset + state.songs.length) % state.songs.length;
    playSong(state.songs[idx].id);
  }

  function togglePlayPause() {
    const now = Date.now();
    if (now - state.lastTapAt < TAP_DEBOUNCE_MS) return;
    state.lastTapAt = now;
    if (!state.currentSongId && state.songs.length) {
      playSong(state.songs[0].id);
      return;
    }
    if (state.isPlaying) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  }

  // ---- Hidden admin trigger (long-press top-left ~3s) ----
  function bindAdminTrigger() {
    let timer = null;
    const start = (e) => {
      e.preventDefault();
      timer = setTimeout(openPinScreen, 3000);
    };
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    el.adminTrigger.addEventListener('pointerdown', start);
    el.adminTrigger.addEventListener('pointerup', cancel);
    el.adminTrigger.addEventListener('pointerleave', cancel);
    el.adminTrigger.addEventListener('pointercancel', cancel);
  }

  // ---- PIN screen ----
  const pin = { entered: '', mode: 'verify', firstEntry: '' };

  function openPinScreen() {
    pin.entered = '';
    pin.mode = 'verify';
    el.pinTitle.textContent = 'Enter PIN';
    el.pinError.hidden = true;
    renderPinDots();
    el.pinScreen.hidden = false;
  }
  function openChangePin() {
    pin.entered = '';
    pin.mode = 'set-new';
    pin.firstEntry = '';
    el.pinTitle.textContent = 'New PIN';
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
      el.pinTitle.textContent = 'Confirm PIN';
      renderPinDots();
    } else if (pin.mode === 'set-confirm') {
      if (pin.entered === pin.firstEntry) {
        await DB.setSetting('pin', pin.entered);
        el.pinScreen.hidden = true;
        el.adminScreen.hidden = false;
        toast('PIN changed');
      } else {
        el.pinError.textContent = 'PINs did not match';
        el.pinError.hidden = false;
        pin.mode = 'set-new';
        pin.firstEntry = '';
        pin.entered = '';
        el.pinTitle.textContent = 'New PIN';
        renderPinDots();
      }
    }
  }

  // ---- Admin ----
  async function openAdmin() {
    if (state.isPlaying) audio.pause();
    await refreshAdmin();
    el.adminScreen.hidden = false;
  }
  async function refreshAdmin() {
    state.playlists = await DB.getPlaylists();
    state.activePlaylistId = await DB.getSetting('activePlaylistId', state.playlists[0]?.id ?? null);

    // Active playlist select
    el.activePlaylistSelect.innerHTML = '';
    el.songPlaylist.innerHTML = '';
    for (const p of state.playlists) {
      const o = document.createElement('option');
      o.value = p.id; o.textContent = p.name;
      el.activePlaylistSelect.appendChild(o);
      el.songPlaylist.appendChild(o.cloneNode(true));
    }
    el.activePlaylistSelect.value = state.activePlaylistId || '';

    // Volume
    el.volumeCap.value = Math.round(state.volumeCap * 100);
    el.volumeCapLabel.textContent = el.volumeCap.value + '%';

    renderPlaylistList();
    renderSongList();
  }

  function renderPlaylistList() {
    el.playlistList.innerHTML = '';
    state.playlists.forEach((p, i) => {
      const li = document.createElement('li');
      const grow = document.createElement('div');
      grow.className = 'grow';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = p.name;
      grow.appendChild(name);
      if (p.id === state.activePlaylistId) {
        const pill = document.createElement('span');
        pill.className = 'active-pill';
        pill.textContent = 'ACTIVE';
        grow.appendChild(pill);
      }
      li.appendChild(grow);

      const actions = document.createElement('div');
      actions.className = 'row-actions';
      actions.appendChild(iconBtn('\u270E', 'Rename', () => renamePlaylist(p)));
      const delBtn = iconBtn('\u2715', 'Delete', () => removePlaylist(p));
      delBtn.classList.add('danger');
      delBtn.disabled = state.playlists.length <= 1;
      actions.appendChild(delBtn);
      li.appendChild(actions);
      el.playlistList.appendChild(li);
    });
  }

  async function renderSongList() {
    const pid = el.activePlaylistSelect.value;
    const activeName = state.playlists.find((p) => p.id === pid)?.name || '';
    el.songsTitle.textContent = 'Songs in "' + activeName + '"';
    const songs = pid ? await DB.getSongsByPlaylist(pid) : [];
    el.songList.innerHTML = '';
    songs.forEach((s, i) => {
      const li = document.createElement('li');
      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      if (s.image) thumb.style.backgroundImage = `url(${objectUrl(s.image)})`;
      li.appendChild(thumb);

      const grow = document.createElement('div');
      grow.className = 'grow';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = s.title || 'Untitled';
      grow.appendChild(name);
      li.appendChild(grow);

      const actions = document.createElement('div');
      actions.className = 'row-actions';
      const up = iconBtn('\u2191', 'Move up', () => moveSong(songs, i, -1));
      up.disabled = i === 0;
      const down = iconBtn('\u2193', 'Move down', () => moveSong(songs, i, 1));
      down.disabled = i === songs.length - 1;
      const edit = iconBtn('\u270E', 'Edit', () => openSongModal(s));
      const del = iconBtn('\u2715', 'Delete', () => removeSong(s));
      del.classList.add('danger');
      actions.append(up, down, edit, del);
      li.appendChild(actions);
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
    const ao = a.order ?? index, bo = b.order ?? target;
    a.order = bo; b.order = ao;
    await DB.saveSong(a);
    await DB.saveSong(b);
    await renderSongList();
  }

  async function renamePlaylist(p) {
    const name = prompt('Playlist name:', p.name);
    if (name && name.trim()) {
      p.name = name.trim();
      await DB.savePlaylist(p);
      await refreshAdmin();
    }
  }
  async function addPlaylist() {
    const name = prompt('New playlist name:', '');
    if (name && name.trim()) {
      await DB.savePlaylist({ id: DB.uid(), name: name.trim(), order: state.playlists.length });
      await refreshAdmin();
    }
  }
  async function removePlaylist(p) {
    if (state.playlists.length <= 1) return;
    if (!confirm(`Delete playlist "${p.name}" and all its songs?`)) return;
    await DB.deletePlaylist(p.id);
    if (state.activePlaylistId === p.id) {
      const remaining = await DB.getPlaylists();
      await DB.setSetting('activePlaylistId', remaining[0]?.id ?? null);
    }
    await refreshAdmin();
  }
  async function removeSong(s) {
    if (!confirm(`Delete "${s.title || 'this song'}"?`)) return;
    await DB.deleteSong(s.id);
    await renderSongList();
  }

  // ---- Song add/edit modal ----
  const draft = { id: null, imageBlob: null, audioBlob: null, keepImage: false, keepAudio: false };

  function openSongModal(song) {
    draft.id = song ? song.id : null;
    draft.imageBlob = null;
    draft.audioBlob = null;
    draft.keepImage = !!(song && song.image);
    draft.keepAudio = !!(song && song.audio);

    el.songModalTitle.textContent = song ? 'Edit song' : 'Add song';
    el.songTitle.value = song ? (song.title || '') : '';
    el.songPlaylist.value = song ? song.playlistId : el.activePlaylistSelect.value;
    el.audioName.textContent = draft.keepAudio ? 'Current audio kept' : 'No file selected';
    el.imgPreview.style.backgroundImage = song && song.image ? `url(${objectUrl(song.image)})` : '';
    el.imgPreview.textContent = song && song.image ? '' : 'Tap to choose a picture';
    el.songModal.hidden = false;
  }

  function onImagePicked(file) {
    if (!file) return;
    draft.imageBlob = file;
    draft.keepImage = false;
    const url = objectUrl(file);
    el.imgPreview.style.backgroundImage = `url(${url})`;
    el.imgPreview.textContent = '';
  }
  function onAudioPicked(file) {
    if (!file) return;
    draft.audioBlob = file;
    draft.keepAudio = false;
    el.audioName.textContent = file.name;
  }

  async function saveSongDraft() {
    const playlistId = el.songPlaylist.value;
    if (!playlistId) { toast('Choose a playlist'); return; }
    if (!draft.id && !draft.audioBlob) { toast('Choose an audio file'); return; }

    let song;
    if (draft.id) {
      const all = await DB.getAllSongs();
      song = all.find((s) => s.id === draft.id);
    }
    if (!song) {
      const existing = await DB.getSongsByPlaylist(playlistId);
      song = { id: DB.uid(), order: existing.length };
    }
    song.title = el.songTitle.value.trim();
    song.playlistId = playlistId;
    if (draft.audioBlob) song.audio = draft.audioBlob;
    if (draft.imageBlob) song.image = draft.imageBlob;

    await DB.saveSong(song);
    el.songModal.hidden = true;
    toast('Saved');
    await renderSongList();
  }

  // ---- Backup / restore ----
  async function exportData() {
    toast('Preparing backup...');
    const playlists = await DB.getPlaylists();
    const songsRaw = await DB.getAllSongs();
    const songs = [];
    for (const s of songsRaw) {
      songs.push({
        id: s.id,
        title: s.title || '',
        playlistId: s.playlistId,
        order: s.order ?? 0,
        image: s.image ? await blobToDataURL(s.image) : null,
        audio: s.audio ? await blobToDataURL(s.audio) : null
      });
    }
    const payload = {
      app: 'music-tiles',
      version: 1,
      exportedAt: new Date().toISOString(),
      activePlaylistId: await DB.getSetting('activePlaylistId', null),
      volumeCap: state.volumeCap,
      playlists,
      songs
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `music-tiles-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function importData(file) {
    if (!file) return;
    if (!confirm('Importing will REPLACE all current songs and playlists with the backup. Continue?')) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.app !== 'music-tiles') throw new Error('Not a Music Tiles backup');

      await DB.clearStore('songs');
      await DB.clearStore('playlists');
      for (const p of data.playlists || []) await DB.savePlaylist(p);
      for (const s of data.songs || []) {
        await DB.saveSong({
          id: s.id,
          title: s.title || '',
          playlistId: s.playlistId,
          order: s.order ?? 0,
          image: s.image ? await dataURLToBlob(s.image) : undefined,
          audio: s.audio ? await dataURLToBlob(s.audio) : undefined
        });
      }
      if (data.activePlaylistId) await DB.setSetting('activePlaylistId', data.activePlaylistId);
      if (typeof data.volumeCap === 'number') {
        state.volumeCap = data.volumeCap;
        await DB.setSetting('volumeCap', data.volumeCap);
      }
      toast('Backup restored');
      await refreshAdmin();
    } catch (err) {
      toast('Import failed: ' + err.message);
    }
  }

  // ---- Events ----
  function bindEvents() {
    bindAdminTrigger();

    el.btnPlayPause.addEventListener('click', togglePlayPause);
    el.btnNext.addEventListener('click', () => playByOffset(1));
    el.btnPrev.addEventListener('click', () => playByOffset(-1));

    audio.addEventListener('play', () => { state.isPlaying = true; updatePlayingIndicator(); });
    audio.addEventListener('pause', () => { state.isPlaying = false; updatePlayingIndicator(); });
    audio.addEventListener('ended', () => { state.isPlaying = false; updatePlayingIndicator(); });

    // PIN pad
    el.pinDots.parentElement.querySelectorAll('.pin-pad button').forEach((b) => {
      b.addEventListener('click', () => onPinKey(b.dataset.key));
    });

    // Admin
    el.adminDone.addEventListener('click', async () => {
      el.adminScreen.hidden = true;
      await loadActivePlaylistView();
    });
    el.activePlaylistSelect.addEventListener('change', async () => {
      await DB.setSetting('activePlaylistId', el.activePlaylistSelect.value);
      state.activePlaylistId = el.activePlaylistSelect.value;
      renderPlaylistList();
      await renderSongList();
    });
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
    el.changePin.addEventListener('click', openChangePin);
    el.exportData.addEventListener('click', exportData);
    el.importData.addEventListener('click', () => el.importFile.click());
    el.importFile.addEventListener('change', (e) => importData(e.target.files[0]));

    // Song modal
    el.imgPreview.addEventListener('click', () => el.songImage.click());
    el.songImage.addEventListener('change', (e) => onImagePicked(e.target.files[0]));
    el.pickAudio.addEventListener('click', () => el.songAudio.click());
    el.songAudio.addEventListener('change', (e) => onAudioPicked(e.target.files[0]));
    el.songCancel.addEventListener('click', () => (el.songModal.hidden = true));
    el.songSave.addEventListener('click', saveSongDraft);

    // Keep audio playing within the cap if some other code changes volume
    audio.addEventListener('volumechange', () => {
      if (audio.volume > state.volumeCap + 0.001) audio.volume = state.volumeCap;
    });
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  init();
})();
