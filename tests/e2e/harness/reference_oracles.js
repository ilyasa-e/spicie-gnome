/**
 * Authoritative Reference Oracles.
 *
 * These encode the expected behaviour independently of the live modules so the
 * suite still has something to compare against when an import cannot run under
 * the headless harness.
 */

// ==========================================
// 1. Romanization Oracle
// ==========================================

const HANGUL_CHOSEONG = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
const HANGUL_JUNGSEONG = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const HANGUL_JONGSEONG = ['', 'k', 'k', 'ks', 'n', 'nj', 'nh', 't', 'l', 'lg', 'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'p', 'bs', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 'h'];

const KANA_MAP = {
    // Basic Hiragana
    'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
    'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
    'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
    'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
    'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
    'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
    'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
    'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
    'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
    'わ': 'wa', 'ゐ': 'wi', 'ゑ': 'we', 'を': 'o', 'ん': 'n',
    'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
    'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
    'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'で': 'de', 'ど': 'do',
    'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
    'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',

    // Basic Katakana
    'ア': 'a', 'イ': 'i', 'ウ': 'u', 'エ': 'e', 'オ': 'o',
    'カ': 'ka', 'キ': 'ki', 'ク': 'ku', 'ケ': 'ke', 'コ': 'ko',
    'サ': 'sa', 'シ': 'shi', 'ス': 'su', 'セ': 'se', 'ソ': 'so',
    'タ': 'ta', 'チ': 'chi', 'ツ': 'tsu', 'テ': 'te', 'ト': 'to',
    'ナ': 'na', 'ニ': 'ni', 'ヌ': 'nu', 'ネ': 'ne', 'ノ': 'no',
    'ハ': 'ha', 'ヒ': 'hi', 'フ': 'fu', 'ヘ': 'he', 'ホ': 'ho',
    'マ': 'ma', 'ミ': 'mi', 'ム': 'mu', 'メ': 'me', 'モ': 'mo',
    'ヤ': 'ya', 'ユ': 'yu', 'ヨ': 'yo',
    'ラ': 'ra', 'リ': 'ri', 'ル': 'ru', 'レ': 're', 'ロ': 'ro',
    'ワ': 'wa', 'ヰ': 'wi', 'ヱ': 'we', 'ヲ': 'o', 'ン': 'n',
    'ガ': 'ga', 'ギ': 'gi', 'グ': 'gu', 'ゲ': 'ge', 'ゴ': 'go',
    'ザ': 'za', 'ジ': 'ji', 'ズ': 'zu', 'ゼ': 'ze', 'ゾ': 'zo',
    'ダ': 'da', 'ヂ': 'ji', 'ヅ': 'zu', 'デ': 'de', 'ド': 'do',
    'バ': 'ba', 'ビ': 'bi', 'ブ': 'bu', 'ベ': 'be', 'ボ': 'bo',
    'パ': 'pa', 'ピ': 'pi', 'プ': 'pu', 'ペ': 'pe', 'ポ': 'po'
};

const KANA_DIGRAPHS = {
    // Hiragana yōon
    'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo',
    'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho',
    'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho',
    'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo',
    'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo',
    'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo',
    'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo',
    'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo',
    'じゃ': 'ja', 'じゅ': 'ju', 'じょ': 'jo',
    'ぢゃ': 'ja', 'ぢゅ': 'ju', 'ぢょ': 'jo',
    'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo',
    'ぴゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo',

    // Katakana yōon
    'キャ': 'kya', 'キュ': 'kyu', 'キョ': 'kyo',
    'シャ': 'sha', 'シュ': 'shu', 'ショ': 'sho',
    'チャ': 'cha', 'チュ': 'chu', 'チョ': 'cho',
    'ニャ': 'nya', 'ニュ': 'nyu', 'ニョ': 'nyo',
    'ヒャ': 'hya', 'ヒュ': 'hyu', 'ヒョ': 'hyo',
    'ミャ': 'mya', 'ミュ': 'myu', 'ミョ': 'myo',
    'リャ': 'rya', 'リュ': 'ryu', 'リョ': 'ryo',
    'ギャ': 'gya', 'ギュ': 'gyu', 'ギョ': 'gyo',
    'ジャ': 'ja', 'ジュ': 'ju', 'ジョ': 'jo',
    'ビャ': 'bya', 'ビュ': 'byu', 'ビョ': 'byo',
    'ピャ': 'pya', 'ピュ': 'pyu', 'ピョ': 'pyo',

    // Katakana loanword digraphs
    'ディ': 'di', 'ティ': 'ti', 'ドゥ': 'du',
    'ウィ': 'wi', 'ウェ': 'we', 'ウォ': 'wo',
    'シェ': 'she', 'ジェ': 'je', 'チェ': 'che',
    'ファ': 'fa', 'フィ': 'fi', 'フェ': 'fe', 'フォ': 'fo'
};

const CYRILLIC_MAP = {
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo', 'Ж': 'Zh', 'З': 'Z',
    'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R',
    'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'Kh', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch',
    'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya',
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z',
    'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r',
    'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
    // Ukrainian / Belarusian
    'І': 'I', 'і': 'i', 'Ї': 'Yi', 'ї': 'yi', 'Є': 'Ye', 'є': 'ye', 'Ґ': 'G', 'ґ': 'g'
};

export class RomanizerOracle {
    static romanizeHangul(text) {
        if (!text) return '';
        let result = '';
        for (let i = 0; i < text.length; i++) {
            const code = text.charCodeAt(i);
            if (code >= 0xAC00 && code <= 0xD7A3) {
                const sIndex = code - 0xAC00;
                const lIndex = Math.floor(sIndex / 588);
                const vIndex = Math.floor((sIndex % 588) / 28);
                const tIndex = sIndex % 28;
                result += HANGUL_CHOSEONG[lIndex] + HANGUL_JUNGSEONG[vIndex] + HANGUL_JONGSEONG[tIndex];
            } else {
                result += text[i];
            }
        }
        return result;
    }

    static romanizeKana(text) {
        if (!text) return '';
        let result = '';
        let lastVowel = 'a';

        for (let i = 0; i < text.length; i++) {
            // Check 2-char digraph (yōon)
            if (i + 1 < text.length) {
                const pair = text.slice(i, i + 2);
                if (KANA_DIGRAPHS[pair]) {
                    result += KANA_DIGRAPHS[pair];
                    lastVowel = KANA_DIGRAPHS[pair].slice(-1);
                    i++;
                    continue;
                }
            }

            const ch = text[i];

            // Sokuon (っ or ッ)
            if (ch === 'っ' || ch === 'ッ') {
                if (i + 1 < text.length) {
                    const nextCh = text[i + 1];
                    const nextPair = i + 2 <= text.length ? text.slice(i + 1, i + 3) : '';
                    const nextRomaji = KANA_DIGRAPHS[nextPair] || KANA_MAP[nextCh];
                    if (nextRomaji) {
                        const firstLetter = nextRomaji[0];
                        result += (firstLetter === 'c') ? 't' : firstLetter;
                        continue;
                    }
                }
                result += "'"; // Trailing sokuon
                continue;
            }

            // Chōonpu (ー)
            if (ch === 'ー') {
                result += lastVowel;
                continue;
            }

            // Monograph
            if (KANA_MAP[ch]) {
                const romaji = KANA_MAP[ch];
                result += romaji;
                lastVowel = romaji.slice(-1);
            } else {
                result += ch;
                if (/[aeiou]/i.test(ch)) lastVowel = ch.toLowerCase();
            }
        }
        return result;
    }

    static romanizeCyrillic(text) {
        if (!text) return '';
        let result = '';
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            result += CYRILLIC_MAP[ch] !== undefined ? CYRILLIC_MAP[ch] : ch;
        }
        return result;
    }

    static romanize(text) {
        if (!text) return '';
        let res = this.romanizeHangul(text);
        res = this.romanizeKana(res);
        res = this.romanizeCyrillic(res);
        return res;
    }

    static hasRomanizableContent(text) {
        if (!text) return false;
        return /[\uAC00-\uD7A3\u3040-\u30FF\u0400-\u04FF]/.test(text);
    }
}

