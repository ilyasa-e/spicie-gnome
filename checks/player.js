import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import System from 'system';
import { DEFAULT_PALETTE, formatTime, paletteFromPixels } from '../playerTheme.js';
import { PlayerArtwork } from '../playerArtwork.js';

let passed = 0;
let failed = false;
function check(name, value) {
    if (!value) throw new Error(name);
    print(`PASS ${name}`);
    passed++;
}
const pause = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    resolve(); return GLib.SOURCE_REMOVE;
}));
const loop = new GLib.MainLoop(null, false);
const folder = GLib.dir_make_tmp('spotify-player-test-XXXXXX');
const artwork = new PlayerArtwork(() => {}, {cacheDir: `${folder}/covers`});
(async () => {
    check('Time formats milliseconds', formatTime(83000) === '1:23');
    check('Invalid time is safe', formatTime(-1) === '0:00' && formatTime(Infinity) === '0:00');
    const transparent = paletteFromPixels(new Uint8Array([255, 0, 0, 0]), 1, 1, 4, 4);
    check('Transparent cover uses neutral palette', transparent.surface === DEFAULT_PALETTE.surface);
    const red = paletteFromPixels(new Uint8Array([220, 50, 30, 255, 0, 255, 255, 255]), 1, 1, 8, 4);
    check('Row padding does not affect colour', parseInt(red.top.slice(1, 3), 16) > parseInt(red.top.slice(5, 7), 16));
    for (const [name, color] of [['red', 0xdc321eff], ['blue', 0x2878dcff]]) {
        const image = GdkPixbuf.Pixbuf.new(GdkPixbuf.Colorspace.RGB, true, 8, 8, 8);
        image.fill(color);
        image.savev(`${folder}/${name}.png`, 'png', [], []);
    }
    artwork.update(`file://${folder}/red.png`);
    for (let i = 0; i < 30 && !artwork.value.gicon; i++) await pause(20);
    check('Local artwork loads asynchronously', artwork.value.gicon !== null);
    artwork.update(`file://${folder}/red.png?missing`);
    artwork.update(`file://${folder}/blue.png`);
    for (let i = 0; i < 30 && !artwork.value.gicon; i++) await pause(20);
    const top = artwork.value.palette.top;
    check('Latest song wins over cancelled artwork', artwork.value.gicon !== null && parseInt(top.slice(5, 7), 16) > parseInt(top.slice(1, 3), 16));
    check('Local artwork is drawn from its own file', artwork.value.uri === `file://${folder}/blue.png`);
    // Downloaded covers are written to the cache so they can be a rounded background.
    const bytes = GLib.file_get_contents(`${folder}/red.png`)[1];
    const stored = await new Promise(resolve => artwork._store('https://example.com/cover', new GLib.Bytes(bytes),
        new Gio.Cancellable(), resolve));
    check('Downloaded artwork is kept as a file', stored?.startsWith(`file://${folder}/covers/`) &&
        Gio.File.new_for_uri(stored).query_exists(null));
    artwork.update('https://');
    check('Invalid artwork restores neutral cover', artwork.value.gicon === null && artwork.value.uri === null);
    check('The previous song\'s cover file is removed', !Gio.File.new_for_uri(stored).query_exists(null));
    print(`${passed} checks passed`);
})().catch(error => {
    printerr(error.stack);
    failed = true;
}).finally(() => {
    artwork.destroy();
    for (const name of ['red', 'blue']) Gio.File.new_for_path(`${folder}/${name}.png`).delete(null);
    try { Gio.File.new_for_path(`${folder}/covers`).delete(null); } catch (_) {}
    Gio.File.new_for_path(folder).delete(null);
    loop.quit();
});
loop.run();
if (failed) System.exit(1);
