import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Soup from 'gi://Soup?version=3.0';
import { DEFAULT_PALETTE, paletteFromPixels } from './playerTheme.js';

// Covers are drawn as CSS backgrounds so their corners can be rounded, and
// St loads backgrounds from files. Downloaded covers are kept here, one file
// per cover address, and removed when the song changes.
const DEFAULT_CACHE = GLib.build_filenamev([GLib.get_user_cache_dir(), 'spicie-gnome', 'covers']);

export class PlayerArtwork {
    constructor(onChanged, {cacheDir = DEFAULT_CACHE} = {}) {
        this._onChanged = onChanged;
        this._cacheDir = cacheDir;
        this._session = new Soup.Session({ timeout: 12, user_agent: 'Spicie/2.0 (GNOME Shell Extension)' });
        this._url = null;
        this._generation = 0;
        this.value = { gicon: null, palette: DEFAULT_PALETTE, uri: null };
    }

    _forget() {
        if (this._cached) {
            try { Gio.File.new_for_path(this._cached).delete(null); } catch (_) {}
        }
        this._cached = null;
    }

    update(url = '') {
        if (url === this._url) return;
        this._url = url;
        this._cancellable?.cancel();
        this._cancellable = new Gio.Cancellable();
        const generation = ++this._generation;
        this._forget();
        this.value = { gicon: null, palette: DEFAULT_PALETTE, uri: null };
        this._onChanged(this.value);
        if (!url || !/^(https?:\/\/|file:\/\/)/i.test(url)) return;
        const cancellable = this._cancellable;
        const decode = bytes => {
            if (generation !== this._generation || bytes.get_size() > 8 * 1024 * 1024) return;
            const stream = Gio.MemoryInputStream.new_from_bytes(bytes);
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, 64, 64, true, cancellable, (_source, result) => {
                try {
                    const image = GdkPixbuf.Pixbuf.new_from_stream_finish(result);
                    if (generation !== this._generation) return;
                    const palette = paletteFromPixels(image.get_pixels(), image.width, image.height,
                        image.rowstride, image.n_channels);
                    const publish = uri => {
                        if (generation !== this._generation) return;
                        this.value = { gicon: Gio.BytesIcon.new(bytes), palette, uri };
                        this._onChanged(this.value);
                    };
                    if (url.startsWith('file://')) publish(url);
                    else this._store(url, bytes, cancellable, publish);
                } catch (e) {
                    // Retain the neutral cover on errors or cancelled requests.
                } finally {
                    stream.close(null);
                }
            });
        };
        if (url.startsWith('file://')) {
            Gio.File.new_for_uri(url).load_bytes_async(cancellable, (file, result) => {
                try { decode(file.load_bytes_finish(result)[0]); } catch (e) {}
            });
        } else {
            const message = Soup.Message.new('GET', url);
            if (!message) return;
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (message.status_code === 200) decode(bytes);
                } catch (e) {}
            });
        }
    }

    _store(url, bytes, cancellable, publish) {
        const path = GLib.build_filenamev([this._cacheDir,
            GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, url, -1)]);
        const file = Gio.File.new_for_path(path);
        try {
            GLib.mkdir_with_parents(this._cacheDir, 0o700);
        } catch (_) {}
        file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION,
            cancellable, (_file, result) => {
                try {
                    file.replace_contents_finish(result);
                } catch (_) {
                    // Without a file the cover still shows, with square corners.
                    publish(null);
                    return;
                }
                if (cancellable.is_cancelled()) {
                    try { file.delete(null); } catch (_) {}
                    return;
                }
                this._cached = path;
                publish(file.get_uri());
            });
    }

    destroy() {
        ++this._generation;
        this._forget();
        this._cancellable?.cancel();
        this._session.abort();
        this._onChanged = () => {};
    }
}
