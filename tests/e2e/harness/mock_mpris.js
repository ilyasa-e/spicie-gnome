/**
 * Mock D-Bus Session Proxy simulating org.mpris.MediaPlayer2.spotify
 */

import { SAMPLE_MPRIS_DATA } from '../fixtures/sample_mpris_data.js';

export class MockSpotifyDBusProxy {
    constructor(initialState = {}) {
        this.nameOwner = initialState.nameOwner !== undefined ? initialState.nameOwner : ':1.99';
        this.playbackStatus = initialState.playbackStatus || 'Playing';
        this.metadata = initialState.metadata || { ...SAMPLE_MPRIS_DATA.standardTrack };
        this.positionUs = initialState.positionUs || 0; // Microseconds
        this.baseMonotonicUs = Date.now() * 1000;
        this.basePositionUs = this.positionUs;

        this.listeners = new Map();
        this.methodCalls = [];
        this.destroyed = false;
    }

    get g_name_owner() {
        return this.nameOwner;
    }

    connect(signal, cb) {
        if (!this.listeners.has(signal)) {
            this.listeners.set(signal, new Set());
        }
        this.listeners.get(signal).add(cb);
        return cb;
    }

    disconnect(cb) {
        for (const [_, set] of this.listeners) {
            set.delete(cb);
        }
    }

    _emit(signal, ...args) {
        if (this.destroyed) return;
        if (this.listeners.has(signal)) {
            for (const cb of this.listeners.get(signal)) {
                try { cb(this, ...args); } catch (e) { console.error(`Error in signal ${signal}:`, e); }
            }
        }
    }

    get_cached_property(key) {
        if (key === 'Metadata') {
            return {
                unpack: () => this.metadata,
                recursiveUnpack: () => this.metadata
            };
        }
        if (key === 'PlaybackStatus') {
            return {
                unpack: () => this.playbackStatus,
                recursiveUnpack: () => this.playbackStatus
            };
        }
        if (key === 'Position') {
            return {
                unpack: () => this.getCurrentPositionUs(),
                recursiveUnpack: () => this.getCurrentPositionUs()
            };
        }
        if (key === 'Rate') {
            return {
                unpack: () => 1.0,
                recursiveUnpack: () => 1.0
            };
        }
        return null;
    }

    call(methodName, parameters, flags, timeout, cancellable, callback) {
        let posUs = 0;
        if (parameters && typeof parameters.recursiveUnpack === 'function') {
            const unpacked = parameters.recursiveUnpack();
            posUs = Array.isArray(unpacked) ? unpacked[1] : 0;
        } else if (Array.isArray(parameters)) {
            posUs = parameters[1] || parameters[0] || 0;
        }

        this.methodCalls.push({ method: methodName, parameters, positionUs: posUs });
        if (methodName === 'PlayPause') {
            this.setPlaybackStatus(this.playbackStatus === 'Playing' ? 'Paused' : 'Playing');
        } else if (methodName === 'Seek') {
            const offsetUs = posUs || 0;
            const newPos = Math.max(0, this.getCurrentPositionUs() + offsetUs);
            this.setPositionUs(newPos);
            this._emit('g-signal', 'org.mpris.MediaPlayer2.spotify', 'Seeked', [newPos]);
            this._emit('Seeked', newPos);
        } else if (methodName === 'SetPosition') {
            this.setPositionUs(posUs);
            this._emit('g-signal', 'org.mpris.MediaPlayer2.spotify', 'Seeked', [posUs]);
            this._emit('Seeked', posUs);
        }
        if (typeof callback === 'function') {
            callback(this, {});
        }
    }

    call_finish(res) {
        return null;
    }

    // Legacy / direct simulation Methods
    PlayPauseRemote() {
        this.methodCalls.push({ method: 'PlayPause' });
        this.setPlaybackStatus(this.playbackStatus === 'Playing' ? 'Paused' : 'Playing');
    }

    NextRemote() {
        this.methodCalls.push({ method: 'Next' });
    }

    PreviousRemote() {
        this.methodCalls.push({ method: 'Previous' });
    }

    SeekRemote(offsetUs) {
        this.methodCalls.push({ method: 'Seek', offsetUs });
        const newPos = Math.max(0, this.getCurrentPositionUs() + offsetUs);
        this.setPositionUs(newPos);
        this._emit('g-signal', 'org.mpris.MediaPlayer2.spotify', 'Seeked', [newPos]);
        this._emit('Seeked', newPos);
    }

    SetPositionRemote(trackId, positionUs) {
        this.methodCalls.push({ method: 'SetPosition', trackId, positionUs });
        this.setPositionUs(positionUs);
        this._emit('g-signal', 'org.mpris.MediaPlayer2.spotify', 'Seeked', [positionUs]);
        this._emit('Seeked', positionUs);
    }

    // Simulated environment helpers
    getCurrentPositionUs() {
        if (this.playbackStatus !== 'Playing') {
            return this.basePositionUs;
        }
        const nowUs = Date.now() * 1000;
        const elapsed = nowUs - this.baseMonotonicUs;
        const maxUs = this.metadata['mpris:length'] || 0;
        const estimated = this.basePositionUs + elapsed;
        return maxUs > 0 ? Math.min(estimated, maxUs) : estimated;
    }

    getCurrentPositionMs() {
        return Math.floor(this.getCurrentPositionUs() / 1000);
    }

    setPositionUs(us) {
        this.basePositionUs = us;
        this.baseMonotonicUs = Date.now() * 1000;
        this.positionUs = us;
    }

    setPositionMs(ms) {
        this.setPositionUs(ms * 1000);
    }

    setPlaybackStatus(status) {
        if (this.playbackStatus === status) return;
        // Freeze or resume position
        this.basePositionUs = this.getCurrentPositionUs();
        this.baseMonotonicUs = Date.now() * 1000;
        this.playbackStatus = status;

        const payload = {
            PlaybackStatus: {
                unpack: () => status,
                recursiveUnpack: () => status
            }
        };

        this._emit('g-properties-changed', {
            unpack: () => payload,
            recursiveUnpack: () => ({ PlaybackStatus: status })
        }, []);
    }

    setMetadata(meta) {
        this.metadata = meta;
        this.basePositionUs = 0;
        this.baseMonotonicUs = Date.now() * 1000;

        const payload = {
            Metadata: {
                unpack: () => meta,
                recursiveUnpack: () => meta
            }
        };

        this._emit('g-properties-changed', {
            unpack: () => payload,
            recursiveUnpack: () => ({ Metadata: meta })
        }, []);
    }

    simulateSeek(newPositionMs) {
        const newPosUs = newPositionMs * 1000;
        this.setPositionUs(newPosUs);
        this._emit('g-signal', 'org.mpris.MediaPlayer2.spotify', 'Seeked', [newPosUs]);
        this._emit('Seeked', newPosUs);
    }

    simulatePlayerDied() {
        this.nameOwner = null;
        this._emit('notify::g-name-owner');
    }

    simulatePlayerStarted() {
        this.nameOwner = ':1.105';
        this._emit('notify::g-name-owner');
    }

    destroy() {
        this.destroyed = true;
        this.listeners.clear();
    }
}
