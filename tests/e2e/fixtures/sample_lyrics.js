/**
 * Test fixtures: Sample lyrics in various languages, formats, and edge cases.
 */

export const SAMPLE_LYRICS = {
    // English pop track: "Yellow" by Coldplay
    yellow: `[00:00.00] (Intro)
[00:35.66] Look at the stars
[00:38.46] Look how they shine for you
[00:40.36] 
[00:44.17] And everything you do
[00:47.88] Yeah, they were all yellow
[00:52.20] I came along
[00:55.10] I wrote a song for you
[00:58.30] And all the things you do
[01:02.10] And it was called Yellow
[01:06.50] So then I took my turn
[01:10.10] Oh, what a thing to have done
[01:14.20] And it was all yellow
[01:20.00] (Instrumental Outro)`,

    // Korean track: "Ditto" by NewJeans (Hangul)
    dittoHangul: `[00:00.00] Stay in the middle
[00:06.20] Like you a little
[00:09.50] Don't want no riddle
[00:13.10] 말해줘 say it back
[00:16.80] 침묵은 no way
[00:20.40] 포기 못 해 너를
[00:24.00] 상상해 너와 나
[00:28.10] 기다리고 있어
[00:32.50] 네가 보고 싶어
[00:36.00] 내 마음은 뛰어
[00:40.00] Stay with me now`,

    // Japanese track: "アイドル" (Idol) by YOASOBI (Kana with yōon, sokuon, chōonpu)
    idolKana: `[00:00.00] むてきのえがおであらすメディア
[00:04.50] しりたいそのひみつミステリアス
[00:08.20] ぬけてるとこさえかのじょのエリア
[00:12.00] かんぺきでうそつきなきみは
[00:15.50] てんさいできなアイドルさま
[00:19.80] きょうなにたべた？
[00:23.00] すきなほんは？
[00:26.40] あそびにいくならどこにいくの？
[00:30.10] なにもたべてない
[00:33.20] それはないしょ
[00:36.00] なんでもきいて`,

    // Cyrillic track: "Группа крови" by КИНО (Cyrillic)
    kinoCyrillic: `[00:00.00] Теплое место, но улицы ждут отпечатков наших ног
[00:08.50] Звездная пыль на сапогах
[00:15.20] Мягкое кресло, клетчатый плед, не нажатый вовремя курок
[00:23.10] Солнечный день в ослепительных снах
[00:30.00] Группа крови на рукаве
[00:35.50] Мой порядковый номер на рукаве
[00:42.00] Пожелай мне удачи в бою
[00:48.00] Пожелай мне удачи`,

    // Multi-timestamp line (chorus repetition)
    multiTimestamp: `[00:15.20][01:30.40][02:45.60] Cause you're a sky full of stars
[00:22.50][01:37.70] I'm gonna give you my heart`,

    // Millisecond precision (3 decimals)
    threeDecimals: `[00:12.345] High precision centisecond
[00:18.890] Another precise line`,

    // Empty and whitespace lines
    emptyLines: `[00:00.00] 
[00:05.00]    
[00:10.00] Line after whitespace`,

    // Instrumental track
    instrumentalText: `[00:00.00] (Instrumental)
[00:30.00] ♪
[01:00.00] (Solo)
[02:00.00] (End)`,

    // Extreme length: 500 lines generator helper
    generateExtremeLyrics(lineCount = 1000) {
        const lines = [];
        for (let i = 0; i < lineCount; i++) {
            const min = String(Math.floor(i / 60)).padStart(2, '0');
            const sec = String(i % 60).padStart(2, '0');
            lines.push(`[${min}:${sec}.00] Generated lyric line number ${i + 1} with standard length`);
        }
        return lines.join('\n');
    }
};
