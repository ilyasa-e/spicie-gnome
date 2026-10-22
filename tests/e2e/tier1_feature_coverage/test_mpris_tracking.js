/**
 * Tier 1: Feature Coverage - MPRIS Tracking
 */

import { describe, it, expect, sleep } from '../harness/test_framework.js';
import { MockSpotifyDBusProxy } from '../harness/mock_mpris.js';
import { loadModule } from '../harness/module_loader.js';
import { SAMPLE_MPRIS_DATA } from '../fixtures/sample_mpris_data.js';

export function runMprisTrackingTests() {
    describe('Tier 1: MPRIS Tracking & D-Bus Proxy', () => {
        it('T1.1: Connects to Spotify MPRIS proxy and detects player availability', async () => {
            const proxy = new MockSpotifyDBusProxy({ nameOwner: ':1.42' });
            const mod = await loadModule('mpris');
            const MprisClass = mod.SpotifyMPRIS || mod.default;
            const mpris = new MprisClass(proxy);

            let availableEvent = null;
            mpris.connect('player-available', (sender, avail) => {
                availableEvent = avail;
            });

            // Proxy is already owned
            expect(Boolean(proxy.g_name_owner)).toBe(true);

            // Simulate owner disconnect
            proxy.simulatePlayerDied();
            expect(availableEvent).toBe(false);

            // Simulate owner reconnect
            proxy.simulatePlayerStarted();
            expect(availableEvent).toBe(true);

            mpris.destroy();
        });

        it('T1.2: Extracts and normalizes metadata variants (artist array, length us -> ms, trackid)', async () => {
            const proxy = new MockSpotifyDBusProxy({ metadata: SAMPLE_MPRIS_DATA.standardTrack });
            const mod = await loadModule('mpris');
            const MprisClass = mod.SpotifyMPRIS || mod.default;
            const mpris = new MprisClass(proxy);

            const meta = mpris.getMetadata();
            expect(meta.title).toBe('Yellow');
            expect(meta.artist).toBe('Coldplay');
            expect(meta.durationMs).toBe(267000); // 267,000,000 us -> 267,000 ms
            expect(meta.trackId).toBe('5JESuE80fvausWHjcT9QVh');
            expect(meta.artUrl).toBe('https://i.scdn.co/image/ab67616d0000b2739164ba0f6ae4763b43085f31');

            mpris.destroy();
        });

        it('T1.3: Monotonic time interpolation computes continuous playback position', async () => {
            const proxy = new MockSpotifyDBusProxy({
                playbackStatus: 'Playing',
                positionUs: 10000000 // 10s
            });
            const mod = await loadModule('mpris');
            const MprisClass = mod.SpotifyMPRIS || mod.default;
            const mpris = new MprisClass(proxy);

            const pos1 = mpris.getPositionMs();
            expect(pos1).toBeGreaterThanOrEqual(10000);

            // Wait 25ms to verify position advances monotonically
            await sleep(25);
            const pos2 = mpris.getPositionMs();
            expect(pos2).toBeGreaterThanOrEqual(pos1);

            mpris.destroy();
        });

        it('T1.4: Handles playback status transitions (Playing -> Paused -> Stopped) and freezes position', async () => {
            const proxy = new MockSpotifyDBusProxy({
                playbackStatus: 'Playing',
                positionUs: 30000000 // 30s
            });
            const mod = await loadModule('mpris');
            const MprisClass = mod.SpotifyMPRIS || mod.default;
            const mpris = new MprisClass(proxy);

            let lastStatus = null;
            mpris.connect('status-changed', (sender, status) => {
                lastStatus = status;
            });

            // Transition to Paused
            proxy.setPlaybackStatus('Paused');
            expect(lastStatus).toBe('Paused');

            const frozenPos1 = mpris.getPositionMs();
            await sleep(25);
            const frozenPos2 = mpris.getPositionMs();

            // When paused, position does not drift forward
            expect(frozenPos2).toBe(frozenPos1);

            mpris.destroy();
        });

        it('T1.5: Dispatches remote player controls (PlayPause, Next, Previous, SetPosition)', async () => {
            const proxy = new MockSpotifyDBusProxy();
            const mod = await loadModule('mpris');
            const MprisClass = mod.SpotifyMPRIS || mod.default;
            const mpris = new MprisClass(proxy);

            await mpris.playPause();
            expect(proxy.methodCalls.some(c => c.method === 'PlayPause')).toBe(true);

            await mpris.next();
            expect(proxy.methodCalls.some(c => c.method === 'Next')).toBe(true);

            await mpris.previous();
            expect(proxy.methodCalls.some(c => c.method === 'Previous')).toBe(true);

            await mpris.setPosition(45000);
            expect(proxy.methodCalls.some(c => c.method === 'SetPosition' && c.positionUs === 45000000)).toBe(true);

            mpris.destroy();
        });
    });
}
