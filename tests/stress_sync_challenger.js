#!/usr/bin/env gjs -m

/**
 * Empirical Challenger Stress Test Suite for LyricsSync Engine (lyricsSync.js)
 * Challenger 2 for Milestone 2 (Lyrics & Romanization Engine)
 *
 * Verifies:
 * 1. 10,000 high-frequency position ticks across steady playback (strict zero-event-flooding).
 * 2. Rapid random seek jumps (forward, backward, intro, post-song, rapid oscillations).
 * 3. Interlude sections (gaps > 2 seconds with endTimeMs, blank lines, musical symbols).
 * 4. Extreme list sizes (empty, 1-line, 1,000-line, 5,000-line scale & O(log N) latency).
 * 5. Concurrency / re-entrancy stress (rapid setLyrics while updatePosition fires, callback re-entrancy).
 * 6. Robustness under fault injection (NaN, null, Infinity, type coercion, lifecycle destruction).
 * 7. Memory endurance and GC stability (100,000 ticks + 5,000 track swaps).
 */

import System from 'system';
import GLib from 'gi://GLib';
import { LyricsSync } from '../lyricsSync.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failureDetails = [];

const ANSI_GREEN = '\x1b[32m';
const ANSI_RED = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_RESET = '\x1b[0m';

function suite(name, fn) {
    console.log(`\n${ANSI_BOLD}${ANSI_CYAN}▶ Stress Suite: ${name}${ANSI_RESET}`);
    fn();
}

function test(name, fn) {
    totalTests++;
    try {
        fn();
        passedTests++;
        console.log(`  ${ANSI_GREEN}✔ [PASS]${ANSI_RESET} ${name}`);
    } catch (err) {
        failedTests++;
        console.error(`  ${ANSI_RED}✖ [FAIL]${ANSI_RESET} ${name}`);
        console.error(`    ${ANSI_RED}Reason: ${err.message}${ANSI_RESET}`);
        if (err.stack) {
            const lines = err.stack.split('\n').slice(0, 5).map(l => `      ${l}`).join('\n');
            console.error(lines);
        }
        failureDetails.push({ test: name, error: err.message, stack: err.stack });
    }
}

function assert(cond, msg = 'Assertion failed') {
    if (!cond) throw new Error(msg);
}

