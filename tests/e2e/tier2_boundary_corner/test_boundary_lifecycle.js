/**
 * Tier 2: Boundary & Corner Cases - Extension Lifecycle
 */

import { describe, it, expect } from '../harness/test_framework.js';
import { MockShellEnvironment } from '../harness/mock_shell.js';
import { MockSettings } from '../harness/mock_settings.js';
import { MockSpotifyDBusProxy } from '../harness/mock_mpris.js';
import { MockNetworkSession } from '../harness/mock_network.js';
import { loadModule } from '../harness/module_loader.js';

export function runBoundaryLifecycleTests() {
    describe('Tier 2: Boundary Cases - Extension Lifecycle', () => {
        it('T2.31: Rapid enable/disable thrashing (10 cycles) leaves clean state without leaking', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);

            for (let i = 0; i < 10; i++) {
                ext.enable();
                ext.disable();
            }

            expect(shell.Main.panel.statusArea.size).toBe(0);
            expect(shell.Main.layoutManager.topChromeActors.size).toBe(0);
        });

        it('T2.32: Extension disabled while Soup HTTP request is actively in-flight handles cancellation', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();
            net.latencyMs = 100; // Simulated slow network

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);

            ext.enable();
            // Start fetch
            const fetchPromise = ext._provider.fetchLyrics('Yellow', 'Coldplay', 'Parachutes', 267, 'slow123');

            // Disable before fetch completes
            ext.disable();

            // Should not crash or throw unhandled rejections
            await fetchPromise;
            expect(ext._enabled).toBe(false);
        });

        it('T2.33: Extension disabled while tray popup menu is actively open cleanly destroys popup', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);

            ext.enable();
            ext._indicator.button.menu.open();
            expect(ext._indicator.button.menu.isOpen).toBe(true);

            ext.disable();
            expect(ext._indicator).toBeNull();
            expect(shell.Main.panel.statusArea.size).toBe(0);
        });

        it('T2.34: Calling enable() when already enabled is a safe no-op', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);

            ext.enable();
            const initialTopChromeCount = shell.Main.layoutManager.topChromeActors.size;

            // Second enable()
            ext.enable();
            expect(shell.Main.layoutManager.topChromeActors.size).toBe(initialTopChromeCount);

            ext.disable();
        });

        it('T2.35: Calling disable() when already disabled is a safe no-op', async () => {
            const shell = new MockShellEnvironment();
            const settings = new MockSettings();
            const proxy = new MockSpotifyDBusProxy();
            const net = new MockNetworkSession();

            const extMod = await loadModule('extension');
            const ExtensionClass = extMod.SpotifyFloatingLyricsExtension || extMod.default;
            const ext = new ExtensionClass(shell, settings, proxy, net);

            // Never enabled
            expect(() => ext.disable()).not.toThrow();

            ext.enable();
            ext.disable();
            // Second disable
            expect(() => ext.disable()).not.toThrow();
        });
    });
}
