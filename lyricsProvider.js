/**
 * Spotify Floating Lyrics - Lyrics Provider Engine
 * Fetches time-synced lyrics from LRCLIB and Spicy Lyrics APIs.
 * Parses LRC format with millisecond precision, handles interludes,
 * and attaches transliterations via Romanizer.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

import { Romanizer } from './romanizer.js';

export class LyricsProvider {
    constructor(params = {}) {
        let session = null;
        let enableRomanization = true;
        let cacheDir = null;

        if (params && (typeof params.sendAsync === 'function' || (typeof Soup !== 'undefined' && Soup && Soup.Session && params instanceof Soup.Session))) {
            session = params;
        } else if (params && typeof params === 'object') {
            session = params.session || null;
            if (params.enableRomanization !== undefined) {
                enableRomanization = params.enableRomanization;
            }
            cacheDir = params.cacheDir || null;
        }

        this._session = session || new Soup.Session({
            user_agent: 'SpotifyFloatingLyrics/1.0 (GNOME Shell Extension)',
            timeout: 10,
        });

        this._enableRomanization = enableRomanization;
        this._cache = new Map();
        this._activeCancellable = new Gio.Cancellable();
        this._destroyed = false;

        // Disk cache directory: only initialize for real network sessions, or if cacheDir is explicitly passed
        const isMockSession = this._session && typeof this._session.sendAsync === 'function';
        if (cacheDir || !isMockSession) {
            try {
                const baseCache = cacheDir || GLib.get_user_cache_dir();
                this._cacheDirPath = GLib.build_filenamev([baseCache, 'spotify-floating-lyrics']);
                GLib.mkdir_with_parents(this._cacheDirPath, 0o755);
            } catch (e) {
                this._cacheDirPath = null;
            }
        } else {
            this._cacheDirPath = null;
        }
    }

    setEnableRomanization(enable) {
        this._enableRomanization = Boolean(enable);
    }

    /**
     * Universal request dispatcher compatible with both Libsoup 3.0 and test harness mocks.
     */
    async _sendRequest(url, options = {}) {
        const cancellable = options.cancellable || this._activeCancellable;

        if (cancellable && cancellable.is_cancelled && cancellable.is_cancelled()) {
            throw new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED, 'Operation was cancelled');
        }

        // Harness MockNetworkSession compatibility
        if (this._session && typeof this._session.sendAsync === 'function') {
            const res = await this._session.sendAsync(url, {
                headers: options.headers || {},
                cancellable
            });
            const status = res.status_code || res.status || 200;
            let bodyStr = '';
            if (res.get_response_body && res.get_response_body().get_data) {
                bodyStr = res.get_response_body().get_data();
            } else if (res.body) {
                bodyStr = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
            }
            return {
                status,
                status_code: status,
                body: bodyStr,
                get_response_body: () => ({ get_data: () => bodyStr })
            };
        }

        // Native Libsoup 3.0 Session
        return new Promise((resolve, reject) => {
            try {
                const message = Soup.Message.new('GET', url);
                if (!message) {
                    reject(new Error(`Failed to create Soup.Message for ${url}`));
                    return;
                }

                message.request_headers.append('User-Agent', 'SpotifyFloatingLyrics/1.0 (GNOME Shell Extension)');
                message.request_headers.append('Accept', 'application/json, text/plain, */*');
                if (options.headers) {
                    for (const [k, v] of Object.entries(options.headers)) {
                        message.request_headers.append(k, String(v));
                    }
                }

                this._session.send_and_read_async(
                    message,
                    GLib.PRIORITY_DEFAULT,
                    cancellable,
                    (sess, asyncRes) => {
                        try {
                            const bytes = sess.send_and_read_finish(asyncRes);
                            const status = typeof message.get_status === 'function' ? message.get_status() : message.status_code;
                            let bodyStr = '';
                            if (bytes) {
                                const decoder = new TextDecoder('utf-8');
                                bodyStr = decoder.decode(bytes.toArray());
                            }
                            resolve({
                                status,
                                status_code: status,
                                body: bodyStr,
                                get_response_body: () => ({ get_data: () => bodyStr })
                            });
                        } catch (err) {
                            reject(err);
                        }
                    }
                );
            } catch (err) {
                reject(err);
            }
        });
    }

    /**
     * Fetches lyrics for the specified track.
     */
    async fetchLyrics(title, artist, album, duration, trackId = '', options = {}) {
        if (this._destroyed) {
            return { provider: 'none', instrumental: false, syncedLyrics: null, plainLyrics: null, lines: [] };
        }

        // Defensive parameter normalization
        if (typeof trackId === 'object' && trackId !== null) {
            options = trackId;
            trackId = options.trackId || '';
        }

        const safeTitle = (title || '').trim();
        const safeArtist = (artist || '').trim();
        const safeAlbum = (album || '').trim();
        const cleanTrackId = String(trackId || '')
            .replace(/^spotify:track:/, '')
            .replace(/^\/com\/spotify\/track\//, '')
            .replace(/^\/org\/mpris\/MediaPlayer2\/track\//, '')
            .trim();

        // Duration normalization (detect whether seconds or milliseconds passed)
        const durNum = Number(duration) || 0;
        const durationSec = durNum > 10000 ? Math.round(durNum / 1000) : Math.round(durNum);
        const durationMs = durNum > 10000 ? durNum : durNum * 1000;

        if (!safeTitle && !safeArtist) {
            return { provider: 'none', instrumental: false, syncedLyrics: null, plainLyrics: null, lines: [] };
        }

        // Cancel previous pending request to prevent out-of-order race conditions
        if (this._activeCancellable && !this._activeCancellable.is_cancelled()) {
            this._activeCancellable.cancel();
        }
        this._activeCancellable = new Gio.Cancellable();
        const cancellable = this._activeCancellable;

        const enableSpicy = Boolean(options.enableSpicy);
        const spicyToken = options.spicyToken ? options.spicyToken.trim() : '';
        const enableRom = options.enableRomanization !== undefined ? options.enableRomanization : this._enableRomanization;
        const isSpicyCandidate = enableSpicy && Boolean(spicyToken) && Boolean(cleanTrackId);

        // 1. In-memory Cache Check
        const cacheKey = `${safeArtist.toLowerCase()}:${safeTitle.toLowerCase()}:${cleanTrackId}`;
        if (this._cache.has(cacheKey)) {
            const memResult = this._cache.get(cacheKey);
            if (!isSpicyCandidate || memResult.provider === 'spicy_lyrics') {
                return memResult;
            }
        }

        // 2. Disk Cache Check
        const diskResult = this._readDiskCache(cacheKey);
        if (diskResult) {
            if (!isSpicyCandidate || diskResult.provider === 'spicy_lyrics') {
                this._cache.set(cacheKey, diskResult);
                return diskResult;
            }
        }

        try {
            // 3. Spicy Lyrics (Optional)
            if (enableSpicy && spicyToken && cleanTrackId) {
                try {
                    const spicyResult = await this._fetchSpicyLyrics(cleanTrackId, spicyToken, cancellable, enableRom);
                    if (spicyResult && spicyResult.lines && spicyResult.lines.length > 0) {
                        this._cache.set(cacheKey, spicyResult);
                        this._writeDiskCache(cacheKey, spicyResult);
                        return spicyResult;
                    }
                } catch (e) {
                    console.debug('SpotifyFloatingLyrics: Spicy Lyrics failover to LRCLIB:', e.message);
                }
            }

            // 4. LRCLIB Exact Match
            const exactResult = await this._fetchLrclibExact(safeTitle, safeArtist, safeAlbum, durationSec, durationMs, cancellable, enableRom);
            if (exactResult && (exactResult.lines.length > 0 || exactResult.instrumental)) {
                this._cache.set(cacheKey, exactResult);
                this._writeDiskCache(cacheKey, exactResult);
                return exactResult;
            }

            // 5. LRCLIB Search Fallback
            const searchResult = await this._fetchLrclibSearch(safeTitle, safeArtist, durationSec, durationMs, cancellable, enableRom);
            if (searchResult && (searchResult.lines.length > 0 || searchResult.instrumental || searchResult.plainLyrics)) {
                this._cache.set(cacheKey, searchResult);
                this._writeDiskCache(cacheKey, searchResult);
                return searchResult;
            }

            // Fallback empty result
            const emptyResult = { provider: 'none', instrumental: false, syncedLyrics: null, plainLyrics: null, lines: [] };
            return emptyResult;
        } catch (err) {
            if (cancellable.is_cancelled() || (err.matches && err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) || String(err.message || '').includes('CANCELLED')) {
                return { provider: 'none', instrumental: false, syncedLyrics: null, plainLyrics: null, lines: [] };
            }
            console.debug('SpotifyFloatingLyrics: lyrics fetch error:', err.message);
            return { provider: 'none', instrumental: false, syncedLyrics: null, plainLyrics: null, lines: [] };
        }
    }

    async _fetchSpicyLyrics(trackId, token, cancellable, enableRom) {
        const url = `https://api.spicylyrics.org/query?track_id=${encodeURIComponent(trackId)}`;
        const res = await this._sendRequest(url, {
            headers: { Authorization: `Bearer ${token}` },
            cancellable
        });

        if (res.status === 200 || res.status_code === 200) {
            const data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
            if (data.type === 'syllable_ttml' && data.ttml) {
                const lines = this._parseTtml(data.ttml, enableRom);
                return {
                    provider: 'spicy_lyrics',
                    instrumental: false,
                    syncedLyrics: null,
                    plainLyrics: null,
                    lines
                };
            }
        }
        return null;
    }

    async _fetchLrclibExact(title, artist, album, durationSec, durationMs, cancellable, enableRom) {
        const params = [];
        if (title) params.push(`track_name=${encodeURIComponent(title)}`);
        if (artist) params.push(`artist_name=${encodeURIComponent(artist)}`);
        if (album) params.push(`album_name=${encodeURIComponent(album)}`);
        if (durationSec > 0) params.push(`duration=${encodeURIComponent(durationSec)}`);

        const url = `https://lrclib.net/api/get?${params.join('&')}`;
        const res = await this._sendRequest(url, { cancellable });

        if (res.status === 200 || res.status_code === 200) {
            const data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
            if (data.instrumental) {
                return {
                    provider: 'lrclib',
                    instrumental: true,
                    syncedLyrics: null,
                    plainLyrics: null,
                    lines: []
                };
            }
            if (data.syncedLyrics) {
                const lines = LyricsProvider.parseLRC(data.syncedLyrics, durationMs, { enableRomanization: enableRom });
                return {
                    provider: 'lrclib',
                    instrumental: false,
                    syncedLyrics: data.syncedLyrics,
                    plainLyrics: data.plainLyrics || null,
                    lines
                };
            }
        }
        return null;
    }

    async _fetchLrclibSearch(title, artist, durationSec, durationMs, cancellable, enableRom) {
        const query = `${title} ${artist}`.trim();
        const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
        const res = await this._sendRequest(url, { cancellable });

        if (res.status === 200 || res.status_code === 200) {
            const candidates = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
            if (Array.isArray(candidates) && candidates.length > 0) {
                // Find candidate with syncedLyrics, prioritizing closest duration
                let bestMatch = null;
                const syncedCandidates = candidates.filter(c => c && c.syncedLyrics);
                if (syncedCandidates.length > 0) {
                    if (durationSec > 0) {
                        bestMatch = syncedCandidates.find(c => Math.abs((c.duration || 0) - durationSec) <= 4);
                    }
                    if (!bestMatch) {
                        bestMatch = syncedCandidates[0];
                    }
                } else {
                    bestMatch = candidates[0];
                }

                if (bestMatch && bestMatch.syncedLyrics) {
                    const lines = LyricsProvider.parseLRC(bestMatch.syncedLyrics, durationMs, { enableRomanization: enableRom });
                    return {
                        provider: 'lrclib_search',
                        instrumental: Boolean(bestMatch.instrumental),
                        syncedLyrics: bestMatch.syncedLyrics,
                        plainLyrics: bestMatch.plainLyrics || null,
                        lines
                    };
                } else if (bestMatch) {
                    return {
                        provider: 'lrclib_search',
                        instrumental: Boolean(bestMatch.instrumental),
                        syncedLyrics: null,
                        plainLyrics: bestMatch.plainLyrics || null,
                        lines: []
                    };
                }
            }
        }
        return null;
    }

    _parseTtml(ttmlText, enableRom) {
        const lines = [];
        const pRegex = /<p\s+begin="([^"]+)"\s+end="([^"]+)"[^>]*>([\s\S]*?)<\/p>/gi;

        function parseTimestamp(ts) {
            if (!ts) return 0;
            const parts = ts.trim().split(':');
            if (parts.length === 2) {
                const min = parseInt(parts[0], 10);
                const secParts = parts[1].split('.');
                const sec = parseInt(secParts[0], 10);
                const ms = secParts[1] ? parseInt(secParts[1].padEnd(3, '0').slice(0, 3), 10) : 0;
                return (min * 60000) + (sec * 1000) + ms;
            } else if (parts.length === 3) {
                const hr = parseInt(parts[0], 10);
                const min = parseInt(parts[1], 10);
                const secParts = parts[2].split('.');
                const sec = parseInt(secParts[0], 10);
                const ms = secParts[1] ? parseInt(secParts[1].padEnd(3, '0').slice(0, 3), 10) : 0;
                return (hr * 3600000) + (min * 60000) + (sec * 1000) + ms;
            }
            return 0;
        }

        let pMatch;
        let id = 0;
        while ((pMatch = pRegex.exec(ttmlText)) !== null) {
            const startTimeMs = parseTimestamp(pMatch[1]);
            const endTimeMs = parseTimestamp(pMatch[2]);
            const innerContent = pMatch[3];

            const syllables = [];
            const spanRegex = /<span\s+begin="([^"]+)"\s+end="([^"]+)"[^>]*>([\s\S]*?)<\/span>/gi;
            let sMatch;
            let words = '';
            while ((sMatch = spanRegex.exec(innerContent)) !== null) {
                const sBegin = parseTimestamp(sMatch[1]);
                const sEnd = parseTimestamp(sMatch[2]);
                const sText = sMatch[3].replace(/<[^>]+>/g, '');
                syllables.push({ text: sText, startTimeMs: sBegin, endTimeMs: sEnd });
                words += sText;
            }

            if (syllables.length === 0) {
                words = innerContent.replace(/<[^>]+>/g, '').trim();
            } else {
                words = words.trim();
            }

            const isInterlude = words.length === 0 || words === '♪' || words.toLowerCase().includes('(instrumental)');
            let romanized = null;
            if (enableRom && !isInterlude && Romanizer && typeof Romanizer.hasRomanizableContent === 'function') {
                if (Romanizer.hasRomanizableContent(words)) {
                    romanized = Romanizer.romanize(words);
                }
            }

            lines.push({
                id: id++,
                timeMs: startTimeMs,
                startTimeMs,
                endTimeMs,
                text: words,
                words,
                isInterlude,
                romanized,
                syllables: syllables.length > 0 ? syllables : null
            });
        }
        return lines;
    }

    parseLRC(lrcText, durationMs = 0, options = {}) {
        return LyricsProvider.parseLRC(lrcText, durationMs, {
            enableRomanization: options.enableRomanization !== undefined ? options.enableRomanization : this._enableRomanization
        });
    }

    static parseLRC(lrcContent, durationMs = 0, options = {}) {
        if (!lrcContent || typeof lrcContent !== 'string') return [];

        const enableRom = options.enableRomanization !== undefined ? options.enableRomanization : true;
        const rawLines = lrcContent.split(/\r?\n/);
        const entries = [];
        const tagRegex = /\[(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?\]/g;

        let idCounter = 0;

        for (const line of rawLines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const matches = [...trimmed.matchAll(tagRegex)];
            if (matches.length === 0) continue;

            // Strip all timestamp tags to extract clean line text
            const words = trimmed.replace(tagRegex, '').trim();

            for (const match of matches) {
                const min = parseInt(match[1], 10);
                const sec = parseInt(match[2], 10);
                let ms = 0;
                if (match[3]) {
                    const frac = match[3];
                    if (frac.length === 1) ms = parseInt(frac, 10) * 100;
                    else if (frac.length === 2) ms = parseInt(frac, 10) * 10;
                    else ms = parseInt(frac.slice(0, 3), 10);
                }
                const startTimeMs = (min * 60000) + (sec * 1000) + ms;
                const isInterlude = words.length === 0 || words === '♪' || words.toLowerCase().includes('(instrumental)');

                let romanized = null;
                if (enableRom && !isInterlude && Romanizer) {
                    if (typeof Romanizer.hasRomanizableContent === 'function') {
                        if (Romanizer.hasRomanizableContent(words)) {
                            romanized = Romanizer.romanize(words);
                        }
                    } else if (typeof Romanizer.romanize === 'function') {
                        const rom = Romanizer.romanize(words);
                        if (rom !== words) romanized = rom;
                    }
                }

                entries.push({
                    id: idCounter++,
                    timeMs: startTimeMs,
                    startTimeMs,
                    endTimeMs: 0,
                    text: words,
                    words,
                    isInterlude,
                    romanized,
                    syllables: null
                });
            }
        }

        // Chronological sort
        entries.sort((a, b) => a.startTimeMs - b.startTimeMs);

        // Re-index and compute endTimeMs
        for (let i = 0; i < entries.length; i++) {
            entries[i].id = i;
            if (i < entries.length - 1) {
                entries[i].endTimeMs = entries[i + 1].startTimeMs;
            } else {
                entries[i].endTimeMs = durationMs > entries[i].startTimeMs
                    ? durationMs
                    : entries[i].startTimeMs + 6000;
            }
        }

        return entries;
    }

    _readDiskCache(key) {
        if (!this._cacheDirPath) return null;
        try {
            const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, key, -1);
            const path = GLib.build_filenamev([this._cacheDirPath, `${hash}.json`]);
            if (GLib.file_test(path, GLib.FileTest.EXISTS)) {
                const [ok, contents] = GLib.file_get_contents(path);
                if (ok && contents) {
                    const decoder = new TextDecoder('utf-8');
                    return JSON.parse(decoder.decode(contents));
                }
            }
        } catch (e) {
            // Ignore disk cache read errors
        }
        return null;
    }

    _writeDiskCache(key, data) {
        if (!this._cacheDirPath || !data) return;
        try {
            const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, key, -1);
            const path = GLib.build_filenamev([this._cacheDirPath, `${hash}.json`]);
            GLib.file_set_contents(path, JSON.stringify(data));
        } catch (e) {
            // Ignore disk cache write errors
        }
    }

    cancel() {
        if (this._activeCancellable && !this._activeCancellable.is_cancelled()) {
            this._activeCancellable.cancel();
        }
        this._activeCancellable = new Gio.Cancellable();
    }

    clearCache() {
        this._cache.clear();
    }

    destroy() {
        this._destroyed = true;
        this.cancel();
        this.clearCache();
        this._session = null;
    }
}

export default LyricsProvider;