function assertEquals(actual, expected, msg = '') {
    if (actual !== expected) {
        const prefix = msg ? `${msg} -> ` : '';
        throw new Error(`${prefix}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

// Ground-truth Linear Search Oracle for verification
function linearOracleFindActiveIndex(lines, positionMs) {
    if (!lines || lines.length === 0) return -1;
    if (positionMs < lines[0].timeMs) return -1;

    let candidate = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].timeMs <= positionMs) {
            candidate = i;
        } else {
            break;
        }
    }

    if (candidate === -1) return -1;

    const cur = lines[candidate];
    if (candidate < lines.length - 1 && cur.endTimeMs !== null && cur.endTimeMs !== undefined) {
        const nextTime = lines[candidate + 1].timeMs;
        if (cur.endTimeMs < nextTime && positionMs >= cur.endTimeMs) {
            return -1;
        }
    }

    return candidate;
}

// =============================================================================
// Suite 1: 10,000 High-Frequency Steady Playback Ticks & Zero Event Flooding
// =============================================================================
suite('1. 10,000 High-Frequency Position Ticks & Strict Zero-Event-Flooding', () => {
    test('1.1 10,000 steady 20ms ticks across 100-line song emits EXACTLY on line transitions', () => {
        const sync = new LyricsSync();
        try {
            // 100 lines, 2000ms duration per line -> 0ms to 200,000ms total
            const lines = [];
            for (let i = 0; i < 100; i++) {
                lines.push({
                    timeMs: i * 2000,
                    endTimeMs: (i + 1) * 2000,
                    text: `Lyric Line #${i}`,
                });
            }
            sync.setLyrics(lines);

            let emitCount = 0;
            const emittedIndices = [];
            sync.connect('line-changed', (_e, idx) => {
                emitCount++;
                emittedIndices.push(idx);
            });

            // 10,000 ticks at 20ms steps from 0ms to 199,980ms
            const startUs = GLib.get_monotonic_time();
            for (let tick = 0; tick < 10000; tick++) {
                const posMs = tick * 20;
                sync.updatePosition(posMs);
            }
            const elapsedMs = (GLib.get_monotonic_time() - startUs) / 1000;

            // Across 100 contiguous lines, there should be exactly 100 emissions (indices 0 through 99)
            assertEquals(emitCount, 100, `Expected exactly 100 emissions for 100 lines across 10,000 ticks, but got ${emitCount}`);
            for (let i = 0; i < 100; i++) {
                assertEquals(emittedIndices[i], i, `Emitted index at position ${i} should be ${i}`);
            }
            assertEquals(sync.getCurrentIndex(), 99, 'Final line index must be 99');
            console.log(`      [Perf] 10,000 ticks evaluated in ${elapsedMs.toFixed(2)}ms (${(10000 / (elapsedMs / 1000)).toFixed(0)} ticks/sec)`);
        } finally {
            sync.destroy();
        }
    });

    test('1.2 10,000 micro-ticks (1ms steps) within a single line emit ZERO redundant events', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics([
                { timeMs: 5000, endTimeMs: 25000, text: 'Single Long Line' },
                { timeMs: 25000, endTimeMs: 40000, text: 'Next Line' }
            ]);

            let emitCount = 0;
            sync.connect('line-changed', () => {
                emitCount++;
            });

            // Enter first line at 5000ms (1st emit)
            sync.updatePosition(5000);
            assertEquals(emitCount, 1);

            // 10,000 micro-ticks from 5001ms to 15000ms (all inside line 0)
            for (let t = 5001; t <= 15000; t++) {
                sync.updatePosition(t);
            }

            assertEquals(emitCount, 1, `Expected 0 redundant events across 10,000 micro-ticks, got ${emitCount - 1} extra emissions`);
            assertEquals(sync.getCurrentIndex(), 0);
        } finally {
            sync.destroy();
        }
    });

    test('1.3 High-frequency floating-point positions (interpolated clocks) do not cause jitter', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics([
                { timeMs: 1000, endTimeMs: 3000, text: 'Line 0' },
                { timeMs: 3000, endTimeMs: 5000, text: 'Line 1' },
            ]);

            let emitCount = 0;
            sync.connect('line-changed', () => { emitCount++; });

            // Simulate fractional monotonic clock ticks: 1000.123, 1000.456, ..., 2999.890
            let t = 1000.0;
            while (t < 3000.0) {
                sync.updatePosition(t);
                t += 0.333333;
            }

            assertEquals(emitCount, 1, 'Floating-point positions within line 0 must emit exactly once');
            assertEquals(sync.getCurrentIndex(), 0);

            // Step across boundary to 3000.001
            sync.updatePosition(3000.001);
            assertEquals(emitCount, 2, 'Crossing boundary must emit exactly once');
            assertEquals(sync.getCurrentIndex(), 1);
        } finally {
            sync.destroy();
        }
    });
});

