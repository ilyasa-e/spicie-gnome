# Spicie for GNOME

Music controls and live lyrics for the Spotify desktop app, without changing Spotify itself.

## Player

Click the music indicator in the top bar to open the player. Choose a layout in **Settings → Player → Layout**:

- **Compact:** a small, nearly square player with a small album cover beside the song details. Playback controls and the seek slider sit below.
- **Horizontal:** playback controls sit beside the song details.

Both layouts include the album cover, previous/play/pause/next controls, a seek slider, and song times. The background colour follows the cover. Missing or failed covers use a neutral background.

Use the pin button or **Keep player on desktop** to keep the player visible. Drag its cover, title, or empty background to move it. The position is saved separately from desktop lyrics. **Player position → Reset** moves it back to the starting position. Fullscreen apps hide the pinned player.

## Lyrics

Lyrics can appear in the top bar, on the desktop, inside the player, or in multiple locations. The top-bar indicator and pinned player appear only while Spotify is available. Choose Left or Right with **Top bar position**. Left places the indicator after the workspace indicator. The top-bar line stays visible between phrases and is cleared when seeking before the first lyric or switching songs. Enable **Player lyrics** to show the current line inside the popup and pinned player.

Desktop lyrics use one lightweight window. **Animate lyrics** is the only animation option: it highlights characters when word timing is available and otherwise shows normal text.

The lyrics window is hidden from the taskbar, application switcher, and window
previews while the extension manages it. It remains visible on the desktop and
can still be dragged when click-through is off. The settings window remains a
normal application window. **Always on top** controls stacking separately.

Open **Settings → Lyrics** for a placement preview, screen position, text alignment, font, background, and mouse behaviour. Settings are searchable and changes apply immediately.

The default screen position is **Top center**, below the top bar. Top left, Top right, Center, and the three bottom positions are also available. Dragging the lyrics saves a **Custom** position. **Reset placement** restores Top center and automatic vocalist alignment.

**Text alignment** is separate from screen position: choose Left, Center, Right, or **By vocalist**. By vocalist uses the source's `OppositeAligned` flag to place voices on the left or right, including overlapping lead vocals. Without that flag, text stays centered. Manual alignment applies to all voices. The same window handles normal and animated lyrics. Transparent draws no background.

Turn on **Let clicks pass through** to interact with the app behind the lyrics. Use **Move desktop lyrics → Move** to turn click-through off and drag the lyrics again. Lyrics stay hidden until their first timed word begins.

**Animate lyrics** controls highlighting:

- On: animate only when the source provides word or syllable times.
- Off: show normal lyrics from every source.
- Line-only timing always shows normal lyrics, even when the switch is on.

Words and syllables animate as complete source segments: each has a soft highlight sweep, a small rise, and a slight change in size. If the source splits a word into syllables, each syllable keeps its own time and pauses. Complete source words stay complete; Spicie does not invent syllable boundaries from spelling.

Sustained Latin segments add individual letter movement inside the segment animation. Letter times are interpolated inside that segment; they are not separate timestamps recorded for every letter. Connected scripts retain their shaped text and use the timed sweep without separate movement. The full shaped line supplies positions for alignment, wrapping, and non-Latin text. Pause freezes all effects; seeking reconstructs the frame immediately. Turning animation off disables both segment and letter effects.

Timing precision depends on the source's segments and Spotify's reported playback position. The Spicetify version of Spicy Lyrics can read Spotify's internal playback clock; this extension uses the desktop player's media interface instead. Millisecond timestamps do not guarantee measured audio alignment to the millisecond.

## Sources

LRCLIB supplies lyrics without sign-in. **Settings → Sources** also offers Spicy Lyrics for word timing, with a [Spicy Lyrics key](https://developers.spicylyrics.org/docs/keys). Spotify access tokens do not authenticate this service. The integration uses its current `/v1/lyrics/{trackId}` route and also understands catalogue TTML. The default source is used when the optional source is unavailable.

Spicie is an independent app and is not made or endorsed by Spicy Lyrics. Source credits appear beside lyrics, including contributor links for community syncs. Saved lyrics expire within 30 days; expired or older unversioned cache files are discarded. Lyrics are only displayed inside the app and are not offered as downloads or a shared service.

Keys are stored in your local GNOME settings and are never included in the repository. Do not bundle a secret key in a release. Apps distributed to other people must use client access; the [key guide](https://developers.spicylyrics.org/docs/keys) explains native clients and app templates. Access to the service does not grant permission from the song's rights holders; see the [terms](https://developers.spicylyrics.org/terms).

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
GSETTINGS_BACKEND=memory gjs -m checks/karaoke.js
GSETTINGS_BACKEND=memory gjs -m checks/sources.js
GSETTINGS_BACKEND=memory gjs -m checks/presentation.js
GSETTINGS_BACKEND=memory gjs -m checks/regressions.js
GSETTINGS_BACKEND=memory gjs -m checks/syllables.js
```

The player checks cover artwork loading, cancellation when songs change, fallback colours, and time formatting. The player and settings also need a running GNOME session for visual and interaction checks.
