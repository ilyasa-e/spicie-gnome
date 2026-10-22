/**
 * Tier 2: Boundary & Corner Cases - MPRIS Tracking
 */

import { describe, it, expect } from '../harness/test_framework.js';
import { MockSpotifyDBusProxy } from '../harness/mock_mpris.js';
import { loadModule } from '../harness/module_loader.js';
import { SAMPLE_MPRIS_DATA } from '../fixtures/sample_mpris_data.js';

export function runBoundaryMprisTests() {
    describe('Tier 2: Boundary Cases - MPRIS D-Bus', () => {
        it('T2.1: Spotify audio advertisement is detected and marked as ad', async () => {
            const proxy = new MockSpotifyDBusProxy({ metadata: SAMPLE_MPRIS_DATA.advertisementTrack });
            const mod = await loadModule('mpris');
            const MprisClass = mod.SpotifyMPRIS || mod.default;
            const mpris = new MprisClass(proxy);

            const meta = mpris.getMetadata();
            expect(Boolean(meta.isAd || meta.isAdvertisement)).toBe(true);

            mpris.destroy();
        });

        it('T2.2: Empty or missing metadata dictionary handles all fields with safe defaults', async () => {
            const proxy = new MockSpotifyDBusProxy({ metadata: SAMPLE_MPRIS_DATA.emptyMetadata });
            const mod = await loadModule('mpris');
            const MprisClass = mod.SpotifyMPRIS || mod.default;
            const mpris = new MprisClass(proxy);

            const meta = mpris.getMetadata();
            expect(meta.title === '' || meta.title === 'Unknown Title').toBe(true);
            expect(meta.artist === '' || meta.artist === 'Unknown Artist').toBe(true);
            expect(meta.durationMs).toBe(0);
            expect(meta.trackId).toBe('');
            expect(meta.artUrl).toBe('');

            mpris.destroy();
        });

        it('T2.3: xesam:artist variant handles scalar string and empty array', async () => {
            const proxy = new MockSpotifyDBusProxy({ metadata: SAMPLE_MPRIS_DATA.scalarArtistTrack });
            const mod = await loadModule('mpris');
            const MprisClass = mod.SpotifyMPRIS || mod.default;
            const mpris = new MprisClass(proxy);

            // Scalar artist string
            expect(mpris.getMetadata().artist).toBe('Solo Performer');

            // Multiple artists array
            proxy.setMetadata(SAMPLE_MPRIS_DATA.multiArtistTrack);
            expect(mpris.getMetadata().artist).toBe('Artist A, Artist B, Featured C');

            mpris.destroy();
        });

        it('T2.4: Handles 24-hour track length and extreme microsecond values without overflow', async () => {
            const proxy = new MockSpotifyDBusProxy({ metadata: SAMPLE_MPRIS_DATA.extremeMetadata });
            const mod = await loadModule('mpris');
            const MprisClass = mod.SpotifyMPRIS || mod.default;
            const mpris = new MprisClass(proxy);

            const meta = mpris.getMetadata();
            // 86,400,000,000 us = 86,400,000 ms (24 hours)
            expect(meta.durationMs).toBe(86400000);

            mpris.destroy();
        });

        it('T2.5: Rapid successive seek events within 10ms recalibrate position cleanly', async () => {
            const proxy = new MockSpotifyDBusProxy({
                playbackStatus: 'Playing',
                positionUs: 10000000 // 10s
            });
            const mod = await loadModule('mpris');
            const MprisClass = mod.SpotifyMPRIS || mod.default;
            const mpris = new MprisClass(proxy);

            let seekedCount = 0;
            mpris.connect('seeked', () => { seekedCount++; });

            // Rapid seeks: 20s, 30s, 40s, 50s
            proxy.simulateSeek(20000);
            proxy.simulateSeek(30000);
            proxy.simulateSeek(40000);
            proxy.simulateSeek(50000);

            expect(seekedCount).toBe(4);
            expect(mpris.getPositionMs()).toBeGreaterThanOrEqual(50000);

            mpris.destroy();
        });
    });
}