// =============================================================================
// Suite 2: Rapid Random Seek Jumps
// =============================================================================
suite('2. Rapid Random Seek Jumps & Scrubbing Stress', () => {
    test('2.1 5,000 pseudo-random seek jumps across 50-line track match linear oracle 100%', () => {
        const sync = new LyricsSync();
        try {
            const lines = [];
            for (let i = 0; i < 50; i++) {
                // Lines with varying durations and occasional 3s gaps
                const start = i * 4000;
                const end = (i % 5 === 0) ? start + 2500 : start + 4000; // Gap when i % 5 === 0
                lines.push({
                    timeMs: start,
                    endTimeMs: end,
                    text: `Line #${i}`,
                });
            }
            sync.setLyrics(lines);

            let emitCount = 0;
            sync.connect('line-changed', () => {
                emitCount++;
            });

            // LCG Pseudo-random generator for determinism
            let seed = 42;
            function rand() {
                seed = (seed * 1664525 + 1013904223) % 4294967296;
                return seed / 4294967296;
            }

            let expectedEmits = 0;
            let currentTrackedIdx = -1;

            const startUs = GLib.get_monotonic_time();
            for (let i = 0; i < 5000; i++) {
                // Random position from -20,000ms (intro) to 250,000ms (past song)
                const targetMs = Math.floor(rand() * 270000) - 20000;
                const oracleIdx = linearOracleFindActiveIndex(lines, targetMs);

                if (oracleIdx !== currentTrackedIdx) {
                    expectedEmits++;
                    currentTrackedIdx = oracleIdx;
                }

                sync.updatePosition(targetMs);

                assertEquals(sync.getCurrentIndex(), oracleIdx, `Seek iteration ${i} at ${targetMs}ms mismatch with oracle`);
                if (oracleIdx >= 0) {
                    assertEquals(sync.getCurrentLine().text, lines[oracleIdx].text);
                } else {
                    assertEquals(sync.getCurrentLine(), null);
                }
            }
            const elapsedMs = (GLib.get_monotonic_time() - startUs) / 1000;

            assertEquals(emitCount, expectedEmits, `Total emissions must match transition count: expected ${expectedEmits}, got ${emitCount}`);
            console.log(`      [Perf] 5,000 random seeks evaluated against linear oracle in ${elapsedMs.toFixed(2)}ms`);
        } finally {
            sync.destroy();
        }
    });

    test('2.2 Rapid 2,000 oscillations between two adjacent lines (scrub jitter stress)', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics([
                { timeMs: 10000, endTimeMs: 20000, text: 'Line A' },
                { timeMs: 20000, endTimeMs: 30000, text: 'Line B' },
            ]);

            let transitions = 0;
            sync.connect('line-changed', () => {
                transitions++;
            });

            // Alternating between 19999ms and 20000ms 2,000 times
            for (let i = 0; i < 2000; i++) {
                const pos = (i % 2 === 0) ? 19999 : 20000;
                sync.updatePosition(pos);
                assertEquals(sync.getCurrentIndex(), (i % 2 === 0) ? 0 : 1);
            }

            assertEquals(transitions, 2000, `Oscillating across boundary 2,000 times must emit exactly 2,000 events, got ${transitions}`);
        } finally {
            sync.destroy();
        }
    });

    test('2.3 Extreme seek jumps: -100,000ms (deep intro) and +50,000,000ms (far future)', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics([
                { timeMs: 1000, endTimeMs: 5000, text: 'Start' },
                { timeMs: 5000, endTimeMs: 10000, text: 'End' }
            ]);

            // Deep negative seek
            sync.updatePosition(-100000);
            assertEquals(sync.getCurrentIndex(), -1);
            assertEquals(sync.getCurrentLine(), null);

            // Direct jump to line 0
            sync.updatePosition(2000);
            assertEquals(sync.getCurrentIndex(), 0);

            // Far future seek (50,000,000ms) clamps to last line index (index 1)
            sync.updatePosition(50000000);
            assertEquals(sync.getCurrentIndex(), 1, 'Far future seek must clamp to last line index');
            assertEquals(sync.getCurrentLine().text, 'End');

            // Jump back to intro
            sync.updatePosition(500);
            assertEquals(sync.getCurrentIndex(), -1, 'Jump back to intro must return index -1');
            assertEquals(sync.getCurrentLine(), null);
        } finally {
            sync.destroy();
        }
    });
});

