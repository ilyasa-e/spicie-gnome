import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';

// Shared by the top bar and Classic desktop lyrics. Credits stay beside the text.
export class SourceCredits {
    constructor({ vertical = false } = {}) {
        this._vertical = vertical;
        this.actor = new St.BoxLayout({ vertical, style_class: 'lyrics-source-credits',
            y_align: Clutter.ActorAlign.CENTER, visible: false });
    }

    setAttribution(attribution) {
        this.actor.destroy_all_children();
        this.actor.visible = Boolean(attribution);
        if (!attribution) return;
        const labelFor = text => {
            const label = new St.Label({ text, y_align: Clutter.ActorAlign.CENTER });
            label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            return label;
        };
        this.actor.add_child(labelFor(String(attribution.provider || 'Unknown source')));
        for (const person of attribution.contributors || []) {
            const label = `${this._vertical ? '' : ' · '}${person.role}: ${person.name}`;
            if (person.url && /^https?:\/\/[^\s]+$/i.test(person.url)) {
                const button = new St.Button({ child: labelFor(label), can_focus: true,
                    style_class: 'lyrics-source-link', accessible_name: `${person.role}: ${person.name}` });
                button.connect('clicked', () => {
                    try { Gio.AppInfo.launch_default_for_uri(person.url, null); }
                    catch (_) { console.warn('Spicie: Could not open the contributor link.'); }
                });
                this.actor.add_child(button);
            } else this.actor.add_child(labelFor(label));
        }
    }
}
