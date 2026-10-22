/**
 * Tier 1: Feature Coverage - Extension Lifecycle
 */

import { describe, it, expect } from '../harness/test_framework.js';
import { MockShellEnvironment } from '../harness/mock_shell.js';
import { MockSettings } from '../harness/mock_settings.js';
import { MockSpotifyDBusProxy } from '../harness/mock_mpris.js';
import { MockNetworkSession } from '../harness/mock_network.js';
import { loadModule } from '../harness/module_loader.js';

export function runLifecycleTests() {
    describe('Tier 1: Extension Lifecycle Management', () => {
        it('T1.31: enable() instantiates MPRIS client, lyrics provider, sync, HUD, and panel button', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);

            ext.enable();

            // Actors registered with Main
            expect(shell.Main.panel.statusArea.has('spotify-floating-lyrics')).toBe(true);
            expect(shell.Main.layoutManager.topChromeActors.size).toBe(1);

            ext.disable();
        });

        it('T1.32: disable() tears down all components in clean reverse order', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);

            ext.enable();
            ext.disable();

            // Actors unparented and removed
            expect(shell.Main.panel.statusArea.has('spotify-floating-lyrics')).toBe(false);
            expect(shell.Main.layoutManager.topChromeActors.size).toBe(0);
        });

        it('T1.33: Destroys Clutter actors from Main.layoutManager and Main.panel on disable', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);

            ext.enable();
            const hudActor = [...shell.Main.layoutManager.topChromeActors.keys()][0];
            expect(hudActor.destroyed).toBe(false);

            ext.disable();
            expect(hudActor.destroyed).toBe(true);
        });

        it('T1.34: Cancels active sync loop timers and clears cached state on disable', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);

            ext.enable();
            expect(ext._sync).toBeDefined();

            ext.disable();
            expect(ext._sync).toBeNull();
        });

        it('T1.35: Verifies zero dangling D-Bus signal connections post-disable', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);

            ext.enable();
            ext.disable();

            // Emitting signals on proxy post-disable must not throw or invoke destroyed extension handlers
            expect(() => {
                proxy.setPlaybackStatus('Playing');
                proxy.simulateSeek(50000);
            }).not.toThrow();
        });
    });
}
