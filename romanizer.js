/**
 * romanizer.js - Standalone Romanization Engine
 *
 * Implements:
 * 1. Korean Hangul Revised Romanization (RR) decomposition (Unicode 0xAC00 - 0xD7A3).
 * 2. Japanese Kana (Hiragana & Katakana) Hepburn romanization with digraphs, sokuon gemination, and chōonpu.
 * 3. Slavic Cyrillic transliteration to Latin with case preservation (Russian, Ukrainian, Belarusian).
 * 4. Verbatim preservation of mixed Latin, numbers, punctuation, and Japanese Kanji / Chinese Hanzi.
 */

// ---------------------------------------------------------------------------
// 1. Hangul Constants & Tables (Revised Romanization of Korean)
// ---------------------------------------------------------------------------

// 19 Initial consonants (Choseong, L)
const HANGUL_CHOSEONG = [
    'g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's',
    'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'
];

// 21 Vowels (Jungseong, V)
const HANGUL_JUNGSEONG = [
    'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa',
    'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'
];

// 28 Final consonants (Jongseong, T) - 0 is empty (no final consonant)
const HANGUL_JONGSEONG = [
    '', 'k', 'k', 'ks', 'n', 'nj', 'nh', 't', 'l', 'lg',
    'lm', 'lb', 'ls', 'lt', 'lp', 'lh', 'm', 'p', 'bs', 't',
    't', 'ng', 't', 't', 'k', 't', 'p', 'h'
];

// ---------------------------------------------------------------------------
// 2. Japanese Kana Constants & Tables (Hepburn Romanization)
// ---------------------------------------------------------------------------

const KANA_MAP = {
    // Hiragana basic monographs
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
    'ぁ': 'a', 'ぃ': 'i', 'ゥ': 'u', 'ぇ': 'e', 'ぉ': 'o',
    'ゃ': 'ya', 'ゅ': 'yu', 'ょ': 'yo', 'ゎ': 'wa',
    'ゔ': 'vu',

    // Katakana basic monographs
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
    'ガ': 'ga', 'ギ': 'gi', 'グ': 'gu', 'ゲ': 'ge', 'ご': 'go',
    'ザ': 'za', 'ジ': 'ji', 'ズ': 'zu', 'ゼ': 'ze', 'ゾ': 'zo',
    'ダ': 'da', 'ヂ': 'ji', 'ヅ': 'zu', 'デ': 'de', 'ド': 'do',
    'バ': 'ba', 'ビ': 'bi', 'ブ': 'bu', 'ベ': 'be', 'ボ': 'bo',
    'パ': 'pa', 'ピ': 'pi', 'プ': 'pu', 'ペ': 'pe', 'ポ': 'po',
    'ァ': 'a', 'ィ': 'i', 'ゥ': 'u', 'ェ': 'e', 'ォ': 'o',
    'ャ': 'ya', 'ュ': 'yu', 'ョ': 'yo', 'ヮ': 'wa',
    'ヴ': 'vu'
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
    'ヂャ': 'ja', 'ヂュ': 'ju', 'ヂョ': 'jo',
    'ビャ': 'bya', 'ビュ': 'byu', 'ビョ': 'byo',
    'ピャ': 'pya', 'ピュ': 'pyu', 'ピョ': 'pyo',

    // Katakana loanword digraphs
    'ディ': 'di', 'ティ': 'ti', 'ドゥ': 'du',
    'ウィ': 'wi', 'ウェ': 'we', 'ウォ': 'wo',
    'シェ': 'she', 'ジェ': 'je', 'チェ': 'che',
    'ファ': 'fa', 'フィ': 'fi', 'フェ': 'fe', 'フォ': 'fo',
    'フュ': 'fyu',
    'ヴァ': 'va', 'ヴィ': 'vi', 'ヴェ': 've', 'ヴォ': 'vo',
    'ツァ': 'tsa', 'ツィ': 'tsi', 'ツェ': 'tse', 'ツォ': 'tso',
    'イェ': 'ye'
};

// ---------------------------------------------------------------------------
// 3. Cyrillic Constants & Tables (Slavic Cyrillic Transliteration)
// ---------------------------------------------------------------------------

