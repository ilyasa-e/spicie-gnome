/**
 * Preferences-side Spotify account connection (authorization code + PKCE).
 *
 * A loopback server receives the single redirect, then stops. It only answers
 * the registered callback path and only accepts the state it generated.
 */

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import { SPOTIFY_REDIRECT_PORT, pkcePair, authorizeUrl, exchangeCode, soupSend } from './spotifyLibrary.js';

const PAGE = message => `<!doctype html><meta charset="utf-8"><title>Spicie</title>
<body style="font:16px sans-serif;padding:3em;text-align:center">${message}</body>`;

/** @returns {Function|null} cancels the sign-in, or null when it already failed */
export function connectSpotify(settings, {onDone, onError}) {
    const clientId = settings.get_string('spotify-client-id').trim();
    if (!clientId) { onError(new Error('Enter your Spotify client ID first.')); return null; }
    const {verifier, challenge} = pkcePair();
    const state = GLib.uuid_string_random();
    const session = new Soup.Session({timeout: 15});
    const server = new Soup.Server({});
    let finished = false;
    let timeoutId = 0;
    const stop = () => {
        if (finished) return;
        finished = true;
        if (timeoutId) GLib.Source.remove(timeoutId);
        // Let the browser receive the page before the socket closes.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => { server.disconnect(); return GLib.SOURCE_REMOVE; });
    };
    server.add_handler('/callback', (_server, message, _path, query) => {
        const reply = text => {
            message.set_status(200, null);
            message.set_response('text/html; charset=utf-8', Soup.MemoryUse.COPY, new TextEncoder().encode(PAGE(text)));
        };
        if (finished || query?.state !== state) { reply('This sign-in link is no longer valid.'); return; }
        if (!query?.code) {
            reply('Spotify did not connect. You can close this tab.');
            stop();
            onError(new Error(query?.error === 'access_denied' ? 'Spotify access was declined.' : 'Spotify did not return a code.'));
            return;
        }
        reply('Spotify is connected to Spicie. You can close this tab.');
        stop();
        exchangeCode((...args) => soupSend(session, ...args), clientId, query.code, verifier).then(tokens => {
            settings.set_string('spotify-refresh-token', tokens.refresh_token);
            onDone();
        }).catch(onError);
    });
    try {
        server.listen_local(SPOTIFY_REDIRECT_PORT, Soup.ServerListenOptions.IPV4_ONLY);
    } catch (e) {
        onError(new Error(`Port ${SPOTIFY_REDIRECT_PORT} is in use. Close the other sign-in and try again.`));
        return null;
    }
    timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 300, () => {
        timeoutId = 0;
        stop();
        onError(new Error('Spotify sign-in timed out.'));
        return GLib.SOURCE_REMOVE;
    });
    try {
        Gio.AppInfo.launch_default_for_uri(authorizeUrl(clientId, challenge, state), null);
    } catch (e) {
        stop();
        onError(new Error('Could not open the browser.'));
        return null;
    }
    return stop;
}
