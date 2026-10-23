import St from 'gi://St';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import Meta from 'gi://Meta';
import { creditItems } from './lyricsAttribution.js';

// Measure wrapped labels at their allocated width so links keep a real
// height, including inside the compact player.
const CreditsFlow = GObject.registerClass({GTypeName: 'SpicieCreditsFlow'}, class CreditsFlow extends Clutter.LayoutManager {
    _rows(container, width) {
        const limit = width < 0 ? Infinity : Math.max(1, width);
        let x = 0, y = 0, rowHeight = 0;
        const items = [];
        for (const actor of container.get_children().filter(child => child.visible)) {
            const itemWidth = Math.min(limit, actor.get_preferred_width(-1)[1]);
            if (x > 0 && x + itemWidth > limit) { y += rowHeight + 2;x = 0;rowHeight = 0; }
            const height = actor.get_preferred_height(itemWidth)[1];
            items.push({actor, x, y, width: itemWidth, height});
            x += itemWidth + 8;rowHeight = Math.max(rowHeight, height);
        }
        return {items, height: y + rowHeight};
    }
    vfunc_get_preferred_width(container, _height) {
        const widths = container.get_children().filter(child => child.visible)
            .map(child => child.get_preferred_width(-1));
        return [Math.max(0, ...widths.map(size => size[0])),
            widths.reduce((sum, size) => sum + size[1], 0) + Math.max(0, widths.length - 1) * 8];
    }
    vfunc_get_preferred_height(container, width) {
        const {height} = this._rows(container, width);
        return [height, height];
    }
    vfunc_allocate(container, box) {
        for (const item of this._rows(container, box.get_width()).items)
            item.actor.allocate(new Clutter.ActorBox({x1: box.x1 + item.x, y1: box.y1 + item.y,
                x2: box.x1 + item.x + item.width, y2: box.y1 + item.y + item.height}));
    }
});

export class SourceCredits {
    constructor(onLinkOpened = null) {
        this._onLinkOpened = onLinkOpened;
        this.actor = new St.Widget({style_class: 'lyrics-source-credits',
            layout_manager: new CreditsFlow(),
            y_align: Clutter.ActorAlign.CENTER, x_expand: true, visible: false});
        this.hasCredits = false;
    }

    setAttribution(attribution) {
        this.actor.destroy_all_children();
        const items = creditItems(attribution);
        this.hasCredits = items.length > 0;
        this.actor.visible = this.hasCredits;
        for (const person of items) {
            const label = new St.Label({text: person.name, y_expand: true, y_align: Clutter.ActorAlign.CENTER});
            label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            label.clutter_text.set_line_wrap(true);
            label.clutter_text.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
            if (person.url) {
                label.clutter_text.set_markup(`<u>${GLib.markup_escape_text(person.name, -1)}</u>`);
                const button = new St.Button({child: label, can_focus: true, y_expand: true,
                    style_class: 'lyrics-source-link',
                    accessible_name: person.role ? `${person.role}: ${person.name}` : person.name});
                // The shell has no link cursor of its own; show one so the
                // credit reads as clickable before it is pressed.
                button.connect('notify::hover', () => global.display.set_cursor(button.hover
                    ? Meta.Cursor.POINTING_HAND : Meta.Cursor.DEFAULT));
                button.connect('destroy', () => {
                    if (button.hover) global.display.set_cursor(Meta.Cursor.DEFAULT);
                });
                button.connect('clicked', () => {
                    try { Gio.AppInfo.launch_default_for_uri(person.url, null); }
                    catch (_) { console.warn('Spicie: Could not open the contributor link.'); }
                    // A popup would otherwise stay open on top of the browser.
                    this._onLinkOpened?.();
                });
                this.actor.add_child(button);
            } else this.actor.add_child(label);
        }
    }
}
