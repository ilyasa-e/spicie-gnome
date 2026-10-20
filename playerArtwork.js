import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import Soup from 'gi://Soup?version=3.0';
import { DEFAULT_PALETTE, paletteFromPixels } from './playerTheme.js';

export class PlayerArtwork {
    constructor(onChanged) {
        this._onChanged = onChanged;
        this._session = new Soup.Session({ timeout: 12, user_agent: 'SpotifyFloatingLyrics/2' });
        this._url = null;
        this._generation = 0;
        this.value = { gicon: null, palette: DEFAULT_PALETTE };
    }

    update(url = '') {
        if (url === this._url) return;
        this._url = url;
        this._cancellable?.cancel();
        this._cancellable = new Gio.Cancellable();
        const generation = ++this._generation;
        this.value = { gicon: null, palette: DEFAULT_PALETTE };
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
                    this.value = {
                        gicon: Gio.BytesIcon.new(bytes),
                        palette: paletteFromPixels(image.get_pixels(), image.width, image.height,
                            image.rowstride, image.n_channels),
                    };
                    this._onChanged(this.value);
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

    destroy() {
        ++this._generation;
        this._cancellable?.cancel();
        this._session.abort();
        this._onChanged = () => {};
    }
}
