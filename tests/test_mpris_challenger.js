#!/usr/bin/env gjs -m

/**
 * Challenger Stress & Fuzz Harness for Spotify MPRIS D-Bus Client
 * Authored by Challenger 1 (critic, specialist)
 *
 * Exhaustively stress-tests:
 * 1. Fuzzing toObjectPath() and setPosition() (Defect 1 verification)
 * 2. Fuzzing parseMetadata() durationMs & fields (Defect 2 verification)
 * 3. Fuzzing _onPropertiesChanged() payload resilience (Defect 3 verification)
 * 4. Fuzzing monotonic clock deltas & interpolation bounds
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import System from 'system';

import { SpotifyMPRIS } from '../mpris.js';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
    if (!condition) {
        throw new Error(msg);
    }
}

class MockDBusProxy {
    constructor() {
        this.g_name_owner = ':1.42';
        this.methodCalls = [];
    }
    connect() { return 1; }
    disconnect() {}
    get_cached_property(name) { return null; }
    call_finish(res) { return new GLib.Variant('()', []); }
    call(methodName, params, flags, timeout, cancellable, callback) {
        this.methodCalls.push({ methodName, params });
        if (typeof callback === 'function') {
            callback(this, {
                call_finish: () => new GLib.Variant('()', []),
            });
        }
    }
}

console.log('Starting Challenger Stress & Fuzz Suite...');

// =========================================================================
// SECTION 1: Exhaustive Fuzzing of toObjectPath() and setPosition()
// =========================================================================
console.log('\n--- Section 1: toObjectPath & setPosition ObjectPath Fuzzing ---');

const trackIdFuzzSamples = [
    // Nullish & primitives
    null, undefined, 0, 42, -1, true, false, {}, [], () => {},
    // Empty & whitespace
    '', ' ', '   \t\n',
    // Spotify URIs
    'spotify:track:4cOdK2wGLETKBW3PvgPWqT',
    'spotify:ad:6b39a4892c90',
    'spotify:local:artist:album:track',
    'spotify:track:',
    'spotify:track',
    'spotify:',
    'spotify:::test',
    'spotify:track:with-hyphens-and-dots.123',
    'spotify:track:special!@#$%^&*()_+~`',
    'spotify:track:공유_BTS_Official',
    'spotify:track:' + 'a'.repeat(2000),
    // Object paths
    '/org/mpris/MediaPlayer2/Track/1',
    '/com/spotify/track/4cOdK2wGLETKBW3PvgPWqT',
    '/com/spotify/track/with-hyphen',
    '/com/spotify/track/with.dots',
    '/com/spotify/track/with spaces',
    '/',
    '///',
    '//com//spotify//track//123',
    '/invalid/trailing/slash/',
    '/123/starts/with/digit',
    '//_valid_/_after_/_cleaning_',
    // Arbitrary URLs & strings
    'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
    'arbitrary_string_without_slashes',
    'just a normal song title by an artist',
    '../../etc/passwd',
    '\\windows\\path\\style',
    'null', 'undefined', '[object Object]',
];

let toObjectPathPassCount = 0;
for (const sample of trackIdFuzzSamples) {
    const objPath = SpotifyMPRIS.toObjectPath(sample);
    assert(typeof objPath === 'string', `toObjectPath must return string, got ${typeof objPath}`);
    assert(objPath.length > 0, `toObjectPath returned empty string for ${String(sample)}`);
    assert(
        GLib.Variant.is_object_path(objPath),
        `toObjectPath returned INVALID D-Bus ObjectPath "${objPath}" for input: ${String(sample)}`
    );

    // Verify GLib.Variant('(ox)') can be instantiated without critical or error
    try {
        const variant = new GLib.Variant('(ox)', [objPath, 1000]);
        assert(variant !== null, 'Variant construction failed');
    } catch (e) {
        throw new Error(`GLib.Variant('(ox)') threw for input ${String(sample)} -> "${objPath}": ${e.message}`);
    }
    toObjectPathPassCount++;
}
console.log(`✓ 1.1 toObjectPath: ${toObjectPathPassCount} fuzz samples produced 100% valid D-Bus ObjectPaths`);
passed++;

// Fuzz setPosition with various position values
const positionFuzzSamples = [
    0, 100, 15000, 200000, -1, -50000, -Infinity,
    NaN, Infinity, '15000', '0', '-500', 'invalid', '', '   ',
    null, undefined, {}, [], 1e12, 180000000n,
];

let setPositionPassCount = 0;
for (const samplePos of positionFuzzSamples) {
    for (const sampleTrack of ['spotify:track:4cOdK2wGLETKBW3PvgPWqT', '', null, '/com/spotify/track/abc-123']) {
        const mockProxy = new MockDBusProxy();
        const player = new SpotifyMPRIS({ proxy: mockProxy, autoConnect: false });
        player._handlePlayerAvailable(true);
        player._updateMetadata({ 'mpris:trackid': sampleTrack });

        player.setPosition(samplePos);

        assert(mockProxy.methodCalls.length === 1, 'SetPosition call not recorded');
        const call = mockProxy.methodCalls[0];
        assert(call.methodName === 'SetPosition', 'Method name mismatch');
        const [path, posUs] = call.params.recursiveUnpack();

        assert(GLib.Variant.is_object_path(path), `SetPosition called with invalid object path "${path}"`);
        assert(typeof posUs === 'number' || typeof posUs === 'bigint', `posUs must be numeric, got ${typeof posUs}`);
        assert(Number(posUs) >= 0, `posUs must be >= 0, got ${posUs} for input ${samplePos}`);
        assert(!Number.isNaN(Number(posUs)), `posUs must not be NaN for input ${samplePos}`);
        assert(Number.isFinite(Number(posUs)), `posUs must be finite for input ${samplePos}`);

        player.destroy();
        setPositionPassCount++;
    }
}
console.log(`✓ 1.2 setPosition: ${setPositionPassCount} trackId x position permutations executed with 0 GLib assertions`);
passed++;

// =========================================================================
// SECTION 2: Exhaustive Fuzzing of parseMetadata() (Defect 2 verification)
// =========================================================================
console.log('\n--- Section 2: parseMetadata durationMs & Field Fuzzing ---');

const corruptLengths = [
    // Non-numeric strings
    'invalid_duration_string', 'NaN', 'undefined', 'null', 'false', 'true',
    '', '   ', '\t\n', '123abc', 'abc123', '0x123', '1e5abc',
    // Numbers & Booleans
    0, -0, -1, -9999999, 1000, 199000000, 1.5, -1.5,
    true, false,
    // Special IEEE 754
    NaN, Infinity, -Infinity,
    // BigInt
    0n, 1000000n, -5000n,
    // Collections
    [], [100000], [1, 2], {}, { value: 100000 },
    // Variants
    new GLib.Variant('s', 'corrupt_str'),
    new GLib.Variant('s', ''),
    new GLib.Variant('i', -500),
    new GLib.Variant('x', 200000000),
    new GLib.Variant('x', -200000000),
    new GLib.Variant('d', 150000000.5),
    new GLib.Variant('b', true),
    new GLib.Variant('mv', null),
    new GLib.Variant('v', new GLib.Variant('s', 'nested_bad')),
    new GLib.Variant('v', new GLib.Variant('x', 300000000)),
];

let durationTestCount = 0;
for (const cl of corruptLengths) {
    const meta = SpotifyMPRIS.parseMetadata({
        'mpris:length': cl,
        'xesam:title': 'Fuzz Track',
    });

    assert(typeof meta.durationMs === 'number', `durationMs must be number, got ${typeof meta.durationMs}`);
    assert(!Number.isNaN(meta.durationMs), `durationMs was NaN for input ${String(cl)}`);
    assert(Number.isFinite(meta.durationMs), `durationMs was not finite for input ${String(cl)}`);
    assert(meta.durationMs >= 0, `durationMs was negative (${meta.durationMs}) for input ${String(cl)}`);
    assert(Number.isInteger(meta.durationMs), `durationMs must be integer, got ${meta.durationMs}`);

    durationTestCount++;
}
console.log(`✓ 2.1 parseMetadata durationMs: ${durationTestCount} corrupt length types evaluated safely without NaN`);
passed++;

// Fuzz whole metadata payloads
const rawMetadataPayloads = [
    null, undefined, 42, 0, -1, 'string', true, false, Symbol('sym'), [],
    {},
    new GLib.Variant('a{sv}', {}),
    new GLib.Variant('i', 42),
    new GLib.Variant('s', 'just string'),
    new GLib.Variant('as', ['a', 'b']),
    new GLib.Variant('mv', null),
    { 'xesam:title': null, 'xesam:artist': null, 'mpris:length': null },
    { 'xesam:title': 12345, 'xesam:artist': 67890 },
    { 'xesam:artist': ['Valid', null, undefined, 42, 'Artist'] },
    { 'mpris:trackid': null },
    { 'mpris:trackid': 123 },
    { 'mpris:trackid': 'spotify:track:4cOdK2wGLETKBW3PvgPWqT' },
];

let metaPayloadCount = 0;
for (const payload of rawMetadataPayloads) {
    const meta = SpotifyMPRIS.parseMetadata(payload);
    assert(typeof meta === 'object' && meta !== null, 'parseMetadata must return non-null object');
    assert(typeof meta.title === 'string', 'title must be string');
    assert(typeof meta.artist === 'string', 'artist must be string');
    assert(typeof meta.album === 'string', 'album must be string');
    assert(typeof meta.artUrl === 'string', 'artUrl must be string');
    assert(typeof meta.trackId === 'string', 'trackId must be string');
    assert(typeof meta.rawTrackId === 'string', 'rawTrackId must be string');
    assert(typeof meta.trackPath === 'string', 'trackPath must be string');
    assert(GLib.Variant.is_object_path(meta.trackPath), `meta.trackPath "${meta.trackPath}" is not valid ObjectPath`);
    assert(typeof meta.isAd === 'boolean', 'isAd must be boolean');
    assert(typeof meta.durationMs === 'number' && Number.isFinite(meta.durationMs) && meta.durationMs >= 0, 'durationMs invalid');
    metaPayloadCount++;
}
console.log(`✓ 2.2 parseMetadata payloads: ${metaPayloadCount} arbitrary payloads unpacked with valid schema contracts`);
passed++;

// =========================================================================
// SECTION 3: Exhaustive Fuzzing of _onPropertiesChanged() (Defect 3 verification)
// =========================================================================
console.log('\n--- Section 3: _onPropertiesChanged Payload Resilience ---');

const propChangedFuzzPayloads = [
    // Primitives that previously threw TypeError ('Metadata' in changed)
    42, 0, -1, true, false, 'string_payload', '', Symbol('prop'),
    null, undefined,
    // Arrays
    [], [1, 2, 3], ['Metadata'],
    // Variants
    new GLib.Variant('i', 42),
    new GLib.Variant('s', 'test'),
    new GLib.Variant('b', false),
    new GLib.Variant('as', ['a']),
    new GLib.Variant('mv', null),
    // Objects with unexpected properties
    {},
    { UnknownProperty: 'value' },
    { Metadata: 42 },
    { Metadata: 'string' },
    { Metadata: null },
    { Metadata: new GLib.Variant('mv', null) },
    { Rate: 'not a number' },
    { Rate: -5 },
    { Rate: 0 },
    { Rate: NaN },
    { Rate: Infinity },
    { Rate: 2.5 },
    { PlaybackStatus: 'Playing' },
    { PlaybackStatus: 'Paused' },
    { PlaybackStatus: 'Stopped' },
];

let propCount = 0;
for (const payload of propChangedFuzzPayloads) {
    const mockProxy = new MockDBusProxy();
    const player = new SpotifyMPRIS({ proxy: mockProxy, autoConnect: false });
    player._handlePlayerAvailable(true);

    let error = null;
    try {
        player._onPropertiesChanged(mockProxy, payload, []);
    } catch (e) {
        error = e;
    }

    assert(error === null, `_onPropertiesChanged threw for payload ${String(payload)}: ${error ? error.message : ''}`);
    player.destroy();
    propCount++;
}
console.log(`✓ 3.1 _onPropertiesChanged: ${propCount} malformed/primitive payloads processed without TypeError`);
passed++;

// =========================================================================
// SECTION 4: Monotonic Clock Bounds & Interpolation Arithmetic
// =========================================================================
console.log('\n--- Section 4: Monotonic Clock Bounds & Interpolation ---');

let virtualClock = 5000000000;
const mockProxy = new MockDBusProxy();
const player = new SpotifyMPRIS({
    proxy: mockProxy,
    timeProvider: () => virtualClock,
    autoConnect: false,
});
player._handlePlayerAvailable(true);
player._updateMetadata({
    'mpris:trackid': 'spotify:track:clock_test',
    'xesam:title': 'Clock Test',
    'mpris:length': 200000000, // 200s = 200,000ms
});
player._updatePlaybackStatus('Playing');

// Clock variations
const clockDeltas = [
    0, 1, 100, 1000000, 5000000, -100, -5000000, -3600000000,
    10000000000, 0, 500000,
];

for (const delta of clockDeltas) {
    virtualClock += delta;
    const pos = player.getPositionMs();
    assert(typeof pos === 'number', 'pos must be number');
    assert(!Number.isNaN(pos), 'pos must not be NaN');
    assert(Number.isFinite(pos), 'pos must be finite');
    assert(pos >= 0, `pos went negative (${pos}) after delta ${delta}`);
    assert(pos <= 200000, `pos exceeded durationMs: ${pos}`);
}

player.destroy();
console.log(`✓ 4.1 Monotonic clock: ${clockDeltas.length} clock warp steps maintained valid [0, durationMs] bounds`);
passed++;

// =========================================================================
// SECTION 5: Generative Fuzzing with 5,000 Randomized Payloads
// =========================================================================
console.log('\n--- Section 5: Generative Fuzzing (5,000 Randomized Payloads) ---');

function generateRandomString(len) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_:/.- \t\n\r!@#$%^&*()_+~`{}|[]\\;\'",<>?/\u0000\u0001\u202E\uD83D\uDD25';
    let res = '';
    for (let i = 0; i < len; i++) {
        res += chars[Math.floor(Math.random() * chars.length)];
    }
    return res;
}

let genPathPass = 0;
for (let i = 0; i < 2500; i++) {
    const len = Math.floor(Math.random() * 80);
    const randStr = (i % 3 === 0 ? 'spotify:' : (i % 3 === 1 ? '/' : '')) + generateRandomString(len);
    const objPath = SpotifyMPRIS.toObjectPath(randStr);
    assert(GLib.Variant.is_object_path(objPath), `Random string generated invalid ObjectPath: "${objPath}" from "${randStr}"`);
    const variant = new GLib.Variant('(ox)', [objPath, i]);
    assert(variant !== null);
    genPathPass++;
}
console.log(`✓ 5.1 Generative toObjectPath: ${genPathPass} random strings converted to 100% valid D-Bus ObjectPaths`);

let genDurationPass = 0;
for (let i = 0; i < 2500; i++) {
    const len = Math.floor(Math.random() * 40);
    const randLen = generateRandomString(len);
    const meta = SpotifyMPRIS.parseMetadata({
        'mpris:length': randLen,
    });
    assert(typeof meta.durationMs === 'number', 'durationMs must be number');
    assert(!Number.isNaN(meta.durationMs), `durationMs was NaN for random string "${randLen}"`);
    assert(Number.isFinite(meta.durationMs), `durationMs was not finite for "${randLen}"`);
    assert(meta.durationMs >= 0, `durationMs was negative for "${randLen}"`);
    genDurationPass++;
}
console.log(`✓ 5.2 Generative parseMetadata: ${genDurationPass} random length strings evaluated safely without NaN`);
passed += 2;

// =========================================================================
// Final Verdict
// =========================================================================
console.log('\n======================================================');
console.log(`Challenger Fuzz Execution Complete:`);
console.log(`  Passed Sections: ${passed}`);
console.log(`  Failed Sections: ${failed}`);
console.log('======================================================\n');

if (failed > 0) {
    System.exit(1);
} else {
    System.exit(0);
}