const CYRILLIC_MAP = {
    // Russian uppercase
    'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Е': 'E', 'Ё': 'Yo', 'Ж': 'Zh', 'З': 'Z',
    'И': 'I', 'Й': 'Y', 'К': 'K', 'Л': 'L', 'М': 'M', 'Н': 'N', 'О': 'O', 'П': 'P', 'Р': 'R',
    'С': 'S', 'Т': 'T', 'У': 'U', 'Ф': 'F', 'Х': 'Kh', 'Ц': 'Ts', 'Ч': 'Ch', 'Ш': 'Sh', 'Щ': 'Shch',
    'Ъ': '', 'Ы': 'Y', 'Ь': '', 'Э': 'E', 'Ю': 'Yu', 'Я': 'Ya',

    // Russian lowercase
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z',
    'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r',
    'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',

    // Ukrainian / Belarusian / Serbian / Macedonian extensions
    'І': 'I', 'і': 'i', 'Ї': 'Yi', 'ї': 'yi', 'Є': 'Ye', 'є': 'ye', 'Ґ': 'G', 'ґ': 'g',
    'Ў': 'U', 'ў': 'u', 'Ђ': 'Dj', 'ђ': 'dj', 'Ј': 'J', 'ј': 'j', 'Љ': 'Lj', 'љ': 'lj',
    'Њ': 'Nj', 'њ': 'nj', 'Ћ': 'C', 'ћ': 'c', 'Џ': 'Dzh', 'џ': 'dzh', 'Ѕ': 'Dz', 'ѕ': 'dz'
};

// ---------------------------------------------------------------------------
// 4. Romanizer Main Engine
// ---------------------------------------------------------------------------

export class Romanizer {
    /**
     * Determines whether the given text contains any characters eligible for romanization
     * (Hangul syllables, Hiragana, Katakana, or Cyrillic characters).
     *
     * @param {string|null|undefined} text - Input text to evaluate
     * @returns {boolean} True if text contains romanizable characters, false otherwise
     */
    static hasRomanizableContent(text) {
        if (!text || typeof text !== 'string') return false;
        return /[\uAC00-\uD7A3\u3040-\u30FF\u0400-\u04FF]/.test(text);
    }

    /**
     * Romanizes Korean Hangul syllables using the standard Revised Romanization (RR)
     * algorithmic decomposition formula:
     *   S = code - 0xAC00
     *   L = floor(S / 588)
     *   V = floor((S % 588) / 28)
     *   T = S % 28
     *
     * Non-Hangul syllables, uncombined standalone Jamo, whitespace, and punctuation
     * pass through unchanged.
     *
     * @param {string|null|undefined} text - Input string
     * @returns {string} Transliterated string
     */
    static romanizeHangul(text) {
        if (!text || typeof text !== 'string') return '';
        let result = '';
        const len = text.length;

        for (let i = 0; i < len; i++) {
            const code = text.charCodeAt(i);
            if (code >= 0xAC00 && code <= 0xD7A3) {
                const sIndex = code - 0xAC00;
                const lIndex = Math.floor(sIndex / 588);
                const vIndex = Math.floor((sIndex % 588) / 28);
                const tIndex = sIndex % 28;

                // Standard Revised Romanization Rule: Nasal assimilation across syllable boundaries
                let finalConsonant = HANGUL_JONGSEONG[tIndex];
                if (i + 1 < len) {
                    const nextCode = text.charCodeAt(i + 1);
                    if (nextCode >= 0xAC00 && nextCode <= 0xD7A3) {
                        const nextL = Math.floor((nextCode - 0xAC00) / 588);
                        // Next onset is 'n' (index 2, ㄴ) or 'm' (index 6, ㅁ)
                        if (nextL === 2 || nextL === 6) {
                            if (tIndex === 17 || tIndex === 18 || tIndex === 26) {
                                // ㅂ, ㅄ, ㅍ -> m (e.g. 합 + 니 -> hamni)
                                finalConsonant = 'm';
                            } else if (tIndex === 1 || tIndex === 2 || tIndex === 24) {
                                // ㄱ, ㄲ, ㅋ -> ng (e.g. 백 + 마 -> baengma)
                                finalConsonant = 'ng';
                            } else if (tIndex === 7 || tIndex === 19 || tIndex === 20 || tIndex === 22 || tIndex === 23 || tIndex === 25) {
                                // ㄷ, ㅅ, ㅆ, ㅈ, ㅊ, ㅌ -> n
                                finalConsonant = 'n';
                            }
                        }
                    }
                }

                result += HANGUL_CHOSEONG[lIndex] + HANGUL_JUNGSEONG[vIndex] + finalConsonant;
            } else {
                result += text[i];
            }
        }
        return result;
    }

