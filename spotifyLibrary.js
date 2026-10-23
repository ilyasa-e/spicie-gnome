/**
 * "Like" support through the Spotify Web API.
 *
 * Spotify's media interface has no rating or library calls, so liking a song
 * needs the user's own Spotify app (a client ID) and an account connection made
 * once in the preferences with PKCE. No client secret is involved; only the
 * refresh token issued for this machine is kept in local GNOME settings.
 */

import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

// Liking is switched off for now: no heart in the player, no settings group.
// The account code stays so it can be turned back on in one place.
export const LIKE_SONGS_ENABLED = false;

export const SPOTIFY_REDIRECT_URI = 'http://127.0.0.1:8898/callback';
export const SPOTIFY_REDIRECT_PORT = 8898;
export const SPOTIFY_SCOPES = 'user-library-read user-library-modify';
const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';

export function spotifyTrackId(trackId) {
    const id = String(trackId || '').replace(/^(\/com\/spotify\/track\/|spotify:track:)/, '');
    return /^[0-9A-Za-z]{22}$/.test(id) ? id : null;
}

export function formBody(values) {
    return Object.entries(values).filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&');
}

const base64Url = bytes => GLib.base64_encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function pkceChallenge(verifier) {
    const hex = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, verifier, -1);
    return base64Url(new Uint8Array(hex.match(/../g).map(pair => parseInt(pair, 16))));
}

export function pkcePair() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const verifier = Array.from({length: 64}, () => alphabet[GLib.random_int_range(0, alphabet.length)]).join('');
    return {verifier, challenge: pkceChallenge(verifier)};
}

export function authorizeUrl(clientId, challenge, state) {
    return `${ACCOUNTS}/authorize?${formBody({client_id: clientId, response_type: 'code',
        redirect_uri: SPOTIFY_REDIRECT_URI, code_challenge_method: 'S256', code_challenge: challenge,
        scope: SPOTIFY_SCOPES, state})}`;
}

// One HTTP helper for both the shell and the preferences window.
export function soupSend(session, method, url, headers = {}, body = null) {
    return new Promise((resolve, reject) => {
        const message = Soup.Message.new(method, url);
        for (const [key, value] of Object.entries(headers)) message.request_headers.append(key, value);
        if (body !== null) message.set_request_body_from_bytes('application/x-www-form-urlencoded',
            new GLib.Bytes(new TextEncoder().encode(body)));
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (source, result) => {
            try {
                const bytes = source.send_and_read_finish(result);
                const text = bytes ? new TextDecoder().decode(bytes.toArray()) : '';
                let json = null;
                try { json = text ? JSON.parse(text) : null; } catch (_) {}
                resolve({status: message.get_status(), json});
            } catch (e) {
                reject(e);
            }
        });
    });
}

export async function exchangeCode(send, clientId, code, verifier) {
    const response = await send('POST', `${ACCOUNTS}/api/token`, {}, formBody({grant_type: 'authorization_code',
        code, redirect_uri: SPOTIFY_REDIRECT_URI, client_id: clientId, code_verifier: verifier}));
    if (response.status !== 200 || !response.json?.refresh_token)
        throw new Error(response.json?.error_description || response.json?.error || `Spotify answered ${response.status}`);
    return response.json;
}

export class SpotifyLibrary {
    /**
     * @param {Gio.Settings} settings
     * @param {Function|null} send (method, url, headers, body) => Promise<{status, json}>
     */
    constructor(settings, send = null) {
        this._settings = settings;
        if (!send) {
            this._session = new Soup.Session({timeout: 15, user_agent: 'Spicie/2.0 (GNOME Shell Extension)'});
            send = (...args) => soupSend(this._session, ...args);
        }
        this._send = send;
        this._token = null;
        this._expiresUs = 0;
        this._signals = ['spotify-client-id', 'spotify-refresh-token'].map(key =>
            settings.connect(`changed::${key}`, () => { this._token = null; }));
    }

    get connected() {
        return Boolean(this._settings.get_string('spotify-client-id') && this._settings.get_string('spotify-refresh-token'));
    }

    async _accessToken() {
        if (this._token && GLib.get_monotonic_time() < this._expiresUs) return this._token;
        this._refreshing ||= this._refresh().finally(() => { this._refreshing = null; });
        return this._refreshing;
    }

    async _refresh() {
        const clientId = this._settings.get_string('spotify-client-id');
        const response = await this._send('POST', `${ACCOUNTS}/api/token`, {}, formBody({grant_type: 'refresh_token',
            refresh_token: this._settings.get_string('spotify-refresh-token'), client_id: clientId}));
        if (response.status !== 200 || !response.json?.access_token) {
            // A revoked or expired grant cannot recover by itself. Drop it so
            // the player hides the button and the preferences offer Connect.
            if (response.status === 400 || response.status === 401) this._settings.set_string('spotify-refresh-token', '');
            throw new Error(response.json?.error_description || `Spotify sign-in failed (${response.status})`);
        }
        // PKCE grants rotate the refresh token; the old one stops working.
        if (response.json.refresh_token && response.json.refresh_token !== this._settings.get_string('spotify-refresh-token'))
            this._settings.set_string('spotify-refresh-token', response.json.refresh_token);
        this._token = response.json.access_token;
        this._expiresUs = GLib.get_monotonic_time() + Math.max(60, (response.json.expires_in || 3600) - 60) * 1000000;
        return this._token;
    }

    async _api(method, path, retried = false) {
        const token = await this._accessToken();
        const response = await this._send(method, `${API}${path}`, {Authorization: `Bearer ${token}`});
        if (response.status === 401 && !retried) {
            this._token = null;
            return this._api(method, path, true);
        }
        return response;
    }

    // The generic library routes replaced the per-type ones for development
    // apps in 2026. Older grants and extended-quota apps still answer the
    // track routes, so fall back when the generic one is not available.
    async isSaved(trackId) {
        const id = spotifyTrackId(trackId);
        if (!id) return false;
        let response = await this._api('GET', `/me/library/contains?uris=spotify:track:${id}`);
        if ([400, 404, 410].includes(response.status)) response = await this._api('GET', `/me/tracks/contains?ids=${id}`);
        if (response.status !== 200 || !Array.isArray(response.json)) throw new Error(`Spotify answered ${response.status}`);
        return response.json[0] === true;
    }

    async setSaved(trackId, saved) {
        const id = spotifyTrackId(trackId);
        if (!id) throw new Error('This song cannot be saved');
        const method = saved ? 'PUT' : 'DELETE';
        let response = await this._api(method, `/me/library?uris=spotify:track:${id}`);
        if ([400, 404, 410].includes(response.status)) response = await this._api(method, `/me/tracks?ids=${id}`);
        if (response.status < 200 || response.status >= 300) throw new Error(`Spotify answered ${response.status}`);
        return saved;
    }

    destroy() {
        this._signals.forEach(id => this._settings.disconnect(id));
        this._session?.abort();
        this._session = null;
    }
}
