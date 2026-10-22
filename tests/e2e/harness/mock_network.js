/**
 * Mock HTTP Session simulator for Libsoup / network queries.
 */

import { MOCK_API_RESPONSES } from '../fixtures/mock_api_responses.js';
import { sleep } from './test_framework.js';

export class MockNetworkSession {
    constructor() {
        this.requests = [];
        this.isOffline = false;
        this.force503 = false;
        this.force404 = false;
        this.latencyMs = 0;
    }

    async sendAsync(url, options = {}) {
        const cancellable = options.cancellable || null;
        this.requests.push({ url, options, timestamp: Date.now() });

        if (this.latencyMs > 0) {
            await sleep(this.latencyMs);
        }

        if (cancellable && cancellable.is_cancelled && cancellable.is_cancelled()) {
            throw new Error('GLib.IOErrorEnum: CANCELLED');
        }

        if (this.isOffline) {
            throw new Error('Network unreachable: could not resolve host');
        }

        if (this.force503) {
            return {
                status_code: 503,
                get_response_body: () => ({
                    get_data: () => JSON.stringify(MOCK_API_RESPONSES.lrclib503.body)
                })
            };
        }

        if (this.force404) {
            return {
                status_code: 404,
                get_response_body: () => ({
                    get_data: () => JSON.stringify(MOCK_API_RESPONSES.lrclibNotFound.body)
                })
            };
        }

        // Spicy Lyrics endpoint
        if (url.includes('api.spicylyrics.org')) {
            const authHeader = options.headers ? (options.headers.Authorization || options.headers.authorization) : null;
            if (!authHeader || authHeader === 'Bearer ' || authHeader === 'Bearer') {
                return {
                    status_code: 418,
                    get_response_body: () => ({
                        get_data: () => JSON.stringify(MOCK_API_RESPONSES.spicyLyricsForbidden.body)
                    })
                };
            }
            return {
                status_code: 200,
                get_response_body: () => ({
                    get_data: () => JSON.stringify(MOCK_API_RESPONSES.spicyLyricsSuccess.body)
                })
            };
        }

        // LRCLIB Exact Lookup
        if (url.includes('/api/get')) {
            const trackMatch = url.match(/[?&]track_name=([^&#]*)/);
            const artistMatch = url.match(/[?&]artist_name=([^&#]*)/);
            const trackName = (trackMatch ? decodeURIComponent(trackMatch[1]) : '').toLowerCase();
            const artistName = (artistMatch ? decodeURIComponent(artistMatch[1]) : '').toLowerCase();

            if (trackName === 'yellow' && artistName.includes('coldplay')) {
                return {
                    status_code: 200,
                    get_response_body: () => ({
                        get_data: () => JSON.stringify(MOCK_API_RESPONSES.lrclibYellow.body)
                    })
                };
            }

            if (trackName.includes('ditto') || artistName.includes('newjeans')) {
                return {
                    status_code: 200,
                    get_response_body: () => ({
                        get_data: () => JSON.stringify(MOCK_API_RESPONSES.lrclibDitto.body)
                    })
                };
            }

            if (trackName.includes('アイドル') || trackName.includes('idol') || artistName.includes('yoasobi')) {
                return {
                    status_code: 200,
                    get_response_body: () => ({
                        get_data: () => JSON.stringify(MOCK_API_RESPONSES.lrclibIdol.body)
                    })
                };
            }

            if (trackName.includes('группа') || trackName.includes('крови') || artistName.includes('кино')) {
                return {
                    status_code: 200,
                    get_response_body: () => ({
                        get_data: () => JSON.stringify(MOCK_API_RESPONSES.lrclibKino.body)
                    })
                };
            }

            if (trackName.includes('yyz') || artistName.includes('rush')) {
                return {
                    status_code: 200,
                    get_response_body: () => ({
                        get_data: () => JSON.stringify(MOCK_API_RESPONSES.lrclibInstrumental.body)
                    })
                };
            }

            // Default 404 for unknown track
            return {
                status_code: 404,
                get_response_body: () => ({
                    get_data: () => JSON.stringify(MOCK_API_RESPONSES.lrclibNotFound.body)
                })
            };
        }

        // LRCLIB Search Fallback
        if (url.includes('/api/search')) {
            const qMatch = url.match(/[?&]q=([^&#]*)/);
            const query = (qMatch ? decodeURIComponent(qMatch[1]) : '').toLowerCase();
            if (query.includes('yellow')) {
                return {
                    status_code: 200,
                    get_response_body: () => ({
                        get_data: () => JSON.stringify(MOCK_API_RESPONSES.lrclibSearchCandidates.body)
                    })
                };
            }
            return {
                status_code: 200,
                get_response_body: () => ({
                    get_data: () => JSON.stringify([])
                })
            };
        }

        // Unhandled
        return {
            status_code: 404,
            get_response_body: () => ({
                get_data: () => JSON.stringify({ error: "Not found" })
            })
        };
    }
}