    /**
     * Romanizes Japanese Hiragana (\u3040-\u309F) and Katakana (\u30A0-\u30FF) using Hepburn Romanization.
     * Correctly processes:
     * - Multi-character yōon digraphs (e.g. きゃ -> kya, しゅ -> shu, ちょ -> cho)
     * - Katakana foreign loanword digraphs (e.g. ティ -> ti, シェ -> she, ファ -> fa)
     * - Consonant gemination with sokuon (っ / ッ), including "tch" for 'c' consonants and "'" for trailing sokuon
     * - Chōonpu (ー) vowel prolongation repeating the preceding vowel
     * - Passthrough of Kanji, punctuation, Latin, and whitespace
     *
     * @param {string|null|undefined} text - Input string
     * @returns {string} Transliterated string
     */
    static romanizeKana(text) {
        if (!text || typeof text !== 'string') return '';
        let result = '';
        let lastVowel = 'a';
        const len = text.length;

        for (let i = 0; i < len; i++) {
            // Check 2-character digraph (yōon or loanword)
            if (i + 1 < len) {
                const pair = text.slice(i, i + 2);
                if (KANA_DIGRAPHS[pair]) {
                    const romaji = KANA_DIGRAPHS[pair];
                    result += romaji;
                    const match = romaji.match(/[aeiou]/gi);
                    if (match) lastVowel = match[match.length - 1].toLowerCase();
                    i++;
                    continue;
                }
            }

            const ch = text[i];

            // Sokuon (っ or ッ)
            if (ch === 'っ' || ch === 'ッ') {
                if (i + 1 < len) {
                    const nextCh = text[i + 1];
                    const nextPair = i + 2 <= len ? text.slice(i + 1, i + 3) : '';
                    const nextRomaji = KANA_DIGRAPHS[nextPair] || KANA_MAP[nextCh];
                    if (nextRomaji) {
                        const firstLetter = nextRomaji[0];
                        result += (firstLetter === 'c') ? 't' : firstLetter;
                        continue;
                    }
                }
                result += "'"; // Trailing sokuon or followed by non-kana
                continue;
            }

            // Chōonpu (ー)
            if (ch === 'ー') {
                result += lastVowel;
                continue;
            }

            // Monograph lookup
            if (KANA_MAP[ch]) {
                const romaji = KANA_MAP[ch];
                result += romaji;
                const match = romaji.match(/[aeiou]/gi);
                if (match) lastVowel = match[match.length - 1].toLowerCase();
            } else {
                result += ch;
                if (/[aeiou]/i.test(ch)) lastVowel = ch.toLowerCase();
            }
        }
        return result;
    }

    /**
     * Romanizes Slavic Cyrillic text (Russian, Ukrainian, Belarusian, etc.) into Latin
     * with exact case preservation. Soft signs (ь/Ь) and hard signs (ъ/Ъ) are omitted cleanly.
     *
     * @param {string|null|undefined} text - Input string
     * @returns {string} Transliterated string
     */
    static romanizeCyrillic(text) {
        if (!text || typeof text !== 'string') return '';
        let result = '';
        const len = text.length;
        for (let i = 0; i < len; i++) {
            const ch = text[i];
            result += CYRILLIC_MAP[ch] !== undefined ? CYRILLIC_MAP[ch] : ch;
        }
        return result;
    }

    /**
     * Unified romanization pipeline:
     * Transliterates Hangul, Kana, and Cyrillic scripts sequentially.
     * If no romanizable characters exist, returns original text instantly.
     * Latin, numbers, punctuation, and Japanese Kanji / Chinese Hanzi pass through unmodified.
     *
     * @param {string|null|undefined} text - Input string
     * @returns {string} Fully romanized string
     */
    static romanize(text) {
        if (!text || typeof text !== 'string') return '';
        if (!this.hasRomanizableContent(text)) return text;

        let res = this.romanizeHangul(text);
        res = this.romanizeKana(res);
        res = this.romanizeCyrillic(res);
        return res;
    }
}

export default Romanizer;
