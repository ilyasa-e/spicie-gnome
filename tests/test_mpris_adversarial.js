#!/usr/bin/env gjs -m

/**
 * Adversarial Stress Test Suite for Spotify MPRIS D-Bus Client (Milestone 1)
 *
 * Actively stress-tests:
 * 1. Rapid seek stress tests (hundreds of seeks in short time frames)
 * 2. Wild monotonic clock deltas (negative deltas, large leaps, overflow)
 * 3. Corrupt metadata variants (numeric keys, empty dicts, deep nesting, strings, durations)
 * 4. Rapid track changes while playing and paused
 * 5. Rapid proxy destruction and reconstruction, listener leaks, and post-destroy calls
 * 6. Edge case bug hunting (URI trackId in setPosition, non-numeric durationMs, malformed PropertiesChanged)
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import System from 'system';

import { SpotifyMPRIS } from '../mpris.js';

let totalSuites = 0;
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

const ANSI_GREEN = '\x1b[32m';
const ANSI_RED = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_RESET = '\x1b[0m';

async function describe(suiteName, suiteFn) {
    totalSuites++;
    console.log(`\n${ANSI_BOLD}=== Adversarial Suite: ${suiteName} ===${ANSI_RESET}`);
    await suiteFn();
}

function test(testName, testFn) {
    totalTests++;
    try {
        testFn();
        passedTests++;
        console.log(`  ${ANSI_GREEN}✓${ANSI_RESET} ${testName}`);
    } catch (e) {
        failedTests++;
        console.error(`  ${ANSI_RED}✗ ${testName}${ANSI_RESET}`);
        console.error(`    ${ANSI_RED}Error: ${e.message}${ANSI_RESET}`);
        if (e.stack) {
            const cleanStack = e.stack.split('\n').slice(0, 4).map(l => `      ${l}`).join('\n');
            console.error(cleanStack);
        }
    }
}

async function testAsync(testName, testFn) {
    totalTests++;
    try {
        await testFn();
        passedTests++;
        console.log(`  ${ANSI_GREEN}✓${ANSI_RESET} ${testName}`);
    } catch (e) {
        failedTests++;
        console.error(`  ${ANSI_RED}✗ ${testName}${ANSI_RESET}`);
        console.error(`    ${ANSI_RED}Error: ${e.message}${ANSI_RESET}`);
        if (e.stack) {
            const cleanStack = e.stack.split('\n').slice(0, 4).map(l => `      ${l}`).join('\n');
            console.error(cleanStack);
        }
    }
}

function assert(condition, message = 'Assertion failed') {
    if (!condition) {
        throw new Error(message);
    }
}

function assertEquals(actual, expected, message = '') {
    if (actual !== expected) {
        const prefix = message ? `${message}: ` : '';
        throw new Error(`${prefix}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

class MockDBusProxy {
    constructor() {
        this._listeners = new Map();
        this.g_name_owner = ':1.42';
        this.PlaybackStatus = 'Stopped';
        this.Metadata = {};
        this.Position = 0;
        this.Rate = 1.0;
        this.methodCalls = [];
        this.delayCalls = false;
    }

    connect(signal, callback) {
        if (!this._listeners.has(signal)) {
            this._listeners.set(signal, new Set());
        }
        const id = Math.floor(Math.random() * 10000000) + 1;
        this._listeners.get(signal).add({ id, callback });
        return id;
    }

    disconnect(id) {
        for (const handlers of this._listeners.values()) {
            for (const h of handlers) {
                if (h.id === id) {
                    handlers.delete(h);
                    return;
                }
            }
        }
    }

    getListenerCount() {
        let count = 0;
        for (const handlers of this._listeners.values()) {
            count += handlers.size;
        }
        return count;
    }

    emit(signal, ...args) {
        const handlers = this._listeners.get(signal);
        if (handlers) {
            for (const h of Array.from(handlers)) {
                h.callback(this, ...args);
            }
        }
    }

    get_cached_property(name) {
        if (name === 'PlaybackStatus') return new GLib.Variant('s', this.PlaybackStatus);
        if (name === 'Position') return new GLib.Variant('x', this.Position);
        if (name === 'Rate') return new GLib.Variant('d', this.Rate);
        if (name === 'Metadata') {
            return this.Metadata instanceof GLib.Variant
                ? this.Metadata
                : new GLib.Variant('a{sv}', {});
        }
        return null;
    }

    call_finish(res) {
        if (res && res._error) {
            throw res._error;
        }
        return new GLib.Variant('()', []);
    }

    call(methodName, params, flags, timeout, cancellable, callback) {
        this.methodCalls.push({ methodName, params });
        let handled = false;
        if (cancellable) {
            if (cancellable.is_cancelled()) {
                handled = true;
                if (typeof callback === 'function') {
                    callback(this, {
                        _error: new Gio.IOErrorEnum({
                            code: Gio.IOErrorEnum.CANCELLED,
                            message: 'Operation was cancelled',
                        }),
                    });
                }
                return;
            }
            cancellable.connect(() => {
                if (!handled && typeof callback === 'function') {
                    handled = true;
                    callback(this, {
                        _error: new Gio.IOErrorEnum({
                            code: Gio.IOErrorEnum.CANCELLED,
                            message: 'Operation was cancelled',
                        }),
                    });
                }
            });
        }

        if (!this.delayCalls && !handled && typeof callback === 'function') {
            handled = true;
            callback(this, {});
        }
    }
}

async function runAdversarialSuites() {

    // =========================================================================
    // Suite 1: Rapid Seek Stress Tests
    // =========================================================================
    await describe('1. Rapid Seek Stress Tests', async () => {
        test('1.1 Burst of 1,000 rapid seeks oscillating back and forth', () => {
            let fakeTime = 1000000;
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({
                proxy,
                timeProvider: () => fakeTime,
            });

            player._updateMetadata({
                'mpris:trackid': '/com/spotify/track/seek_test',
                'xesam:title': 'Seek Test',
                'mpris:length': 300000000, // 300s
            });
            player._updatePlaybackStatus('Playing');

            let seekCount = 0;
            player.connect('seeked', () => {
                seekCount++;
            });

            for (let i = 0; i < 1000; i++) {
                const targetUs = (i % 2 === 0) ? (i * 200000) : (50000000 - i * 10000);
                fakeTime += 100; // tiny 100us step
                proxy.emit('g-signal', 'org.mpris.MediaPlayer2.Player', 'Seeked', new GLib.Variant('(x)', [targetUs]));
                const posMs = player.getPositionMs();
                assert(posMs >= 0, `Position went negative during burst seek: ${posMs}`);
            }

            assertEquals(seekCount, 1000, 'All 1,000 seeks must emit seeked signal');
            player.destroy();
        });

        test('1.2 Zero time elapsed seeks (instantaneous seek collisions)', () => {
            const fakeTime = 5000000;
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({
                proxy,
                timeProvider: () => fakeTime,
            });

            player._updateMetadata({
                'mpris:trackid': '/com/spotify/track/seek_instant',
                'xesam:title': 'Instant Seeks',
                'mpris:length': 200000000,
            });
            player._updatePlaybackStatus('Playing');

            for (let i = 0; i < 500; i++) {
                proxy.emit('g-signal', 'org.mpris.MediaPlayer2.Player', 'Seeked', new GLib.Variant('(x)', [i * 100000]));
            }

            const finalPos = player.getPositionMs();
            assertEquals(finalPos, 49900, 'Final position should match last seeked value');
            player.destroy();
        });

        test('1.3 Seeks beyond track duration clamp safely in getPositionMs', () => {
            let fakeTime = 1000000;
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({
                proxy,
                timeProvider: () => fakeTime,
            });

            player._updateMetadata({
                'mpris:trackid': '/com/spotify/track/seek_clamp',
                'xesam:title': 'Clamp Test',
                'mpris:length': 180000000, // 180s = 180,000ms
            });
            player._updatePlaybackStatus('Playing');

            // Seek way past song end (5,000s)
            proxy.emit('g-signal', 'org.mpris.MediaPlayer2.Player', 'Seeked', new GLib.Variant('(x)', [5000000000]));
            const clampedPos = player.getPositionMs();
            assertEquals(clampedPos, 180000, 'Position must clamp to durationMs (180000ms)');

            player.destroy();
        });

        test('1.4 Seeks with negative position values clamp to 0', () => {
            let fakeTime = 1000000;
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({
                proxy,
                timeProvider: () => fakeTime,
            });

            player._updateMetadata({
                'mpris:trackid': '/com/spotify/track/seek_neg',
                'xesam:title': 'Neg Seek',
                'mpris:length': 180000000,
            });
            player._updatePlaybackStatus('Playing');

            proxy.emit('g-signal', 'org.mpris.MediaPlayer2.Player', 'Seeked', new GLib.Variant('(x)', [-50000000]));
            const pos = player.getPositionMs();
            assertEquals(pos, 0, 'Negative seek must clamp to 0');

            player.destroy();
        });

        await testAsync('1.5 Concurrent 200 setPosition calls with object path trackId execute without crashing', async () => {
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({
                proxy,
            });

            player._updateMetadata({
                'mpris:trackid': '/com/spotify/track/concurrent_seek',
                'xesam:title': 'Concurrent Seek',
                'mpris:length': 200000000,
            });

            const promises = [];
            for (let i = 0; i < 200; i++) {
                promises.push(player.setPosition(i * 500));
            }

            await Promise.all(promises);
            assertEquals(proxy.methodCalls.length, 200, 'All 200 setPosition calls dispatched');
            player.destroy();
        });
    });

    // =========================================================================
    // Suite 2: Wild Monotonic Clock Deltas & Arithmetic Anomalies
    // =========================================================================
    await describe('2. Wild Monotonic Clock Deltas & Arithmetic Anomalies', async () => {
        test('2.1 Clock going backwards (negative delta: -10s, -1hr)', () => {
            let fakeTime = 100000000; // 100s
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({
                proxy,
                timeProvider: () => fakeTime,
            });

            player._updateMetadata({
                'mpris:trackid': '/com/spotify/track/clock_warp',
                'xesam:title': 'Time Warp',
                'mpris:length': 300000000,
            });
            player._updatePlaybackStatus('Playing');

            // Advance 5 seconds
            fakeTime += 5000000;
            const pos1 = player.getPositionMs();
            assertEquals(pos1, 5000, 'Position advances 5s normally');

            // Clock steps backwards 10 seconds!
            fakeTime -= 10000000;
            const pos2 = player.getPositionMs();
            assertEquals(pos2, 0, 'Negative delta from origin clamped safely without underflow');

            // Clock steps backwards 1 hour
            fakeTime -= 3600000000;
            const pos3 = player.getPositionMs();
            assert(pos3 >= 0 && Number.isFinite(pos3), 'Huge negative delta remains finite and >= 0');

            player.destroy();
        });

        test('2.2 System suspend / sleep simulation (+8 hours forward leap)', () => {
            let fakeTime = 10000000;
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({
                proxy,
                timeProvider: () => fakeTime,
            });

            player._updateMetadata({
                'mpris:trackid': '/com/spotify/track/suspend_test',
                'xesam:title': 'Sleep Test',
                'mpris:length': 240000000, // 240s
            });
            player._updatePlaybackStatus('Playing');

            // Machine sleeps for 8 hours (28,800,000,000 us)
            fakeTime += 28800000000;
            const posAfterWake = player.getPositionMs();
            assertEquals(posAfterWake, 240000, 'Position cleanly clamped at song duration after wake');

            player.destroy();
        });

        test('2.3 Extreme clock values: Number.MAX_SAFE_INTEGER and Infinity', () => {
            let fakeTime = 1000000;
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({
                proxy,
                timeProvider: () => fakeTime,
            });

            player._updateMetadata({
                'mpris:trackid': '/com/spotify/track/extreme_clock',
                'xesam:title': 'Extreme Clock',
                'mpris:length': 120000000,
            });
            player._updatePlaybackStatus('Playing');

            fakeTime = Number.MAX_SAFE_INTEGER;
            const posMax = player.getPositionMs();
            assertEquals(posMax, 120000, 'Clamps at durationMs with MAX_SAFE_INTEGER');

            fakeTime = Infinity;
            const posInf = player.getPositionMs();
            assertEquals(posInf, 120000, 'Clamps at durationMs with Infinity');

            player.destroy();
        });

        test('2.4 Clock returning NaN or undefined does not corrupt state', () => {
            let fakeTime = 1000000;
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({
                proxy,
                timeProvider: () => fakeTime,
            });

            player._updateMetadata({
                'mpris:trackid': '/com/spotify/track/nan_clock',
                'xesam:title': 'NaN Clock',
                'mpris:length': 120000000,
            });
            player._updatePlaybackStatus('Playing');

            fakeTime += 10000000; // 10s
            const validPos = player.getPositionMs();
            assertEquals(validPos, 10000);

            // Clock returns NaN
            fakeTime = NaN;
            const nanPos = player.getPositionMs();
            assertEquals(nanPos, 0, 'NaN clock delta does not increment position past baseline');

            // Clock returns undefined
            fakeTime = undefined;
            const undefPos = player.getPositionMs();
            assertEquals(undefPos, 0, 'Undefined clock delta does not crash');

            player.destroy();
        });

        test('2.5 High-frequency microsecond jitter (+1us, -1us, 0us)', () => {
            let fakeTime = 10000000;
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({
                proxy,
                timeProvider: () => fakeTime,
            });

            player._updateMetadata({
                'mpris:trackid': '/com/spotify/track/jitter_clock',
                'xesam:title': 'Jitter Clock',
                'mpris:length': 120000000,
            });
            player._updatePlaybackStatus('Playing');

            for (let i = 0; i < 1000; i++) {
                fakeTime += (i % 2 === 0) ? 1 : -1;
                const pos = player.getPositionMs();
                assert(pos >= 0, 'Jitter caused negative position');
            }

            player.destroy();
        });
    });

    // =========================================================================
    // Suite 3: Malformed & Corrupt Metadata Variants
    // =========================================================================
    await describe('3. Malformed & Corrupt Metadata Variants', async () => {
        test('3.1 Non-object / primitive payloads do not throw exceptions', () => {
            const primitives = [42, true, false, 'hello', Symbol('sym'), [], 0, -1];
            for (const prim of primitives) {
                const parsed = SpotifyMPRIS.parseMetadata(prim);
                assert(typeof parsed === 'object', `parseMetadata(${String(prim)}) should return object`);
                assertEquals(parsed.trackId, '', 'trackId should be empty string for primitive');
                assertEquals(parsed.title, '', 'title should be empty string for primitive');
                assertEquals(parsed.durationMs, 0, 'durationMs should be 0 for primitive');
            }
        });

        test('3.2 Numeric keys and empty dictionaries in GLib.Variant', () => {
            const emptyVariant = new GLib.Variant('a{sv}', {});
            const parsedEmpty = SpotifyMPRIS.parseMetadata(emptyVariant);
            assertEquals(parsedEmpty.title, '');
            assertEquals(parsedEmpty.artist, '');
            assertEquals(parsedEmpty.durationMs, 0);

            const numericKeys = {
                1: 'first',
                2: 'second',
                'xesam:title': 'Valid Title',
            };
            const parsedNumeric = SpotifyMPRIS.parseMetadata(numericKeys);
            assertEquals(parsedNumeric.title, 'Valid Title');
            assertEquals(parsedNumeric.artist, '');
        });

        test('3.3 Deeply nested GLib.Variant unwraps correctly', () => {
            const deepVariant = new GLib.Variant('a{sv}', {
                'xesam:title': new GLib.Variant('v', new GLib.Variant('v', new GLib.Variant('s', 'Deep Title'))),
                'xesam:artist': new GLib.Variant('v', new GLib.Variant('as', ['Deep Artist'])),
                'mpris:length': new GLib.Variant('v', new GLib.Variant('x', 150000000)),
            });

            const parsed = SpotifyMPRIS.parseMetadata(deepVariant);
            assertEquals(parsed.title, 'Deep Title');
            assertEquals(parsed.artist, 'Deep Artist');
            assertEquals(parsed.durationMs, 150000);
        });

        test('3.4 Corrupt and non-standard xesam:artist representations', () => {
            const testCases = [
                { input: null, expected: '' },
                { input: 42, expected: '' },
                { input: ['Artist A', null, undefined, '', '   ', 'Artist B'], expected: 'Artist A, Artist B' },
                { input: ['   Single Artist   '], expected: 'Single Artist' },
                { input: { not: 'array' }, expected: '' },
                { input: [123, 456], expected: '123, 456' },
            ];

            for (const { input, expected } of testCases) {
                const parsed = SpotifyMPRIS.parseMetadata({ 'xesam:artist': input });
                assertEquals(parsed.artist, expected, `Failed on artist input ${JSON.stringify(input)}`);
            }
        });

        test('3.5 Malformed durations (negative, zero, massive, non-numeric)', () => {
            // Negative duration
            const neg = SpotifyMPRIS.parseMetadata({ 'mpris:length': -1000000 });
            assertEquals(neg.durationMs, 0, 'Negative duration should clamp to 0');

            // Zero duration
            const zero = SpotifyMPRIS.parseMetadata({ 'mpris:length': 0 });
            assertEquals(zero.durationMs, 0, 'Zero duration should be 0');

            // Massive duration (1e15 us)
            const huge = SpotifyMPRIS.parseMetadata({ 'mpris:length': 1e15 });
            assertEquals(huge.durationMs, 1e12, 'Huge duration scaled to ms');

            // BigInt length
            const bigint = SpotifyMPRIS.parseMetadata({ 'mpris:length': 180000000n });
            assertEquals(bigint.durationMs, 180000, 'BigInt duration scaled to ms');
        });

        test('3.6 Special characters: null bytes, emojis, newlines, RTL in title/artist', () => {
            const special = SpotifyMPRIS.parseMetadata({
                'xesam:title': 'Track \u0000 with \n newline and 🎵 emoji \u202ERTL',
                'xesam:artist': ['방탄소년단 (BTS)', 'Official髭男dism', 'Земфира'],
                'xesam:album': 'Albüm \uD83D\uDD25',
                'mpris:trackid': '/com/spotify/track/special_123',
            });

            assert(special.title.includes('🎵'), 'Emoji preserved');
            assertEquals(special.artist, '방탄소년단 (BTS), Official髭男dism, Земфира');
            assertEquals(special.trackId, 'special_123');
        });

        test('3.7 Advertisement detection with various Spotify ad formats', () => {
            const adCases = [
                { 'mpris:trackid': 'spotify:ad:123', expected: true },
                { 'mpris:trackid': '/com/spotify/ad/456', expected: true },
                { 'xesam:title': 'Advertisement', 'xesam:artist': 'Spotify', expected: true },
                { 'xesam:title': 'spotify', 'xesam:artist': 'spotify', expected: true },
                { 'xesam:title': 'Normal Song', 'mpris:trackid': 'spotify:track:abc', expected: false },
            ];

            for (const ac of adCases) {
                const parsed = SpotifyMPRIS.parseMetadata(ac);
                assertEquals(parsed.isAd, ac.expected, `Ad detection failed for ${JSON.stringify(ac)}`);
            }
        });
    });

    // =========================================================================
    // Suite 4: Rapid Track Transitions Under Dynamic Playback States
    // =========================================================================
    await describe('4. Rapid Track Transitions Under Dynamic Playback States', async () => {
        test('4.1 500 rapid track changes while Playing resets position to 0 each time', () => {
            let fakeTime = 1000000;
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({
                proxy,
                timeProvider: () => fakeTime,
            });

            player._updatePlaybackStatus('Playing');

            let trackChangeEvents = 0;
            player.connect('track-changed', () => {
                trackChangeEvents++;
            });

            for (let i = 0; i < 500; i++) {
                fakeTime += 1000000; // 1 second
                player._updateMetadata({
                    'mpris:trackid': `/com/spotify/track/track_${i}`,
                    'xesam:title': `Track ${i}`,
                    'xesam:artist': `Artist ${i}`,
                    'mpris:length': 200000000,
                });

                // Immediately after track change, position relative to new track must be 0
                const pos = player.getPositionMs();
                assertEquals(pos, 0, `Track transition ${i} must reset position to 0`);
            }

            assertEquals(trackChangeEvents, 500, '500 track-changed signals emitted');
            player.destroy();
        });

        test('4.2 500 rapid track changes while Paused preserves position at 0', () => {
            let fakeTime = 1000000;
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({
                proxy,
                timeProvider: () => fakeTime,
            });

            player._updatePlaybackStatus('Paused');

            for (let i = 0; i < 500; i++) {
                fakeTime += 5000000; // 5 seconds
                player._updateMetadata({
                    'mpris:trackid': `/com/spotify/track/paused_${i}`,
                    'xesam:title': `Paused Track ${i}`,
                    'mpris:length': 200000000,
                });

                const pos = player.getPositionMs();
                assertEquals(pos, 0, `Position must remain 0 while paused across track changes`);
            }

            player.destroy();
        });

        test('4.3 Dynamic oscillation: Playing <-> Paused <-> Stopped during track transitions', () => {
            let fakeTime = 1000000;
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({
                proxy,
                timeProvider: () => fakeTime,
            });

            const states = ['Playing', 'Paused', 'Playing', 'Stopped', 'Playing'];
            for (let i = 0; i < 300; i++) {
                const state = states[i % states.length];
                fakeTime += 200000; // 200ms
                player._updatePlaybackStatus(state);
                player._updateMetadata({
                    'mpris:trackid': `/com/spotify/track/dyn_${i}`,
                    'xesam:title': `Dyn Track ${i}`,
                    'mpris:length': 180000000,
                });
                const pos = player.getPositionMs();
                assert(pos >= 0 && Number.isFinite(pos), `State ${state} at iteration ${i} gave invalid pos ${pos}`);
            }

            player.destroy();
        });

        test('4.4 Duplicate metadata emission for same track does not reset position', () => {
            let fakeTime = 1000000;
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({
                proxy,
                timeProvider: () => fakeTime,
            });

            player._updatePlaybackStatus('Playing');
            player._updateMetadata({
                'mpris:trackid': '/com/spotify/track/same_track',
                'xesam:title': 'Same Track',
                'xesam:artist': 'Same Artist',
                'mpris:length': 200000000,
            });

            // Advance 10 seconds
            fakeTime += 10000000;
            const posBefore = player.getPositionMs();
            assertEquals(posBefore, 10000, 'Position is 10s');

            // Send updated metadata with artwork for same track
            player._updateMetadata({
                'mpris:trackid': '/com/spotify/track/same_track',
                'xesam:title': 'Same Track',
                'xesam:artist': 'Same Artist',
                'mpris:artUrl': 'https://image.spotify.com/new',
                'mpris:length': 200000000,
            });

            // Position must NOT reset to 0!
            const posAfter = player.getPositionMs();
            assertEquals(posAfter, 10000, 'Position must NOT reset on same-track metadata update');

            player.destroy();
        });
    });

    // =========================================================================
    // Suite 5: Rapid Proxy Lifecycle, Destruction, and Resource Leaks
    // =========================================================================
    await describe('5. Rapid Proxy Lifecycle, Destruction, and Resource Leaks', async () => {
        test('5.1 1,000 rapid cycles of creation, signal emission, and destruction', () => {
            for (let i = 0; i < 1000; i++) {
                const proxy = new MockDBusProxy();
                const player = new SpotifyMPRIS({
                    proxy,
                });
                player._updatePlaybackStatus('Playing');
                player._updateMetadata({
                    'mpris:trackid': `/com/spotify/track/cycle_${i}`,
                    'xesam:title': `Title ${i}`,
                    'mpris:length': 100000000,
                });
                player.destroy();
                assertEquals(proxy.getListenerCount(), 0, `Proxy listeners leaked on iteration ${i}`);
            }
        });

        test('5.2 Repeated calls to destroy() on single instance are idempotent', () => {
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({
                proxy,
            });

            for (let i = 0; i < 20; i++) {
                player.destroy();
            }

            assertEquals(player.isAvailable, false);
            assertEquals(player.playbackStatus, 'Stopped');
            assertEquals(player.track, null);
            assertEquals(player.getPositionMs(), 0);
        });

        await testAsync('5.3 Invoking public methods after destroy() fails gracefully or returns safe defaults', async () => {
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({
                proxy,
            });

            player.destroy();

            // Synchronous getters
            assertEquals(player.isAvailable, false);
            assertEquals(player.playbackStatus, 'Stopped');
            assertEquals(player.track, null);
            assertEquals(player.getMetadata(), null);
            assertEquals(player.getPositionMs(), 0);

            // Async methods must reject cleanly without uncaught exceptions
            let playPauseRejected = false;
            try {
                await player.playPause();
            } catch (e) {
                playPauseRejected = true;
                assert(e.message.includes('Spotify is not running'));
            }
            assert(playPauseRejected, 'playPause() must reject after destroy()');

            let nextRejected = false;
            try {
                await player.next();
            } catch (e) {
                nextRejected = true;
                assert(e.message.includes('Spotify is not running'));
            }
            assert(nextRejected, 'next() must reject after destroy()');

            let prevRejected = false;
            try {
                await player.previous();
            } catch (e) {
                prevRejected = true;
                assert(e.message.includes('Spotify is not running'));
            }
            assert(prevRejected, 'previous() must reject after destroy()');
        });

        await testAsync('5.4 In-flight cancellable aborts pending D-Bus calls cleanly on destroy()', async () => {
            const proxy = new MockDBusProxy();
            proxy.delayCalls = true;
            const player = new SpotifyMPRIS({
                proxy,
            });

            player._updateMetadata({
                'mpris:trackid': '/com/spotify/track/abort_test',
                'xesam:title': 'Abort Test',
                'mpris:length': 100000000,
            });

            // Start a method call and immediately destroy
            const callPromise = player.playPause();
            player.destroy();

            const res = await callPromise;
            // Either resolved null via cancellable or rejected because destroyed
            assert(res === null || res === undefined, 'Cancelled call returned safely');
        });
    });

    // =========================================================================
    // Suite 6: Hardened Regression & Edge-Case Verification
    // =========================================================================
    await describe('6. Hardened Regression & Edge-Case Verification', async () => {
        await testAsync('6.1 [FIXED] setPosition() with URI-formatted trackId formats valid D-Bus ObjectPath (ox)', async () => {
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({ proxy });

            // Spotify frequently supplies trackId as a URI 'spotify:track:<id>'
            player._updateMetadata({
                'mpris:trackid': 'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
                'xesam:title': 'Dynamite',
                'mpris:length': 199000000,
            });

            await player.setPosition(15000);

            assertEquals(proxy.methodCalls.length, 1, 'Expected 1 call to SetPosition');
            assertEquals(proxy.methodCalls[0].methodName, 'SetPosition', 'Method name should be SetPosition');
            const [calledPath, calledPositionUs] = proxy.methodCalls[0].params.recursiveUnpack();
            assertEquals(calledPath, '/com/spotify/track/4cOdK2wGLETKBW3PvgPWqT', 'URI trackId converted to valid D-Bus ObjectPath');
            assertEquals(calledPositionUs, 15000000, 'Position correctly converted to microseconds');
            assert(GLib.Variant.is_object_path(calledPath), 'calledPath must be valid D-Bus ObjectPath');

            player.destroy();
        });

        test('6.2 [FIXED] Malformed non-numeric lengths evaluate to safe finite durationMs: 0 (never NaN)', () => {
            const testStrings = ['invalid_duration_string', '', '   ', 'NaN', 'undefined', 'abc123', null, undefined];
            for (const str of testStrings) {
                const parsed = SpotifyMPRIS.parseMetadata({
                    'mpris:trackid': '/com/spotify/track/corrupt_len',
                    'xesam:title': 'Corrupt Length',
                    'mpris:length': str,
                });

                assert(!Number.isNaN(parsed.durationMs), `durationMs must not be NaN for length "${str}"`);
                assert(Number.isFinite(parsed.durationMs), `durationMs must be finite for length "${str}"`);
                assertEquals(parsed.durationMs, 0, `durationMs must be 0 for length "${str}"`);
            }
        });

        test('6.3 [FIXED] _onPropertiesChanged ignores primitive payloads without throwing TypeError', () => {
            const proxy = new MockDBusProxy();
            const player = new SpotifyMPRIS({ proxy });

            const invalidPayloads = [
                42,
                0,
                -1,
                true,
                false,
                'invalid_payload',
                [],
                new GLib.Variant('i', 42),
                new GLib.Variant('s', 'corrupted'),
                new GLib.Variant('mv', null),
            ];

            for (const payload of invalidPayloads) {
                let error = null;
                try {
                    player._onPropertiesChanged(proxy, payload, []);
                } catch (e) {
                    error = e;
                }
                assertEquals(error, null, `_onPropertiesChanged should not throw on payload: ${String(payload)}`);
            }

            assertEquals(player.playbackStatus, 'Stopped', 'Playback status unchanged on corrupt properties');
            player.destroy();
        });
    });

    // =========================================================================
    // Summary
    // =========================================================================
    console.log(`\n======================================================`);
    console.log(`${ANSI_BOLD}Adversarial Stress Test Summary:${ANSI_RESET}`);
    console.log(`  Total Suites:  ${totalSuites}`);
    console.log(`  Total Tests:   ${totalTests}`);
    console.log(`  ${ANSI_GREEN}Passed Tests:  ${passedTests}${ANSI_RESET}`);
    console.log(`  ${failedTests > 0 ? ANSI_RED : ANSI_GREEN}Failed Tests:  ${failedTests}${ANSI_RESET}`);
    console.log(`======================================================\n`);

    if (failedTests > 0) {
        System.exit(1);
    }
}

runAdversarialSuites().catch(e => {
    console.error('Fatal runner error:', e);
    System.exit(1);
});
