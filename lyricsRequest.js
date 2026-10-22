/**
 * One definition of what a lyrics request needs.
 *
 * The extension and the standalone lyrics window both show the same song, so
 * they must read the same preferences and pass the same arguments to
 * LyricsProvider. Keeping the mapping here prevents the two call sites from
 * drifting apart.
 */

export const LYRICS_SETTINGS = [
    'enable-spicy-lyrics',
    'spicy-lyrics-client-key',
    'enable-romanization',
];

export function lyricsOptions(settings) {
    return {
        enableSpicy: settings?.get_boolean('enable-spicy-lyrics') ?? false,
        spicyClientKey: settings?.get_string('spicy-lyrics-client-key') || '',
        enableRomanization: settings?.get_boolean('enable-romanization') ?? true,
    };
}

/**
 * @param {object} provider LyricsProvider instance
 * @param {object|null} track MPRIS track metadata
 * @param {object|null} settings GSettings, or null when unavailable
 * @returns {Promise<object|null>} provider result, or null when there is no song
 */
export function fetchTrackLyrics(provider, track, settings) {
    if (!provider || !track?.title) return Promise.resolve(null);
    return provider.fetchLyrics(
        track.title,
        track.artist || '',
        track.album || '',
        Math.round((track.durationMs || 0) / 1000),
        track.trackId || '',
        lyricsOptions(settings)
    );
}
