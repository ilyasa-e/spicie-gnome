# Spicie for GNOME

Music controls and live lyrics for the Spotify desktop app, without changing Spotify itself.

## Settings

Settings has three tabs.

- **General → Lyrics source** picks where lyrics come from. LRCLIB is always
  available; **Use Spicy Lyrics** adds word-level timing with a client key.
- **General → Text** holds the options every lyric surface shares:
  **Romanize Korean, Japanese and Cyrillic**, **Countdown dots before the next
  lyric**, and **Animate lyrics**.
- **Desktop lyrics** covers the floating overlay on the desktop.
- **Player** covers the top bar indicator and the player card.

## Player

Click the music indicator in the top bar to open the player. Choose a style in **Settings → Player → Layout**:

- **Style 1 (vertical):** a large rounded album cover on top, then the song
  title and artist, the seek slider with song times, and previous/play/next
  with a large play button. Its lyric panel sits beside the player.
- **Style 2 (horizontal):** a small cover with the song details and the
  playback controls beside them. Its lyric panel sits above or below the player.

The background colour follows the cover. Missing or failed covers use a neutral background.
Click the album cover to bring the Spotify window that is playing to the front,
on its own workspace and restored if it was minimized. If Spotify is running
without a window (closed to the tray), it is asked to show itself. There is no
setting for this. On the pinned player a click opens Spotify and a drag moves
the player.
Hovering or dragging the seek slider thickens the bar, shows its handle and
switches it to the cover's accent colour.

Use the pin button or **Keep player on desktop** to keep the player visible. Drag its cover, title, or empty background to move it. The position is saved separately from desktop lyrics. **Player position → Reset** moves it back to the starting position. Fullscreen apps hide the pinned player.

While the player is pinned, clicking the top bar indicator brings the pinned
player forward with a short pulse instead of opening a second copy in a menu.
When a fullscreen app hides the pinned player, the click opens the menu as
usual. The saved position belongs to the player card itself: its lyric panel
attaches to one of its edges, so songs with more, fewer, or no lyrics never move
the controls, and changing a setting never separates the two.

**Player size** scales the entire player from 70% to 150%, including text,
controls, spacing, and its lyric panel. It changes the actual layout size, so
buttons and dragging continue to match their visible positions.

In **Settings → Player → Lyrics in the player**, enable **Show lyrics** and
choose one to eight **Lines**. Both styles have the panel. Style 2 places it
below a player near the top of the screen and above one near the bottom.
Style 1 places it beside the player, toward the middle of the screen: to the
right of a player on the left half and to the left of one on the right half,
lined up with the player's top edge in the top half of the screen and with its
bottom edge in the bottom half. In the top bar menu, Style 1 shows the panel on
the side of the screen that has room. Scroll freely and click **Follow song**
to return to the current line.

Source credits follow the lyrics: they sit at the bottom of the lyric panel
while it is shown, and inside the player, above the footer buttons, when the
panel is off.

## Lyrics

Lyrics can appear in the top bar, on the desktop, inside the player, or in multiple locations. The top-bar indicator and pinned player appear only while Spotify is available. Choose Left or Right with **Settings → Player → Top bar → Position**. Left places the indicator after the workspace indicator. The top-bar line stays visible between phrases and is cleared when seeking before the first lyric or switching songs. Both player styles can show a separate scrolling lyric panel in the popup and pinned player.

**Settings → Player → Top bar** has separate Artist, Song title, and Lyric line
switches, plus its own **Font weight**.
Desktop lyrics (**Desktop lyrics → Text and background**) and the player's lyric
panel (**Player → Lyrics in the player**) each have a **Font weight** too:
Light, Regular, Medium, Semibold, Bold, or Heavy. Fonts without that weight
use the nearest one available. Selected fields use ` | ` between them; empty or hidden fields leave
no extra separators. Turning all three off keeps the playback button. The player
shows source details when opened, even with player lyrics off. The top bar
shows only the selected song fields; source credits stay in the player and
floating lyrics.

Desktop lyrics use one lightweight window. **Animate lyrics** is the only animation option: it highlights characters when word timing is available and otherwise shows normal text.

The lyrics window is hidden from the taskbar, application switcher, and window
previews while the extension manages it. It remains visible on the desktop and
can still be dragged when click-through is off. The settings window remains a
normal application window. **Keep above windows** controls stacking separately.

Open **Settings → Desktop lyrics** for a placement preview, screen position, text alignment, font, background, and mouse behaviour. Settings are searchable and changes apply immediately.

The default screen position is **Top center**, below the top bar. Top left, Top right, Center, and the three bottom positions are also available. Dragging the lyrics saves a **Custom** position. **Reset placement** restores Top center and automatic vocalist alignment.

**Desktop text alignment** is separate from screen position: choose Left, Center, Right, or **By vocalist**. By vocalist uses the source's `OppositeAligned` flag to place voices on the left or right, including overlapping lead vocals. Without that flag, text stays centered. Manual alignment applies to all voices. The same window handles normal and animated lyrics. Transparent draws no background.

Turn on **Let clicks pass through** to interact with the app behind the lyrics. **Move lyrics → Move** outlines the lyrics and lets you drag them even while click-through is on; click **Done** (or close Settings) to finish. Click-through keeps its own setting and comes back unchanged. The first lyric is visible while waiting, without early karaoke highlighting.

