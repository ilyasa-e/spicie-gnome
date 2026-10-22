/**
 * Spicie GNOME Extension - Master E2E Test Runner
 *
 * Runs all 4 test tiers:
 * - Tier 1: Feature Coverage (>=5 test cases across 7 features)
 * - Tier 2: Boundary & Corner Cases (>=5 test cases across 7 features)
 * - Tier 3: Cross-Feature Combinations (>=10 pairwise test cases)
 * - Tier 4: Real-World Workloads (>=6 realistic playback scenarios)
 *
 * Compatible with GJS 1.88+ and Node.js 20+
 */

import { defaultRunner } from './harness/test_framework.js';
import { ModuleStatus } from './harness/module_loader.js';

// Tier 1 Imports
import { runMprisTrackingTests } from './tier1_feature_coverage/test_mpris_tracking.js';
import { runLyricsFetchTests } from './tier1_feature_coverage/test_lyrics_fetch.js';
import { runRomanizationTests } from './tier1_feature_coverage/test_romanization.js';
import { runSyncEngineTests } from './tier1_feature_coverage/test_sync_engine.js';
import { runUiSurfacesTests } from './tier1_feature_coverage/test_ui_surfaces.js';
import { runPreferencesTests } from './tier1_feature_coverage/test_preferences.js';
import { runLifecycleTests } from './tier1_feature_coverage/test_lifecycle.js';

// Tier 2 Imports
import { runBoundaryMprisTests } from './tier2_boundary_corner/test_boundary_mpris.js';
import { runBoundaryLyricsTests } from './tier2_boundary_corner/test_boundary_lyrics.js';
import { runBoundaryRomanizationTests } from './tier2_boundary_corner/test_boundary_romanization.js';
import { runBoundarySyncTests } from './tier2_boundary_corner/test_boundary_sync.js';
import { runBoundaryUiTests } from './tier2_boundary_corner/test_boundary_ui.js';
import { runBoundaryPreferencesTests } from './tier2_boundary_corner/test_boundary_preferences.js';
import { runBoundaryLifecycleTests } from './tier2_boundary_corner/test_boundary_lifecycle.js';

// Tier 3 Imports
import { runCrossFeatureTests } from './tier3_cross_feature/test_cross_feature_combinations.js';

// Tier 4 Imports
import { runRealWorldWorkloadTests } from './tier4_real_world/test_real_world_workloads.js';

async function main() {
    console.log(`\x1b[1m\x1b[35m=== Spicie E2E Test Suite ===\x1b[0m`);
    console.log(`Initializing 4-Tier Opaque-Box Test Matrix...\n`);

    // Register Tier 1 Tests
    runMprisTrackingTests();
    runLyricsFetchTests();
    runRomanizationTests();
    runSyncEngineTests();
    runUiSurfacesTests();
    runPreferencesTests();
    runLifecycleTests();

    // Register Tier 2 Tests
    runBoundaryMprisTests();
    runBoundaryLyricsTests();
    runBoundaryRomanizationTests();
    runBoundarySyncTests();
    runBoundaryUiTests();
    runBoundaryPreferencesTests();
    runBoundaryLifecycleTests();

    // Register Tier 3 Tests
    runCrossFeatureTests();

    // Register Tier 4 Tests
    runRealWorldWorkloadTests();

    // Execute all registered suites
    const summary = await defaultRunner.run();

    console.log(`\x1b[1mModule Progression Status:\x1b[0m`);
    for (const [mod, status] of Object.entries(ModuleStatus)) {
        const badge = status === 'real' ? '\x1b[32m[LIVE IMPLEMENTATION]\x1b[0m' : '\x1b[34m[CONTRACT ORACLE]\x1b[0m';
        console.log(`  - ${mod.padEnd(18)}: ${badge}`);
    }
    console.log('');

    const exitCode = summary.passed ? 0 : 1;

    // Platform-agnostic exit
    if (typeof process !== 'undefined' && process.exit) {
        process.exit(exitCode);
    } else {
        try {
            const system = await import('system');
            system.default.exit(exitCode);
        } catch (e) {
            // If running in an environment without system or process
        }
    }
}

main().catch(err => {
    console.error(`Fatal Test Runner Error:`, err);
    if (typeof process !== 'undefined' && process.exit) {
        process.exit(1);
    }
});
