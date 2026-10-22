/**
 * Module Loader for Progressive E2E Test Execution.
 * Dynamically loads live implementation modules if available, or falls back to
 * authoritative contract adapters backed by reference oracles.
 */

import {
    RomanizerOracle,
    LrcParserOracle,
    PositionInterpolationOracle,
    LyricsSyncOracle,
    MprisUnpackerOracle,
    HudLayoutOracle
} from './reference_oracles.js';

export const ModuleStatus = {
    mpris: 'oracle',
    romanizer: 'oracle',
    lyricsProvider: 'oracle',
    lyricsSync: 'oracle',
    indicator: 'oracle',
    popupMenu: 'oracle',
    prefs: 'oracle',
    extension: 'oracle'
};

// ==========================================
// Fallback Contract Implementations
// ==========================================

export class FallbackRomanizer {
    static romanize(text) { return RomanizerOracle.romanize(text); }
    static romanizeHangul(text) { return RomanizerOracle.romanizeHangul(text); }
    static romanizeKana(text) { return RomanizerOracle.romanizeKana(text); }
    static romanizeCyrillic(text) { return RomanizerOracle.romanizeCyrillic(text); }
    static hasRomanizableContent(text) { return RomanizerOracle.hasRomanizableContent(text); }
}

export class FallbackSpotifyMPRIS {
    constructor(dbusProxy) {
        this._proxy = dbusProxy;
        this._callbacks = new Set();
        this._lastKnownPositionMs = dbusProxy ? dbusProxy.getCurrentPositionMs() : 0;
        this._lastKnownTimeUs = Date.now() * 1000;
        this._playbackStatus = dbusProxy && dbusProxy.playbackStatus ? dbusProxy.playbackStatus : 'Stopped';
        this._metadata = dbusProxy && dbusProxy.metadata ? MprisUnpackerOracle.unpackMetadata(dbusProxy.metadata) : MprisUnpackerOracle.unpackMetadata(null);

        if (this._proxy) {
            this._proxy.connect('g-properties-changed', (proxy, changed, invalidated) => {
                const props = changed.unpack ? changed.unpack() : changed;
                if (props.PlaybackStatus) {
                    const st = props.PlaybackStatus.unpack ? props.PlaybackStatus.unpack() : props.PlaybackStatus;
                    this._playbackStatus = st;
                    this._emit('status-changed', st);
                }
                if (props.Metadata) {
                    const meta = props.Metadata.unpack ? props.Metadata.unpack() : props.Metadata;
                    this._metadata = MprisUnpackerOracle.unpackMetadata(meta);
                    this._emit('track-changed', this._metadata);
                }
            });
            this._proxy.connect('Seeked', (proxy, positionUs) => {
                const posMs = Math.floor(positionUs / 1000);
                this._lastKnownPositionMs = posMs;
                this._lastKnownTimeUs = Date.now() * 1000;
                this._emit('seeked', posMs);
            });
            this._proxy.connect('notify::g-name-owner', () => {
                this._emit('player-available', Boolean(this._proxy.g_name_owner));
            });
        }
    }

    connect(signalOrCb, cb) {
        if (typeof signalOrCb === 'function') {
            this._callbacks.add(signalOrCb);
            return signalOrCb;
        }
        if (!this._signals) this._signals = new Map();
        if (!this._signals.has(signalOrCb)) this._signals.set(signalOrCb, new Set());
        this._signals.get(signalOrCb).add(cb);
        return cb;
    }

    _emit(event, data) {
        for (const cb of this._callbacks) {
            try { cb(event, data); } catch (e) { console.error(e); }
        }
        if (this._signals && this._signals.has(event)) {
            for (const cb of this._signals.get(event)) {
                try { cb(this, data); } catch (e) { console.error(e); }
            }
        }
    }

    getMetadata() {
        if (this._proxy && this._proxy.metadata) {
            return MprisUnpackerOracle.unpackMetadata(this._proxy.metadata);
        }
        return this._metadata;
    }

    getPositionMs() {
        if (!this._proxy) return this._lastKnownPositionMs;
        const nowUs = Date.now() * 1000;
        return PositionInterpolationOracle.calculateCurrentPosition(
            this._lastKnownPositionMs,
            this._lastKnownTimeUs,
            nowUs,
            this._proxy.playbackStatus,
            this.getMetadata().durationMs
        );
    }

