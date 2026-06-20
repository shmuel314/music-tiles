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
    adminEntry: $('admin-entry'),
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
    bulkImportSongs: $('bulk-import-songs'),
    bulkAudio: $('bulk-audio'),
    songList: $('song-list'),
    changePin: $('change-pin'),
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
    youtubeUrl: $('youtube-url'),
    youtubeImport: $('youtube-import'),
    youtubePreviewActions: $('youtube-preview-actions'),
    youtubeAccept: $('youtube-accept'),
    youtubeCancel: $('youtube-cancel'),
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

  function titleFromFileName(name) {
    return name.replace(/\.[^.]+$/, '').trim();
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
    if (!state.currentSongId) return;
    if (!audio.paused) {
      audio.pause();
    } else {
      audio.play().catch(() => {});
    }
  }

  // ---- Admin entry (visible button, PIN required) ----
  function bindAdminEntry() {
    el.adminEntry.addEventListener('click', openPinScreen);
  }

  // ---- PIN screen ----
  const pin = { entered: '', mode: 'verify', firstEntry: '' };

  function openPinScreen() {
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
        toast('הקוד שונה');
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
        pill.textContent = 'פעילה';
        grow.appendChild(pill);
      }
      li.appendChild(grow);

      const actions = document.createElement('div');
      actions.className = 'row-actions';
      actions.appendChild(iconBtn('\u270E', 'שינוי שם', () => renamePlaylist(p)));
      const delBtn = iconBtn('\u2715', 'מחיקה', () => removePlaylist(p));
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
    el.songsTitle.textContent = 'שירים ב„' + activeName + '”';
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
      name.textContent = s.title || 'ללא שם';
      grow.appendChild(name);
      li.appendChild(grow);

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
    await renderSongList();
  }

  // ---- Song add/edit modal ----
  const draft = {
    id: null,
    imageBlob: null,
    audioBlob: null,
    keepImage: false,
    keepAudio: false,
    pendingYtBlob: null,
    imagePreviewRevert: null
  };

  const YT_THUMBNAIL_QUALITIES = [
    { name: 'maxresdefault', minWidth: 200 },
    { name: 'sddefault', minWidth: 640 },
    { name: 'hqdefault', minWidth: 480 },
    { name: 'mqdefault', minWidth: 320 },
    { name: 'default', minWidth: 120 }
  ];

  function extractYouTubeVideoId(url) {
    const s = (url || '').trim();
    if (!s) return null;
    let m = s.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
    m = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
    m = s.match(/\/(?:embed|shorts|live|v)\/([a-zA-Z0-9_-]{11})/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
    return null;
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

  function hideYoutubePreviewActions() {
    el.youtubePreviewActions.hidden = true;
    draft.pendingYtBlob = null;
    draft.imagePreviewRevert = null;
  }

  function openSongModal(song) {
    draft.id = song ? song.id : null;
    draft.imageBlob = null;
    draft.audioBlob = null;
    draft.keepImage = !!(song && song.image);
    draft.keepAudio = !!(song && song.audio);
    hideYoutubePreviewActions();

    el.songModalTitle.textContent = song ? 'עריכת שיר' : 'הוספת שיר';
    el.songTitle.value = song ? (song.title || '') : '';
    el.songPlaylist.value = song ? song.playlistId : el.activePlaylistSelect.value;
    el.audioName.textContent = draft.keepAudio ? 'הקובץ הקיים נשמר' : 'לא נבחר קובץ';
    el.youtubeUrl.value = '';
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
    hideYoutubePreviewActions();
    draft.imageBlob = file;
    draft.keepImage = false;
    setImagePreviewBlob(file);
  }

  async function importYoutubeThumbnail() {
    const videoId = extractYouTubeVideoId(el.youtubeUrl.value);
    if (!videoId) {
      toast('קישור YouTube לא תקין');
      return;
    }

    draft.imagePreviewRevert = snapshotImagePreview();
    el.youtubeImport.disabled = true;
    toast('מייבא תמונה...');

    try {
      const { blob, quality } = await fetchYouTubeThumbnailBlob(videoId);
      draft.pendingYtBlob = blob;
      setImagePreviewBlob(blob);
      el.youtubePreviewActions.hidden = false;
      toast(`תמונה נטענה (${quality}) — לאשר?`);
    } catch {
      draft.pendingYtBlob = null;
      if (draft.imagePreviewRevert) applyImagePreview(draft.imagePreviewRevert);
      toast('לא ניתן לייבא תמונה מיוטיוב');
    } finally {
      el.youtubeImport.disabled = false;
    }
  }

  function acceptYoutubeThumbnail() {
    if (!draft.pendingYtBlob) return;
    draft.imageBlob = draft.pendingYtBlob;
    draft.keepImage = false;
    hideYoutubePreviewActions();
    toast('התמונה אושרה — לחצו «שמירה» לשמירה');
  }

  function cancelYoutubeThumbnail() {
    if (draft.imagePreviewRevert) applyImagePreview(draft.imagePreviewRevert);
    hideYoutubePreviewActions();
  }
  function onAudioPicked(file) {
    if (!file) return;
    draft.audioBlob = file;
    draft.keepAudio = false;
    el.audioName.textContent = file.name;
    el.songTitle.value = titleFromFileName(file.name);
  }

  async function bulkImportSongs(files) {
    const playlistId = el.activePlaylistSelect.value;
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

    toast(`מייבא ${audioFiles.length} שירים...`);
    const existing = await DB.getSongsByPlaylist(playlistId);
    let order = existing.length;
    let imported = 0;

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

    await renderSongList();
    toast(imported === 1 ? 'שיר אחד יובא' : `${imported} שירים יובאו`);
  }

  async function saveSongDraft() {
    const playlistId = el.songPlaylist.value;
    if (!playlistId) { toast('יש לבחור רשימת השמעה'); return; }
    if (!draft.id && !draft.audioBlob) { toast('יש לבחור קובץ שמע'); return; }

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
    toast('נשמר');
    await renderSongList();
  }

  // ---- Backup / share ----
  // Export format (one self-contained JSON file that can be sent to the other parent):
  //   { app, version, exportedAt, includesAudio, settings:{activePlaylistId, volumeCap, offlineMode},
  //     playlists:[...], songs:[{ id, title, playlistId, order, sourceType, spotifyUri, image, audio }] }
  async function exportData(includeAudio) {
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

    toast('מכין קובץ...');
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
        offlineMode: await DB.getSetting('offlineMode', true)
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
    toast(includeAudio ? 'הייצוא המלא נוצר' : 'ייצוא המטא־דאטה נוצר');
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

  async function runImport(mode) {
    if (!pendingImport) return;
    const data = pendingImport;
    el.importModal.hidden = true;
    try {
      if (mode === 'replace') {
        if (!confirm('פעולה זו תמחק את כל השירים והרשימות הקיימים במכשיר זה ותחליף אותם בקובץ. להמשיך?')) {
          el.importModal.hidden = false;
          return;
        }
        toast('מייבא...');
        await doReplace(data);
        toast('הספרייה שוחזרה');
      } else {
        toast('ממזג...');
        await doMerge(data);
        toast('המיזוג הושלם');
      }
      pendingImport = null;
      await refreshAdmin();
    } catch (err) {
      toast('הייבוא נכשל: ' + err.message);
    }
  }

  // ---- Events ----
  function bindEvents() {
    bindAdminEntry();

    el.btnPlayPause.addEventListener('click', togglePlayPause);
    el.btnNext.addEventListener('click', () => playByOffset(1));
    el.btnPrev.addEventListener('click', () => playByOffset(-1));

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
    el.bulkImportSongs.addEventListener('click', () => el.bulkAudio.click());
    el.bulkAudio.addEventListener('change', (e) => {
      bulkImportSongs(e.target.files);
      e.target.value = '';
    });
    el.changePin.addEventListener('click', openChangePin);
    el.exportFull.addEventListener('click', () => exportData(true));
    el.exportMeta.addEventListener('click', () => exportData(false));
    el.importData.addEventListener('click', () => el.importFile.click());
    el.importFile.addEventListener('change', (e) => pickImportFile(e.target.files[0]));
    el.importMerge.addEventListener('click', () => runImport('merge'));
    el.importReplace.addEventListener('click', () => runImport('replace'));
    el.importCancel.addEventListener('click', () => { el.importModal.hidden = true; pendingImport = null; el.importFile.value = ''; });

    // Song modal
    el.imgPreview.addEventListener('click', () => el.songImage.click());
    el.songImage.addEventListener('change', (e) => onImagePicked(e.target.files[0]));
    el.pickAudio.addEventListener('click', () => el.songAudio.click());
    el.songAudio.addEventListener('change', (e) => onAudioPicked(e.target.files[0]));
    el.songCancel.addEventListener('click', () => (el.songModal.hidden = true));
    el.songSave.addEventListener('click', saveSongDraft);
    el.youtubeImport.addEventListener('click', importYoutubeThumbnail);
    el.youtubeAccept.addEventListener('click', acceptYoutubeThumbnail);
    el.youtubeCancel.addEventListener('click', cancelYoutubeThumbnail);

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

  init();
})();
