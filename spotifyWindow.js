import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Desktop files used by the deb, Flatpak, Snap and AUR packages.
const SPOTIFY_APPS = ['spotify.desktop', 'com.spotify.Client.desktop', 'spotify_spotify.desktop',
    'spotify-launcher.desktop'];

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

/**
 * Brings the Spotify window that is playing to the front: on its own
 * workspace, unminimized and focused.
 *
 * @param {string} busName the MPRIS name of the player
 */
export function showSpotify(busName = 'org.mpris.MediaPlayer2.spotify') {
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
        Gio.DBus.session.call(busName, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2', 'CanRaise']), null, Gio.DBusCallFlags.NONE, 2000, null,
            (connection, result) => {
                let canRaise = false;
                try { canRaise = connection.call_finish(result).recursiveUnpack()[0] === true; } catch (_) {}
                if (canRaise) raiseOverMpris(busName);
                else app.activate();
            });
        return;
    }
    raiseOverMpris(busName);
}