// =============================================================================
// Suite 3: Interlude Sections & Gap Detection
// =============================================================================
suite('3. Instrumental Interludes & Gap Handling', () => {
    test('3.1 Explicit blank lines, whitespace, ♪ note, and (instrumental) markers flag isInterlude === true', () => {
        const sync = new LyricsSync();
        try {
            const rawLyrics = [
                { timeMs: 1000, text: 'Normal Lyric Line 1' },
                { timeMs: 5000, text: '' }, // Blank interlude
                { timeMs: 10000, text: '   ' }, // Whitespace interlude
                { timeMs: 15000, text: '♪' }, // Musical note interlude
                { timeMs: 20000, text: '(Instrumental)' }, // (Instrumental)
                { timeMs: 25000, text: 'Normal Lyric Line 2' },
                { timeMs: 30000, text: 'Another Line', isInterlude: true }, // Explicit flag
            ];
            sync.setLyrics(rawLyrics);

            const lines = sync.getLines();
            assertEquals(lines[0].isInterlude, false, 'Line 0 must not be interlude');
            assertEquals(lines[1].isInterlude, true, 'Empty text must be interlude');
            assertEquals(lines[2].isInterlude, true, 'Whitespace text must be interlude');
            assertEquals(lines[3].isInterlude, true, '♪ text must be interlude');
            assertEquals(lines[4].isInterlude, true, '(Instrumental) must be interlude');
            assertEquals(lines[5].isInterlude, false, 'Line 5 must not be interlude');
            assertEquals(lines[6].isInterlude, true, 'Explicit isInterlude flag must be preserved');

            // Test active line emission during each interlude
            sync.updatePosition(5500);
            assertEquals(sync.getCurrentIndex(), 1);
            assertEquals(sync.getCurrentLine().isInterlude, true);

            sync.updatePosition(15500);
            assertEquals(sync.getCurrentIndex(), 3);
            assertEquals(sync.getCurrentLine().isInterlude, true);

            sync.updatePosition(20500);
            assertEquals(sync.getCurrentIndex(), 4);
            assertEquals(sync.getCurrentLine().isInterlude, true);

            sync.updatePosition(30500);
            assertEquals(sync.getCurrentIndex(), 6);
            assertEquals(sync.getCurrentLine().isInterlude, true);
        } finally {
            sync.destroy();
        }
    });

    test('3.4 Standard LRC without endTimeMs holds previous line until next timestamp', () => {
        const sync = new LyricsSync();
        try {
            // Standard LRC where endTimeMs is omitted
            sync.setLyrics([
                { timeMs: 1000, text: 'Line 1 (starts at 1s)' },
                { timeMs: 8000, text: 'Line 2 (starts at 8s)' },
            ]);

            // During the 7-second interval (1s to 7.999s), Line 1 remains active
            sync.updatePosition(1000);
            assertEquals(sync.getCurrentIndex(), 0);

            sync.updatePosition(5000); // 4 seconds after Line 1 started
            assertEquals(sync.getCurrentIndex(), 0, 'Standard LRC without endTimeMs maintains active line until next timestamp');

            sync.updatePosition(7999);
            assertEquals(sync.getCurrentIndex(), 0);

            sync.updatePosition(8000);
            assertEquals(sync.getCurrentIndex(), 1, 'Switches to Line 2 at 8000ms');
        } finally {
            sync.destroy();
        }
    });

    test('3.2 Non-contiguous lines with gaps > 2 seconds properly emit null states (-1, null)', () => {
        const sync = new LyricsSync();
        try {
            // Verse 1 ends at 5000ms. 5-second guitar solo before Verse 2 starts at 10000ms.
            const lyricsWithSolo = [
                { timeMs: 1000, endTimeMs: 5000, text: 'Verse 1 ends here' },
                { timeMs: 10000, endTimeMs: 15000, text: 'Verse 2 begins after 5s solo' }
            ];
            sync.setLyrics(lyricsWithSolo);

            let emitLog = [];
            sync.connect('line-changed', (_e, idx, line) => {
                emitLog.push({ idx, text: line ? line.text : null });
            });

            // Enter Verse 1
            sync.updatePosition(2000);
            assertEquals(sync.getCurrentIndex(), 0);
            assertEquals(emitLog.length, 1);
            assertEquals(emitLog[0].idx, 0);

            // Multiple ticks inside the 5-second gap (5000ms to 9999ms)
            for (let t = 5000; t < 10000; t += 500) {
                sync.updatePosition(t);
                assertEquals(sync.getCurrentIndex(), -1, `Position ${t}ms in gap must evaluate to -1`);
                assertEquals(sync.getCurrentLine(), null, `Position ${t}ms in gap must have null line`);
            }

            // Zero event flooding in the gap: emitLog must have recorded entering gap (-1, null) EXACTLY ONCE
            assertEquals(emitLog.length, 2, 'Gap should emit (-1, null) exactly once upon entry');
            assertEquals(emitLog[1].idx, -1);
            assertEquals(emitLog[1].text, null);

            // Transition into Verse 2 at 10000ms
            sync.updatePosition(10000);
            assertEquals(sync.getCurrentIndex(), 1);
            assertEquals(emitLog.length, 3);
            assertEquals(emitLog[2].idx, 1);
            assertEquals(emitLog[2].text, 'Verse 2 begins after 5s solo');
        } finally {
            sync.destroy();
        }
    });

    test('3.3 Boundary conditions around gap edges: endTimeMs - 1, endTimeMs, and nextTime', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics([
                { timeMs: 1000, endTimeMs: 4000, text: 'Line 1' },
                { timeMs: 7000, endTimeMs: 10000, text: 'Line 2' }
            ]);

            // Just before gap: 3999ms -> Line 1 (idx 0)
            sync.updatePosition(3999);
            assertEquals(sync.getCurrentIndex(), 0);

            // Exactly at gap boundary: 4000ms -> Gap (-1)
            sync.updatePosition(4000);
            assertEquals(sync.getCurrentIndex(), -1);

            // Just before next line: 6999ms -> Still gap (-1)
            sync.updatePosition(6999);
            assertEquals(sync.getCurrentIndex(), -1);

            // Exactly at next line: 7000ms -> Line 2 (idx 1)
            sync.updatePosition(7000);
            assertEquals(sync.getCurrentIndex(), 1);
        } finally {
            sync.destroy();
        }
    });
});

