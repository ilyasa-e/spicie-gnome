/**
 * Spotify MPRIS D-Bus Client for GNOME Shell Extension
 * Connects to org.mpris.MediaPlayer2.spotify on the session bus. While the
 * Spotify app is not running, it follows the Spotify Web Player in a browser.
 *
 * Implements monotonic time position interpolation, defensive variant unpacking,
 * track transition handling, and playback controls.
 */

import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const APP_BUS_NAME = 'org.mpris.MediaPlayer2.spotify';

// Browsers that publish their tabs' media over MPRIS. Chrome, Brave, Edge,
// Vivaldi and Opera all use the chromium name.
const BROWSER_BUS_NAME = /^org\.mpris\.MediaPlayer2\.(chromium|firefox|librewolf|zen|floorp|waterfox|plasma-browser-integration)(\.|$)/;

export const isBrowserPlayer = busName => BROWSER_BUS_NAME.test(busName || '');

/**
 * Whether a browser's media metadata belongs to the Spotify Web Player.
 * Browsers that share the page address are checked by it. Chromium-based
 * browsers do not, so there the song must have a title, artist and album,
 * which the Web Player always sets and video sites usually do not.
 *
 * @param {GLib.Variant|object|null} raw MPRIS metadata
 * @returns {boolean}
 */
export function isSpotifyWebMetadata(raw) {
    const dict = typeof raw?.recursiveUnpack === 'function' ? raw.recursiveUnpack() : raw;
    if (!dict || typeof dict !== 'object' || Array.isArray(dict)) return false;
    const url = String(dict['xesam:url'] ?? '').trim();
    if (url) return /^https:\/\/open\.spotify\.com(\/|$)/.test(url);
    const track = SpotifyMPRIS.parseMetadata(dict);
    return Boolean(track.title && track.artist && track.album);
}