    async playPause() {
        if (this._proxy) this._proxy.PlayPauseRemote();
    }

    async next() {
        if (this._proxy) this._proxy.NextRemote();
    }

    async previous() {
        if (this._proxy) this._proxy.PreviousRemote();
    }

    async setPosition(positionMs) {
        if (this._proxy) this._proxy.SetPositionRemote(this.getMetadata().trackId, positionMs * 1000);
    }

    destroy() {
        this._callbacks.clear();
        if (this._signals) this._signals.clear();
        if (this._proxy) this._proxy.destroy();
    }
}

export class FallbackLyricsProvider {
    constructor(networkSession) {
        this._network = networkSession;
        this._cache = new Map();
    }

    async fetchLyrics(title, artist, album, durationSec, trackId, options = {}) {
        const cacheKey = `${artist}_${title}_${trackId}`;
        if (this._cache.has(cacheKey)) {
            return this._cache.get(cacheKey);
        }

        // Try Spicy if enabled and token present
        if (options.enableSpicy && options.spicyToken) {
            try {
                const res = await this._network.sendAsync(`https://api.spicylyrics.org/query?track_id=${trackId}`, {
                    headers: { Authorization: `Bearer ${options.spicyToken}` }
                });
                if (res.status_code === 200) {
                    const data = JSON.parse(res.get_response_body().get_data());
                    const result = {
                        provider: 'spicy_lyrics',
                        lines: [], // TTML lines
                        syncedLyrics: null,
                        plainLyrics: null
                    };
                    this._cache.set(cacheKey, result);
                    return result;
                }
            } catch (e) {
                // Failover to LRCLIB
            }
        }

        // Exact match
        try {
            const exactUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}&duration=${durationSec}`;
            const res = await this._network.sendAsync(exactUrl);
            if (res.status_code === 200) {
                const data = JSON.parse(res.get_response_body().get_data());
                const lines = data.syncedLyrics ? LrcParserOracle.parse(data.syncedLyrics, durationSec * 1000) : [];
                const result = {
                    provider: 'lrclib',
                    instrumental: Boolean(data.instrumental),
                    syncedLyrics: data.syncedLyrics,
                    plainLyrics: data.plainLyrics,
                    lines
                };
                this._cache.set(cacheKey, result);
                return result;
            }
        } catch (e) {
            // Check if fallback search needed
        }

        // Fallback Search
        try {
            const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(title + ' ' + artist)}`;
            const res = await this._network.sendAsync(searchUrl);
            if (res.status_code === 200) {
                const candidates = JSON.parse(res.get_response_body().get_data());
                const match = candidates.find(c => c.syncedLyrics);
                if (match) {
                    const lines = LrcParserOracle.parse(match.syncedLyrics, durationSec * 1000);
                    const result = {
                        provider: 'lrclib_search',
                        instrumental: Boolean(match.instrumental),
                        syncedLyrics: match.syncedLyrics,
                        plainLyrics: match.plainLyrics,
                        lines
                    };
                    this._cache.set(cacheKey, result);
                    return result;
                }
            }
        } catch (e) {
            // Failed
        }

        return { provider: 'none', instrumental: false, syncedLyrics: null, plainLyrics: null, lines: [] };
    }

    parseLRC(lrcText, durationMs = 0) {
        return LrcParserOracle.parse(lrcText, durationMs);
    }

    clearCache() {
        this._cache.clear();
    }

    cancel() {}
    destroy() { this.clearCache(); }
}

export class FallbackLyricsSync {
    constructor() {
        this._lines = [];
        this._currentIndex = -1;
        this._callbacks = new Set();
        this._signals = new Map();
    }

    setLyrics(lines) {
        this._lines = lines || [];
        this._currentIndex = -1;
    }

    updatePosition(positionMs) {
        const newIndex = LyricsSyncOracle.findActiveIndex(this._lines, positionMs);
        if (newIndex !== this._currentIndex) {
            this._currentIndex = newIndex;
            const line = newIndex >= 0 ? this._lines[newIndex] : null;
            this._emit('line-changed', newIndex, line, this._lines);
        }
    }

    getCurrentIndex() {
        return this._currentIndex;
    }

    onLineChanged(cb) {
        this._callbacks.add(cb);
    }

