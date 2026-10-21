import Gtk from 'gi://Gtk';
import { lineAlignment } from './lyricsPresentation.js';

export function createLyricsPreview(settings) {
    const frame = new Gtk.Frame({ margin_bottom: 6 });
    const screen = new Gtk.Overlay({ height_request: 150 });
    screen.set_child(new Gtk.Box());
    screen.add_overlay(new Gtk.Label({ label: 'Placement preview', halign: Gtk.Align.START,
        valign: Gtk.Align.END, margin_start: 12, margin_bottom: 8, css_classes: ['dim-label', 'caption'] }));
    const sample = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 5,
        width_request: 230, margin_start: 14, margin_end: 14, margin_top: 14, margin_bottom: 28 });
    const first = new Gtk.Label({label:'First voice',xalign:0});
    const second = new Gtk.Label({label:'Second voice',xalign:1,css_classes:['dim-label']});
    sample.append(first);sample.append(second);screen.add_overlay(sample);frame.set_child(screen);
    const refresh = () => {
        const position = settings.get_string('floating-position');
        sample.halign = position.includes('left') ? Gtk.Align.START : position.includes('right') ? Gtk.Align.END : Gtk.Align.CENTER;
        sample.valign = position.startsWith('top') ? Gtk.Align.START : position.startsWith('bottom') ? Gtk.Align.END : Gtk.Align.CENTER;
        const setting = settings.get_string('lyrics-alignment');
        first.label = setting === 'vocals' ? 'First voice' : 'Sample lyric';
        first.xalign = ({left:0,center:0.5,right:1})[lineAlignment(setting,{oppositeAligned:false})];
        second.visible = setting === 'vocals';
        second.xalign = 1;
        frame.sensitive = settings.get_boolean('show-floating');
    };
    refresh();
    const signals = ['floating-position','lyrics-alignment','show-floating'].map(key => settings.connect(`changed::${key}`,refresh));
    return { widget: frame, destroy: () => signals.forEach(id => settings.disconnect(id)) };
}
