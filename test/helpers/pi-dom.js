/**
 * Minimal browser host for Property Inspector pages.
 *
 * Why this exists: the PI pages load their scripts as classic `<script src>` tags,
 * which all share ONE top-level lexical scope. A `const` declared in
 * plugin/lib/endpoints.js and re-declared in a PI index.js is therefore a
 * SyntaxError that kills the whole page — the symptom being a PI form that never
 * leaves `display: none`. `node --check` cannot see this, because it checks files
 * one at a time.
 *
 * `vm.runInContext` reproduces the browser exactly: separate scripts run against
 * one shared global lexical scope, so V8 itself raises
 * "Identifier 'X' has already been declared" for us. No jsdom needed; the DOM
 * surface the PI code touches is small and is stubbed from the real HTML below.
 *
 * Deliberately NOT a browser: unsupported selectors throw instead of returning
 * null, so a stub gap shows up as a loud failure rather than a silent pass.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PLUGIN_DIR = path.resolve(__dirname, '..', '..', 'id.trakteer.streamdock.sdPlugin');
const PI_DIR = path.join(PLUGIN_DIR, 'propertyInspector');

/** `style="display: none"` → `{ display: 'none' }`, camelCased like a real CSSStyleDeclaration. */
function parseStyle(attribute) {
    const style = {};
    for (const declaration of String(attribute || '').split(';')) {
        const [property, ...rest] = declaration.split(':');
        if (!property.trim() || !rest.length) continue;
        const camel = property.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        style[camel] = rest.join(':').trim();
    }
    return style;
}

/** An element, as far as the PI code is concerned. */
class FakeElement {
    constructor(tagName, attributes = {}) {
        this.tagName = tagName.toUpperCase();
        this.attributes = { ...attributes };
        this.id = attributes.id || '';
        this.type = attributes.type || '';
        this.placeholder = attributes.placeholder || '';
        this.textContent = '';
        this.children = [];
        this.style = parseStyle(attributes.style);
        this.listeners = new Map();
        this._classes = new Set((attributes.class || '').split(/\s+/).filter(Boolean));
        this._value = attributes.value === undefined ? '' : String(attributes.value);

        const classes = this._classes;
        const self = this;
        this.classList = {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c),
            toggle: (c, force) => {
                const on = force === undefined ? !classes.has(c) : Boolean(force);
                if (on) classes.add(c); else classes.delete(c);
                return on;
            },
            get length() { return classes.size; },
            toString: () => [...classes].join(' '),
        };
        Object.defineProperty(this, 'className', {
            get: () => [...self._classes].join(' '),
            enumerable: false,
        });
    }

    get value() { return this._value; }

    set value(next) {
        const text = next === undefined || next === null ? '' : String(next);
        if (this.tagName === 'SELECT') {
            const options = this.children.filter((c) => c.tagName === 'OPTION');
            // A real <select> refuses a value none of its options carry.
            if (options.length && !options.some((o) => o.value === text)) {
                this._value = '';
                return;
            }
        }
        this._value = text;
    }

    /** Only `innerHTML = ''` is used (to clear a <select>); anything else is a stub gap. */
    set innerHTML(html) {
        if (html !== '') throw new Error(`pi-dom: innerHTML assignment other than '' is not supported (got ${JSON.stringify(html)})`);
        this.children = [];
        this._value = '';
    }

    get innerHTML() { return ''; }

    appendChild(child) {
        this.children.push(child);
        // Browsers select the first option of a <select> automatically.
        if (this.tagName === 'SELECT' && this._value === '' && child.tagName === 'OPTION') {
            this._value = child.value;
        }
        return child;
    }

    addEventListener(event, handler) {
        if (!this.listeners.has(event)) this.listeners.set(event, []);
        this.listeners.get(event).push(handler);
    }

    setAttribute(name, value) { this.attributes[name] = value; }

    getAttribute(name) {
        return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    }

    /** Test-side helper: fire the listeners the PI code registered. */
    fire(event) {
        for (const handler of this.listeners.get(event) || []) handler.call(this, { target: this, type: event });
    }
}

/**
 * Scan real HTML for its elements.
 *
 * Not a parser — the PI pages are flat, hand-written markup and the PI scripts only
 * ever look elements up by id, by class, or by `tag[attr="value"]`. Keeping this a
 * scanner means the element set comes from the shipped HTML rather than a fixture
 * that can drift away from it.
 */
