#!/usr/bin/env gjs -m

/**
 * Empirical Concurrency & Stress Test Suite:
 * Concurrent Interactions Between GSettings Updates and SpotifyMPRIS State Updates
 *
 * Validates:
 * 1. High-frequency interleaved GSettings updates & MPRIS D-Bus signals (real Gio.Settings)
 * 2. Asynchronous D-Bus control calls (setPosition, playPause, next, prev) under GSettings thrashing
 * 3. Bidirectional signal feedback loops (GSettings changed -> MPRIS, MPRIS signals -> GSettings)
 * 4. Concurrent lifecycle destruction & resurrection under active GSettings churn
 * 5. Player availability (crash/restart) storms concurrent with GSettings writes
 * 6. GLib.MainLoop true event-loop concurrency stress testing with multiple timers
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import System from 'system';

import { SpotifyMPRIS } from '../mpris.js';

// =============================================================================
// ANSI Output & Assertion Framework
// =============================================================================

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
    console.log(`\n${ANSI_BOLD}=== Stress Suite: ${suiteName} ===${ANSI_RESET}`);
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
            const cleanStack = e.stack.split('\n').slice(0, 5).map(l => `      ${l}`).join('\n');
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
            const cleanStack = e.stack.split('\n').slice(0, 5).map(l => `      ${l}`).join('\n');
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

// =============================================================================
// Mock DBusProxy for Headless Concurrency Testing
// =============================================================================

class MockDBusProxy {
    constructor(owner = ':1.42') {
        this._listeners = new Map();
        this.g_name_owner = owner;
        this.PlaybackStatus = 'Stopped';
        this.Metadata = {};
        this.Position = 0;
        this.Rate = 1.0;
        this.methodCalls = [];
        this.autoResolve = true;
        this.resolveDelayMs = 0;
    }

    connect(signal, callback) {
        if (!this._listeners.has(signal)) {
            this._listeners.set(signal, new Set());
        }
        const id = Math.floor(Math.random() * 100000000) + 1;
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

        if (this.autoResolve) {
            if (this.resolveDelayMs > 0) {
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.resolveDelayMs, () => {
                    if (!handled && typeof callback === 'function') {
                        handled = true;
                        callback(this, {
                            call_finish: () => new GLib.Variant('()', []),
                        });
                    }
                    return GLib.SOURCE_REMOVE;
                });
            } else {
                handled = true;
                if (typeof callback === 'function') {
                    callback(this, {
                        call_finish: () => new GLib.Variant('()', []),
                    });
                }
            }
        }
    }

    simulatePlayerDied() {
        this.g_name_owner = null;
        this.emit('notify::g-name-owner');
    }

    simulatePlayerStarted(owner = ':1.42') {
        this.g_name_owner = owner;
        this.emit('notify::g-name-owner');
    }
}

// Helper to create real Gio.Settings instance bound to schema
function createSettings() {
    return new Gio.Settings({
        schema_id: 'org.gnome.shell.extensions.spotify-floating-lyrics',
    });
}

// Track fixture generator
function createMockTrackMetadata(idx) {
    const trackUris = [
        `spotify:track:track_${idx}`,
        `/com/spotify/track/track_${idx}`,
        `spotify:ad:ad_${idx}`,
        `/org/mpris/MediaPlayer2/Track/${idx}`,
        `track-without-prefix-${idx}`,
    ];
    const titles = [`Song ${idx}`, `Ad Title ${idx}`, `Special & Title #@! ${idx}`, 'Advertisement'];
    const artists = [['Artist A', 'Artist B'], ['Solo Artist'], 'Single String Artist', []];
    const durations = [180000000, 240000000, 0, 1500000, '300000000'];

    const chosenUri = trackUris[idx % trackUris.length];
    const chosenTitle = titles[idx % titles.length];
    const chosenArtist = artists[idx % artists.length];
    const chosenDur = durations[idx % durations.length];

    const dict = {
        'mpris:trackid': new GLib.Variant('s', chosenUri),
        'xesam:title': new GLib.Variant('s', chosenTitle),
        'xesam:album': new GLib.Variant('s', `Album ${idx}`),
    };

    if (Array.isArray(chosenArtist)) {
        dict['xesam:artist'] = new GLib.Variant('as', chosenArtist);
    } else if (typeof chosenArtist === 'string') {
        dict['xesam:artist'] = new GLib.Variant('s', chosenArtist);
    }

    if (typeof chosenDur === 'number') {
        dict['mpris:length'] = new GLib.Variant('x', chosenDur);
    } else {
        dict['mpris:length'] = new GLib.Variant('s', chosenDur);
    }

    return new GLib.Variant('a{sv}', dict);
}

// =============================================================================
// Test Suites Execution
// =============================================================================

async function runAllConcurrencyTests() {
    console.log(`${ANSI_BOLD}Starting Empirical Concurrency & Stress Tests for GSettings + SpotifyMPRIS${ANSI_RESET}`);

    // -------------------------------------------------------------------------
    // Suite 1: High-Frequency Interleaved GSettings Updates & MPRIS Signals
    // -------------------------------------------------------------------------
    await describe('1. High-Frequency Interleaved GSettings Updates & MPRIS Signals', async () => {
        test('1.1 1,000 rapid interleaved mutations of all 14 GSettings keys and MPRIS signals', () => {
            const settings = createSettings();
            const proxy = new MockDBusProxy();
            let simulatedTimeUs = 1000000;
            const mpris = new SpotifyMPRIS({
                proxy,
                timeProvider: () => simulatedTimeUs,
            });

            const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center', 'custom'];
            const bgStyles = ['transparent', 'blur', 'dark-card'];
            const statuses = ['Playing', 'Paused', 'Stopped'];

            let gsettingsChangeEvents = 0;
            const settingsConn = settings.connect('changed', () => {
                gsettingsChangeEvents++;
            });

            let trackChangedCount = 0;
            let statusChangedCount = 0;
            let seekedCount = 0;
            mpris.connect('track-changed', () => { trackChangedCount++; });
            mpris.connect('status-changed', () => { statusChangedCount++; });
            mpris.connect('seeked', () => { seekedCount++; });

            for (let i = 0; i < 1000; i++) {
                // 1. Mutate GSettings across various key types
                const mod = i % 14;
                switch (mod) {
                    case 0: settings.set_boolean('show-in-panel', i % 2 === 0); break;
                    case 1: settings.set_boolean('show-floating', i % 2 === 1); break;
                    case 2: settings.set_boolean('floating-always-on-top', i % 2 === 0); break;
                    case 3: settings.set_boolean('floating-click-passthrough', i % 2 === 1); break;
                    case 4: settings.set_string('floating-position', positions[i % positions.length]); break;
                    case 5: settings.set_int('floating-x', (i * 7) % 500); break;
                    case 6: settings.set_int('floating-y', (i * 11) % 500); break;
                    case 7: settings.set_string('font-family', i % 2 === 0 ? 'Sans' : 'Monospace'); break;
                    case 8: settings.set_int('font-size', 12 + (i % 36)); break; // in range 10..96
                    case 9: settings.set_int('line-spacing', (i % 30)); break; // in range 0..100
                    case 10: settings.set_string('background-style', bgStyles[i % bgStyles.length]); break;
                    case 11: settings.set_boolean('enable-spicy-lyrics', i % 2 === 0); break;
                    case 12: settings.set_string('spicy-lyrics-token', `token_${i}`); break;
                    case 13: settings.set_boolean('enable-romanization', i % 2 === 1); break;
                }

                // 2. Interleave MPRIS D-Bus PropertiesChanged and Seeked events
                simulatedTimeUs += 50000; // +50ms
                const status = statuses[i % statuses.length];
                const meta = createMockTrackMetadata(i);
                const rate = 0.5 + (i % 4) * 0.5;

                proxy.emit('g-properties-changed', new GLib.Variant('a{sv}', {
                    'PlaybackStatus': new GLib.Variant('s', status),
                    'Metadata': meta,
                    'Rate': new GLib.Variant('d', rate),
                }), new GLib.Variant('as', []));

                if (i % 5 === 0) {
                    proxy.emit('g-signal', 'org.mpris.MediaPlayer2.Player', 'Seeked', new GLib.Variant('(x)', [(i * 1000000)]));
                }

                // 3. Concurrently inspect MPRIS internal state
                const posMs = mpris.getPositionMs();
                assert(Number.isFinite(posMs) && !Number.isNaN(posMs) && posMs >= 0, `getPositionMs returned invalid value: ${posMs}`);

                const currentTrack = mpris.track;
                assert(currentTrack !== null, 'mpris.track should not be null');
                assert(typeof currentTrack.trackPath === 'string' && currentTrack.trackPath.length > 0, 'trackPath must be valid string');
                assert(GLib.Variant.is_object_path(currentTrack.trackPath), `trackPath is not valid D-Bus object path: ${currentTrack.trackPath}`);
            }

            assert(gsettingsChangeEvents > 500, `Expected >500 GSettings change events, got ${gsettingsChangeEvents}`);
            assert(trackChangedCount > 500, `Expected >500 track-changed events, got ${trackChangedCount}`);
            assert(statusChangedCount > 0, `Expected statusChangedCount > 0, got ${statusChangedCount}`);
            assert(seekedCount > 100, `Expected >100 seeked events, got ${seekedCount}`);

            settings.disconnect(settingsConn);
            mpris.destroy();
        });
    });

    // -------------------------------------------------------------------------
    // Suite 2: Asynchronous D-Bus Control Calls Under GSettings Thrashing
    // -------------------------------------------------------------------------
    await describe('2. Asynchronous D-Bus Control Calls Under GSettings Thrashing', async () => {
        await testAsync('2.1 Concurrent setPosition / playback controls while GSettings are mutated', async () => {
            const settings = createSettings();
            const proxy = new MockDBusProxy();
            const mpris = new SpotifyMPRIS({ proxy });

            // Setup playing track
            proxy.emit('g-properties-changed', new GLib.Variant('a{sv}', {
                'PlaybackStatus': new GLib.Variant('s', 'Playing'),
                'Metadata': new GLib.Variant('a{sv}', {
                    'mpris:trackid': new GLib.Variant('s', 'spotify:track:stress_track_42'),
                    'xesam:title': new GLib.Variant('s', 'Async Stress Track'),
                    'mpris:length': new GLib.Variant('x', 300000000),
                }),
            }), new GLib.Variant('as', []));

            const asyncPromises = [];

            for (let i = 0; i < 300; i++) {
                // Mutate GSettings
                settings.set_int('font-size', 14 + (i % 20));
                settings.set_boolean('show-floating', i % 2 === 0);

                // Concurrently invoke async MPRIS control methods
                switch (i % 4) {
                    case 0:
                        asyncPromises.push(mpris.playPause());
                        break;
                    case 1:
                        asyncPromises.push(mpris.next());
                        break;
                    case 2:
                        asyncPromises.push(mpris.previous());
                        break;
                    case 3: {
                        const targetMs = (i * 1000) % 300000;
                        asyncPromises.push(mpris.setPosition(targetMs));
                        break;
                    }
                }
            }

            // Await all async D-Bus operations
            const results = await Promise.all(asyncPromises);
            assertEquals(results.length, 300, 'All 300 async operations must complete');
            assert(proxy.methodCalls.length >= 300, `Expected >=300 proxy calls, recorded ${proxy.methodCalls.length}`);

            // Verify all setPosition calls used valid D-Bus ObjectPaths
            const setPosCalls = proxy.methodCalls.filter(c => c.methodName === 'SetPosition');
            assert(setPosCalls.length > 50, `Expected >50 SetPosition calls, got ${setPosCalls.length}`);
            for (const call of setPosCalls) {
                const params = call.params;
                assert(params instanceof GLib.Variant, 'SetPosition params must be GLib.Variant');
                assertEquals(params.get_type_string(), '(ox)', 'SetPosition signature must be (ox)');
                const [pathVal, posVal] = params.recursiveUnpack();
                assert(GLib.Variant.is_object_path(pathVal), `Object path ${pathVal} invalid`);
                assert(posVal >= 0, `Position microsecond value ${posVal} must be non-negative`);
            }

            mpris.destroy();
        });
    });

    // -------------------------------------------------------------------------
    // Suite 3: Bidirectional Signal Feedback Loops (GSettings <-> MPRIS)
    // -------------------------------------------------------------------------
    await describe('3. Bidirectional Signal Feedback Loops (GSettings <-> MPRIS)', async () => {
        test('3.1 Re-entrant cross-coupled signals between GSettings and SpotifyMPRIS execute safely', () => {
            const settings = createSettings();
            const proxy = new MockDBusProxy();
            let simulatedTimeUs = 5000000;
            const mpris = new SpotifyMPRIS({
                proxy,
                timeProvider: () => simulatedTimeUs,
            });

            let feedbackCount = 0;

            // Connect GSettings changed to query MPRIS state and optionally trigger setPosition
            const sConn = settings.connect('changed::floating-x', (s, key) => {
                const xVal = s.get_int(key);
                feedbackCount++;
                const curPos = mpris.getPositionMs();
                if (curPos < 100000) {
                    mpris.setPosition(curPos + xVal).catch(() => {});
                }
            });

            // Connect MPRIS track-changed and status-changed to mutate GSettings
            const mConn1 = mpris.connect('track-changed', (m, track) => {
                feedbackCount++;
                if (track && track.durationMs > 0) {
                    settings.set_int('floating-x', (track.durationMs % 400));
                }
            });

            const mConn2 = mpris.connect('seeked', (m, posMs) => {
                feedbackCount++;
                settings.set_boolean('show-floating', posMs % 2 === 0);
            });

            // Fire 100 interleaved events
            for (let i = 0; i < 100; i++) {
                simulatedTimeUs += 100000;
                proxy.emit('g-properties-changed', new GLib.Variant('a{sv}', {
                    'PlaybackStatus': new GLib.Variant('s', 'Playing'),
                    'Metadata': createMockTrackMetadata(i),
                }), new GLib.Variant('as', []));

                proxy.emit('g-signal', 'org.mpris.MediaPlayer2.Player', 'Seeked', new GLib.Variant('(x)', [(i * 2000000)]));
                settings.set_int('floating-y', i % 100);
            }

            assert(feedbackCount > 200, `Expected >200 feedback loop interactions, got ${feedbackCount}`);

            settings.disconnect(sConn);
            mpris.disconnect(mConn1);
            mpris.disconnect(mConn2);
            mpris.destroy();
        });
    });

    // -------------------------------------------------------------------------
    // Suite 4: Concurrent Lifecycle Destruction & Resurrection
    // -------------------------------------------------------------------------
    await describe('4. Concurrent Lifecycle Destruction & Resurrection Under Churn', async () => {
        await testAsync('4.1 50 rapid cycles of instantiation, in-flight calls, and destroy() while GSettings thrash', async () => {
            const settings = createSettings();
            const proxy = new MockDBusProxy();

            for (let cycle = 0; cycle < 50; cycle++) {
                const mpris = new SpotifyMPRIS({ proxy });

                // Mutate settings
                settings.set_int('font-size', 16 + (cycle % 20));
                settings.set_string('background-style', cycle % 2 === 0 ? 'dark-card' : 'transparent');

                // Emit properties
                proxy.emit('g-properties-changed', new GLib.Variant('a{sv}', {
                    'PlaybackStatus': new GLib.Variant('s', 'Playing'),
                    'Metadata': createMockTrackMetadata(cycle),
                }), new GLib.Variant('as', []));

                // Launch in-flight call
                const pendingCall = mpris.setPosition(15000);

                // Destroy immediately while call is in flight
                mpris.destroy();

                // Wait for cancelled call to settle
                await pendingCall;

                // Validate clean post-destroy state
                assertEquals(mpris.isAvailable, false, 'mpris.isAvailable should be false after destroy');
                assertEquals(mpris.playbackStatus, 'Stopped', 'playbackStatus should be Stopped after destroy');
                assertEquals(mpris.track, null, 'track should be null after destroy');
                assertEquals(mpris.getPositionMs(), 0, 'getPositionMs() should return 0 after destroy');
            }

            // Ensure proxy listeners are not leaked
            assertEquals(proxy.getListenerCount(), 0, 'All proxy listeners must be unbound after destroy cycles');
        });
    });

    // -------------------------------------------------------------------------
    // Suite 5: Player Availability Storms (Spotify Crash / Restart) + GSettings
    // -------------------------------------------------------------------------
    await describe('5. Player Availability Storms (Crash/Restart) Concurrently with GSettings Writes', async () => {
        test('5.1 100 rapid cycles of player crash and restart during active GSettings writes', () => {
            const settings = createSettings();
            const proxy = new MockDBusProxy(':1.100');
            const mpris = new SpotifyMPRIS({ proxy });

            let availableTransitions = [];
            mpris.connect('player-available', (m, avail) => {
                availableTransitions.push(avail);
            });

            for (let i = 0; i < 100; i++) {
                // Mutate GSettings
                settings.set_boolean('show-in-panel', i % 2 === 0);
                settings.set_int('line-spacing', (i % 25));

                // Crash player
                proxy.simulatePlayerDied();
                assertEquals(mpris.isAvailable, false, 'mpris.isAvailable must be false when player dies');
                assertEquals(mpris.playbackStatus, 'Stopped', 'playbackStatus must be Stopped when player dies');
                assertEquals(mpris.track, null, 'track must be null when player dies');
                assertEquals(mpris.getPositionMs(), 0, 'getPositionMs must be 0 when player dies');

                // Restart player
                proxy.simulatePlayerStarted(`:1.${101 + i}`);
                assertEquals(mpris.isAvailable, true, 'mpris.isAvailable must be true when player restarts');
            }

            assertEquals(availableTransitions.length, 200, 'Expected 200 player-available signal transitions');
            mpris.destroy();
        });
    });

    // -------------------------------------------------------------------------
    // Suite 6: GLib MainLoop True Event Loop Concurrency Stress
    // -------------------------------------------------------------------------
    await describe('6. GLib.MainLoop True Event Loop Concurrency Stress', async () => {
        await testAsync('6.1 Real GLib.MainLoop concurrency with interleaved timers and async D-Bus operations', async () => {
            const loop = new GLib.MainLoop(null, false);
            const settings = createSettings();
            const proxy = new MockDBusProxy();
            proxy.resolveDelayMs = 1; // asynchronous D-Bus reply delay

            let simulatedTimeUs = 10000000;
            const mpris = new SpotifyMPRIS({
                proxy,
                timeProvider: () => simulatedTimeUs,
            });

            let gsettingsTicks = 0;
            let mprisSignalTicks = 0;
            let positionCheckTicks = 0;
            let asyncCallTicks = 0;
            let lastPos = 0;

            // Timer 1: Rapid GSettings updates (every 2ms)
            const t1 = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2, () => {
                gsettingsTicks++;
                settings.set_int('font-size', 12 + (gsettingsTicks % 30));
                settings.set_string('floating-position', gsettingsTicks % 2 === 0 ? 'center' : 'top-left');
                return GLib.SOURCE_CONTINUE;
            });

            // Timer 2: Rapid MPRIS D-Bus signals (every 2ms)
            const t2 = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2, () => {
                mprisSignalTicks++;
                simulatedTimeUs += 100000; // +100ms
                proxy.emit('g-properties-changed', new GLib.Variant('a{sv}', {
                    'PlaybackStatus': new GLib.Variant('s', 'Playing'),
                    'Metadata': createMockTrackMetadata(mprisSignalTicks),
                }), new GLib.Variant('as', []));

                if (mprisSignalTicks % 10 === 0) {
                    proxy.emit('g-signal', 'org.mpris.MediaPlayer2.Player', 'Seeked', new GLib.Variant('(x)', [mprisSignalTicks * 1000000]));
                }
                return GLib.SOURCE_CONTINUE;
            });

            // Timer 3: Concurrent position inspection (every 3ms)
            const t3 = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3, () => {
                positionCheckTicks++;
                const pos = mpris.getPositionMs();
                assert(Number.isFinite(pos) && !Number.isNaN(pos) && pos >= 0, `Invalid pos: ${pos}`);
                lastPos = pos;
                return GLib.SOURCE_CONTINUE;
            });

            // Timer 4: Async setPosition calls (every 4ms)
            const t4 = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 4, () => {
                asyncCallTicks++;
                mpris.setPosition(asyncCallTicks * 250).catch(err => {
                    console.error('Async call error:', err.message);
                });
                return GLib.SOURCE_CONTINUE;
            });

            // Timer 5: Loop terminator (after 300ms)
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                GLib.source_remove(t1);
                GLib.source_remove(t2);
                GLib.source_remove(t3);
                GLib.source_remove(t4);
                loop.quit();
                return GLib.SOURCE_REMOVE;
            });

            // Run MainLoop
            loop.run();

            assert(gsettingsTicks >= 50, `Expected >=50 gsettings ticks, got ${gsettingsTicks}`);
            assert(mprisSignalTicks >= 50, `Expected >=50 mpris ticks, got ${mprisSignalTicks}`);
            assert(positionCheckTicks >= 30, `Expected >=30 position check ticks, got ${positionCheckTicks}`);
            assert(asyncCallTicks >= 20, `Expected >=20 async call ticks, got ${asyncCallTicks}`);

            mpris.destroy();
        });
    });

    // =========================================================================
    // Summary
    // =========================================================================
    console.log('\n======================================================');
    console.log(`${ANSI_BOLD}Concurrency Stress Test Execution Summary:${ANSI_RESET}`);
    console.log(`  Total Suites:  ${totalSuites}`);
    console.log(`  Total Tests:   ${totalTests}`);
    console.log(`  ${ANSI_GREEN}Passed Tests:  ${passedTests}${ANSI_RESET}`);
    console.log(`  ${failedTests === 0 ? ANSI_GREEN : ANSI_RED}Failed Tests:  ${failedTests}${ANSI_RESET}`);
    console.log('======================================================\n');

    if (failedTests > 0) {
        System.exit(1);
    }
}

// Execute
runAllConcurrencyTests().catch(err => {
    console.error('Fatal test error:', err);
    System.exit(1);
});
