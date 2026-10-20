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
import { DesktopFloatingHUD } from './floatingOverlay.js';

export default class SpotifyFloatingLyricsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // 1. Core Services
        this._mpris = new SpotifyMPRIS();
        this._lyricsProvider = new LyricsProvider();
        this._sync = new LyricsSync();

        // 2. Standalone Smooth HUD Process & Window State
        this._hudSubprocess = null;
        this._hudStdinStream = null;
        this._hudWindowSignals = [];
        this._windowCreatedSignalId = 0;

        // 3. UI Presenters
        this._indicator = new SpotifyIndicator(
            this._settings,
            () => this._toggleFloating(),
            () => this.openPreferences()
        );
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._popup = new SpotifyLyricsPopup(
            this._indicator.menu,
            this._settings,
            this._mpris,
            () => this.openPreferences()
        );

        this._floatingHUD = new DesktopFloatingHUD(this._settings);

        // 4. Connect Sync Engine to UI Presenters
        this._syncSignalId = this._sync.connect('line-changed', (_emitter, index, line) => {
            const lineText = line ? (line.words || line.text || '').trim() : '';
            this._indicator.updateLyric(lineText);
            this._floatingHUD.updateLine(line, index, this._sync.getLines());
            this._popup.setActiveLine(index);
        });

        // 5. Connect Settings changes for HUD Lifecycle
        this._settingsSignals = [];
        const hudKeys = ['show-floating', 'hud-renderer'];
        hudKeys.forEach(k => {
            const sid = this._settings.connect(`changed::${k}`, () => {
                this._syncHUDLifecycle();
            });
            this._settingsSignals.push(sid);
        });

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
            if (!isAvailable) {
                this._indicator.updateLyric('');
                this._indicator.updatePlayback(false, null);
                this._popup.updateMetadata(null, false);
                this._popup.setLyrics([]);
                this._floatingHUD.updateLine(null, -1, []);
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
        const renderer = this._settings.get_string('hud-renderer');

        if (showFloating && renderer === 'smooth-gtk') {
            this._ensureHUDProcess();
        } else {
            this._stopHUDProcess();
        }
    }

    _ensureHUDProcess() {
        if (this._hudSubprocess) return;

        try {
            const exePath = this._getHUDExecutablePath();
            if (!GLib.file_test(exePath, GLib.FileTest.IS_EXECUTABLE)) {
                return;
            }

            const launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDIN_PIPE,
            });

            this._hudSubprocess = launcher.spawnv([exePath]);
            this._hudStdinStream = this._hudSubprocess.get_stdin_pipe();

            this._hudSubprocess.wait_check_async(null, (_proc, res) => {
                try {
                    _proc.wait_check_finish(res);
                } catch (e) {
                    // Normal process exit
                }
                this._hudSubprocess = null;
                this._hudStdinStream = null;
            });

            // Resend current state to newly launched HUD
            const track = this._mpris ? this._mpris.track : null;
            const lines = this._sync ? this._sync.getLines() : [];
            if (track && lines.length > 0) {
                this._sendHUDMessage({
                    type: 'lyrics',
                    title: track.title || '',
                    artist: track.artist || '',
                    lines
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
            console.error('[SpotifyFloatingLyrics] Failed to spawn HUD process:', e);
        }
    }

    _stopHUDProcess() {
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
    }

    _sendHUDMessage(msg) {
        if (!this._hudStdinStream) return;
        try {
            const text = JSON.stringify(msg) + '\n';
            const bytes = new GLib.Bytes(new TextEncoder().encode(text));
            this._hudStdinStream.write_bytes_async(bytes, GLib.PRIORITY_DEFAULT, null, null);
        } catch (e) {
            // Stream may have closed
        }
    }

    _initHUDWindowTracking() {
        if (!global.display) return;

        this._windowCreatedSignalId = global.display.connect('window-created', (_disp, metaWindow) => {
            this._configureHUDMetaWindow(metaWindow);
        });

        // Scan existing windows
        try {
            const tabList = global.display.get_tab_list ? global.display.get_tab_list(Meta.TabList.NORMAL, null) : [];
            for (const mw of tabList) {
                this._configureHUDMetaWindow(mw);
            }
        } catch (e) {}
    }

    _configureHUDMetaWindow(metaWindow) {
        if (!metaWindow) return;

        try {
            const title = typeof metaWindow.get_title === 'function' ? metaWindow.get_title() : '';
            const wmClass = typeof metaWindow.get_wm_class === 'function' ? metaWindow.get_wm_class() : '';
            const appId = typeof metaWindow.get_gtk_application_id === 'function' ? metaWindow.get_gtk_application_id() : '';

            if (title === 'Spotify Floating Lyrics' ||
                wmClass === 'dev.norang.SpotifyFloatingLyricsHUD' ||
                appId === 'dev.norang.SpotifyFloatingLyricsHUD') {

                // Pin Always on Top & Stick across workspaces
                if (typeof metaWindow.make_above === 'function') {
                    metaWindow.make_above();
                }
                if (typeof metaWindow.stick === 'function') {
                    metaWindow.stick();
                }
                if (typeof metaWindow.set_skip_taskbar === 'function') {
                    metaWindow.set_skip_taskbar(true);
                }

                // Restore custom position if saved
                const posMode = this._settings.get_string('floating-position');
                if (posMode === 'custom' && typeof metaWindow.move_frame === 'function') {
                    const x = this._settings.get_int('floating-x');
                    const y = this._settings.get_int('floating-y');
                    metaWindow.move_frame(true, x, y);
                }

                // Save custom coordinates when moved by user
                const posId = metaWindow.connect('position-changed', () => {
                    if (!this._settings || typeof metaWindow.get_frame_rect !== 'function') return;
                    const rect = metaWindow.get_frame_rect();
                    if (rect) {
                        this._settings.set_string('floating-position', 'custom');
                        this._settings.set_int('floating-x', rect.x);
                        this._settings.set_int('floating-y', rect.y);
                    }
                });
                this._hudWindowSignals.push({ window: metaWindow, id: posId });
            }
        } catch (e) {
            console.error('[SpotifyFloatingLyrics] MetaWindow configuration error:', e);
        }
    }

    _startPositionTicker() {
        if (this._tickerId) return;
        this._tickerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            if (!this._mpris || this._mpris.playbackStatus !== 'Playing') {
                this._tickerId = null;
                return GLib.SOURCE_REMOVE;
            }
            const pos = this._mpris.getPositionMs();
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

    async _onTrackChanged(track) {
        if (!track || !track.title) {
            this._indicator.updateLyric('');
            this._floatingHUD.updateLine(null, -1, []);
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

        // Clear existing lyrics display while fetching
        this._sync.setLyrics([]);
        this._popup.setLyrics([]);
        this._indicator.updateLyric('');
        this._floatingHUD.updateLine(null, -1, []);

        const enableSpicy = this._settings.get_boolean('enable-spicy-lyrics');
        const spicyToken = this._settings.get_string('spicy-lyrics-token');
        const enableRomaji = this._settings.get_boolean('enable-romanization');
        this._lyricsProvider.setEnableRomanization(enableRomaji);

        try {
            const title = track.title || '';
            const artist = track.artist || '';
            const album = track.album || '';
            const durationSec = Math.round((track.durationMs || 0) / 1000);
            const trackId = track.trackId || '';

            const res = await this._lyricsProvider.fetchLyrics(
                title,
                artist,
                album,
                durationSec,
                trackId,
                { enableSpicy, spicyToken }
            );

            // Verify track hasn't changed while awaiting fetch
            const nowTrack = this._mpris.track;
            if (nowTrack && nowTrack.title === title) {
                if (res && Array.isArray(res.lines) && res.lines.length > 0) {
                    this._sync.setLyrics(res.lines);
                    this._popup.setLyrics(res.lines);

                    // Send parsed lines (including syllable timings if available) to smooth HUD
                    this._sendHUDMessage({
                        type: 'lyrics',
                        title,
                        artist,
                        lines: res.lines
                    });

                    const pos = this._mpris.getPositionMs();
                    this._sync.updatePosition(pos);
                    this._sendHUDMessage({
                        type: 'sync',
                        status: this._mpris.playbackStatus || 'Playing',
                        positionMs: pos
                    });
                } else {
                    this._popup.setLyrics([]);
                    this._sendHUDMessage({
                        type: 'lyrics',
                        title,
                        artist,
                        lines: []
                    });
                }
            }
        } catch (e) {
            console.error('[SpotifyFloatingLyrics] Lyrics fetch error:', e);
            this._popup.setLyrics([]);
        }
    }

    _toggleFloating() {
        if (this._settings) {
            const current = this._settings.get_boolean('show-floating');
            this._settings.set_boolean('show-floating', !current);
        }
    }

    disable() {
        this._stopPositionTicker();
        this._stopHUDProcess();

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
        if (this._floatingHUD) {
            this._floatingHUD.destroy();
            this._floatingHUD = null;
        }

        if (this._popup) {
            this._popup.destroy();
            this._popup = null;
        }

        if (this._indicator) {
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
