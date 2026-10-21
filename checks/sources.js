import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import System from 'system';
import { LyricsProvider, MAX_CACHE_AGE_MS } from '../lyricsProvider.js';
import { lyricAttribution, attributionMarkup, creditItems } from '../lyricsAttribution.js';
import { FloatingLyricsHUDApp } from '../bin/spotify-floating-hud';
let count = 0;
const check = (name, value) => { if (!value) throw Error(name); print(`PASS ${name}`); ++count; };
const root = GLib.dir_make_tmp('spicie-sources-XXXXXX');
const loop = new GLib.MainLoop(null, false);
let failed = false, provider;
const pause = ms => new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {resolve();return GLib.SOURCE_REMOVE;}));
(async () => {
    let requests = 0;
    const body = {source:'spicy_lyrics',Type:'Syllable',UploadAttribution:{
        Uploader:{username:'A < B & C',url:'https://spicylyrics.org/uploader'},
        Maker:{username:'Maker',url:'https://spicylyrics.org/maker'}},
        Content:[{Type:'Vocal',Lead:{StartTime:1,EndTime:3,Syllables:[{Text:'Hello',StartTime:1,EndTime:3}]}}]};
    const session = {sendAsync:async () => {requests++;return {status:200,body:{Body:body}};}};
    provider = new LyricsProvider({session,cacheDir:root});
    const fetch = key => provider.fetchLyrics('Song','Artist','Album',10,'1234567890123456789012',{enableSpicy:true,spicyClientKey:key});
    const first = await fetch('sl_pk_first-test-credential');
    check('The first available community response wins before LRCLIB', requests === 1 && first.source === 'spicy_lyrics');
    const attribution = lyricAttribution(first);
    check('Provider credits come from the response', attribution.provider === 'Spicy Lyrics');
    check('Community contributor names and links survive decoding', attribution.contributors.length === 2 && attribution.contributors[0].url === body.UploadAttribution.Uploader.url);
    check('Community credits keep provider, uploader, maker order', attribution.provider === 'Spicy Lyrics' && attribution.contributors.map(person => person.role).join(',') === 'Uploader,Maker');
    check('Contributor markup is escaped', attributionMarkup(attribution).includes('A &lt; B &amp; C'));
    check('Contributor profile links remain clickable', attributionMarkup(attribution).includes('<a href="https://spicylyrics.org/maker"><u>Maker</u></a>'));
    check('Community display contains only uploader and maker names', creditItems(attribution).map(item => item.name).join('|') === 'A < B & C|Maker');
    check('Community display hides provider and role labels', !/Spicy Lyrics|Uploader:|Maker:/.test(attributionMarkup(attribution)));
    const unsafe = lyricAttribution({...first,uploadAttribution:{Uploader:{username:'Name',url:'javascript:alert(1)'}}});
    check('Non-web contributor links are not opened', unsafe.contributors[0].url === null);
    check('Other sources still show their provider name', attributionMarkup(lyricAttribution({...first,source:'apple_music'})) === 'Apple Music');
    check('Commercial sources do not inherit community credits', lyricAttribution({...first,source:'apple_music'}).contributors.length === 0);
    check('Apple Music is named as the actual provider', lyricAttribution({...first,source:'apple_music'}).provider === 'Apple Music');
    check('Missing source is not claimed as Spicy Lyrics', lyricAttribution({...first,source:null}).provider === 'Unknown source');
    check('Empty lyrics do not leave stale credits', lyricAttribution({...first,lines:[]}) === null);
    check('New cache expires before 30 days', first.expiresAt <= first.cachedAt + MAX_CACHE_AGE_MS);
    await fetch('sl_pk_first-test-credential');
    check('Fresh cache avoids repeated requests', requests === 1);
    provider.clearCache();
    const disk = await fetch('sl_pk_first-test-credential');
    check('Disk cache retains expiry and contributor metadata', requests === 1 && disk.expiresAt === first.expiresAt && lyricAttribution(disk).contributors.length === 2);
    await fetch('sl_pk_second-test-credential');
    check('Changing keys does not reuse another key response', requests === 2);
    const secretFallback = await fetch('sl_sk_not-allowed-here');
    check('Secret keys are never sent from the extension', secretFallback.provider !== 'spicy_lyrics');
    const [cacheKey] = provider._cache.keys();
    const expired = {...first,cachedAt:Date.now()-MAX_CACHE_AGE_MS-100,expiresAt:Date.now()-100};
    provider._cache.set(cacheKey,expired);
    provider._writeDiskCache(cacheKey,expired);
    const cacheDir = Gio.File.new_for_path(provider._cacheDirPath);
    const legacy = cacheDir.get_child('a'.repeat(40)+'.json');
    GLib.file_set_contents(legacy.get_path(),JSON.stringify({provider:'spicy_lyrics',lines:[{text:'old'}]}));
    provider._purgeExpiredCache();
    check('Old unversioned cache files are discarded', !legacy.query_exists(null));
    check('Expired disk and memory entries are discarded', !provider._cache.has(cacheKey) && provider._readDiskCache(cacheKey) === null);
    check('Future-dated entries cannot bypass expiry', !provider._isFresh({...first,cachedAt:Date.now()+10000}));
    const app = new FloatingLyricsHUDApp();
    app._handleIPCMessage(JSON.stringify({type:'lyrics',lines:first.lines,attribution,expiresAt:Date.now()+40}));
    check('Helper receives the response credits', app._attribution.provider === 'Spicy Lyrics');
    await pause(70);
    check('Displayed lyrics and credits are cleared at expiry', app._lines.length === 0 && app._attribution === null);
    app._shutdown();
    for (const source of ['apple_music', 'spotify']) {
        body.source = source;delete body.UploadAttribution;
        const response = await provider._fetchSpicyLyrics('1234567890123456789012', 'sl_pk_test-credential', null, false);
        check(`Server-selected ${source} timing uses the same response path`, response.source === source && response.lines.length > 0);
        check(`${source} does not show empty community credits`, lyricAttribution(response).contributors.length === 0);
    }
    print(`${count} source checks passed`);
})().catch(error => {failed=true;printerr(error.stack);}).finally(() => {
    provider?.destroy();
    function remove(file) {
        if (file.query_file_type(Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,null) === Gio.FileType.DIRECTORY) {
            const entries=file.enumerate_children('standard::name',Gio.FileQueryInfoFlags.NONE,null);
            let entry;while((entry=entries.next_file(null)))remove(file.get_child(entry.get_name()));entries.close(null);
        }
        file.delete(null);
    }
    remove(Gio.File.new_for_path(root));loop.quit();
});
loop.run();
if(failed)System.exit(1);
