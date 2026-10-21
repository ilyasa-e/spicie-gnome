import Cairo from 'cairo';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GdkPixbuf from 'gi://GdkPixbuf';
import { KaraokeLayout } from '../karaokeLayout.js';
import { segmentTimeline, segmentProgress, segmentMotion, characterProgress, characterLift } from '../karaokeTiming.js';
import { LyricsSync } from '../lyricsSync.js';
import { LyricsProvider } from '../lyricsProvider.js';

let count = 0;
const check = (name, value) => { if (!value) throw Error(name); print(`PASS ${name}`); count++; };
const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, 420, 140);
const cr = new Cairo.Context(surface);
const dir = GLib.dir_make_tmp('spicie-syllables-XXXXXX');
const digest = (drawing, time, name) => {
    const image = new Cairo.ImageSurface(Cairo.Format.ARGB32, 420, 140);
    const context = new Cairo.Context(image);
    drawing.draw(context, time, 8, 12);
    const file = `${dir}/${name}.png`;
    image.writeToPNG(file); context.$dispose();
    const hash = GLib.compute_checksum_for_data(GLib.ChecksumType.SHA256, GLib.file_get_contents(file)[1]);
    Gio.File.new_for_path(file).delete(null);
    return hash;
};
const rightmostInk = drawing => {
    const image = new Cairo.ImageSurface(Cairo.Format.ARGB32, 420, 140);
    const context = new Cairo.Context(image);
    drawing.draw(context, 4000, 8, 12);
    const file = `${dir}/alignment.png`; image.writeToPNG(file); context.$dispose();
    const pixels = GdkPixbuf.Pixbuf.new_from_file(file);
    const bytes = pixels.get_pixels(); let right = 0;
    for (let y = 0; y < pixels.height; y++) for (let x = 0; x < pixels.width; x++)
        if (bytes[y * pixels.rowstride + x * 4 + 3] > 0) right = Math.max(right, x);
    Gio.File.new_for_path(file).delete(null);
    return right;
};
const spans = [
    {Text: 'ba', StartTime: 1, EndTime: 1.12, IsPartOfWord: true},
    {Text: 'gai', StartTime: 1.16, EndTime: 1.6, IsPartOfWord: true},
    {Text: 'ma', StartTime: 1.8, EndTime: 2, IsPartOfWord: true},
    {Text: 'na', StartTime: 2.1, EndTime: 3.8, IsPartOfWord: false},
];
const provider = new LyricsProvider({session: {sendAsync: async () => ({status: 200, body: {
    Body: {Type: 'Syllable', source: 'apple_music', Content: [{Type: 'Vocal', Lead: {
        StartTime: 1, EndTime: 3.8, Syllables: spans,
    }}]},
}})}});
try {
    const result = await provider._fetchSpicyLyrics('1234567890123456789012', 'test-key', null, false);
    const line = result.lines[0];
    check('Source syllables inside a word stay separate', line.words === 'bagaimana' && line.syllables.length === 4);
    check('Every source boundary retains its own duration', line.syllables.map(span => span.endTimeMs - span.startTimeMs).join(',') === '120,440,200,1700');
    check('Source word-continuation markers are retained', line.syllables.map(span => span.isPartOfWord).join(',') === 'true,true,true,false');
    const sync = new LyricsSync([line]);
    check('Word-continuation markers survive synchronization', sync.getLines()[0].syllables[0].isPartOfWord === true);
    sync.destroy();
    const timeline = segmentTimeline(line);
    check('Split syllables belong to one word without merging their timing', timeline.every(span => span.wordIndex === 0 && span.kind === 'syllable') && timeline.length === 4);
    const legacy = segmentTimeline({...line, syllables: line.syllables.map(({isPartOfWord, ...span}) => span)});
    check('Earlier cached timings still group adjacent syllables without inventing times', legacy.every(span => span.kind === 'syllable' && span.wordIndex === 0) && legacy[2].startTimeMs === 1800);
    const following = segmentTimeline({...line, words: 'bagaimana kabar', syllables: [...line.syllables,
        {text: 'kabar', startOffset: 10, endOffset: 15, startTimeMs: 4000, endTimeMs: 4400, isPartOfWord: false}]});
    check('A complete source word stays one word animation unit', following.at(-1).wordIndex === 1 && following.at(-1).kind === 'word');
    const drawing = new KaraokeLayout(cr, line, 'Sans Bold 28', 400);
    const syllable = offset => drawing.characters.filter(char => char.segmentOffset === offset);
    check('No syllable starts before its supplied timestamp', syllable(2).every(char => characterProgress(char, 1150) === 0));
    check('A gap holds the preceding syllable without advancing the next', syllable(2).every(char => characterProgress(char, 1700) === 1) && syllable(5).every(char => characterProgress(char, 1700) === 0));
    check('A sustained syllable starts and ends at the source boundaries', syllable(7)[0].startTimeMs === 2100 && syllable(7).at(-1).endTimeMs === 3800);
    check('Only sustained Latin syllables receive letter movement', syllable(7).every(char => char.emphasized) && syllable(2).every(char => !char.emphasized));
    check('Letter movement is zero before and after the held note', characterLift(syllable(7)[0], 2000) === 0 && characterLift(syllable(7)[0], 3800) === 0);
    check('Held letters rise during their own sung interval', characterLift(syllable(7)[0], 2500) > 0 && characterLift(syllable(7)[1], 2500) === 0);
    check('Paused rendering stays identical at the same timestamp', digest(drawing, 2500, 'paused-a') === digest(drawing, 2500, 'paused-b'));
    const before = digest(drawing, 1300, 'before');
    digest(drawing, 3500, 'after');
    check('Seeking backwards reproduces the original frame immediately', before === digest(drawing, 1300, 'seek-back'));
    const fast = new KaraokeLayout(cr, {words: 'Wi', syllables: [{text: 'Wi', startTimeMs: 0, endTimeMs: 300}]}, 'Sans Bold 28', 400);
    check('Fast words use one segment rather than independent letter effects', fast.segments.length === 1 && fast.segments[0].mode === 'segment');
    const calls = [], drawPart = fast._drawPart.bind(fast);
    fast._drawPart = (...args) => { calls.push({progress: args[4], width: args[3].width}); drawPart(...args); };
    digest(fast, 150, 'word-unit');
    check('A whole word is swept in a single drawing operation', calls.length === 1 && calls[0].progress === 0.5 && calls[0].width === fast.segments[0].advance);
    const motion = segmentMotion(fast.segments[0], 150);
    check('Ordinary words receive their own scale and lift', motion.scale > 1 && motion.lift > 0);
    check('Syllable motions retain unequal source durations and silence', segmentProgress(timeline[1], 1380) === 0.5 && segmentMotion(timeline[2], 1700).lift === 0 && segmentMotion(timeline[0], 1380).scale === 1);
    const active = digest(fast, 150, 'word-active');
    for (const char of fast.characters) { char.startTimeMs = 10000; char.endTimeMs = 20000; }
    check('Ordinary word rendering is independent of interpolated letter clocks', active === digest(fast, 150, 'word-without-letter-clock'));
    fast.segments[0].motionSafe = false;
    check('Whole-word movement changes the rendered word, not only its fill', active !== digest(fast, 150, 'word-no-motion'));
    check('Held letters are layered inside a moving syllable', drawing.segments.at(-1).mode === 'letters' && segmentMotion(drawing.segments.at(-1), 2500).lift > 0);
    const arabic = new KaraokeLayout(cr, {words: 'سلام', syllables: [{text: 'سلام', startTimeMs: 0, endTimeMs: 1700}]}, 'Sans Bold 28', 400);
    check('Joined scripts keep their shape without detached letter movement', arabic.characters.every(char => !char.emphasized) && arabic.characters.some(char => char.width < 0));
    const plain = new KaraokeLayout(cr, {...line, syllables: null}, 'Sans Bold 28', 400);
    check('Line-only timing never receives inferred karaoke', digest(plain, 1200, 'plain-a') === digest(plain, 3500, 'plain-b'));
    const centered = new KaraokeLayout(cr, line, 'Sans Bold 28', 400, 'center');
    const right = new KaraokeLayout(cr, line, 'Sans Bold 28', 400, 'right');
    check('Centered lyrics render beyond the left edge of their allocated width', rightmostInk(centered) > 260);
    check('Right-aligned lyrics retain their final letters', rightmostInk(right) > 395);
    print(`${count} syllable checks passed`);
} finally {
    provider.destroy(); cr.$dispose(); Gio.File.new_for_path(dir).delete(null);
}
