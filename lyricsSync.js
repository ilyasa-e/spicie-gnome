/**
 * Lyrics Synchronization Engine for GNOME Shell Extension
 * Connects playback timestamps to active lyric lines.
 *
 * Implements O(log N) binary search line matching, zero-event-flooding deduplication,
 * gap & interlude handling, seek resynchronization, and clean lifecycle teardown.
 */

import GObject from 'gi://GObject';
import { activeLineIndex } from './karaokeTiming.js';

export const LyricsSync = GObject.registerClass({
    GTypeName: 'LyricsSync',
    Signals: {
        'line-changed': {
            param_types: [GObject.TYPE_INT, GObject.TYPE_JSOBJECT],
        },
    },
}, class LyricsSync extends GObject.Object {
    _init(params = {}) {
        super._init();
        this._lines = [];
        this._currentIndex = -1;
        this._currentLine = null;
        this._destroyed = false;

        if (Array.isArray(params)) {
            this.setLyrics(params);
        } else if (params && Array.isArray(params.lines)) {
            this.setLyrics(params.lines);
        }
    }

    _getTime(line) {
        if (!line) return 0;
        if (typeof line.timeMs === 'number') return line.timeMs;
        if (typeof line.startTimeMs === 'number') return line.startTimeMs;
        return 0;
    }

    /**
     * Stores and normalizes parsed lyrics lines, sorted chronologically.
     * @param {Array<object>} lines
     */
    setLyrics(lines) {
        if (!Array.isArray(lines) || lines.length === 0) {
            this._lines = [];
            if (this._currentIndex !== -1) {
                this._currentIndex = -1;
                this._currentLine = null;
                this.emit('line-changed', -1, null);
            }
            return;
        }

        this._lines = lines.map((line, idx) => {
            const timeMs = this._getTime(line);
            const text = line.text !== undefined ? line.text : (line.words || '');
            return {
                id: line.id !== undefined ? line.id : idx,
                timeMs,
                startTimeMs: timeMs,
                endTimeMs: line.endTimeMs !== undefined ? line.endTimeMs : null,
                text,
                words: text,
                romanized: line.romanized || null,
                timing: line.timing || (line.syllables?.length ? 'syllable' : 'line'),
                syllables: Array.isArray(line.syllables) ? line.syllables.map(span => ({ ...span })) : null,
                isInterlude: Boolean(
                    line.isInterlude || 
                    text.trim() === '' || 
                    text.trim() === '♪' || 
                    text.toLowerCase().includes('(instrumental)')
                ),
            };
        }).sort((a, b) => a.timeMs - b.timeMs);

        // Reset tracking state on new lyric set
        if (this._currentIndex !== -1) {
            this._currentIndex = -1;
            this._currentLine = null;
            this.emit('line-changed', -1, null);
        } else {
            this._currentIndex = -1;
            this._currentLine = null;
        }
    }

    /**
     * Resolves the active line index for a given playback timestamp.
     * @param {number} positionMs
     * @returns {number} Active index (or -1 if before start or in unannotated gap)
     */
    findActiveIndex(positionMs) {
        return activeLineIndex(this._lines, positionMs);
    }

    /**
     * Evaluates current position against lyrics and emits 'line-changed' if active line changed.
     * @param {number} positionMs
     */
    updatePosition(positionMs) {
        if (this._destroyed || !this._lines || this._lines.length === 0) return;
        if (typeof positionMs !== 'number' || isNaN(positionMs)) return;

        const newIndex = this.findActiveIndex(positionMs);
        if (newIndex !== this._currentIndex) {
            this._currentIndex = newIndex;
            this._currentLine = newIndex >= 0 ? this._lines[newIndex] : null;
            this.emit('line-changed', this._currentIndex, this._currentLine);
        }
    }

    getCurrentIndex() {
        return this._currentIndex;
    }

    getCurrentLine() {
        return this._currentLine;
    }

    getLines() {
        return this._lines;
    }

    getLine(index) {
        if (index >= 0 && index < this._lines.length) {
            return this._lines[index];
        }
        return null;
    }

    /**
     * Convenience listener helper matching E2E harness and PROJECT.md contract.
     * @param {Function} callback (activeLine, lineIndex, allLines) => void
     * @returns {number} GObject signal connection ID
     */
    onLineChanged(callback) {
        if (typeof callback !== 'function') return 0;
        return this.connect('line-changed', (_emitter, index, line) => {
            callback(line, index, this._lines);
        });
    }

    /**
     * Clean lifecycle teardown. Nullifies internal arrays and marks instance as destroyed.
     */
    destroy() {
        this._destroyed = true;
        this._lines = [];
        this._currentIndex = -1;
        this._currentLine = null;
    }
});

// Dual export for maximum compatibility across consumers
export const LyricsSyncManager = LyricsSync;
export default LyricsSync;
