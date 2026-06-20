// Tiny IndexedDB wrapper for Music Tiles.
// Stores: playlists, songs (with image + audio blobs), settings (key/value).
const DB = (() => {
  const DB_NAME = 'music-tiles';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('playlists')) {
          db.createObjectStore('playlists', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('songs')) {
          const s = db.createObjectStore('songs', { keyPath: 'id' });
          s.createIndex('playlistId', 'playlistId', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode) {
    return open().then((db) => db.transaction(store, mode).objectStore(store));
  }

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function getAll(store) {
    return tx(store, 'readonly').then((os) => reqToPromise(os.getAll()));
  }
  function get(store, key) {
    return tx(store, 'readonly').then((os) => reqToPromise(os.get(key)));
  }
  function put(store, value) {
    return tx(store, 'readwrite').then((os) => reqToPromise(os.put(value)));
  }
  function del(store, key) {
    return tx(store, 'readwrite').then((os) => reqToPromise(os.delete(key)));
  }
  function clear(store) {
    return tx(store, 'readwrite').then((os) => reqToPromise(os.clear()));
  }

  // ---- Settings helpers ----
  async function getSetting(key, fallback) {
    const row = await get('settings', key);
    return row ? row.value : fallback;
  }
  function setSetting(key, value) {
    return put('settings', { key, value });
  }

  // ---- Playlists ----
  function getPlaylists() {
    return getAll('playlists').then((rows) =>
      rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    );
  }
  function savePlaylist(p) {
    return put('playlists', p);
  }
  async function deletePlaylist(id) {
    const songs = await getSongsByPlaylist(id);
    await Promise.all(songs.map((s) => del('songs', s.id)));
    return del('playlists', id);
  }

  // ---- Songs ----
  function getAllSongs() {
    return getAll('songs');
  }
  async function getSongsByPlaylist(playlistId) {
    const all = await getAll('songs');
    return all
      .filter((s) => s.playlistId === playlistId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }
  function saveSong(song) {
    return put('songs', song);
  }
  function deleteSong(id) {
    return del('songs', id);
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  return {
    open,
    getSetting,
    setSetting,
    getPlaylists,
    savePlaylist,
    deletePlaylist,
    getAllSongs,
    getSongsByPlaylist,
    saveSong,
    deleteSong,
    clearStore: clear,
    uid
  };
})();
