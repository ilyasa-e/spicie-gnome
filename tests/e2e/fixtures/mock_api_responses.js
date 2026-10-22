/**
 * Test fixtures: Mock HTTP responses for LRCLIB and Spicy Lyrics APIs.
 */

import { SAMPLE_LYRICS } from './sample_lyrics.js';

export const MOCK_API_RESPONSES = {
    // LRCLIB 200 OK for "Yellow"
    lrclibYellow: {
        status: 200,
        body: {
            id: 16232,
            name: "Yellow",
            trackName: "Yellow",
            artistName: "Coldplay",
            albumName: "Parachutes",
            duration: 267.0,
            instrumental: false,
            plainLyrics: "Look at the stars...",
            syncedLyrics: SAMPLE_LYRICS.yellow
        }
    },

    // LRCLIB 200 OK for Korean track "Ditto"
    lrclibDitto: {
        status: 200,
        body: {
            id: 99124,
            name: "Ditto",
            trackName: "Ditto",
            artistName: "NewJeans",
            albumName: "NewJeans 'OMG'",
            duration: 185.0,
            instrumental: false,
            plainLyrics: "Stay in the middle...",
            syncedLyrics: SAMPLE_LYRICS.dittoHangul
        }
    },

    // LRCLIB 200 OK for Japanese track "Idol"
    lrclibIdol: {
        status: 200,
        body: {
            id: 88123,
            name: "アイドル",
            trackName: "アイドル",
            artistName: "YOASOBI",
            albumName: "アイドル",
            duration: 213.0,
            instrumental: false,
            plainLyrics: "むてきのえがおで...",
            syncedLyrics: SAMPLE_LYRICS.idolKana
        }
    },

    // LRCLIB 200 OK for Cyrillic track "Группа крови"
    lrclibKino: {
        status: 200,
        body: {
            id: 44211,
            name: "Группа крови",
            trackName: "Группа крови",
            artistName: "КИНО",
            albumName: "Группа крови",
            duration: 285.0,
            instrumental: false,
            plainLyrics: "Теплое место...",
            syncedLyrics: SAMPLE_LYRICS.kinoCyrillic
        }
    },

    // LRCLIB 200 OK for Instrumental track
    lrclibInstrumental: {
        status: 200,
        body: {
            id: 55112,
            name: "YYZ",
            trackName: "YYZ",
            artistName: "Rush",
            albumName: "Moving Pictures",
            duration: 266.0,
            instrumental: true,
            plainLyrics: null,
            syncedLyrics: null
        }
    },

    // LRCLIB 404 Track Not Found
    lrclibNotFound: {
        status: 404,
        body: {
            message: "Failed to find specified track",
            name: "TrackNotFound",
            statusCode: 404
        }
    },

    // LRCLIB 503 Server Overloaded
    lrclib503: {
        status: 503,
        body: {
            message: "The server is busy, please retry in a moment",
            name: "ServerOverloaded",
            statusCode: 503
        }
    },

    // LRCLIB Search Fallback candidate array (HTTP 200)
    lrclibSearchCandidates: {
        status: 200,
        body: [
            {
                id: 16232,
                name: "Yellow",
                trackName: "Yellow",
                artistName: "Coldplay",
                albumName: "Parachutes",
                duration: 267.0,
                instrumental: false,
                syncedLyrics: SAMPLE_LYRICS.yellow
            },
            {
                id: 16233,
                name: "Yellow (Live)",
                trackName: "Yellow (Live)",
                artistName: "Coldplay",
                albumName: "Live 2003",
                duration: 275.0,
                instrumental: false,
                syncedLyrics: null
            }
        ]
    },

    // Spicy Lyrics 200 TTML response
    spicyLyricsSuccess: {
        status: 200,
        body: {
            trackId: "5JESuE80fvausWHjcT9QVh",
            provider: "spicy_lyrics",
            type: "syllable_ttml",
            ttml: `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <div>
      <p begin="00:35.660" end="00:38.460">
        <span begin="00:35.660" end="00:36.200">Look </span>
        <span begin="00:36.200" end="00:36.800">at </span>
        <span begin="00:36.800" end="00:37.400">the </span>
        <span begin="00:37.400" end="00:38.460">stars</span>
      </p>
      <p begin="00:38.460" end="00:44.170">
        <span begin="00:38.460" end="00:39.500">Look </span>
        <span begin="00:39.500" end="00:40.200">how </span>
        <span begin="00:40.200" end="00:41.000">they </span>
        <span begin="00:41.000" end="00:42.500">shine </span>
        <span begin="00:42.500" end="00:43.100">for </span>
        <span begin="00:43.100" end="00:44.170">you</span>
      </p>
    </div>
  </body>
</tt>`
        }
    },

    // Spicy Lyrics 418 / 401 error
    spicyLyricsForbidden: {
        status: 418,
        body: {
            error: "Forbidden",
            message: "Invalid token or internal client requirement"
        }
    }
};
