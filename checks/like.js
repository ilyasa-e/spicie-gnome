import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import { SpotifyLibrary, spotifyTrackId, pkcePair, pkceChallenge, authorizeUrl, SPOTIFY_REDIRECT_URI } from '../spotifyLibrary.js';
import { fontWeightValue, pangoFont } from '../fontWeight.js';
let count = 0;
const check = (name, value) => { if (!value) throw Error(name); print(`PASS ${name}`); count++; };

const id = '4uLU6hMCjMI75M1A2tKUQC';
check('Spotify track paths become catalogue ids', spotifyTrackId(`/com/spotify/track/${id}`) === id && spotifyTrackId(`spotify:track:${id}`) === id);
check('Adverts and local files cannot be liked', spotifyTrackId('/com/spotify/ad/123') === null && spotifyTrackId('') === null);
const {verifier, challenge} = pkcePair();
check('PKCE verifier and challenge use the URL-safe alphabet', /^[A-Za-z0-9._~-]{64}$/.test(verifier) && /^[A-Za-z0-9_-]{43}$/.test(challenge));
// Reference value from an independent SHA-256/base64url implementation.
check('A PKCE challenge is the SHA-256 of its verifier',
    pkceChallenge('dBjftJeZ4CVP-mJ92K9qyArHjIYJdnHtHcf1qaf5n3Y') === 'B94Co-BDDMGYpR72PPoG_f0zpEHbo_wdoOzqvSUS6wQ');
const url = authorizeUrl('client', challenge, 'state');
check('Authorization asks only for library scopes and the loopback redirect',
    url.includes('scope=user-library-read%20user-library-modify') && url.includes(encodeURIComponent(SPOTIFY_REDIRECT_URI)));

const store = {'spotify-client-id': 'client', 'spotify-refresh-token': 'r1'};
const settings = {get_string: key => store[key], set_string: (key, value) => { store[key] = value; },
    connect: () => 1, disconnect: () => {}};
const calls = [];
let generic = true, tokenStatus = 200;
const library = new SpotifyLibrary(settings, async (method, target) => {
    calls.push(`${method} ${target.replace(/^https:\/\/[^/]+/, '')}`);
    if (target.endsWith('/api/token')) return tokenStatus === 200
        ? {status: 200, json: {access_token: 'a', refresh_token: 'r2', expires_in: 3600}} : {status: tokenStatus, json: {error: 'invalid_grant'}};
    if (!generic) return target.includes('/me/library') ? {status: 404, json: null} : {status: 200, json: [true]};
    return {status: 200, json: target.includes('contains') ? [false] : null};
});
const loop = new GLib.MainLoop(null, false);
(async () => {
    check('The library reports a connection only with a client ID and a token', library.connected);
    check('The generic library route answers first', await library.isSaved(id) === false && calls[1].startsWith('GET /v1/me/library/contains?uris=spotify:track:'));
    check('Rotated refresh tokens are kept', store['spotify-refresh-token'] === 'r2');
    check('The access token is reused until it expires', (await library.isSaved(id), calls.filter(call => call.endsWith('/api/token')).length === 1));
    await library.setSaved(id, true);
    check('Liking saves the track through the library', calls.at(-1) === `PUT /v1/me/library?uris=spotify:track:${id}`);
    generic = false;
    check('Older apps fall back to the track routes', await library.isSaved(id) === true && calls.at(-1) === `GET /v1/me/tracks/contains?ids=${id}`);
    await library.setSaved(id, false);
    check('Removing a like falls back the same way', calls.at(-1) === `DELETE /v1/me/tracks?ids=${id}`);
    library._token = null;tokenStatus = 400;
    let failed = false;
    try { await library.isSaved(id); } catch (_) { failed = true; }
    check('A revoked grant disconnects instead of retrying forever', failed && store['spotify-refresh-token'] === '' && !library.connected);
    library.destroy();
})().catch(e => { print(e.stack); throw e; }).finally(() => loop.quit());
loop.run();

check('Font weights map to CSS numbers', fontWeightValue('semibold') === 600 && fontWeightValue('unknown', 700) === 700);
const font = Pango.FontDescription.from_string(pangoFont(Pango, 'Noto Sans', 'light', 22));
check('Desktop lyrics fonts keep family, weight and size apart', font.get_family() === 'Noto Sans' &&
    font.get_weight() === 300 && font.get_size() === 22 * Pango.SCALE);
print(`${count} like and font checks passed`);
