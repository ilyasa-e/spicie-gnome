import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Desktop files used by the deb, Flatpak, Snap and AUR packages.
const SPOTIFY_APPS = ['spotify.desktop', 'com.spotify.Client.desktop', 'spotify_spotify.desktop',
    'spotify-launcher.desktop'];

const APP_BUS_NAME = 'org.mpris.MediaPlayer2.spotify';

const isSpotify = text => /spotify/i.test(text || '');

// All workspaces, most recently used first, minimized windows included.
function spotifyWindow() {
    return global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null).find(window =>
        isSpotify(window.get_wm_class()) || isSpotify(window.get_wm_class_instance())) ?? null;
}

function spotifyApp() {
    const apps = Shell.AppSystem.get_default();
    return apps.get_running().find(app => isSpotify(app.get_id())) ??
        SPOTIFY_APPS.map(id => apps.lookup_app(id)).find(Boolean) ?? null;
}

// The player's own "raise" request. Spotify's window can be closed to the
// tray while it keeps playing; then there is no window to switch to.
function raiseOverMpris(busName) {
    Gio.DBus.session.call(busName, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2', 'Raise',
        null, null, Gio.DBusCallFlags.NONE, 2000, null, (connection, result) => {
            try { connection.call_finish(result); } catch (e) { console.warn(`Spicie: Could not show Spotify: ${e.message}`); }
        });
}

// Asks the player to show itself when it says it can, and runs otherwise()
// when it cannot.
function raiseIfAllowed(busName, otherwise = () => {}) {
    Gio.DBus.session.call(busName, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
        new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2', 'CanRaise']), null, Gio.DBusCallFlags.NONE, 2000, null,
        (connection, result) => {
            let canRaise = false;
            try { canRaise = connection.call_finish(result).recursiveUnpack()[0] === true; } catch (_) {}
            if (canRaise) raiseOverMpris(busName);
            else otherwise();
        });
}

// The browser window of the Web Player: one of the browser's windows, the
// one titled with the song when the Spotify tab is in front (the Web Player
// names its tab after the song), or one with Spotify in its title.
function showWebPlayer(busName, title) {
    const time = global.get_current_time();
    Gio.DBus.session.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
        'GetConnectionUnixProcessID', new GLib.Variant('(s)', [busName]), new GLib.VariantType('(u)'),
        Gio.DBusCallFlags.NONE, 2000, null, (connection, result) => {
            let pid = 0;
            try { [pid] = connection.call_finish(result).deepUnpack(); } catch (_) {}
            const all = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null);
            // A sandboxed browser may report a different process id than its windows.
            const own = all.filter(window => window.get_pid() === pid);
            const windows = own.length ? own : all;
            const titled = text => text ? windows.find(window => (window.get_title() || '').includes(text)) : null;
            const window = titled(title) ?? titled('Spotify') ?? (own.length ? own[0] : null);
            if (window) Main.activateWindow(window, time);
            // Firefox can also switch to the tab that plays; Chromium cannot.
            raiseIfAllowed(busName);
        });
}

/**
 * Brings the Spotify window that is playing to the front: on its own
 * workspace, unminimized and focused. For the Web Player, that is the
 * browser window playing it.
 *
 * @param {object} [player] the followed player (SpotifyMPRIS)
 */
export function showSpotify(player = null) {
    if (player?.isWeb) {
        showWebPlayer(player.busName, player.track?.title);
        return;
    }
    const busName = APP_BUS_NAME;
    const window = spotifyWindow();
    if (window) {
        Main.activateWindow(window, global.get_current_time());
        return;
    }
    // Starting Spotify again hands over to the running copy, which opens its
    // window. Ask the player first so a hidden copy is not launched twice.
    const app = spotifyApp();
    if (app?.get_state() === Shell.AppState.RUNNING) {
        app.activate();
        return;
    }
    if (app) {
        raiseIfAllowed(busName, () => app.activate());
        return;
    }
    raiseOverMpris(busName);
}
