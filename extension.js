import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { SpotifyMPRIS } from './mpris.js';
import { LyricsProvider } from './lyricsProvider.js';
import { LyricsSyncManager } from './lyricsSync.js';
import { SpotifyIndicator } from './indicator.js';
import { SpotifyLyricsPopup } from './popupMenu.js';
import { DesktopFloatingHUD } from './floatingOverlay.js';

export default class SpotifyFloatingLyricsExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // 1. Core Services
        this._mpris = new SpotifyMPRIS();
        this._lyricsProvider = new LyricsProvider();
        this._syncManager = new LyricsSyncManager(this._mpris, this._lyricsProvider, this._settings);

        // 2. Top Panel Status Indicator
        this._indicator = new SpotifyIndicator(
            this._settings,
            () => this._toggleFloating(),
            () => this.openPreferences()
        );
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // 3. Tray Popup View
        this._popup = new SpotifyLyricsPopup(
            this._indicator.menu,
            this._settings,
            this._mpris,
            () => this.openPreferences()
        );

        // 4. Desktop Floating HUD Overlay
        this._floatingHUD = new DesktopFloatingHUD(this._settings);

        // 5. Connect Sync Signals to Presenters
        this._syncSignals = [];

        // Active Line Changed
        const lineSig = this._syncManager.connect('line-changed', (_mgr, activeLine, activeIndex, allLines) => {
            const lineText = activeLine ? (activeLine.words || '').trim() : '';
            this._indicator.updateLyric(lineText);
            this._floatingHUD.updateLine(activeLine, activeIndex, allLines);
            this._popup.setActiveLine(activeIndex);
        });
        this._syncSignals.push(lineSig);

        // Track or Playback Status Changed
        const trackSig = this._syncManager.connect('track-changed', (_mgr, track, isPlaying) => {
            this._indicator.updatePlayback(isPlaying, track);
            this._popup.updateMetadata(track, isPlaying);
        });
        this._syncSignals.push(trackSig);

        // Lyrics Loaded
        const lyricsSig = this._syncManager.connect('lyrics-loaded', (_mgr, lyrics) => {
            this._popup.setLyrics(lyrics?.lines || []);
        });
        this._syncSignals.push(lyricsSig);

        // Start Sync Loop
        this._syncManager.start();
    }

    _toggleFloating() {
        if (this._settings) {
            const current = this._settings.get_boolean('show-floating');
            this._settings.set_boolean('show-floating', !current);
        }
    }

    disable() {
        // Stop sync manager and disconnect signals
        if (this._syncManager) {
            if (this._syncSignals && this._syncSignals.length > 0) {
                this._syncSignals.forEach(id => this._syncManager.disconnect(id));
                this._syncSignals = [];
            }
            this._syncManager.stop();
            this._syncManager.destroy();
            this._syncManager = null;
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
