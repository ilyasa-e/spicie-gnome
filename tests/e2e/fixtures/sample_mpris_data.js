/**
 * Test fixtures: Sample Spotify MPRIS D-Bus metadata, signals, and edge cases.
 */

export const SAMPLE_MPRIS_DATA = {
    // Normal track with array artist
    standardTrack: {
        'mpris:trackid': '/com/spotify/track/5JESuE80fvausWHjcT9QVh',
        'xesam:title': 'Yellow',
        'xesam:artist': ['Coldplay'],
        'xesam:album': 'Parachutes',
        'mpris:length': 267000000, // 267,000,000 microseconds = 267 seconds
        'mpris:artUrl': 'https://i.scdn.co/image/ab67616d0000b2739164ba0f6ae4763b43085f31',
        'xesam:autoRating': 0.8
    },

    // Korean track
    koreanTrack: {
        'mpris:trackid': 'spotify:track:3r8RuvgbX9s7ammBn07D3W',
        'xesam:title': 'Ditto',
        'xesam:artist': ['NewJeans'],
        'xesam:album': 'NewJeans "OMG"',
        'mpris:length': 185000000,
        'mpris:artUrl': 'https://i.scdn.co/image/ab67616d0000b273newjeans'
    },

    // Japanese track
    japaneseTrack: {
        'mpris:trackid': '/com/spotify/track/7j31rOhGQm1nua8LB953Jy',
        'xesam:title': 'アイドル',
        'xesam:artist': ['YOASOBI'],
        'xesam:album': 'アイドル',
        'mpris:length': 213000000,
        'mpris:artUrl': 'https://i.scdn.co/image/ab67616d0000b273yoasobi'
    },

    // Cyrillic track
    cyrillicTrack: {
        'mpris:trackid': '/org/mpris/MediaPlayer2/track/cyrillic123',
        'xesam:title': 'Группа крови',
        'xesam:artist': ['КИНО'],
        'xesam:album': 'Группа крови',
        'mpris:length': 285000000,
        'mpris:artUrl': 'https://i.scdn.co/image/ab67616d0000b273kino'
    },

    // Scalar artist variant (some MPRIS clients return string instead of array)
    scalarArtistTrack: {
        'mpris:trackid': '/com/spotify/track/scalar123',
        'xesam:title': 'Scalar Artist Song',
        'xesam:artist': 'Solo Performer',
        'xesam:album': 'Solo Album',
        'mpris:length': 200000000,
        'mpris:artUrl': 'https://example.com/art.jpg'
    },

    // Multiple artists array
    multiArtistTrack: {
        'mpris:trackid': '/com/spotify/track/multi123',
        'xesam:title': 'Collab Hit',
        'xesam:artist': ['Artist A', 'Artist B', 'Featured C'],
        'xesam:album': 'Collab Album',
        'mpris:length': 195000000,
        'mpris:artUrl': 'https://example.com/collab.jpg'
    },

    // Spotify Audio Advertisement (Free Tier)
    advertisementTrack: {
        'mpris:trackid': '/com/spotify/ad/advertisement12345',
        'xesam:title': 'Spotify Advertisement',
        'xesam:artist': ['Spotify'],
        'xesam:album': '',
        'mpris:length': 30000000, // 30s
        'mpris:artUrl': ''
    },

    // Second ad variant: spotify:ad: prefix
    advertisementTrackUri: {
        'mpris:trackid': 'spotify:ad:67890',
        'xesam:title': 'Advertisement',
        'xesam:artist': [],
        'xesam:album': '',
        'mpris:length': 15000000,
        'mpris:artUrl': ''
    },

    // Empty/Missing metadata edge case
    emptyMetadata: {},

    // Incomplete metadata
    partialMetadata: {
        'mpris:trackid': '/com/spotify/track/partial123'
        // Missing title, artist, album, length, artUrl
    },

    // Extreme values
    extremeMetadata: {
        'mpris:trackid': '/com/spotify/track/' + 'a'.repeat(200),
        'xesam:title': 'Very Long Title '.repeat(20),
        'xesam:artist': ['Artist '.repeat(30)],
        'xesam:album': 'Album '.repeat(25),
        'mpris:length': 86400000000, // 24 hours in microseconds
        'mpris:artUrl': 'https://example.com/' + 'x'.repeat(300)
    }
};
