# Spotify Floating Lyrics for GNOME

Music controls and live lyrics for the Spotify desktop app, without changing Spotify itself.

## Player

Click the music indicator in the top bar to open the player. Choose a layout in **Settings → Player → Layout**:

- **Compact:** the cover and song details sit above the playback controls.
- **Horizontal:** playback controls sit beside the song details.

Both layouts include the album cover, previous/play/pause/next controls, a seek slider, and song times. The background colour follows the cover. Missing or failed covers use a neutral background.

Use the pin button or **Keep player on desktop** to keep the player visible. Drag its cover or title to move it. The position is saved separately from desktop lyrics. **Player position → Reset** moves it back to the starting position. Fullscreen apps hide the pinned player.

## Lyrics

Lyrics can appear in the top bar, on the desktop, or both. The player does not show a long lyrics list.

Desktop lyrics offer two animation modes:

- **Smooth:** a separate window with word highlighting when word timing is available.
- **Classic:** lyrics rendered inside GNOME Shell.

Use **Settings → Lyrics** for text size, font, background, position, and mouse behaviour. Turn on **Let clicks pass through** to interact with the app behind the lyrics.

## Sources

LRCLIB supplies lyrics without sign-in. **Settings → Sources** also offers Spicy Lyrics for word timing, with a Spotify access token. The default source is used when the optional source is unavailable.

## Install

From this repository:

```bash
./install.sh
```

The installer copies the extension and its helper to your local GNOME extension directory, compiles settings, and enables the extension.

When updating an extension already loaded by GNOME, sign out and back in to load changed code. On an X11 session, restarting GNOME Shell also works. The standalone lyrics helper can be tested directly without restarting the desktop; changes to the top-bar player require GNOME Shell to load the updated extension.

Open settings with:

```bash
gnome-extensions prefs spotify-floating-lyrics@norang.dev
```

## Checks

```bash
glib-compile-schemas --strict schemas
gjs -m checks/player.js
```

The player checks cover artwork loading, cancellation when songs change, fallback colours, and time formatting. The player and settings also need a running GNOME session for visual and interaction checks.
