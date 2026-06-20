# Music Tiles — a simple, safe, 100% offline music player for a child

A full-screen grid of large picture tiles. The child taps a picture and the song
plays. No text, no menus, no video, no internet, no accounts, no recommendations.
Everything (songs, pictures, playlists, settings) is stored **only on the device**.

Parents reach a hidden admin area to add songs, manage playlists, set a volume
limit, and back up the library.

---

## What's in here

| File | Purpose |
|------|---------|
| `index.html` | App screen structure |
| `styles.css` | Calm, low-stimulation styling |
| `app.js` | All app logic (player, admin, PIN, backup) |
| `db.js` | Local storage (IndexedDB) — songs/pictures live here |
| `sw.js` | Service worker — makes the app work fully offline |
| `manifest.webmanifest`, `icon.svg` | Makes it installable to the home screen |

---

## How the child uses it

- Tap a picture tile → the song plays immediately. The screen does **not** change.
- The currently playing tile gets a calm, **static** green border + dot (no animation).
- Small Play/Pause • Previous • Next buttons sit at the bottom and never move the tiles.
- Rapid/double taps are ignored (debounced) so nothing breaks.

---

## How the parent gets in (hidden admin)

1. **Press and hold the very top-left corner of the screen for ~3 seconds.**
   (There is no visible button — a child is very unlikely to find this.)
2. Enter the **PIN**. Default is **`1234`** — change it right away
   (Parent Area → *Change PIN*).
3. In the Parent Area you can:
   - Add / edit / delete songs (pick an audio file + a picture from the phone)
   - Reorder songs (↑ / ↓)
   - Create / rename / delete playlists
   - Choose the **active playlist** (the only one the child sees)
   - Set the **maximum volume**
   - **Export / Import** a backup
4. Press **Done** to return to the child screen.

> Tip: keep only a handful of tiles in the active playlist. Fewer, bigger pictures
> are calmer and easier for a young child.

---

## Installing it on the phone (one-time)

A service worker (needed for offline use) only runs from `https://` or `localhost`,
not from a raw file. Pick **one** of these one-time setups — none has a recurring cost:

### Option A — Free static hosting (recommended, easiest for a phone)
1. Create a free [GitHub](https://github.com) account → new repository.
2. Upload all the files in this folder.
3. Repo **Settings → Pages → Deploy from branch → `main` / root**. You get a free
   `https://…github.io/…` link.
4. Open that link **on the phone** (Chrome on Android / Safari on iPhone).
5. Add it to the home screen:
   - **iPhone:** Share → *Add to Home Screen*.
   - **Android:** menu (⋮) → *Install app* / *Add to Home Screen*.
6. Open it from the home-screen icon once while online. After that it works
   **fully offline** — the songs were never on a server anyway, only on the phone.

(Netlify Drop — drag-and-drop the folder at app.netlify.com/drop — also works and is free.)

### Option B — Run locally on a computer (for testing)
From this folder:
```bash
python -m http.server 8000
```
Then open `http://localhost:8000` in a browser.

---

## Locking the child into the app (so they can't leave)

The app cannot block the home button by itself — use the phone's built-in,
free, parent-protected lock. The exit is hidden and protected by a code/biometric.

### iPhone / iPad — Guided Access (best)
1. Settings → **Accessibility → Guided Access** → turn on.
2. Set **Passcode Settings** (a passcode and/or Face ID / Touch ID).
3. Open the Music app, then **triple-click the side button** to start.
   - You can circle areas of the screen to disable touches, and disable the
     volume buttons there too.
4. To exit: triple-click again and enter the passcode / use Face ID.

### Android — Screen Pinning
1. Settings → **Security → Screen pinning** → turn on, and enable
   **"Ask for PIN before unpinning."**
2. Open the Music app, open the recent-apps view, and **pin** it.
3. To exit: the unpin gesture asks for the PIN.

---

## Storage, backups & moving to a new phone

- Songs and pictures are stored in the browser's **IndexedDB** on the device
  (can hold many songs — limited by free space). Small settings use local storage.
- Data **survives app updates**.
- Data does **not** automatically transfer to a new phone. Use
  **Parent Area → Export backup** to save a single `.json` file (to Files / Google
  Drive / iCloud / email). On the new phone, install the app and use **Import backup**.
- Installing to the home screen makes the storage "persistent" so the system
  won't clear it — always install rather than just bookmarking.
- **Back up after adding songs.** The backup file is the only copy off the device.

---

## Notes & limits

- Plays standard audio your device supports (MP3, M4A/AAC, etc.). Use audio you own.
- The volume limit caps the **app's** output; on iPhone Guided Access can also
  disable the hardware volume buttons for a hard limit.
- No internet is ever used after install. No data leaves the phone.