// ==========================================
// 2. LRC Timestamp Parser Oracle
// ==========================================

export class LrcParserOracle {
    static parse(lrcContent, durationMs = 0) {
        if (!lrcContent || typeof lrcContent !== 'string') return [];

        const rawLines = lrcContent.split(/\r?\n/);
        const entries = [];
        const tagRegex = /\[(\d{2,}):(\d{2})(?:\.(\d{2,3}))?\]/g;

        let idCounter = 0;

        for (const line of rawLines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const matches = [...trimmed.matchAll(tagRegex)];
            if (matches.length === 0) continue;

            // Extract the lyric text after stripping all timestamp tags
            const words = trimmed.replace(tagRegex, '').trim();

            for (const match of matches) {
                const min = parseInt(match[1], 10);
                const sec = parseInt(match[2], 10);
                let ms = 0;
                if (match[3]) {
                    const frac = match[3];
                    ms = frac.length === 2 ? parseInt(frac, 10) * 10 : parseInt(frac, 10);
                }
                const startTimeMs = (min * 60000) + (sec * 1000) + ms;
                entries.push({
                    id: idCounter++,
                    startTimeMs,
                    endTimeMs: 0,
                    words: words,
                    romanized: RomanizerOracle.hasRomanizableContent(words) ? RomanizerOracle.romanize(words) : null,
                    isInterlude: words.length === 0 || words === '♪' || words.toLowerCase().includes('(instrumental)')
                });
            }
        }

        // Sort strictly by startTimeMs
        entries.sort((a, b) => a.startTimeMs - b.startTimeMs);

        // Re-index and calculate endTimeMs
        for (let i = 0; i < entries.length; i++) {
            entries[i].id = i;
            if (i < entries.length - 1) {
                entries[i].endTimeMs = entries[i + 1].startTimeMs;
            } else {
                entries[i].endTimeMs = durationMs > entries[i].startTimeMs 
                    ? durationMs 
                    : entries[i].startTimeMs + 6000;
            }
        }

        return entries;
    }
}