export const SpotifyMPRIS = GObject.registerClass({
    GTypeName: 'SpotifyMPRIS',
    Signals: {
        'status-changed': {
            param_types: [GObject.TYPE_STRING],
        },
        'track-changed': {
            param_types: [GObject.TYPE_JSOBJECT],
        },
        'seeked': {
            param_types: [GObject.TYPE_DOUBLE],
        },
        'player-available': {
            param_types: [GObject.TYPE_BOOLEAN],
        },
    },
}, class SpotifyMPRIS extends GObject.Object {
    _init(params = {}) {
        super._init();

        let proxy = null;
        let busName = APP_BUS_NAME;
        let objectPath = '/org/mpris/MediaPlayer2';
        let autoConnect = true;
        let timeProvider = () => GLib.get_monotonic_time();

        if (params && (typeof params.connect === 'function' || params.g_name_owner !== undefined)) {
            proxy = params;
            autoConnect = true;
        } else if (params && typeof params === 'object') {
            proxy = params.proxy || null;
            busName = params.busName || busName;
            objectPath = params.objectPath || objectPath;
            if (params.autoConnect !== undefined) {
                autoConnect = params.autoConnect;
            }
            if (typeof params.timeProvider === 'function') {
                timeProvider = params.timeProvider;
            }
        }

        this._busName = busName;
        this._objectPath = objectPath;
        this._playerInterface = 'org.mpris.MediaPlayer2.Player';

        this._proxy = null;
        this._propChangedId = 0;
        this._signalId = 0;
        this._nameOwnerId = 0;
        this._cancellable = new Gio.Cancellable();
        this._timeProvider = timeProvider;

        this._isAvailable = false;
        this._playbackStatus = 'Stopped';
        this._track = null;
        this._lastPositionUs = 0;
        this._lastTimestampUs = 0;
        this._positionEpoch = 0;
        this._durationUs = 0;
        this._rate = 1.0;
        this._rawTrackId = '';
        this._trackPath = '';
        this._appProxy = null;
        this._appOwnerId = 0;
        this._webProxies = new Map();
        this._webOwnerSubId = 0;
        this._isWeb = false;

        if (proxy) {
            this._attachProxy(proxy, autoConnect);
        } else if (autoConnect) {
            this._initDBus();
        }
    }

    get isAvailable() {
        return this._isAvailable;
    }

    get playbackStatus() {
        return this._playbackStatus;
    }

    get rate() {
        return this._rate;
    }

    /** The MPRIS name of the player being followed. */
    get busName() {
        return this._busName;
    }

    /** Whether the player is the Spotify Web Player in a browser. */
    get isWeb() {
        return this._isWeb;
    }

    refreshPosition() {
        if (!this._proxy?.g_name_owner || this._refreshPending) return Promise.resolve(false);
        this._refreshPending = true;
        const track = this._track;
        const anchor = this._lastTimestampUs;
        const epoch = this._positionEpoch;
        const started = this._timeProvider();
        return new Promise(resolve => {
            this._proxy.get_connection().call(this._busName, this._objectPath,
                'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', [this._playerInterface, 'Position']),
                new GLib.VariantType('(v)'), Gio.DBusCallFlags.NONE, 3000, this._cancellable,
                (connection, result) => {
                    this._refreshPending = false;
                    try {
                        const value = Number(connection.call_finish(result).recursiveUnpack()[0]);
                        if (!Number.isFinite(value) || track !== this._track || anchor !== this._lastTimestampUs || epoch !== this._positionEpoch || !this._proxy) {
                            resolve(false);
                            return;
                        }
                        const now = this._timeProvider();
                        const delay = this._playbackStatus === 'Playing' ? Math.max(0, now - started) / 2 * this._rate : 0;
                        this._lastPositionUs = Math.max(0, value + delay);
                        this._lastTimestampUs = now;
                        resolve(true);
                    } catch (e) {
                        resolve(false);
                    }
                });
        });
    }

    get track() {
        return this._track;
    }

    getTrack() {
        return this._track;
    }

    getMetadata() {
        return this._track;
    }

    /**
     * Converts any track identifier (Spotify URI, arbitrary string, or existing path)
     * into a guaranteed valid D-Bus ObjectPath suitable for GLib.Variant('(ox)', ...).
     * @param {string|any} trackId
     * @returns {string} Valid D-Bus ObjectPath
     */
    static toObjectPath(trackId) {
        if (!trackId || typeof trackId !== 'string') {
            return '/org/mpris/MediaPlayer2/Track/1';
        }

        const path = trackId.trim();

        // 1. If already valid D-Bus object path, return immediately
        if (GLib.Variant.is_object_path(path)) {
            return path;
        }

        // 2. Convert Spotify URI schemas (spotify:track:<id>, spotify:ad:<id>, etc.)
        if (path.startsWith('spotify:')) {
            const parts = path.split(':');
            if (parts.length >= 3) {
                const type = parts[1].replace(/[^a-zA-Z0-9_]/g, '_');
                const id = parts.slice(2).join('_').replace(/[^a-zA-Z0-9_]/g, '_');
                if (type.length > 0 && id.length > 0) {
                    const candidate = `/com/spotify/${type}/${id}`;
                    if (GLib.Variant.is_object_path(candidate)) {
                        return candidate;
                    }
                }
            } else if (parts.length === 2) {
                const id = parts[1].replace(/[^a-zA-Z0-9_]/g, '_');
                if (id.length > 0) {
                    const candidate = `/com/spotify/${id}`;
                    if (GLib.Variant.is_object_path(candidate)) {
                        return candidate;
                    }
                }
            }
        }

        // 3. If starts with '/', sanitize elements and remove duplicate/trailing slashes
        if (path.startsWith('/')) {
            const parts = path.split('/');
            const cleaned = parts
                .map((seg, i) => (i === 0 ? '' : seg.replace(/[^a-zA-Z0-9_]/g, '_')))
                .filter((seg, i) => i === 0 || seg.length > 0);
            const sanitized = cleaned.length === 1 ? '/' : cleaned.join('/');
            if (GLib.Variant.is_object_path(sanitized)) {
                return sanitized;
            }
        }

        // 4. Guaranteed fallback valid object path
        return '/org/mpris/MediaPlayer2/Track/1';
    }

    toObjectPath(trackId) {
        return SpotifyMPRIS.toObjectPath(trackId);
    }

    /**
     * Parses MPRIS metadata variant or plain object into sanitized TrackMetadata.
     * @param {GLib.Variant|Object|null} raw
     * @returns {Object}
     */
    static parseMetadata(raw) {
        if (!raw) {
            return {
                trackId: '',
                title: '',
                artist: '',
                album: '',
                artUrl: '',
                durationMs: 0,
                isAd: false,
                rawTrackId: '',
                trackPath: '/org/mpris/MediaPlayer2/Track/1',
            };
        }

        const dict = (typeof raw.recursiveUnpack === 'function')
            ? raw.recursiveUnpack()
            : raw;

        if (!dict || typeof dict !== 'object' || Array.isArray(dict)) {
            return {
                trackId: '',
                title: '',
                artist: '',
                album: '',
                artUrl: '',
                durationMs: 0,
                isAd: false,
                rawTrackId: '',
                trackPath: '/org/mpris/MediaPlayer2/Track/1',
            };
        }

        const title = (dict['xesam:title'] || '').toString().trim();

        let artist = '';
        const rawArtist = dict['xesam:artist'];
        if (Array.isArray(rawArtist)) {
            artist = rawArtist
                .map(a => (a || '').toString().trim())
                .filter(Boolean)
                .join(', ');
        } else if (typeof rawArtist === 'string') {
            artist = rawArtist.trim();
        }

        const album = (dict['xesam:album'] || '').toString().trim();

        let rawTrackId = (dict['mpris:trackid'] || dict['xesam:url'] || '').toString().trim();
        let isAd = false;
        if (
            rawTrackId.includes('/ad/') ||
            rawTrackId.includes(':ad:') ||
            title.toLowerCase() === 'advertisement' ||
            (title.toLowerCase() === 'spotify' && artist.toLowerCase() === 'spotify')
        ) {
            isAd = true;
        }

        const trackId = rawTrackId.replace(/^(\/com\/spotify\/track\/|spotify:track:)/, '');
        const trackPath = SpotifyMPRIS.toObjectPath(rawTrackId);

        let rawLength = dict['mpris:length'] ?? dict['xesam:length'];
        if (rawLength && typeof rawLength.deepUnpack === 'function') {
            rawLength = rawLength.deepUnpack();
        } else if (rawLength && typeof rawLength.unpack === 'function') {
            rawLength = rawLength.unpack();
        }
        const numLength = Number(rawLength);
        const durationMs = (Number.isFinite(numLength) && numLength > 0)
            ? Math.round(numLength / 1000)
            : 0;

        const artUrl = (dict['mpris:artUrl'] || '').toString().trim();

        return {
            trackId,
            title,
            artist,
            album,
            artUrl,
            durationMs,
            isAd,
            rawTrackId,
            trackPath,
        };
    }

    static unpackMetadata(raw) {
        return SpotifyMPRIS.parseMetadata(raw);
    }

    parseMetadata(raw) {
        return SpotifyMPRIS.parseMetadata(raw);
    }

    unpackMetadata(raw) {
        return SpotifyMPRIS.parseMetadata(raw);
    }

    /**
     * Returns the current playback position in milliseconds using monotonic time interpolation.
     * @returns {number}
     */
    getPositionMs() {
        if (!this._isAvailable || this._playbackStatus === 'Stopped') {
            return 0;
        }

        let posUs = this._lastPositionUs;
        if (this._playbackStatus === 'Playing' && this._lastTimestampUs > 0) {
            const nowUs = this._timeProvider();
            const deltaUs = nowUs - this._lastTimestampUs;
            if (deltaUs > 0) {
                posUs += deltaUs * this._rate;
            }
        }

        if (this._durationUs > 0 && posUs > this._durationUs) {
            posUs = this._durationUs;
        }

        return Math.max(0, Math.floor(posUs / 1000));
    }

    _initDBus() {
        this._setupProxy();
        if (!this._proxy) return;
        this._appProxy = this._proxy;
        this._appOwnerId = this._appProxy.connect('notify::g-name-owner', () => this._selectPlayer());
        this._watchWebPlayers();
        this._selectPlayer();
    }

    // Browser players come and go with their media; each gets a proxy whose
    // changes may make it the one to follow.
    _watchWebPlayers() {
        const bus = Gio.DBus.session;
        this._webOwnerSubId = bus.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus',
            'NameOwnerChanged', '/org/freedesktop/DBus', 'org.mpris.MediaPlayer2',
            Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE, (_conn, _sender, _path, _iface, _signal, params) => {
                const [name, , newOwner] = params.deepUnpack();
                if (!isBrowserPlayer(name)) return;
                if (newOwner) this._addWebPlayer(name);
                else this._removeWebPlayer(name);
            });
        bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
            null, new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1, this._cancellable, (conn, result) => {
                let names = [];
                try { [names] = conn.call_finish(result).deepUnpack(); } catch (_) { return; }
                names.filter(isBrowserPlayer).forEach(name => this._addWebPlayer(name));
            });
    }

    _addWebPlayer(name) {
        if (this._webProxies.has(name) || !this._cancellable) return;
        this._webProxies.set(name, null);
        Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.DO_NOT_AUTO_START, null, name,
            this._objectPath, this._playerInterface, this._cancellable, (_source, result) => {
                let proxy;
                try {
                    proxy = Gio.DBusProxy.new_for_bus_finish(result);
                } catch (_) {
                    if (this._webProxies.get(name) === null) this._webProxies.delete(name);
                    return;
                }
                // The browser may have let the name go meanwhile.
                if (this._webProxies.get(name) !== null) return;
                const changedId = proxy.connect('g-properties-changed', () => this._selectPlayer());
                this._webProxies.set(name, {proxy, changedId});
                this._selectPlayer();
            });
    }

    _removeWebPlayer(name) {
        const entry = this._webProxies.get(name);
        this._webProxies.delete(name);
        if (!entry) return;
        entry.proxy.disconnect(entry.changedId);
        if (entry.proxy === this._proxy) this._selectPlayer();
    }

    // The Spotify app comes first. Otherwise a browser playing the Web Player;
    // the one already followed keeps its place unless it stops and another
    // plays.
    _bestPlayer() {
        if (this._appProxy?.g_name_owner) return this._appProxy;
        const playing = proxy => proxy.get_cached_property('PlaybackStatus')?.unpack() === 'Playing';
        const web = [...this._webProxies.values()]
            .filter(entry => entry?.proxy.g_name_owner && isSpotifyWebMetadata(entry.proxy.get_cached_property('Metadata')))
            .map(entry => entry.proxy);
        if (web.includes(this._proxy) && (playing(this._proxy) || !web.some(playing))) return this._proxy;
        return web.find(playing) ?? web[0] ?? this._appProxy;
    }

    _selectPlayer() {
        const target = this._bestPlayer();
        if (!target) return;
        if (target === this._proxy) this._handlePlayerAvailable(Boolean(target.g_name_owner));
        else this._switchProxy(target);
    }

    _switchProxy(proxy) {
        const wasAvailable = this._isAvailable;
        this._detachProxy();
        this._attachProxy(proxy, false);
        this._busName = proxy.g_name;
        this._isWeb = proxy !== this._appProxy;
        ++this._positionEpoch;
        const available = Boolean(proxy.g_name_owner);
        if (!available || !wasAvailable) {
            this._handlePlayerAvailable(available);
            return;
        }
        // From one playing source to another: show the new song at once.
        this._track = null;
        this._updateMetadata(proxy.get_cached_property('Metadata'));
        this._updateFromProxy();
    }

    _detachProxy() {
        if (!this._proxy) return;
        for (const key of ['_propChangedId', '_signalId', '_nameOwnerId']) {
            if (this[key]) this._proxy.disconnect(this[key]);
            this[key] = 0;
        }
        this._proxy = null;
    }

    _attachProxy(proxy, autoCheckOwner = true) {
        this._proxy = proxy;

        this._propChangedId = this._proxy.connect(
            'g-properties-changed',
            this._onPropertiesChanged.bind(this)
        );

        this._signalId = this._proxy.connect(
            'g-signal',
            this._onSignal.bind(this)
        );

        this._nameOwnerId = this._proxy.connect(
            'notify::g-name-owner',
            () => {
                // When following browsers too, the app's own watcher decides.
                if (this._appProxy) {
                    if (this._proxy !== this._appProxy) this._selectPlayer();
                    return;
                }
                const owner = this._proxy ? this._proxy.g_name_owner : null;
                this._handlePlayerAvailable(Boolean(owner));
            }
        );

        if (autoCheckOwner && this._proxy.g_name_owner) {
            this._handlePlayerAvailable(true);
        }
    }

    _setupProxy() {
        try {
            const proxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.DO_NOT_AUTO_START,
                null,
                this._busName,
                this._objectPath,
                this._playerInterface,
                this._cancellable
            );

            this._attachProxy(proxy);
        } catch (e) {
            console.error(`[SpotifyMPRIS] Error creating D-Bus proxy: ${e.message}`);
        }
    }

    _handlePlayerAvailable(available) {
        if (this._isAvailable === available) {
            return;
        }

        this._isAvailable = available;

        if (available) {
            this._updateFromProxy();
            this.emit('player-available', true);
        } else {
            this._playbackStatus = 'Stopped';
            this._track = null;
            this._lastPositionUs = 0;
            this._lastTimestampUs = 0;
            this._durationUs = 0;
            this._rawTrackId = '';
            this._trackPath = '';
            this.emit('status-changed', 'Stopped');
            this.emit('player-available', false);
        }
    }

    _updateFromProxy() {
        if (!this._proxy || !this._proxy.g_name_owner) {
            return;
        }

        const metaVariant = this._proxy.get_cached_property('Metadata');
        if (metaVariant) {
            this._updateMetadata(metaVariant);
        }

        const posVariant = this._proxy.get_cached_property('Position');
        if (posVariant) {
            this._lastPositionUs = Math.max(0, Number(posVariant.unpack()));
        } else {
            this._lastPositionUs = 0;
        }
        this._lastTimestampUs = this._timeProvider();

        const rateVariant = this._proxy.get_cached_property('Rate');
        this._rate = rateVariant ? Number(rateVariant.unpack()) : 1.0;

        const statusVariant = this._proxy.get_cached_property('PlaybackStatus');
        const newStatus = statusVariant ? statusVariant.unpack() : 'Stopped';
        this._updatePlaybackStatus(newStatus);
        // Chromium does not announce position changes, so the cached one
        // can be old.
        if (this._isWeb) this.refreshPosition();
    }

    _onPropertiesChanged(proxy, changedProperties, invalidatedProperties) {
        if (!changedProperties) {
            return;
        }

        const changed = (typeof changedProperties.recursiveUnpack === 'function')
            ? changedProperties.recursiveUnpack()
            : changedProperties;

        if (!changed || typeof changed !== 'object' || Array.isArray(changed)) {
            return;
        }

        if ('Metadata' in changed) {
            this._updateMetadata(changed.Metadata);
        }

        if ('Rate' in changed) {
            const now = this._timeProvider();
            if (this._playbackStatus === 'Playing' && this._lastTimestampUs > 0)
                this._lastPositionUs += Math.max(0, now - this._lastTimestampUs) * this._rate;
            this._lastTimestampUs = now;
            ++this._positionEpoch;
            const numRate = Number(changed.Rate);
            this._rate = (Number.isFinite(numRate) && numRate > 0) ? numRate : 1.0;
        }

        if ('PlaybackStatus' in changed) {
            this._updatePlaybackStatus(changed.PlaybackStatus);
        }
        if ('Position' in changed) this._onSeeked(changed.Position);
    }

    _updateMetadata(rawMetadata) {
        const newTrack = SpotifyMPRIS.parseMetadata(rawMetadata);
        // Browser track ids are not Spotify's: Firefox uses one for every
        // song. Songs are told apart by title and artist instead.
        if (this._isWeb) newTrack.trackId = '';
        const isDifferentTrack = !this._track ||
            (newTrack.trackId && newTrack.trackId !== this._track.trackId) ||
            (!newTrack.trackId && (newTrack.title !== this._track.title || newTrack.artist !== this._track.artist));

        this._rawTrackId = newTrack.rawTrackId || '';
        this._trackPath = newTrack.trackPath || SpotifyMPRIS.toObjectPath(this._rawTrackId);
        this._durationUs = (newTrack.durationMs || 0) * 1000;
        this._track = newTrack;

        if (isDifferentTrack) {
            this._lastPositionUs = 0;
            this._lastTimestampUs = this._timeProvider();
        }

        this.emit('track-changed', this._track);
    }

    _updatePlaybackStatus(newStatus) {
        if (this._playbackStatus === newStatus) {
            return;
        }
        ++this._positionEpoch;

        const nowUs = this._timeProvider();
        if (this._playbackStatus === 'Playing' && this._lastTimestampUs > 0) {
            const deltaUs = nowUs - this._lastTimestampUs;
            if (deltaUs > 0) {
                this._lastPositionUs += deltaUs * this._rate;
            }
        }

        this._playbackStatus = newStatus;
        this._lastTimestampUs = nowUs;

        if (newStatus === 'Stopped') {
            this._lastPositionUs = 0;
            this._lastTimestampUs = 0;
        }

        this.emit('status-changed', this._playbackStatus);
    }

    _onSignal(proxy, senderName, signalName, parameters) {
        if (signalName === 'Seeked') {
            const params = (parameters && typeof parameters.recursiveUnpack === 'function')
                ? parameters.recursiveUnpack()
                : parameters;
            const newPositionUs = Array.isArray(params) ? params[0] : params;
            this._onSeeked(newPositionUs);
        }
    }

    _onSeeked(newPositionUs) {
        ++this._positionEpoch;
        this._lastPositionUs = Math.max(0, Number(newPositionUs) || 0);
        this._lastTimestampUs = this._timeProvider();
        const positionMs = Math.floor(this._lastPositionUs / 1000);
        this.emit('seeked', positionMs);
    }

    _callPlayerMethod(methodName, parameters = null) {
        if (!this._proxy || !this._proxy.g_name_owner) {
            return Promise.reject(new Error(`[SpotifyMPRIS] Cannot call ${methodName}: Spotify is not running`));
        }

        return new Promise((resolve, reject) => {
            this._proxy.call(
                methodName,
                parameters,
                Gio.DBusCallFlags.NONE,
                -1,
                this._cancellable,
                (proxy, res) => {
                    try {
                        let reply = null;
                        if (proxy && typeof proxy.call_finish === 'function') {
                            reply = proxy.call_finish(res);
                        } else if (res && typeof res.call_finish === 'function') {
                            reply = res.call_finish(res);
                        }
                        resolve(reply);
                    } catch (e) {
                        if (e && typeof e.matches === 'function' && e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                            resolve(null);
                        } else {
                            reject(e);
                        }
                    }
                }
            );
        });
    }

    async playPause() {
        if (this._proxy && typeof this._proxy.PlayPauseRemote === 'function') {
            this._proxy.PlayPauseRemote();
            return;
        }
        return this._callPlayerMethod('PlayPause');
    }

    async next() {
        if (this._proxy && typeof this._proxy.NextRemote === 'function') {
            this._proxy.NextRemote();
            return;
        }
        return this._callPlayerMethod('Next');
    }

    async previous() {
        if (this._proxy && typeof this._proxy.PreviousRemote === 'function') {
            this._proxy.PreviousRemote();
            return;
        }
        return this._callPlayerMethod('Previous');
    }

    async setPosition(positionMs) {
        const numPos = Number(positionMs);
        const positionUs = (Number.isFinite(numPos) && numPos > 0)
            ? Math.round(numPos * 1000)
            : 0;

        const rawTrackId = this._rawTrackId || (this._track && this._track.rawTrackId) || '';
        const trackPath = this._trackPath || SpotifyMPRIS.toObjectPath(rawTrackId);

        if (this._proxy && typeof this._proxy.SetPositionRemote === 'function') {
            this._proxy.SetPositionRemote(trackPath, positionUs);
            return;
        }

        const params = new GLib.Variant('(ox)', [trackPath, positionUs]);
        return this._callPlayerMethod('SetPosition', params);
    }

    destroy() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        if (this._webOwnerSubId) {
            Gio.DBus.session.signal_unsubscribe(this._webOwnerSubId);
            this._webOwnerSubId = 0;
        }
        for (const entry of this._webProxies.values())
            if (entry) entry.proxy.disconnect(entry.changedId);
        this._webProxies.clear();
        if (this._appOwnerId) {
            this._appProxy.disconnect(this._appOwnerId);
            this._appOwnerId = 0;
        }
        this._appProxy = null;

        if (this._proxy) {
            if (this._propChangedId) {
                this._proxy.disconnect(this._propChangedId);
                this._propChangedId = 0;
            }
            if (this._signalId) {
                this._proxy.disconnect(this._signalId);
                this._signalId = 0;
            }
            if (this._nameOwnerId) {
                this._proxy.disconnect(this._nameOwnerId);
                this._nameOwnerId = 0;
            }
            this._proxy = null;
        }

        this._isAvailable = false;
        this._playbackStatus = 'Stopped';
        this._track = null;
        this._lastPositionUs = 0;
        this._lastTimestampUs = 0;
        this._durationUs = 0;
        this._rawTrackId = '';
        this._trackPath = '';
    }
});

export default SpotifyMPRIS;