function scanElements(html) {
    const elements = [];
    const tagPattern = /<([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)\/?>/g;
    let match;
    while ((match = tagPattern.exec(html)) !== null) {
        const [, tagName, rawAttrs] = match;
        const attributes = {};
        const attrPattern = /([\w:-]+)\s*=\s*"([^"]*)"/g;
        let attr;
        while ((attr = attrPattern.exec(rawAttrs)) !== null) attributes[attr[1]] = attr[2];
        elements.push(new FakeElement(tagName, attributes));
    }
    return elements;
}

function matches(element, selector) {
    const trimmed = selector.trim();

    let m = /^\.([\w-]+)$/.exec(trimmed);
    if (m) return element.classList.contains(m[1]);

    m = /^#([\w-]+)$/.exec(trimmed);
    if (m) return element.id === m[1];

    m = /^([\w-]+)$/.exec(trimmed);
    if (m) return element.tagName === m[1].toUpperCase();

    m = /^([\w-]+)\[([\w-]+)="([^"]*)"\]$/.exec(trimmed);
    if (m) return element.tagName === m[1].toUpperCase() && element.getAttribute(m[2]) === m[3];

    throw new Error(`pi-dom: unsupported selector ${JSON.stringify(selector)} — extend matches() rather than loosening it`);
}

function makeDocument(html) {
    const elements = scanElements(html);
    return {
        elements,
        getElementById(id) {
            return elements.find((e) => e.id === id) || null;
        },
        querySelector(selector) {
            return elements.find((e) => matches(e, selector)) || null;
        },
        querySelectorAll(selector) {
            return elements.filter((e) => matches(e, selector));
        },
        createElement(tagName) {
            return new FakeElement(tagName);
        },
        createTreeWalker() {
            throw new Error('pi-dom: createTreeWalker is only reached when $local is true; stub it when that changes');
        },
    };
}

/** The `<script src>` list, in document order — the load order the browser uses. */
function scriptSources(html) {
    return [...html.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Load one Property Inspector page the way the StreamDock PI webview does.
 *
 * @param {string} page PI folder name, e.g. 'testalert'
 * @param {{ extraScripts?: Array<{ filename: string, code: string }> }} [options]
 *        extraScripts run after the page's own scripts, in the same scope. Used by
 *        the negative self-test to prove a duplicate declaration is really detected.
 * @returns {{ context: object, document: object, loaded: string[], sent: object[],
 *             evaluate: (expression: string) => any }}
 */
function loadPropertyInspector(page, options = {}) {
    const htmlPath = path.join(PI_DIR, page, 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const document = makeDocument(html);
    const sent = [];

    class FakeWebSocket {
        constructor(url) {
            this.url = url;
            this.onopen = null;
            this.onmessage = null;
        }

        send(raw) { sent.push(JSON.parse(raw)); }
    }

    const sandbox = {
        document,
        console,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        EventTarget,
        CustomEvent,
        Event,
        WebSocket: FakeWebSocket,
        XMLHttpRequest: class { open() { } send() { } },
        Image: class { },
        NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1 },
        JSON,
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;

    const context = vm.createContext(sandbox);
    const loaded = [];

    for (const src of scriptSources(html)) {
        const file = path.resolve(path.dirname(htmlPath), src);
        // runInContext, not runInNewContext: every script must share one global
        // lexical scope, exactly like classic scripts in a document.
        vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
        loaded.push(path.relative(PLUGIN_DIR, file));
    }

    for (const extra of options.extraScripts || []) {
        vm.runInContext(extra.code, context, { filename: extra.filename });
        loaded.push(extra.filename);
    }

    return {
        context,
        document,
        loaded,
        sent,
        /**
         * Read or call something in the page's scope.
         *
         * Necessary rather than convenient: `const $propEvent`, `const $back` and
         * action.js's `let $websocket` are *lexical* top-level declarations, so they
         * never become properties of the global object. Only code evaluated in the
         * same context can see them — which is also precisely why re-declaring one
         * of endpoints.js's consts is a page-killing SyntaxError.
         */
        evaluate(expression) {
            return vm.runInContext(expression, context, { filename: `<evaluate ${page}>` });
        },
    };
}

/** PI pages a manifest action points at, derived from the manifest itself. */
function propertyInspectorPages() {
    const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'manifest.json'), 'utf8'));
    const pages = new Set();
    for (const action of manifest.Actions || []) {
        if (!action.PropertyInspectorPath) continue;
        pages.add(path.basename(path.dirname(action.PropertyInspectorPath)));
    }
    return [...pages];
}

module.exports = { loadPropertyInspector, propertyInspectorPages, FakeElement, PLUGIN_DIR, PI_DIR };
