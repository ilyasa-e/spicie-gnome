/**
 * Mock GSettings implementation strictly enforcing the extension schema:
 * org.gnome.shell.extensions.spotify-floating-lyrics
 */

export const SCHEMA_DEFAULTS = {
    'show-in-panel': true,
    'show-floating': true,
    'floating-always-on-top': true,
    'floating-click-passthrough': false,
    'floating-position': 'top-right',
    'floating-x': 100,
    'floating-y': 100,
    'font-family': 'Sans',
    'font-weight': 'bold',
    'player-lyrics-font-weight': 'regular',
    'panel-font-weight': 'semibold',
    'font-size': 22,
    'line-spacing': 14,
    'background-style': 'transparent',
    'enable-spicy-lyrics': false,
    'spicy-lyrics-token': '',
    'enable-romanization': true
};

export const SCHEMA_CHOICES = {
    'floating-position': ['top-right', 'bottom-right', 'top-left', 'bottom-left', 'center', 'custom'],
    'background-style': ['transparent', 'blur', 'dark-card']
};

export const SCHEMA_RANGES = {
    'font-size': { min: 12, max: 48 },
    'line-spacing': { min: 4, max: 32 }
};

export class MockSettings {
    constructor(initialValues = {}) {
        this.values = { ...SCHEMA_DEFAULTS, ...initialValues };
        this.listeners = new Map();
    }

    _assertKey(key) {
        if (!(key in SCHEMA_DEFAULTS)) {
            throw new Error(`GSettings error: Unknown key "${key}" for schema org.gnome.shell.extensions.spotify-floating-lyrics`);
        }
    }

    get_boolean(key) {
        this._assertKey(key);
        if (typeof this.values[key] !== 'boolean') {
            throw new Error(`Key "${key}" is not boolean`);
        }
        return this.values[key];
    }

    set_boolean(key, val) {
        this._assertKey(key);
        if (typeof val !== 'boolean') {
            throw new Error(`GSettings error: expected boolean for "${key}", got ${typeof val}`);
        }
        const oldVal = this.values[key];
        this.values[key] = val;
        if (oldVal !== val) this._emit(key);
        return true;
    }

    get_string(key) {
        this._assertKey(key);
        if (typeof this.values[key] !== 'string') {
            throw new Error(`Key "${key}" is not string`);
        }
        return this.values[key];
    }

    set_string(key, val) {
        this._assertKey(key);
        if (typeof val !== 'string') {
            throw new Error(`GSettings error: expected string for "${key}", got ${typeof val}`);
        }
        if (SCHEMA_CHOICES[key] && !SCHEMA_CHOICES[key].includes(val)) {
            throw new Error(`GSettings error: value "${val}" not in choices [${SCHEMA_CHOICES[key].join(', ')}] for "${key}"`);
        }
        const oldVal = this.values[key];
        this.values[key] = val;
        if (oldVal !== val) this._emit(key);
        return true;
    }

    get_int(key) {
        this._assertKey(key);
        if (typeof this.values[key] !== 'number') {
            throw new Error(`Key "${key}" is not integer`);
        }
        return this.values[key];
    }

    set_int(key, val) {
        this._assertKey(key);
        if (typeof val !== 'number' || !Number.isInteger(val)) {
            throw new Error(`GSettings error: expected integer for "${key}", got ${val}`);
        }
        if (SCHEMA_RANGES[key]) {
            const { min, max } = SCHEMA_RANGES[key];
            if (val < min || val > max) {
                throw new Error(`GSettings error: integer value ${val} out of range [${min}, ${max}] for "${key}"`);
            }
        }
        const oldVal = this.values[key];
        this.values[key] = val;
        if (oldVal !== val) this._emit(key);
        return true;
    }

    connect(signal, callback) {
        if (!this.listeners.has(signal)) {
            this.listeners.set(signal, new Set());
        }
        this.listeners.get(signal).add(callback);
        return callback;
    }

    disconnect(callback) {
        for (const [_, set] of this.listeners) {
            set.delete(callback);
        }
    }

    _emit(key) {
        const specificSignal = `changed::${key}`;
        if (this.listeners.has(specificSignal)) {
            for (const cb of this.listeners.get(specificSignal)) {
                try { cb(this, key); } catch (e) { console.error(e); }
            }
        }
        if (this.listeners.has('changed')) {
            for (const cb of this.listeners.get('changed')) {
                try { cb(this, key); } catch (e) { console.error(e); }
            }
        }
    }
}
