/**
 * Mock GNOME Shell UI environment for headless E2E testing.
 * Provides Clutter, St, Main, PanelMenu, PopupMenu, and Adw mocks.
 */

export class MockClutterActor {
    constructor(props = {}) {
        this.reactive = props.reactive !== undefined ? props.reactive : true;
        this.visible = props.visible !== undefined ? props.visible : true;
        this.opacity = props.opacity !== undefined ? props.opacity : 255;
        this.x = props.x || 0;
        this.y = props.y || 0;
        this.width = props.width || 400;
        this.height = props.height || 120;
        this.children = [];
        this.parent = null;
        this.style = '';
        this.style_class = props.style_class || '';
        this.destroyed = false;
        this.signals = new Map();
    }

    add_child(child) {
        if (!child) return;
        child.parent = this;
        this.children.push(child);
    }

    remove_child(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            child.parent = null;
        }
    }

    remove_all_children() {
        for (const ch of this.children) {
            ch.parent = null;
            ch.destroy();
        }
        this.children = [];
    }

    get_children() {
        return [...this.children];
    }

    set_position(x, y) {
        this.x = x;
        this.y = y;
    }

    set_size(w, h) {
        this.width = w;
        this.height = h;
    }

    ease(props) {
        if (props.value !== undefined && this.value !== undefined) {
            this.value = props.value;
        }
    }

    connect(signal, cb) {
        if (!this.signals.has(signal)) this.signals.set(signal, new Set());
        this.signals.get(signal).add(cb);
        return cb;
    }

    disconnect(cb) {
        for (const [_, set] of this.signals) {
            set.delete(cb);
        }
    }

    emit(signal, ...args) {
        if (this.destroyed) return;
        if (this.signals.has(signal)) {
            for (const cb of this.signals.get(signal)) {
                cb(this, ...args);
            }
        }
    }

    destroy() {
        this.destroyed = true;
        this.remove_all_children();
        this.signals.clear();
    }
}

export class MockStWidget extends MockClutterActor {
    constructor(props = {}) {
        super(props);
        this.style_class_list = new Set((props.style_class || '').split(' ').filter(Boolean));
    }

    add_style_class_name(name) {
        this.style_class_list.add(name);
        this.style_class = [...this.style_class_list].join(' ');
    }

    remove_style_class_name(name) {
        this.style_class_list.delete(name);
        this.style_class = [...this.style_class_list].join(' ');
    }

    has_style_class_name(name) {
        return this.style_class_list.has(name);
    }
}

export class MockStLabel extends MockStWidget {
    constructor(props = {}) {
        super(props);
        this.text = props.text || '';
    }

    set_text(text) {
        this.text = text || '';
    }

    get_text() {
        return this.text;
    }
}

export class MockStIcon extends MockStWidget {
    constructor(props = {}) {
        super(props);
        this.icon_name = props.icon_name || '';
    }
}

export class MockStButton extends MockStWidget {
    constructor(props = {}) {
        super(props);
        this.label = props.label || '';
        this.child = props.child || null;
    }
}

export class MockStBoxLayout extends MockStWidget {
    constructor(props = {}) {
        super(props);
        this.vertical = props.vertical || false;
    }
}

export class MockStAdjustment {
    constructor() {
        this.value = 0;
        this.lower = 0;
        this.upper = 1000;
        this.page_size = 380;
    }

    set_value(val) {
        this.value = val;
    }

    get_value() {
        return this.value;
    }

    ease(val, params) {
        this.value = val;
    }
}

export class MockStScrollView extends MockStWidget {
    constructor(props = {}) {
        super(props);
        this.vscroll = {
            adjustment: new MockStAdjustment()
        };
    }

    get_vscroll_bar() {
        return {
            get_adjustment: () => this.vscroll.adjustment
        };
    }
}

export class MockPopupMenu {
    constructor() {
        this.items = [];
        this.box = new MockStBoxLayout({ vertical: true });
        this.isOpen = false;
        this.destroyed = false;
    }

    addMenuItem(item) {
        this.items.push(item);
        if (item.actor) this.box.add_child(item.actor);
    }

    open() {
        this.isOpen = true;
    }

    close() {
        this.isOpen = false;
    }

    destroy() {
        this.destroyed = true;
        this.items = [];
        this.box.destroy();
    }
}

export class MockPanelMenuButton extends MockStWidget {
    constructor(menuAlignment = 0.0, nameText = '') {
        super({ style_class: 'panel-button' });
        this.name = nameText;
        this.menu = new MockPopupMenu();
    }

    destroy() {
        super.destroy();
        this.menu.destroy();
    }
}

export class MockMainLayoutManager {
    constructor() {
        this.topChromeActors = new Map();
        this.monitors = [
            { index: 0, x: 0, y: 0, width: 1920, height: 1080 }
        ];
        this.signals = new Map();
    }

    addTopChrome(actor, params = {}) {
        this.topChromeActors.set(actor, params);
    }

    removeChrome(actor) {
        this.topChromeActors.delete(actor);
    }

    getWorkAreaForMonitor(idx = 0) {
        const mon = this.monitors[idx] || this.monitors[0];
        // 32px top bar reserved
        return {
            x: mon.x,
            y: mon.y + 32,
            width: mon.width,
            height: mon.height - 32
        };
    }

    connect(signal, cb) {
        if (!this.signals.has(signal)) this.signals.set(signal, new Set());
        this.signals.get(signal).add(cb);
        return cb;
    }

    emit(signal, ...args) {
        if (this.signals.has(signal)) {
            for (const cb of this.signals.get(signal)) {
                cb(this, ...args);
            }
        }
    }
}

export class MockMainPanel {
    constructor() {
        this.statusArea = new Map();
    }

    addToStatusArea(role, indicator, position = 1, box = 'right') {
        this.statusArea.set(role, { indicator, position, box });
    }

    remove(role) {
        this.statusArea.delete(role);
    }
}

export class MockAdwPreferencesWindow {
    constructor() {
        this.pages = [];
    }

    add(page) {
        this.pages.push(page);
    }
}

export class MockShellEnvironment {
    constructor() {
        this.Main = {
            layoutManager: new MockMainLayoutManager(),
            panel: new MockMainPanel()
        };
        this.St = {
            Widget: MockStWidget,
            Label: MockStLabel,
            Icon: MockStIcon,
            Button: MockStButton,
            BoxLayout: MockStBoxLayout,
            ScrollView: MockStScrollView
        };
        this.Clutter = {
            Actor: MockClutterActor
        };
        this.PanelMenu = {
            Button: MockPanelMenuButton
        };
    }
}
