// Run on a private session bus: dbus-run-session -- gjs -m checks/web.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';
import { SpotifyMPRIS, isBrowserPlayer, isSpotifyWebMetadata } from '../mpris.js';

let passed = 0;
function check(name, value) {
    if (!value) throw new Error(name);
    print(`PASS ${name}`);
    passed++;
}
const pause = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve(); return GLib.SOURCE_REMOVE;
}));
async function until(test, ms = 3000) {
    for (let waited = 0; waited < ms && !test(); waited += 20) await pause(20);
    return test();
}

const PLAYER_XML = `<node>
  <interface name="org.mpris.MediaPlayer2">
    <property name="Identity" type="s" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
    <method name="Raise"/>
  </interface>
  <interface name="org.mpris.MediaPlayer2.Player">
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="Position" type="x" access="read"/>
    <property name="Rate" type="d" access="read"/>
    <method name="PlayPause"/>
  </interface>
</node>`;

// A media player on its own bus connection, so several can run at once.
class FakePlayer {
    constructor(name, metadata, status = 'Playing') {
        this.name = name;
        this.metadata = metadata;
        this.status = status;
        const address = Gio.dbus_address_get_for_bus_sync(Gio.BusType.SESSION, null);
        this.connection = Gio.DBusConnection.new_for_address_sync(address,
            Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, null, null);
        const info = Gio.DBusNodeInfo.new_for_xml(PLAYER_XML);
        this.ids = info.interfaces.map(iface => this.connection.register_object('/org/mpris/MediaPlayer2', iface,
            () => {}, (_c, _s, _p, ifaceName, property) => this._get(ifaceName, property), null));
        this.connection.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'RequestName', new GLib.Variant('(su)', [name, 4]), null, Gio.DBusCallFlags.NONE, -1, null);
    }

    _get(iface, property) {
        if (iface === 'org.mpris.MediaPlayer2')
            return property === 'Identity' ? new GLib.Variant('s', this.name) : new GLib.Variant('b', false);
        return {
            Metadata: () => this._metadataVariant(),
            PlaybackStatus: () => new GLib.Variant('s', this.status),
            Position: () => new GLib.Variant('x', 1000000),
            Rate: () => new GLib.Variant('d', 1),
        }[property]?.() ?? null;
    }

    _metadataVariant() {
        const entries = {};
        for (const [key, value] of Object.entries(this.metadata)) {
            entries[key] = key === 'xesam:artist' ? new GLib.Variant('as', [value])
                : key === 'mpris:length' ? new GLib.Variant('x', value)
                    : key === 'mpris:trackid' ? new GLib.Variant('o', value) : new GLib.Variant('s', value);
        }
        return new GLib.Variant('a{sv}', entries);
    }

    set(changes) {
        Object.assign(this, changes);
        const changed = {};
        if (changes.metadata) changed.Metadata = this._metadataVariant();
        if (changes.status) changed.PlaybackStatus = new GLib.Variant('s', this.status);
        this.connection.emit_signal(null, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties',
            'PropertiesChanged', new GLib.Variant('(sa{sv}as)', ['org.mpris.MediaPlayer2.Player', changed, []]));
    }

    quit() {
        this.ids.forEach(id => this.connection.unregister_object(id));
        this.connection.close_sync(null);
    }
}

const song = (title, extra = {}) => ({'mpris:trackid': '/org/chromium/MediaPlayer2/TrackList/Track1',
    'xesam:title': title, 'xesam:artist': 'Artist', 'xesam:album': 'Album', 'mpris:length': 200000000, ...extra});

const loop = new GLib.MainLoop(null, false);
(async () => {
    check('Chromium and Firefox players are browsers', isBrowserPlayer('org.mpris.MediaPlayer2.chromium.instance42') &&
        isBrowserPlayer('org.mpris.MediaPlayer2.firefox.instance_1_7') && !isBrowserPlayer('org.mpris.MediaPlayer2.spotify') &&
        !isBrowserPlayer('org.mpris.MediaPlayer2.rhythmbox'));
    check('A Web Player page address is recognized',
        isSpotifyWebMetadata({'xesam:title': 'A', 'xesam:url': 'https://open.spotify.com/track/1'}));
    check('Another site is not Spotify even with an album',
        !isSpotifyWebMetadata({...song('A'), 'xesam:url': 'https://music.youtube.com/watch?v=1'}));
    check('Without an address, a song with an album counts', isSpotifyWebMetadata(song('A')));
    check('Without an address, a video without an album does not', !isSpotifyWebMetadata(song('A', {'xesam:album': ''})));

    const video = new FakePlayer('org.mpris.MediaPlayer2.firefox.instance_1_2',
        {'mpris:trackid': '/org/mpris/MediaPlayer2/firefox', 'xesam:title': 'Cat video', 'xesam:artist': 'Channel'});
    const mpris = new SpotifyMPRIS();
    const changes = [];
    mpris.connect('track-changed', (_m, track) => changes.push(track?.title ?? ''));
    await pause(300);
    check('A video in a browser is not followed', !mpris.isAvailable);

    const web = new FakePlayer('org.mpris.MediaPlayer2.chromium.instance42', song('Web Song'));
    check('The Web Player is followed when the app is closed', await until(() => mpris.isAvailable && mpris.isWeb));
    check('Its song, status and name are read', mpris.track?.title === 'Web Song' && mpris.playbackStatus === 'Playing' &&
        mpris.busName === web.name);
    check('Browser track ids are not used as Spotify ids', mpris.track.trackId === '');

    // Firefox keeps one track id for every song.
    web.set({metadata: song('Next Web Song')});
    check('A new song is noticed by its title', await until(() => mpris.track?.title === 'Next Web Song'));

    const app = new FakePlayer('org.mpris.MediaPlayer2.spotify', song('App Song', {'mpris:trackid': '/com/spotify/track/abc'}));
    check('The Spotify app takes over when it starts', await until(() => !mpris.isWeb && mpris.track?.title === 'App Song'));
    check('The app keeps its Spotify track id', mpris.track.trackId === 'abc' && mpris.busName === 'org.mpris.MediaPlayer2.spotify');

    app.quit();
    check('The Web Player is followed again when the app quits', await until(() => mpris.isWeb && mpris.track?.title === 'Next Web Song'));

    web.set({metadata: song('Paused Song'), status: 'Paused'});
    const other = new FakePlayer('org.mpris.MediaPlayer2.firefox.instance_9_9', song('Other Tab'), 'Paused');
    await pause(300);
    check('A paused Web Player keeps its place over another paused one', mpris.busName === web.name);
    other.set({status: 'Playing'});
    check('A Web Player that starts playing is followed', await until(() => mpris.busName === other.name));

    other.quit();
    check('Back to the remaining Web Player', await until(() => mpris.busName === web.name && mpris.track?.title === 'Paused Song'));
    web.quit();
    check('No player once the browser stops', await until(() => !mpris.isAvailable));

    mpris.destroy();
    video.quit();
    check('Each switch announced its song', changes.includes('Web Song') && changes.includes('App Song'));
    print(`${passed} web player checks passed`);
    loop.quit();
})().catch(error => {
    printerr(`FAIL ${error.message}`);
    loop.quit();
    System.exit(1);
});
loop.run();