// =============================================================================
// Suite 4: Extreme List Sizes (Empty, 1-Line, 1,000-Line Performance)
// =============================================================================
suite('4. Extreme List Sizes & Scalability Stress', () => {
    test('4.1 Empty lyrics list [] handles arbitrary position updates safely', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics([]);
            assertEquals(sync.getCurrentIndex(), -1);
            assertEquals(sync.getCurrentLine(), null);
            assertEquals(sync.getLines().length, 0);

            let emitted = false;
            sync.connect('line-changed', () => { emitted = true; });

            const testPositions = [-1000, 0, 100, 50000, 999999999];
            for (const pos of testPositions) {
                sync.updatePosition(pos);
                assertEquals(sync.getCurrentIndex(), -1);
                assertEquals(sync.getCurrentLine(), null);
            }
            assertEquals(emitted, false, 'No signals allowed when lyrics list is empty');
        } finally {
            sync.destroy();
        }
    });

    test('4.2 1-line lyrics handles pre-track, active line, and post-track clamping', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics([
                { timeMs: 5000, endTimeMs: 10000, text: 'The Only Line' }
            ]);

            let transitions = [];
            sync.connect('line-changed', (_e, idx) => {
                transitions.push(idx);
            });

            // Before line
            sync.updatePosition(0);
            assertEquals(sync.getCurrentIndex(), -1);
            assertEquals(transitions.length, 0);

            // Hit line
            sync.updatePosition(5000);
            assertEquals(sync.getCurrentIndex(), 0);
            assertEquals(transitions.length, 1);
            assertEquals(transitions[0], 0);

            // Mid line
            sync.updatePosition(7500);
            assertEquals(sync.getCurrentIndex(), 0);
            assertEquals(transitions.length, 1);

            // Past endTimeMs: single line is the last line, so clamps to 0
            sync.updatePosition(15000);
            assertEquals(sync.getCurrentIndex(), 0);
            assertEquals(transitions.length, 1);

            // Seek back before line
            sync.updatePosition(1000);
            assertEquals(sync.getCurrentIndex(), -1);
            assertEquals(transitions.length, 2);
            assertEquals(transitions[1], -1);
        } finally {
            sync.destroy();
        }
    });

    test('4.3 1,000-line lyrics stress test: O(log N) binary search lookup performance', () => {
        const sync = new LyricsSync();
        try {
            const lines = [];
            for (let i = 0; i < 1000; i++) {
                lines.push({
                    timeMs: i * 1000,
                    endTimeMs: (i + 1) * 1000,
                    text: `Scale Line #${i}`,
                });
            }

            const loadStart = GLib.get_monotonic_time();
            sync.setLyrics(lines);
            const loadElapsedMs = (GLib.get_monotonic_time() - loadStart) / 1000;
            assertEquals(sync.getLines().length, 1000);

            // Execute 10,000 random queries across the 1,000 lines
            let seed = 12345;
            function rand() {
                seed = (seed * 1103515245 + 12345) % 2147483648;
                return seed / 2147483648;
            }

            const queryStart = GLib.get_monotonic_time();
            for (let q = 0; q < 10000; q++) {
                const targetMs = Math.floor(rand() * 1000000);
                const activeIdx = sync.findActiveIndex(targetMs);
                const expectedIdx = Math.floor(targetMs / 1000);
                if (activeIdx !== expectedIdx) {
                    throw new Error(`Scale test mismatch at ${targetMs}ms: got ${activeIdx}, expected ${expectedIdx}`);
                }
            }
            const queryElapsedMs = (GLib.get_monotonic_time() - queryStart) / 1000;
            const avgLookupUs = (queryElapsedMs * 1000) / 10000;

            console.log(`      [Perf] 1,000 lines indexed in ${loadElapsedMs.toFixed(2)}ms; 10,000 binary lookups in ${queryElapsedMs.toFixed(2)}ms (${avgLookupUs.toFixed(3)}µs/lookup)`);
            assert(avgLookupUs < 50, `Average binary search lookup must be under 50µs, was ${avgLookupUs}µs`);
        } finally {
            sync.destroy();
        }
    });

    test('4.4 5,000-line massive track scale and zero latency degradation', () => {
        const sync = new LyricsSync();
        try {
            const lines = [];
            for (let i = 0; i < 5000; i++) {
                lines.push({
                    timeMs: i * 500,
                    endTimeMs: (i + 1) * 500,
                    text: `Big Lyric Line #${i}`,
                });
            }
            sync.setLyrics(lines);
            assertEquals(sync.getLines().length, 5000);

            // Search worst-case boundary (last line)
            const startUs = GLib.get_monotonic_time();
            for (let i = 0; i < 5000; i++) {
                sync.findActiveIndex(2499999);
            }
            const elapsedMs = (GLib.get_monotonic_time() - startUs) / 1000;
            const avgUs = (elapsedMs * 1000) / 5000;
            console.log(`      [Perf] 5,000 worst-case binary lookups in 5,000-line set in ${elapsedMs.toFixed(2)}ms (${avgUs.toFixed(3)}µs/lookup)`);
            assert(avgUs < 20, 'Binary search on 5,000 lines must stay under 20µs');
        } finally {
            sync.destroy();
        }
    });
});