// ==========================================
// 3. Monotonic Interpolation Oracle
// ==========================================

export class PositionInterpolationOracle {
    static calculateCurrentPosition(basePositionMs, baseTimeUs, currentMonotonicUs, playbackStatus, durationMs) {
        let posMs = basePositionMs;
        if (playbackStatus === 'Playing') {
            const elapsedUs = Math.max(0, currentMonotonicUs - baseTimeUs);
            posMs += Math.floor(elapsedUs / 1000);
        }
        if (durationMs > 0) {
            posMs = Math.min(posMs, durationMs);
        }
        return Math.max(0, posMs);
    }
}

// ==========================================
// 4. Lyrics Sync Engine Oracle
// ==========================================

export class LyricsSyncOracle {
    static findActiveIndex(lines, positionMs) {
        if (!lines || lines.length === 0) return -1;
        if (positionMs < lines[0].startTimeMs) return -1;

        // Binary search for efficiency
        let low = 0;
        let high = lines.length - 1;
        let result = -1;

        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (lines[mid].startTimeMs <= positionMs) {
                result = mid;
                low = mid + 1; // Look for a later line that also starts <= positionMs
            } else {
                high = mid - 1;
            }
        }

        return result;
    }
}

// ==========================================
// 5. MPRIS Variant Unpacking Oracle
// ==========================================

export class MprisUnpackerOracle {
    static unpackMetadata(rawMeta) {
        if (!rawMeta || typeof rawMeta !== 'object') {
            return {
                trackId: '',
                title: 'Unknown Title',
                artist: 'Unknown Artist',
                album: '',
                durationMs: 0,
                artUrl: '',
                isAdvertisement: false
            };
        }

        const rawTrackId = rawMeta['mpris:trackid'] || '';
        const isAd = rawTrackId.includes('spotify:ad:') || rawTrackId.includes('/com/spotify/ad/') || rawMeta['xesam:title'] === 'Advertisement';

        // Clean Track ID
        const trackId = rawTrackId
            .replace(/^spotify:track:/, '')
            .replace(/^\/com\/spotify\/track\//, '')
            .replace(/^\/org\/mpris\/MediaPlayer2\/track\//, '');

        // Title
        const title = rawMeta['xesam:title'] || (isAd ? 'Spotify Advertisement' : 'Unknown Title');

        // Artist (array or string)
        let artist = 'Unknown Artist';
        if (Array.isArray(rawMeta['xesam:artist'])) {
            artist = rawMeta['xesam:artist'].join(', ') || 'Unknown Artist';
        } else if (typeof rawMeta['xesam:artist'] === 'string' && rawMeta['xesam:artist'].trim()) {
            artist = rawMeta['xesam:artist'].trim();
        }

        // Album
        const album = rawMeta['xesam:album'] || '';

        // Length (microseconds to milliseconds)
        const lengthUs = typeof rawMeta['mpris:length'] === 'number' ? rawMeta['mpris:length'] : 0;
        const durationMs = Math.floor(lengthUs / 1000);

        // Art URL
        const artUrl = rawMeta['mpris:artUrl'] || '';

        return {
            trackId,
            title,
            artist,
            album,
            durationMs,
            artUrl,
            isAdvertisement: isAd
        };
    }
}

// ==========================================
// 6. HUD Screen Coordinates Oracle
// ==========================================

export class HudLayoutOracle {
    static calculateCoordinates(preset, customX, customY, workArea, actorWidth, actorHeight, padding = 40) {
        const { x, y, width, height } = workArea;
        switch (preset) {
            case 'top-left':
                return { x: x + padding, y: y + padding };
            case 'top-right':
                return { x: x + width - actorWidth - padding, y: y + padding };
            case 'bottom-left':
                return { x: x + padding, y: y + height - actorHeight - padding };
            case 'bottom-right':
                return { x: x + width - actorWidth - padding, y: y + height - actorHeight - padding };
            case 'center':
                return {
                    x: Math.round(x + (width - actorWidth) / 2),
                    y: Math.round(y + (height - actorHeight) / 2)
                };
            case 'custom':
            default:
                return { x: customX, y: customY };
        }
    }
}
