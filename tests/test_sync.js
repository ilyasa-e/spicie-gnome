#!/usr/bin/env gjs -m

/**
 * Unit Test Suite for Lyrics Synchronization Engine (Milestone 2)
 * Validates active line matching, transition deduplication, seek handling,
 * instrumental interlude transitions, and lifecycle destruction.
 *
 * Can be run headlessly:
 *   gjs -m tests/test_sync.js
 */

import System from 'system';
import { LyricsSync } from '../lyricsSync.js';

// =============================================================================
// Micro Test Runner & Assertion Harness
// =============================================================================

let totalSuites = 0;
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let skippedTests = 0;

const ANSI_GREEN = '\x1b[32m';
const ANSI_RED = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_RESET = '\x1b[0m';

function describe(suiteName, suiteFn) {
    totalSuites++;
    console.log(`\n${ANSI_BOLD}=== Suite: ${suiteName} ===${ANSI_RESET}`);
    suiteFn();
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

function assert(condition, message = 'Assertion failed') {
    if (!condition) throw new Error(message);
}

function assertEquals(actual, expected, message = '') {
    if (actual !== expected) {
        const prefix = message ? `${message}: ` : '';
        throw new Error(`${prefix}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertDeepEquals(actual, expected, message = '') {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    if (actualStr !== expectedStr) {
        const prefix = message ? `${message}: ` : '';
        throw new Error(`${prefix}Expected ${expectedStr}, got ${actualStr}`);
    }
}

// Standard test lyrics dataset for 5-line song
function getStandardTestLyrics() {
    return [
        { timeMs: 1000, endTimeMs: 3000, text: 'Look at the stars' },
        { timeMs: 3000, endTimeMs: 6000, text: 'Look how they shine for you' },
        { timeMs: 6000, endTimeMs: 9000, text: 'And everything you do' },
        { timeMs: 9000, endTimeMs: 12000, text: 'Yeah they were all yellow' },
        { timeMs: 12000, endTimeMs: 16000, text: 'I came along' },
    ];
}

// =============================================================================
// Suite 1: Initialization & Empty State
// =============================================================================

describe('1. Initialization & Empty State Handling', () => {
    test('1.1 New instance starts with index -1 and line null', () => {
        const sync = new LyricsSync();
        try {
            assertEquals(sync.getCurrentIndex(), -1, 'Initial index must be -1');
            assertEquals(sync.getCurrentLine(), null, 'Initial line must be null');
        } finally {
            sync.destroy();
        }
    });

    test('1.2 updatePosition with empty lyrics does not throw or emit', () => {
        const sync = new LyricsSync();
        try {
            let emitted = false;
            sync.connect('line-changed', () => { emitted = true; });
            sync.updatePosition(5000);
            assertEquals(sync.getCurrentIndex(), -1);
            assertEquals(sync.getCurrentLine(), null);
            assert(!emitted, 'Should not emit when lyrics are empty');
        } finally {
            sync.destroy();
        }
    });

    test('1.3 setLyrics([]) resets current index to -1 and line to null', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics(getStandardTestLyrics());
            sync.updatePosition(3500);
            assertEquals(sync.getCurrentIndex(), 1);

            let emittedWithNull = false;
            sync.connect('line-changed', (_e, idx, line) => {
                if (idx === -1 && line === null) emittedWithNull = true;
            });

            sync.setLyrics([]);
            assertEquals(sync.getCurrentIndex(), -1);
            assertEquals(sync.getCurrentLine(), null);
            assert(emittedWithNull, 'Must emit -1, null when active lyrics are cleared');
        } finally {
            sync.destroy();
        }
    });

    test('1.4 setLyrics automatically sorts out-of-order lines by timestamp', () => {
        const sync = new LyricsSync();
        try {
            const disordered = [
                { timeMs: 6000, text: 'Line 3' },
                { timeMs: 1000, text: 'Line 1' },
                { timeMs: 3000, text: 'Line 2' },
            ];
            sync.setLyrics(disordered);
            const lines = sync.getLines();
            assertEquals(lines[0].text, 'Line 1');
            assertEquals(lines[1].text, 'Line 2');
            assertEquals(lines[2].text, 'Line 3');
        } finally {
            sync.destroy();
        }
    });
});

// =============================================================================
// Suite 2: Forward Playback Active Line Matching
// =============================================================================

describe('2. Forward Playback Active Line Matching', () => {
    test('2.1 Position before first line (t < 1000ms) evaluates to index -1', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics(getStandardTestLyrics());
            let emitted = false;
            sync.connect('line-changed', () => { emitted = true; });

            sync.updatePosition(0);
            assertEquals(sync.getCurrentIndex(), -1);
            assertEquals(sync.getCurrentLine(), null);

            sync.updatePosition(500);
            assertEquals(sync.getCurrentIndex(), -1);
            assert(!emitted, 'No line-changed emitted before song lyrics begin');
        } finally {
            sync.destroy();
        }
    });

    test('2.2 First line boundary hit at t = 1000ms', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics(getStandardTestLyrics());
            let eventIndex = null;
            let eventLine = null;
            sync.connect('line-changed', (_e, idx, line) => {
                eventIndex = idx;
                eventLine = line;
            });

            sync.updatePosition(1000);
            assertEquals(sync.getCurrentIndex(), 0);
            assertEquals(eventIndex, 0);
            assert(eventLine !== null && eventLine.text === 'Look at the stars');
        } finally {
            sync.destroy();
        }
    });

    test('2.3 Mid-line playback position maintains active line', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics(getStandardTestLyrics());
            sync.updatePosition(1500);
            assertEquals(sync.getCurrentIndex(), 0);
            sync.updatePosition(2500);
            assertEquals(sync.getCurrentIndex(), 0);
            assertEquals(sync.getCurrentLine().text, 'Look at the stars');
        } finally {
            sync.destroy();
        }
    });

    test('2.4 Sequential line transitions cross all 5 lines in order', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics(getStandardTestLyrics());
            const transitions = [];
            sync.connect('line-changed', (_e, idx) => {
                transitions.push(idx);
            });

            sync.updatePosition(1000);
            sync.updatePosition(3000);
            sync.updatePosition(6000);
            sync.updatePosition(9000);
            sync.updatePosition(12000);

            assertDeepEquals(transitions, [0, 1, 2, 3, 4], 'Must transition sequentially through 0..4');
        } finally {
            sync.destroy();
        }
    });
});

// =============================================================================
// Suite 3: Zero Redundant Signal Emission (Steady Playback)
// =============================================================================

describe('3. Zero Redundant Signal Emission (Steady Playback)', () => {
    test('3.1 100 consecutive 50ms ticks on same line emit exactly ONCE', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics(getStandardTestLyrics());
            let emitCount = 0;
            sync.connect('line-changed', () => {
                emitCount++;
            });

            // Simulate high frequency 50ms ticker from 3000ms to 5950ms (Line 1)
            for (let t = 3000; t < 6000; t += 50) {
                sync.updatePosition(t);
            }

            assertEquals(emitCount, 1, 'Exactly one signal on transition; zero redundant ticks');
            assertEquals(sync.getCurrentIndex(), 1);
        } finally {
            sync.destroy();
        }
    });

    test('3.2 Full song simulation (160 ticks across 16 seconds) emits exactly 5 times', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics(getStandardTestLyrics());
            let emitCount = 0;
            sync.connect('line-changed', () => {
                emitCount++;
            });

            // Step in 100ms intervals from 0ms to 16000ms (161 ticks total)
            for (let t = 0; t <= 16000; t += 100) {
                sync.updatePosition(t);
            }

            assertEquals(emitCount, 5, 'Must emit exactly 5 times (one for each of the 5 lines)');
        } finally {
            sync.destroy();
        }
    });
});

// =============================================================================
// Suite 4: Seek Handling & Resynchronization
// =============================================================================

describe('4. Seek Handling & Resynchronization', () => {
    test('4.1 Forward seek jump (+3 lines) updates index and emits once', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics(getStandardTestLyrics());
            sync.updatePosition(1500); // Line 0
            assertEquals(sync.getCurrentIndex(), 0);

            let emittedIndex = null;
            sync.connect('line-changed', (_e, idx) => {
                emittedIndex = idx;
            });

            sync.updatePosition(10500); // Seek forward into Line 3
            assertEquals(sync.getCurrentIndex(), 3);
            assertEquals(emittedIndex, 3);
            assertEquals(sync.getCurrentLine().text, 'Yeah they were all yellow');
        } finally {
            sync.destroy();
        }
    });

    test('4.2 Backward seek jump (-2 lines) updates index and emits once', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics(getStandardTestLyrics());
            sync.updatePosition(10500); // Line 3
            assertEquals(sync.getCurrentIndex(), 3);

            let emittedIndex = null;
            sync.connect('line-changed', (_e, idx) => {
                emittedIndex = idx;
            });

            sync.updatePosition(3500); // Seek backward into Line 1
            assertEquals(sync.getCurrentIndex(), 1);
            assertEquals(emittedIndex, 1);
            assertEquals(sync.getCurrentLine().text, 'Look how they shine for you');
        } finally {
            sync.destroy();
        }
    });

    test('4.3 Seek to intro (before line 0) emits index -1 and line null', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics(getStandardTestLyrics());
            sync.updatePosition(3500); // Line 1
            assertEquals(sync.getCurrentIndex(), 1);

            let emittedIndex = null;
            let emittedLine = 'unset';
            sync.connect('line-changed', (_e, idx, line) => {
                emittedIndex = idx;
                emittedLine = line;
            });

            sync.updatePosition(200); // Seek to intro before 1000ms
            assertEquals(sync.getCurrentIndex(), -1);
            assertEquals(emittedIndex, -1);
            assertEquals(emittedLine, null);
        } finally {
            sync.destroy();
        }
    });

    test('4.4 Intra-line seek emits zero redundant signals', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics(getStandardTestLyrics());
            sync.updatePosition(6100); // Line 2 (6000..9000ms)
            assertEquals(sync.getCurrentIndex(), 2);

            let emitCount = 0;
            sync.connect('line-changed', () => { emitCount++; });

            sync.updatePosition(8500); // Seek forward within Line 2
            assertEquals(sync.getCurrentIndex(), 2);
            assertEquals(emitCount, 0, 'No signal on seek within the same active line');

            sync.updatePosition(6200); // Seek backward within Line 2
            assertEquals(sync.getCurrentIndex(), 2);
            assertEquals(emitCount, 0, 'No signal on backward seek within same line');
        } finally {
            sync.destroy();
        }
    });

    test('4.5 Playback past last line end time clamps gracefully', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics(getStandardTestLyrics());
            sync.updatePosition(30000); // Past 16000ms
            assertEquals(sync.getCurrentIndex(), 4, 'Clamps to last line');
        } finally {
            sync.destroy();
        }
    });
});

// =============================================================================
// Suite 5: Instrumental Interludes & Gaps
// =============================================================================

describe('5. Instrumental Interludes & Gaps', () => {
    test('5.1 Explicit interlude line with isInterlude === true', () => {
        const sync = new LyricsSync();
        try {
            const lyricsWithInterlude = [
                { timeMs: 1000, endTimeMs: 4000, text: 'Verse 1' },
                { timeMs: 4000, endTimeMs: 8000, text: '', isInterlude: true },
                { timeMs: 8000, endTimeMs: 12000, text: 'Verse 2' },
            ];
            sync.setLyrics(lyricsWithInterlude);

            let activeLine = null;
            sync.onLineChanged((line) => {
                activeLine = line;
            });

            sync.updatePosition(2000); // Verse 1
            assertEquals(sync.getCurrentIndex(), 0);
            assert(activeLine.isInterlude === false);

            sync.updatePosition(5000); // Interlude
            assertEquals(sync.getCurrentIndex(), 1);
            assert(activeLine.isInterlude === true, 'Active line must flag isInterlude');

            sync.updatePosition(9000); // Verse 2
            assertEquals(sync.getCurrentIndex(), 2);
            assert(activeLine.isInterlude === false);
        } finally {
            sync.destroy();
        }
    });

    test('5.2 Gap between non-contiguous lines emits index -1 and null line', () => {
        const sync = new LyricsSync();
        try {
            const nonContiguousLyrics = [
                { timeMs: 1000, endTimeMs: 4000, text: 'Line 1' },
                // 3-second gap between 4000ms and 7000ms
                { timeMs: 7000, endTimeMs: 10000, text: 'Line 2' },
            ];
            sync.setLyrics(nonContiguousLyrics);

            let emittedIndex = null;
            let emittedLine = 'unset';
            sync.connect('line-changed', (_e, idx, line) => {
                emittedIndex = idx;
                emittedLine = line;
            });

            sync.updatePosition(2000); // Line 1
            assertEquals(sync.getCurrentIndex(), 0);

            sync.updatePosition(5000); // In the 4000..7000 gap
            assertEquals(sync.getCurrentIndex(), -1);
            assertEquals(emittedIndex, -1);
            assertEquals(emittedLine, null);

            sync.updatePosition(8000); // Line 2 starts
            assertEquals(sync.getCurrentIndex(), 1);
            assertEquals(emittedIndex, 1);
            assertEquals(sync.getCurrentLine().text, 'Line 2');
        } finally {
            sync.destroy();
        }
    });

    test('5.3 Negative position clamps to -1 before track starts', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics(getStandardTestLyrics());
            sync.updatePosition(-5000);
            assertEquals(sync.getCurrentIndex(), -1);
            assertEquals(sync.getCurrentLine(), null);
        } finally {
            sync.destroy();
        }
    });
});

// =============================================================================
// Suite 6: Dynamic Lyrics & Track Replacement
// =============================================================================

describe('6. Dynamic Lyrics & Track Replacement', () => {
    test('6.1 Replacing lyrics mid-playback resets state and matches new song immediately', () => {
        const sync = new LyricsSync();
        try {
            sync.setLyrics(getStandardTestLyrics());
            sync.updatePosition(3500); // Line 1 in Song 1
            assertEquals(sync.getCurrentIndex(), 1);

            const song2 = [
                { timeMs: 2000, text: 'New Song Line 1' },
                { timeMs: 5000, text: 'New Song Line 2' },
            ];
            sync.setLyrics(song2);
            assertEquals(sync.getCurrentIndex(), -1, 'setLyrics resets index to -1');

            sync.updatePosition(2500); // Matches Line 0 of Song 2
            assertEquals(sync.getCurrentIndex(), 0);
            assertEquals(sync.getCurrentLine().text, 'New Song Line 1');
        } finally {
            sync.destroy();
        }
    });

    test('6.2 Rapid consecutive setLyrics calls do not throw or leak state', () => {
        const sync = new LyricsSync();
        try {
            for (let i = 0; i < 20; i++) {
                sync.setLyrics([{ timeMs: i * 1000, text: `Track ${i}` }]);
                sync.updatePosition(i * 1000);
            }
            assertEquals(sync.getCurrentIndex(), 0);
            assertEquals(sync.getCurrentLine().text, 'Track 19');
        } finally {
            sync.destroy();
        }
    });
});

// =============================================================================
// Suite 7: Lifecycle & Resource Teardown
// =============================================================================

describe('7. Lifecycle & Resource Teardown', () => {
    test('7.1 destroy() clears internal state and nullifies references', () => {
        const sync = new LyricsSync();
        sync.setLyrics(getStandardTestLyrics());
        sync.updatePosition(3500);
        assertEquals(sync.getCurrentIndex(), 1);

        sync.destroy();
        assertEquals(sync.getCurrentIndex(), -1);
        assertEquals(sync.getCurrentLine(), null);
        assertEquals(sync.getLines().length, 0);
    });

    test('7.2 Calling updatePosition after destroy is a safe no-op', () => {
        const sync = new LyricsSync();
        sync.setLyrics(getStandardTestLyrics());
        sync.destroy();

        let emitted = false;
        sync.connect('line-changed', () => { emitted = true; });
        sync.updatePosition(5000); // Must not throw or emit
        assert(!emitted, 'No emissions permitted after destroy()');
    });
});

// =============================================================================
// Summary & Process Exit
// =============================================================================

console.log('\n======================================================');
console.log(`${ANSI_BOLD}Test Execution Summary (test_sync.js):${ANSI_RESET}`);
console.log(`  Total Suites:  ${totalSuites}`);
console.log(`  Total Tests:   ${totalTests}`);
console.log(`  ${ANSI_GREEN}Passed Tests:  ${passedTests}${ANSI_RESET}`);
console.log(`  ${failedTests > 0 ? ANSI_RED : ANSI_GREEN}Failed Tests:  ${failedTests}${ANSI_RESET}`);
console.log(`  ${ANSI_YELLOW}Skipped Tests: ${skippedTests}${ANSI_RESET}`);
console.log('======================================================\n');

if (failedTests > 0) {
    System.exit(1);
} else {
    System.exit(0);
}