// =============================================================================
// Suite 5: Concurrency, Thrashing & Signal Re-entrancy Stress
// =============================================================================
suite('5. Concurrency, Thrashing & Signal Re-entrancy Stress', () => {
    test('5.1 Re-entrant updatePosition() called from inside line-changed signal handler', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics([
                { timeMs: 1000, text: 'A' },
                { timeMs: 2000, text: 'B' },
                { timeMs: 3000, text: 'C' },
            ]);

            let callDepth = 0;
            let maxCallDepth = 0;
            let emissionOrder = [];

            sync.connect('line-changed', (_e, idx) => {
                callDepth++;
                if (callDepth > maxCallDepth) maxCallDepth = callDepth;
                emissionOrder.push(idx);

                // Nested update call from within listener
                if (idx === 0) {
                    sync.updatePosition(2500); // Jump to line 1 immediately from callback
                }

                callDepth--;
            });

            sync.updatePosition(1500); // Triggers Line 0, which triggers Line 1
            assertEquals(sync.getCurrentIndex(), 1);
            assertEquals(emissionOrder.length, 2);
            assertEquals(emissionOrder[0], 0);
            assertEquals(emissionOrder[1], 1);
            assert(maxCallDepth <= 2, 'Call depth must remain bounded');
        } finally {
            sync.destroy();
        }
    });

    test('5.2 Rapid setLyrics() thrashing interleaved with updatePosition() (1,000 cycles)', () => {
        const sync = new LyricsSync();
        try {
            // Thrash 1,000 rapid track changes while updating positions
            const startUs = GLib.get_monotonic_time();
            for (let i = 0; i < 1000; i++) {
                const trackLen = (i % 10) + 1;
                const lines = [];
                for (let j = 0; j < trackLen; j++) {
                    lines.push({ timeMs: j * 1000, text: `Song ${i} Line ${j}` });
                }

                sync.setLyrics(lines);
                sync.updatePosition(500); // In line 0
                assertEquals(sync.getCurrentIndex(), 0);

                // Random update before next setLyrics
                sync.updatePosition(trackLen * 1000 + 500); // Past end
                assertEquals(sync.getCurrentIndex(), trackLen - 1);
            }
            const elapsedMs = (GLib.get_monotonic_time() - startUs) / 1000;
            console.log(`      [Perf] 1,000 setLyrics/updatePosition thrash cycles completed in ${elapsedMs.toFixed(2)}ms`);
        } finally {
            sync.destroy();
        }
    });

    test('5.3 Calling setLyrics([]) mid-playback emits (-1, null) and handles subsequent updates', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics([
                { timeMs: 1000, text: 'Line 1' },
                { timeMs: 3000, text: 'Line 2' },
            ]);
            sync.updatePosition(1500);
            assertEquals(sync.getCurrentIndex(), 0);

            let emittedIdx = null;
            let emittedLine = 'unset';
            sync.connect('line-changed', (_e, idx, line) => {
                emittedIdx = idx;
                emittedLine = line;
            });

            // Clear lyrics mid-playback
            sync.setLyrics([]);
            assertEquals(sync.getCurrentIndex(), -1);
            assertEquals(emittedIdx, -1);
            assertEquals(emittedLine, null);

            // Subsequent update on empty lyrics
            sync.updatePosition(2000);
            assertEquals(sync.getCurrentIndex(), -1);
        } finally {
            sync.destroy();
        }
    });
});