In **Settings → Desktop lyrics → Overlay**, the **Lines** row selects one to
eight lyric lines (two by default). With two, the active lyric is first and the next line is below it.
With three or more, one previous line sits above the active lyric in row two.
The first lyric starts in row one. Other lines are dimmed, and simultaneous
vocalists remain visible even if that exceeds the chosen context count.

**Countdown dots** show three timed dots in long intros and vocal gaps of at
least 2.5 seconds. The row is visible for the whole wait, from the previous
vocal or the start of the song, and the three dots divide that wait evenly so
the last one lands on the next lyric. They disappear at its exact start. Pause
freezes them; seeking rebuilds their state.
Turning Animate lyrics off removes their bounce while keeping the countdown.
The countdown is a row in the lyric sequence, before the next vocal. The first
lyric is already visible below it during an intro. Existing rows scroll smoothly
when focus advances; seeking rebuilds the view immediately.

When the song changes, the previous song's lyrics are hidden at once. The
window keeps its size until the new lyrics arrive instead of collapsing and
growing back.

Floating LRCLIB credits appear with the final lyric and remain at the end. For
responses from the Spicy Lyrics API, including Apple Music, a small source line
and any required contributor links remain visible whenever lyrics are shown.
Community credits show uploader and maker names inline, with underlined links
from the response. They wrap when space is limited; role labels and the Spicy
Lyrics name are omitted from the credit display. Source metadata stays intact.
In the player, linked credits (contributor profiles and LRCLIB) show a hand
cursor and a highlight on hover; opening one closes the popup.

**Animate lyrics** controls highlighting:

- On: animate only when the source provides word or syllable times.
- Off: show normal lyrics from every source.
- Line-only timing always shows normal lyrics, even when the switch is on.

Words and syllables animate as complete source segments: each has a soft highlight sweep, a small rise, and a slight change in size. If the source splits a word into syllables, each syllable keeps its own time and pauses. Complete source words stay complete; Spicie does not invent syllable boundaries from spelling.

Sustained Latin segments add individual letter movement inside the segment animation. Letter times are interpolated inside that segment; they are not separate timestamps recorded for every letter. Connected scripts retain their shaped text and use the timed sweep without separate movement. The full shaped line supplies positions for alignment, wrapping, and non-Latin text. Pause freezes all effects; seeking reconstructs the frame immediately. Turning animation off disables both segment and letter effects.

Timing precision depends on the source's segments and Spotify's reported playback position. The Spicetify version of Spicy Lyrics can read Spotify's internal playback clock; this extension uses the desktop player's media interface instead. Millisecond timestamps do not guarantee measured audio alignment to the millisecond.

## Sources

Spicy Lyrics uses one endpoint. The service selects **community sync → Apple
Music → Spotify**, considering timing precision and availability for the two
commercial sources. Spicie keeps the returned source and community contributor
links. It does not make a separate community request or force a commercial
source. See the [source hierarchy](https://developers.spicylyrics.org/docs/sync-sources#the-hierarchy).


LRCLIB supplies lyrics without sign-in. **Settings → General → Lyrics source** also offers Spicy Lyrics for word timing, with a [Spicy Lyrics client key](https://developers.spicylyrics.org/docs/keys). Spotify access tokens and Spicy Lyrics secret keys do not belong in the extension. The integration uses its current `/v1/lyrics/{trackId}` route and also understands catalogue TTML. The default source is used when the optional source is unavailable.

Spicie is an independent app and is not made or endorsed by Spicy Lyrics. Source credits appear in the player and floating lyrics, including contributor links for community syncs. LRCLIB credits appear in the player and at the end of desktop lyrics. Saved lyrics expire within 30 days; expired or older unversioned cache files are discarded. Lyrics are only displayed inside the app and are not offered as downloads or a shared service.

Client keys are stored in local GNOME settings and are never included in the repository or release package. Do not bundle a secret key in a release. Apps distributed to other people should use an approved Spicy Lyrics app template so each user receives their own client key. Access to the service does not grant permission from the song's rights holders; see the [terms](https://developers.spicylyrics.org/terms).

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
gjs -m checks/hud.js
GSETTINGS_BACKEND=memory gjs -m checks/karaoke.js
GSETTINGS_BACKEND=memory gjs -m checks/sources.js
GSETTINGS_BACKEND=memory gjs -m checks/presentation.js
GSETTINGS_BACKEND=memory gjs -m checks/regressions.js
GSETTINGS_BACKEND=memory gjs -m checks/syllables.js
GSETTINGS_BACKEND=memory gjs -m checks/view.js
GSETTINGS_BACKEND=memory gjs -m checks/like.js
```

The player checks cover artwork loading, cancellation when songs change, fallback colours, and time formatting. The player and settings also need a running GNOME session for visual and interaction checks.

The end-to-end suite lives in `tests/` and runs headless:

```bash
tests/e2e/run_all.sh
```

It covers the extension lifecycle, lyric fetching, MPRIS tracking, preferences, romanization, the sync engine, and the UI surfaces, with separate tiers for boundary cases, cross-feature combinations, and real-world workloads.
