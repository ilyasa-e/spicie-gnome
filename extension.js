import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { SpotifyMPRIS } from './mpris.js';
import { LyricsProvider } from './lyricsProvider.js';
import { LyricsSync } from './lyricsSync.js';
import { SpotifyIndicator } from './indicator.js';
import { SpotifyLyricsPopup } from './popupMenu.js';
import { lyricAttribution } from './lyricsAttribution.js';
import { fetchTrackLyrics, LYRICS_SETTINGS } from './lyricsRequest.js';
import { floatingPosition, isLyricsWindow, hideLyricsWindowFromLists } from './lyricsPresentation.js';
import { recoveryDelayMs } from './hudLifecycle.js';
import { SpotifyLibrary } from './spotifyLibrary.js';

const wait = ms => new Promise(resolve => {
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, ms), () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    });
});

export default class SpotifyFloatingLyricsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // 1. Core Services
        this._mpris = new SpotifyMPRIS();
        this._lyricsProvider = new LyricsProvider();
        this._sync = new LyricsSync();
        this._library = new SpotifyLibrary(this._settings);

        // 2. Standalone Smooth HUD Process & Window State
        this._hudSubprocess = null;
        this._hudWaylandClient = null;
        this._hudStdinStream = null;
        this._hudExpectedExit = false;
        this._hudSpawnUs = 0;
        this._hudRapidExits = 0;
        this._hudReconcileId = 0;
        this._hudWindowSignals = [];
        this._hudWindows = new Set();
        this._windowCreatedSignalId = 0;

        // 3. UI Presenters
        this._indicator = new SpotifyIndicator(
            this._settings,
            () => this._toggleFloating(),
            () => this.openPreferences()
        );
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, this._settings.get_string('panel-position'));
        this._positionIndicator();
        this._indicator.visible = this._mpris.isAvailable;

        this._popup = new SpotifyLyricsPopup(
            this._indicator.menu,
            this._settings,
            this._mpris,
            () => this.openPreferences(),
            this._library
        );
        // With the player pinned, the top bar button focuses it instead of
        // opening a duplicate player in a menu.
        this._indicator.setActivateHandler(() => this._popup.focusPinned());



        // 4. Connect Sync Engine to UI Presenters
        this._syncSignalId = this._sync.connect('line-changed', (_emitter, index, line) => {
            const lineText = line ? (line.words || line.text || '').trim() : '';
            this._indicator.updateLyric(lineText);
            this._popup.setActiveLine(index);
        });

        // 5. Connect Settings changes for HUD Lifecycle
        this._settingsSignals = [];
        const hudKeys = ['show-floating'];
        hudKeys.forEach(k => {
            const sid = this._settings.connect(`changed::${k}`, () => {
                this._syncHUDLifecycle();
            });
            this._settingsSignals.push(sid);
        });
        this._settingsSignals.push(this._settings.connect('changed::panel-position', () => this._positionIndicator()));
        for (const key of ['floating-position', 'floating-x', 'floating-y', 'floating-always-on-top']) {
            this._settingsSignals.push(this._settings.connect(`changed::${key}`, () => {
                for (const window of this._hudWindows) this._applyHUDPosition(window);
            }));
        }
        for (const key of LYRICS_SETTINGS) {
            this._settingsSignals.push(this._settings.connect(`changed::${key}`, () => {
                this._onTrackChanged(this._mpris.track);
            }));
        }

        // 6. Connect Window Manager to configure GTK4 HUD MetaWindow (Always on Top)
        this._initHUDWindowTracking();

        // 7. Handle MPRIS Signals
        this._mprisSignals = [];

        // Track Changed
        const trackSig = this._mpris.connect('track-changed', (_mpris, track) => {
            this._onTrackChanged(track);
        });
        this._mprisSignals.push(trackSig);

        // Status Changed
        const statusSig = this._mpris.connect('status-changed', (_mpris, status) => {
            const isPlaying = status === 'Playing';
            const track = this._mpris.track;
            this._indicator.updatePlayback(isPlaying, track);
            this._popup.updateMetadata(track, isPlaying);

            const pos = this._mpris.getPositionMs();
            this._sendHUDMessage({
                type: 'sync',
                status: isPlaying ? 'Playing' : 'Paused',
                positionMs: pos
            });

            if (isPlaying) {
                this._startPositionTicker();
                // Pausing and resuming is the user's manual resync. Make it
                // authoritative too: query Spotify instead of trusting the
                // interpolated clock that may have drifted while paused.
                this._refreshPositionAndSync();
            } else {
                this._stopPositionTicker();
                this._sync.updatePosition(pos);
            }
        });
        this._mprisSignals.push(statusSig);

        // Seeked
        const seekSig = this._mpris.connect('seeked', (_mpris, positionMs) => {
            this._sync.updatePosition(positionMs);
            this._popup.updatePosition(positionMs);
            this._sendHUDMessage({
                type: 'sync',
                status: this._mpris.playbackStatus || 'Paused',
                positionMs
            });
        });
        this._mprisSignals.push(seekSig);

        // Player Available
        const availSig = this._mpris.connect('player-available', (_mpris, isAvailable) => {
            this._indicator.visible = isAvailable;
            this._popup.setAvailable(isAvailable);
            this._syncHUDLifecycle();
            if (!isAvailable) {
                this._setLyricsAttribution(null);
                this._indicator.updateLyric('');
                this._indicator.updatePlayback(false, null);
                this._popup.updateMetadata(null, false);
                this._popup.setLyrics([]);
                this._sync.setLyrics([]);
                this._sendHUDMessage({
                    type: 'lyrics',
                    title: '',
                    artist: '',
                    lines: []
                });
                this._sendHUDMessage({
                    type: 'sync',
                    status: 'Stopped',
                    positionMs: 0
                });
                this._stopPositionTicker();
            }
        });
        this._mprisSignals.push(availSig);

        // Synchronize HUD process with current settings
        this._popup.setAvailable(this._mpris.isAvailable);
        this._syncHUDLifecycle();

        // Check if Spotify is already running & playing right now
        const currentTrack = this._mpris.track;
        if (currentTrack && currentTrack.title) {
            this._onTrackChanged(currentTrack);
        }
        if (this._mpris.playbackStatus === 'Playing') {
            this._startPositionTicker();
        }
    }

    _getHUDExecutablePath() {
        return GLib.build_filenamev([this.path, 'bin', 'spotify-floating-hud']);
    }

    _syncHUDLifecycle() {
        if (!this._settings) return;

        const showFloating = this._settings.get_boolean('show-floating');
        if (showFloating && this._mpris?.isAvailable) {
            this._ensureHUDProcess();
        } else {
            this._stopHUDProcess();
        }
    }

    _scheduleHUDReconcile(delayMs) {
        if (!this._settings?.get_boolean('show-floating') || this._hudReconcileId) return;
        this._hudReconcileId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(0, delayMs), () => {
            this._hudReconcileId = 0;
            this._syncHUDLifecycle();
            return GLib.SOURCE_REMOVE;
        });
    }

    _ensureHUDProcess() {
        if (this._hudSubprocess) return;

        try {
            const exePath = this._getHUDExecutablePath();
            if (!GLib.file_test(exePath, GLib.FileTest.IS_EXECUTABLE)) {
                console.warn(`[SpotifyFloatingLyrics] Lyrics window is not installed at ${exePath}`);
                return;
            }
            this._hudExpectedExit = false;
            this._hudSpawnUs = GLib.get_monotonic_time();

            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDIN_PIPE,
            });

            // GNOME 50 removed the X11 compositor and this detection function.
            if (!Meta.is_wayland_compositor || Meta.is_wayland_compositor()) {
                // A managed Wayland client also supports hiding the window on
                // older GNOME versions. Do not inherit an X11 backend override.
                launcher.setenv('GDK_BACKEND', 'wayland', true);
                if (Meta.WaylandClient.new_subprocess) {
                    this._hudWaylandClient = Meta.WaylandClient.new_subprocess(global.context, launcher, [exePath]);
                    this._hudSubprocess = this._hudWaylandClient.get_subprocess();
                } else {
                    this._hudWaylandClient = Meta.WaylandClient.new(global.context, launcher);
                    this._hudSubprocess = this._hudWaylandClient.spawnv(global.display, [exePath]);
                }
            } else this._hudSubprocess = launcher.spawnv([exePath]);
            launcher.close();
            this._hudStdinStream = this._hudSubprocess.get_stdin_pipe();

            this._hudSubprocess.wait_check_async(null, (_proc, res) => {
                try {
                    _proc.wait_check_finish(res);
                } catch (e) {
                    // Normal process exit
                }
                if (this._hudSubprocess === _proc) {
                    this._hudSubprocess = null;
                    this._hudStdinStream = null;
                    this._hudWaylandClient = null;
                }
                // A window that dies on its own (missing module, GPU reset,
                // compositor restart) must come back without the user having
                // to toggle the setting off and on.
                if (!this._hudExpectedExit) {
                    const lifetimeUs = GLib.get_monotonic_time() - (this._hudSpawnUs || 0);
                    if (lifetimeUs < 1000000) this._hudRapidExits = (this._hudRapidExits || 0) + 1;
                    else this._hudRapidExits = 0;
                    this._scheduleHUDReconcile(recoveryDelayMs(lifetimeUs, this._hudRapidExits));
                }
            });

            // Resend current state to newly launched HUD
            const track = this._mpris ? this._mpris.track : null;
            const lines = this._sync ? this._sync.getLines() : [];
            if (track && lines.length > 0) {
                this._sendHUDMessage({
                    type: 'lyrics',
                    title: track.title || '',
                    artist: track.artist || '',
                    lines,
                    attribution: this._lyricsAttribution,
                    expiresAt: this._lyricsExpiresAt,
                });
            }

            const isPlaying = this._mpris && this._mpris.playbackStatus === 'Playing';
            const pos = this._mpris ? this._mpris.getPositionMs() : 0;
            this._sendHUDMessage({
                type: 'sync',
                status: isPlaying ? 'Playing' : 'Paused',
                positionMs: pos
            });
        } catch (e) {
            this._hudWaylandClient = null;
            console.error('[SpotifyFloatingLyrics] Failed to spawn HUD process:', e);
        }
    }

    _stopHUDProcess() {
        this._hudExpectedExit = true;
        if (this._hudReconcileId) {
            GLib.Source.remove(this._hudReconcileId);
            this._hudReconcileId = 0;
        }
        if (this._hudStdinStream) {
            this._sendHUDMessage({ type: 'exit' });
            try {
                this._hudStdinStream.close(null);
            } catch (e) {}
            this._hudStdinStream = null;
        }

        if (this._hudSubprocess) {
            try {
                this._hudSubprocess.force_exit();
            } catch (e) {}
            this._hudSubprocess = null;
        }
        this._hudWaylandClient = null;
    }

    _sendHUDMessage(msg) {
        if (!this._hudStdinStream) return;
        try {
            if (msg.type === 'sync') msg = { ...msg, sampleTimeUs: GLib.get_monotonic_time(), rate: this._mpris?.rate || 1 };
            const text = JSON.stringify(msg) + '\n';
            const bytes = new GLib.Bytes(new TextEncoder().encode(text));
            const stream = this._hudStdinStream;
            stream.write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, null, (target, res) => {
                try {
                    target.write_bytes_finish(res);
                } catch (e) {
                    // A closed pipe means the window is gone even though the
                    // process handle still looks alive. Reconnect it.
                    if (this._hudExpectedExit || this._hudStdinStream !== target) return;
                    this._hudStdinStream = null;
                    this._scheduleHUDReconcile(500);
                }
            });
        } catch (e) {
            // Stream may have closed
        }
    }

    // Re-reads Spotify's own position and pushes it to every surface. Used
    // after a track change and after resuming, where interpolation alone can
    // be stale for a moment.
    _refreshPositionAndSync() {
        if (!this._mpris) return;
        const result = this._mpris.refreshPosition?.();
        if (!result?.then) return;
        result.then(ok => {
            if (!ok || !this._mpris) return;
            const pos = this._mpris.getPositionMs();
            this._sync?.updatePosition(pos);
            this._popup?.updatePosition(pos);
            this._sendHUDMessage({ type: 'sync',
                status: this._mpris.playbackStatus || 'Playing', positionMs: pos });
        }).catch(() => {});
    }

    _initHUDWindowTracking() {
        if (!global.display) return;

        this._windowCreatedSignalId = global.display.connect('window-created', (_disp, metaWindow) => {
            this._watchHUDWindow(metaWindow);
        });

        this._hudGrabSignals = [
            global.display.connect('grab-op-begin', (_display, window, op) => {
                if (this._hudWindows.has(window) && [Meta.GrabOp.MOVING, Meta.GrabOp.KEYBOARD_MOVING].includes(op)) this._hudDragging = window;
            }),
            global.display.connect('grab-op-end', (_display, window) => {
                if (this._hudDragging !== window || !this._settings) return;
                this._hudDragging = null;
                const rect = window.get_frame_rect();
                this._savingHUDPosition = true;
                this._settings.set_int('floating-x', rect.x);
                this._settings.set_int('floating-y', rect.y);
                this._settings.set_string('floating-position', 'custom');
                this._savingHUDPosition = false;
            }),
        ];

        this._hudPendingWindows = new Map();

        // Scan existing windows
        try {
            // Hidden overlays are deliberately absent from the tab list.
            for (const actor of global.get_window_actors()) {
                const mw = actor.meta_window;
                this._watchHUDWindow(mw);
            }
        } catch (e) {}
    }

    _watchHUDWindow(window) {
        this._configureHUDMetaWindow(window);
        if (this._hudWindows.has(window)) return;
        const clear = () => {
            const ids = this._hudPendingWindows.get(window);
            if (!ids) return;
            this._hudPendingWindows.delete(window);
            for (const id of ids) { try { window.disconnect(id); } catch (_) {} }
        };
        const notify = window.connect('notify', () => {
            this._configureHUDMetaWindow(window);
            if (this._hudWindows.has(window)) clear();
        });
        const unmanaged = window.connect('unmanaged', clear);
        this._hudPendingWindows.set(window, [notify, unmanaged]);
    }

    _configureHUDMetaWindow(metaWindow) {
        if (!metaWindow) return;

        try {
            if (isLyricsWindow(metaWindow)) {

                if (this._hudWindows.has(metaWindow)) return;
                this._hudWindows.add(metaWindow);
                metaWindow.stick?.();
                hideLyricsWindowFromLists(metaWindow, this._hudWaylandClient);
                const resizeId = metaWindow.connect('size-changed', () => this._applyHUDPosition(metaWindow));
                const unmanagedId = metaWindow.connect('unmanaged', () => this._hudWindows.delete(metaWindow));
                this._hudWindowSignals.push({ window: metaWindow, id: resizeId }, { window: metaWindow, id: unmanagedId });
                this._applyHUDPosition(metaWindow);
            }
        } catch (e) {
            console.error('[SpotifyFloatingLyrics] MetaWindow configuration error:', e);
        }
    }

    _applyHUDPosition(window) {
        if (!this._settings || this._hudDragging === window || this._savingHUDPosition) return;
        if (this._settings.get_boolean('floating-always-on-top')) window.make_above?.();
        else window.unmake_above?.();
        const monitor = window.get_monitor();
        if (monitor < 0) return;
        const area = Main.layoutManager.getWorkAreaForMonitor(monitor);
        const rect = window.get_frame_rect();
        if (!rect.width || !rect.height) return;
        const position = floatingPosition(area, rect.width, rect.height,
            this._settings.get_string('floating-position'), this._settings.get_int('floating-x'), this._settings.get_int('floating-y'));
        if (rect.x !== position.x || rect.y !== position.y) window.move_frame(false, position.x, position.y);
    }

    _startPositionTicker() {
        if (this._tickerId) return;
        this._positionRefreshUs = 0;
        this._tickerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (!this._mpris || this._mpris.playbackStatus !== 'Playing') {
                this._tickerId = null;
                return GLib.SOURCE_REMOVE;
            }
            const pos = this._mpris.getPositionMs();
            const now = GLib.get_monotonic_time();
            if (now - this._positionRefreshUs >= 2000000) {
                this._positionRefreshUs = now;
                this._mpris.refreshPosition();
            }
            this._sync.updatePosition(pos);
            this._popup.updatePosition(pos);
            this._sendHUDMessage({
                type: 'sync',
                status: 'Playing',
                positionMs: pos
            });
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopPositionTicker() {
        if (this._tickerId) {
            GLib.Source.remove(this._tickerId);
            this._tickerId = null;
        }
    }

    // Callers are signal handlers that cannot await, so a failure here must
    // never surface as an unhandled rejection that hides the real error.
    _onTrackChanged(track) {
        return this._loadTrackLyrics(track).catch(e => {
            console.error('[SpotifyFloatingLyrics] Lyrics update error:', e);
        });
    }

    async _loadTrackLyrics(track) {
        const requestId = (this._lyricsRequestId || 0) + 1;
        this._lyricsRequestId = requestId;
        this._setLyricsAttribution(null);
        if (!track || !track.title) {
            this._lyricsTrackKey = null;
            this._indicator.updateLyric('');
            this._popup.setLyrics([]);
            this._sync.setLyrics([]);
            this._sendHUDMessage({
                type: 'lyrics',
                title: '',
                artist: '',
                lines: []
            });
            return;
        }

        const isPlaying = this._mpris.playbackStatus === 'Playing';
        this._indicator.updatePlayback(isPlaying, track);
        this._popup.updateMetadata(track, isPlaying);

        const title = track.title || '';
        const artist = track.artist || '';
        // The previous song's lyrics must not run against the new song's
        // clock. Hide them, but tell the window the next set is on its way so
        // it keeps its size instead of collapsing to an empty strip. A refetch
        // of the same song (a changed source setting) keeps them on screen.
        const trackKey = track.trackId || `${title}\n${artist}`;
        if (trackKey !== this._lyricsTrackKey) {
            this._lyricsTrackKey = trackKey;
            this._sync.setLyrics([]);
            this._popup.setLyrics([]);
            this._indicator.updateLyric('');
            this._sendHUDMessage({ type: 'lyrics', title, artist, lines: [], pending: true });
        }

        try {
            const res = await this._fetchLyrics(track, requestId);
            if (requestId !== this._lyricsRequestId) return;

            // Verify track hasn't changed while awaiting fetch
            const nowTrack = this._mpris.track;
            if (nowTrack && nowTrack.title === title) {
                if (res && Array.isArray(res.lines) && res.lines.length > 0) {
                    this._setLyricsAttribution(res);
                    this._sync.setLyrics(res.lines);
                    this._popup.setLyrics(res.lines);

                    // Send parsed lines (including syllable timings if available) to smooth HUD
                    this._sendHUDMessage({
                        type: 'lyrics',
                        title,
                        artist,
                        lines: res.lines,
                        attribution: this._lyricsAttribution,
                        expiresAt: this._lyricsExpiresAt,
                    });

                    const pos = this._mpris.getPositionMs();
                    this._sync.updatePosition(pos);
                    this._popup.updatePosition(pos);
                    this._sendHUDMessage({
                        type: 'sync',
                        status: this._mpris.playbackStatus || 'Playing',
                        positionMs: pos
                    });
                    this._refreshPositionAndSync();
                } else {
                    this._sync.setLyrics([]);
                    this._popup.setLyrics([]);
                    this._indicator.updateLyric('');
                    this._sendHUDMessage({
                        type: 'lyrics',
                        title,
                        artist,
                        lines: []
                    });
                }
            }
        } catch (e) {
            if (requestId !== this._lyricsRequestId || !this._popup) return;
            console.error('[SpotifyFloatingLyrics] Lyrics fetch error:', e);
            this._sync.setLyrics([]);
            this._popup.setLyrics([]);
            this._indicator.updateLyric('');
            this._sendHUDMessage({ type: 'lyrics', title, artist, lines: [] });
        }
    }

    // Network hiccups should not leave a track permanently without lyrics.
    // An empty answer without a failure flag is a legitimate "no synced
    // lyrics" response and is returned immediately.
    async _fetchLyrics(track, requestId) {
        let last = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            if (requestId !== this._lyricsRequestId) return null;
            try {
                const res = await fetchTrackLyrics(this._lyricsProvider, track, this._settings);
                if (!res?.failed) return res;
                last = res;
            } catch (e) {
                last = null;
            }
            if (attempt === 0) await wait(700);
        }
        return last;
    }

    _setLyricsAttribution(result) {
        if (this._lyricsExpiryId) GLib.Source.remove(this._lyricsExpiryId);
        this._lyricsExpiryId = 0;
        this._lyricsAttribution = lyricAttribution(result);
        this._lyricsExpiresAt = result?.expiresAt || null;
        this._popup?.setAttribution(this._lyricsAttribution);
        if (this._lyricsExpiresAt) this._lyricsExpiryId = GLib.timeout_add(GLib.PRIORITY_DEFAULT,
            Math.max(1, Math.min(4294967295, this._lyricsExpiresAt - Date.now())), () => {
                this._lyricsExpiryId = 0;
                this._onTrackChanged(this._mpris?.track);
                return GLib.SOURCE_REMOVE;
            });
    }

    _positionIndicator() {
        const actor = this._indicator.container;
        const left = this._settings.get_string('panel-position') === 'left';
        const box = left ? Main.panel._leftBox : Main.panel._rightBox;
        actor.get_parent()?.remove_child(actor);
        const workspace = Main.panel.statusArea.activities?.container;
        const workspaceIndex = box.get_children().indexOf(workspace);
        box.insert_child_at_index(actor, left ? (workspaceIndex >= 0 ? workspaceIndex + 1 : -1) : 0);
    }

    _toggleFloating() {
        if (this._settings) {
            const current = this._settings.get_boolean('show-floating');
            this._settings.set_boolean('show-floating', !current);
        }
    }

    disable() {
        this._lyricsRequestId = (this._lyricsRequestId || 0) + 1;
        this._setLyricsAttribution(null);
        this._stopPositionTicker();
        if (this._hudReconcileId) {
            GLib.Source.remove(this._hudReconcileId);
            this._hudReconcileId = 0;
        }
        this._stopHUDProcess();

        for (const id of this._hudGrabSignals || []) global.display.disconnect(id);
        this._hudGrabSignals = [];
        this._hudWindows.clear();
        for (const [window, ids] of this._hudPendingWindows || []) {
            for (const id of ids) { try { window.disconnect(id); } catch (_) {} }
        }
        this._hudPendingWindows?.clear();
        if (this._windowCreatedSignalId && global.display) {
            global.display.disconnect(this._windowCreatedSignalId);
            this._windowCreatedSignalId = 0;
        }

        if (this._hudWindowSignals.length > 0) {
            this._hudWindowSignals.forEach(({ window, id }) => {
                try {
                    window.disconnect(id);
                } catch (e) {}
            });
            this._hudWindowSignals = [];
        }

        if (this._settingsSignals && this._settingsSignals.length > 0) {
            this._settingsSignals.forEach(id => this._settings.disconnect(id));
            this._settingsSignals = [];
        }

        if (this._sync && this._syncSignalId) {
            this._sync.disconnect(this._syncSignalId);
            this._syncSignalId = 0;
        }
        if (this._sync) {
            this._sync.destroy();
            this._sync = null;
        }

        if (this._mpris && this._mprisSignals) {
            this._mprisSignals.forEach(id => this._mpris.disconnect(id));
            this._mprisSignals = [];
        }

        // Clean up UI presenters

        if (this._popup) {
            this._popup.destroy();
            this._popup = null;
        }

        this._library?.destroy();
        this._library = null;

        if (this._indicator) {
            this._indicator.setActivateHandler(null);
            this._indicator.destroy();
            this._indicator = null;
        }

        // Clean up backend services
        if (this._lyricsProvider) {
            this._lyricsProvider.destroy();
            this._lyricsProvider = null;
        }

        if (this._mpris) {
            this._mpris.destroy();
            this._mpris = null;
        }

        this._settings = null;
    }
}