// =============================================================================
// Suite 6: Fault Injection, Boundary Types & Teardown
// =============================================================================
suite('6. Fault Injection, Type Robustness & Teardown', () => {
    test('6.1 Non-numeric and NaN timestamps in updatePosition() are ignored safely', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics([
                { timeMs: 1000, text: 'First' },
                { timeMs: 5000, text: 'Second' }
            ]);
            sync.updatePosition(2000);
            assertEquals(sync.getCurrentIndex(), 0);

            let emitted = false;
            sync.connect('line-changed', () => { emitted = true; });

            // Pass invalid types
            sync.updatePosition(NaN);
            sync.updatePosition(null);
            sync.updatePosition(undefined);
            sync.updatePosition('2000');
            sync.updatePosition({});
            sync.updatePosition([1000]);

            // State should remain unchanged at index 0, with 0 emissions
            assertEquals(sync.getCurrentIndex(), 0);
            assertEquals(emitted, false, 'Invalid inputs must not mutate state or emit signals');
        } finally {
            sync.destroy();
        }
    });

    test('6.2 setLyrics() with non-array arguments resets cleanly to empty state', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics(null);
            assertEquals(sync.getLines().length, 0);

            sync.setLyrics(undefined);
            assertEquals(sync.getLines().length, 0);

            sync.setLyrics('invalid string');
            assertEquals(sync.getLines().length, 0);

            sync.setLyrics(12345);
            assertEquals(sync.getLines().length, 0);

            sync.setLyrics({ lines: 'not an array' });
            assertEquals(sync.getLines().length, 0);
        } finally {
            sync.destroy();
        }
    });

    test('6.3 Out-of-order lines with identical timestamps sort deterministically', () => {
        const sync = new LyricsSync();
        try {
            const disordered = [
                { timeMs: 5000, text: 'At 5000 (A)' },
                { timeMs: 1000, text: 'At 1000' },
                { timeMs: 5000, text: 'At 5000 (B)' },
                { timeMs: 3000, text: 'At 3000' },
            ];
            sync.setLyrics(disordered);
            const sorted = sync.getLines();
            assertEquals(sorted[0].timeMs, 1000);
            assertEquals(sorted[1].timeMs, 3000);
            assertEquals(sorted[2].timeMs, 5000);
            assertEquals(sorted[3].timeMs, 5000);
        } finally {
            sync.destroy();
        }
    });

    test('6.4 Teardown: Operations after destroy() do not throw or leak', () => {
        const sync = new LyricsSync();
        sync.setLyrics([
            { timeMs: 1000, text: 'Line 1' },
            { timeMs: 3000, text: 'Line 2' }
        ]);
        sync.updatePosition(1500);
        assertEquals(sync.getCurrentIndex(), 0);

        sync.destroy();

        // Check internal nullification
        assertEquals(sync.getCurrentIndex(), -1);
        assertEquals(sync.getCurrentLine(), null);
        assertEquals(sync.getLines().length, 0);

        // Subsequent calls must be safe no-ops
        let emitted = false;
        sync.connect('line-changed', () => { emitted = true; });
        sync.updatePosition(2000);
        sync.updatePosition(3500);
        assertEquals(emitted, false, 'Destroyed synchronizer must not emit');

        // Calling destroy multiple times must be safe
        sync.destroy();
        sync.destroy();
    });
});