    connect(signal, cb) {
        if (!this._signals.has(signal)) this._signals.set(signal, new Set());
        this._signals.get(signal).add(cb);
        return cb;
    }

    _emit(signal, ...args) {
        for (const cb of this._callbacks) {
            try { cb(args[1], args[0], args[2]); } catch (e) { console.error(e); }
        }
        if (this._signals.has(signal)) {
            for (const cb of this._signals.get(signal)) {
                try { cb(this, ...args); } catch (e) { console.error(e); }
            }
        }
    }

    destroy() {
        this._lines = [];
        this._callbacks.clear();
        this._signals.clear();
    }
}

export class FallbackFloatingHUD {
    constructor(settings, shellEnv) {
        this._settings = settings;
        this._shell = shellEnv;
        this._actor = new shellEnv.Clutter.Actor({ style_class: 'floating-lyrics-box' });
        this._prevLabel = new shellEnv.St.Label({ style_class: 'floating-lyric-line floating-lyric-prev' });
        this._activeLabel = new shellEnv.St.Label({ style_class: 'floating-lyric-line floating-lyric-active' });
        this._romanizedLabel = new shellEnv.St.Label({ style_class: 'floating-lyric-romanized' });
        this._nextLabel = new shellEnv.St.Label({ style_class: 'floating-lyric-line floating-lyric-next' });

        this._actor.add_child(this._prevLabel);
        this._actor.add_child(this._activeLabel);
        this._actor.add_child(this._romanizedLabel);
        this._actor.add_child(this._nextLabel);

        this._applySettings();
        if (this._settings) {
            this._settings.connect('changed', () => this._applySettings());
        }
        this._shell.Main.layoutManager.addTopChrome(this._actor);
    }

    _applySettings() {
        if (!this._settings) return;
        const passthrough = this._settings.get_boolean('floating-click-passthrough');
        this._actor.reactive = !passthrough;

        const bgStyle = this._settings.get_string('background-style');
        this._actor.style_class = `floating-lyrics-box background-${bgStyle}`;

        this.reposition();
    }

    reposition() {
        if (!this._settings) return;
        const preset = this._settings.get_string('floating-position');
        const customX = this._settings.get_int('floating-x');
        const customY = this._settings.get_int('floating-y');
        const workArea = this._shell.Main.layoutManager.getWorkAreaForMonitor(0);
        const coords = HudLayoutOracle.calculateCoordinates(
            preset,
            customX,
            customY,
            workArea,
            this._actor.width,
            this._actor.height
        );
        this._actor.set_position(coords.x, coords.y);
    }

    updateLine(activeLine, index, lines) {
        if (!lines || lines.length === 0 || index < 0) {
            this._prevLabel.set_text('');
            this._activeLabel.set_text('');
            this._romanizedLabel.set_text('');
            this._nextLabel.set_text('');
            return;
        }

        const prev = index > 0 ? lines[index - 1].words : '';
        const current = activeLine ? activeLine.words : '';
        const roman = activeLine && activeLine.romanized ? activeLine.romanized : '';
        const next = index < lines.length - 1 ? lines[index + 1].words : '';

        this._prevLabel.set_text(prev);
        this._activeLabel.set_text(current);
        this._romanizedLabel.set_text(roman);
        this._nextLabel.set_text(next);
    }

    destroy() {
        this._shell.Main.layoutManager.removeChrome(this._actor);
        this._actor.destroy();
    }
}

export class FallbackIndicator {
    constructor(settings, shellEnv) {
        this._settings = settings;
        this._shell = shellEnv;
        this.button = new shellEnv.PanelMenu.Button(0.0, 'SpotifyLyrics');
        this.icon = new shellEnv.St.Icon({ icon_name: 'media-playback-start-symbolic' });
        this.label = new shellEnv.St.Label({ style_class: 'panel-lyric-label' });
        this.button.add_child(this.icon);
        this.button.add_child(this.label);

        this._shell.Main.panel.addToStatusArea('spotify-floating-lyrics', this.button);
    }

    updateLyric(line) {
        const text = line ? (line.words || '') : '';
        this.label.set_text(text);
    }

    destroy() {
        this._shell.Main.panel.remove('spotify-floating-lyrics');
        this.button.destroy();
    }
}

export class FallbackPopupMenu {
    constructor(indicator, mpris, shellEnv) {
        this._indicator = indicator;
        this._mpris = mpris;
        this._shell = shellEnv;
        this._lyrics = [];
        this._activeIndex = -1;
    }

