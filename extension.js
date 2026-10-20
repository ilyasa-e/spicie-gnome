import GLib from 'gi://GLib';
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

        // 2. UI Presenters
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

        // 3. Connect Sync Engine to UI Presenters
        this._syncSignalId = this._sync.connect('line-changed', (_emitter, index, line) => {
            const lineText = line ? (line.words || line.text || '').trim() : '';
            this._indicator.updateLyric(lineText);
            this._floatingHUD.updateLine(line, index, this._sync.getLines());
            this._popup.setActiveLine(index);
        });

        // 4. Handle MPRIS Signals
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

            if (isPlaying) {
                this._startPositionTicker();
            } else {
                this._stopPositionTicker();
                const pos = this._mpris.getPositionMs();
                this._sync.updatePosition(pos);
            }
        });
        this._mprisSignals.push(statusSig);

        // Seeked
        const seekSig = this._mpris.connect('seeked', (_mpris, positionMs) => {
            this._sync.updatePosition(positionMs);
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
                this._stopPositionTicker();
            }
        });
        this._mprisSignals.push(availSig);

        // Check if Spotify is already running & playing right now
        const currentTrack = this._mpris.track;
        if (currentTrack && currentTrack.title) {
            this._onTrackChanged(currentTrack);
        }
        if (this._mpris.playbackStatus === 'Playing') {
            this._startPositionTicker();
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

                    const pos = this._mpris.getPositionMs();
                    this._sync.updatePosition(pos);
                } else {
                    this._popup.setLyrics([]);
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