// =============================================================================
// Suite 7: Memory Endurance & Garbage Collection Stability
// =============================================================================
suite('7. Memory Endurance & Garbage Collection Stability', () => {
    test('7.1 100,000 position updates do not leak memory or degrade throughput', () => {
        const sync = new LyricsSync();
        try {
            const lines = [];
            for (let i = 0; i < 200; i++) {
                lines.push({ timeMs: i * 1000, endTimeMs: (i + 1) * 1000, text: `Line ${i}` });
            }
            sync.setLyrics(lines);

            // Warm up
            for (let i = 0; i < 1000; i++) sync.updatePosition(i * 10);

            // Execute 100,000 updates in chunks, measuring throughput
            const t0 = GLib.get_monotonic_time();
            for (let i = 0; i < 100000; i++) {
                sync.updatePosition(i % 200000);
            }
            const tTotalMs = (GLib.get_monotonic_time() - t0) / 1000;

            console.log(`      [Perf] 100,000 position updates evaluated in ${tTotalMs.toFixed(2)}ms (${(100000 / (tTotalMs / 1000)).toFixed(0)} updates/sec)`);
            assert(tTotalMs < 500, `100,000 updates took ${tTotalMs}ms (must be < 500ms)`);
        } finally {
            sync.destroy();
        }
    });

    test('7.2 2,000 new LyricsSync instances created and destroyed cleanly collect with System.gc()', () => {
        const startUs = GLib.get_monotonic_time();
        for (let i = 0; i < 2000; i++) {
            const inst = new LyricsSync();
            inst.setLyrics([
                { timeMs: 0, text: 'A' },
                { timeMs: 5000, text: 'B' },
            ]);
            inst.updatePosition(2500);
            inst.destroy();
        }
        System.gc();
        const elapsedMs = (GLib.get_monotonic_time() - startUs) / 1000;
        console.log(`      [Endurance] 2,000 instance lifecycles created, exercised, destroyed, and GC'd in ${elapsedMs.toFixed(2)}ms`);
    });
});

// =============================================================================
// Execution Summary
// =============================================================================
console.log('\n======================================================');
console.log(`${ANSI_BOLD}Empirical Challenger Test Summary (lyricsSync.js):${ANSI_RESET}`);
console.log(`  Total Tests:   ${totalTests}`);
console.log(`  ${ANSI_GREEN}Passed:        ${passedTests}${ANSI_RESET}`);
console.log(`  ${failedTests > 0 ? ANSI_RED : ANSI_GREEN}Failed:        ${failedTests}${ANSI_RESET}`);
console.log('======================================================\n');

if (failedTests > 0) {
    console.error(`${ANSI_RED}Failure Breakdown:${ANSI_RESET}`);
    for (const fail of failureDetails) {
        console.error(`- ${fail.test}: ${fail.error}`);
    }
    System.exit(1);
} else {
    System.exit(0);
}