    setLyrics(lines) {
        this._lyrics = lines || [];
    }

    setActiveLine(idx) {
        this._activeIndex = idx;
    }

    destroy() {
        this._lyrics = [];
    }
}

export class FallbackExtension {
    constructor(shellEnv, mockSettings, dbusProxy, networkSession) {
        this._shell = shellEnv;
        this._settings = mockSettings;
        this._proxy = dbusProxy;
        this._network = networkSession;
        this._enabled = false;
        this._mpris = null;
        this._provider = null;
        this._sync = null;
        this._hud = null;
        this._indicator = null;
        this._popup = null;
    }

    enable() {
        if (this._enabled) return;
        this._enabled = true;
        this._mpris = new FallbackSpotifyMPRIS(this._proxy);
        this._provider = new FallbackLyricsProvider(this._network);
        this._sync = new FallbackLyricsSync();
        this._hud = new FallbackFloatingHUD(this._settings, this._shell);
        this._indicator = new FallbackIndicator(this._settings, this._shell);
        this._popup = new FallbackPopupMenu(this._indicator, this._mpris, this._shell);

        this._sync.onLineChanged((line, idx, all) => {
            this._hud.updateLine(line, idx, all);
            this._indicator.updateLyric(line);
            this._popup.setActiveLine(idx);
        });
    }

    disable() {
        if (!this._enabled) return;
        this._enabled = false;

        if (this._hud) { this._hud.destroy(); this._hud = null; }
        if (this._popup) { this._popup.destroy(); this._popup = null; }
        if (this._indicator) { this._indicator.destroy(); this._indicator = null; }
        if (this._sync) { this._sync.destroy(); this._sync = null; }
        if (this._provider) { this._provider.destroy(); this._provider = null; }
        if (this._mpris) { this._mpris.destroy(); this._mpris = null; }
    }
}

// Dynamic module loader
export async function loadModule(name) {
    try {
        const mod = await import(`../../../${name}.js`);
        ModuleStatus[name] = 'real';
        if (name === 'mpris') {
            const RealClass = mod.SpotifyMPRIS || mod.default;
            function SpotifyMPRISAdapter(paramsOrProxy) {
                const isProxy = paramsOrProxy && (paramsOrProxy.g_name_owner !== undefined || paramsOrProxy.PlayPauseRemote);
                const params = isProxy ? { proxy: paramsOrProxy, autoConnect: false } : (paramsOrProxy || {});
                const instance = new RealClass(params);
                if (isProxy && paramsOrProxy.g_name_owner && !instance.isAvailable) {
                    instance._handlePlayerAvailable(true);
                }
                if (!instance.getMetadata) {
                    instance.getMetadata = function() {
                        return this.track || this.parseMetadata(this._proxy ? this._proxy.metadata : null);
                    };
                }
                return instance;
            }
            Object.setPrototypeOf(SpotifyMPRISAdapter, RealClass);
            SpotifyMPRISAdapter.prototype = RealClass.prototype;
            return { SpotifyMPRIS: SpotifyMPRISAdapter, default: SpotifyMPRISAdapter };
        }
        return mod;
    } catch (e) {
        ModuleStatus[name] = 'oracle';
        switch (name) {
            case 'romanizer': return { Romanizer: FallbackRomanizer, default: FallbackRomanizer };
            case 'mpris': return { SpotifyMPRIS: FallbackSpotifyMPRIS, default: FallbackSpotifyMPRIS };
            case 'lyricsProvider': return { LyricsProvider: FallbackLyricsProvider, default: FallbackLyricsProvider };
            case 'lyricsSync': return { LyricsSync: FallbackLyricsSync, LyricsSyncManager: FallbackLyricsSync, default: FallbackLyricsSync };
            case 'indicator': return { SpotifyIndicator: FallbackIndicator, PanelIndicator: FallbackIndicator, default: FallbackIndicator };
            case 'popupMenu': return { SpotifyLyricsPopup: FallbackPopupMenu, LyricsPopupMenu: FallbackPopupMenu, default: FallbackPopupMenu };
            case 'extension': return { SpotifyFloatingLyricsExtension: FallbackExtension, default: FallbackExtension };
            default: return null;
        }
    }
}
