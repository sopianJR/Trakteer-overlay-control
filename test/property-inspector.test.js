/**
 * Property Inspector page tests.
 *
 * These guard a failure mode that `node --check` and `vm.Script` parsing cannot see,
 * because both look at one file at a time: the PI pages load their scripts as classic
 * `<script src>` tags, which share ONE top-level lexical scope. A `const` declared in
 * plugin/lib/endpoints.js and re-declared in a PI index.js is therefore
 * "SyntaxError: Identifier 'X' has already been declared" — V8 aborts the page, the
 * `$propEvent` handlers are never installed, and the form stays at `display: none`.
 * On a real Stream Dock that looks like an empty Property Inspector with no error.
 *
 * Run: node --test test/
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadPropertyInspector, propertyInspectorPages, PLUGIN_DIR } = require('./helpers/pi-dom');

const PAGES = propertyInspectorPages();

test('the manifest actually points at the PI pages under test', () => {
    assert.deepEqual([...PAGES].sort(), ['generic', 'testalert', 'widget']);
});

// ── the regression itself ────────────────────────────────────────────────────

for (const page of PAGES) {
    test(`propertyInspector/${page}: every script loads in one shared scope`, () => {
        // Throws on a duplicate top-level declaration, which is the whole point.
        const pi = loadPropertyInspector(page);
        assert.ok(
            pi.loaded.includes('plugin/lib/endpoints.js'),
            'the page must still load the shared endpoint registry',
        );
    });

    test(`propertyInspector/${page}: didReceiveSettings is installed`, () => {
        const pi = loadPropertyInspector(page);
        assert.equal(
            pi.evaluate('typeof $propEvent?.didReceiveSettings'),
            'function',
            'a SyntaxError anywhere on the page would leave this handler unregistered',
        );
        assert.equal(pi.evaluate('$back'), false, '$back must be false so action.js reveals the form');
    });
}

/**
 * Is this the duplicate-declaration SyntaxError, for the given identifier?
 *
 * `err.name`, not `instanceof SyntaxError`: the error is constructed inside the vm
 * realm, which has its own intrinsics, so cross-realm `instanceof` is always false.
 */
function isDuplicateDeclaration(err, name) {
    return Boolean(err)
        && err.name === 'SyntaxError'
        && err.message === `Identifier '${name}' has already been declared`;
}

/**
 * The negative self-test: break it on purpose and prove the harness notices.
 *
 * Without this, the tests above could pass for the wrong reason — e.g. if the loader
 * silently ran each script in its own scope, it would be green no matter what the PI
 * code declared, and the bug would sail straight back in.
 *
 * The injected names are ones the PI page itself declares (not registry exports),
 * precisely because endpoints.js no longer leaks anything — so this stays a test of
 * the harness rather than of the bug that was just fixed.
 */
test('a duplicate top-level declaration is detected, not tolerated', () => {
    for (const [page, name] of [['widget', '$endpoints'], ['widget', 'FIELDS'], ['testalert', 'binding'], ['generic', '$back']]) {
        assert.throws(
            () => loadPropertyInspector(page, {
                extraScripts: [{ filename: `<injected ${name}>`, code: `const ${name} = {};` }],
            }),
            (err) => isDuplicateDeclaration(err, name),
            `re-declaring ${name} on propertyInspector/${page} must raise a SyntaxError`,
        );
    }
});

/**
 * Reproduce the original bug shape end to end, so the fix is pinned by behaviour and
 * not only by the static scan below: a script that leaks `const WIDGETS` the way
 * endpoints.js used to, followed by a PI-style destructuring of the same name.
 */
test('the historical leak + destructuring combination is still fatal', () => {
    assert.throws(
        () => loadPropertyInspector('generic', {
            extraScripts: [
                { filename: '<endpoints.js as it used to be>', code: 'const WIDGETS = { timer: {} };' },
                { filename: '<widget/index.js as it used to be>', code: 'const { WIDGETS } = window.TRAKTEER_ENDPOINTS;' },
            ],
        }),
        (err) => isDuplicateDeclaration(err, 'WIDGETS'),
        'this is the exact error that emptied the Test alert form on the device',
    );
});

test('the harness shares scope across scripts, like classic <script src> tags does', () => {
    // A const from an earlier script must be visible to a later one; if this ever
    // stops holding, the duplicate-declaration tests above are meaningless.
    const pi = loadPropertyInspector('widget', {
        extraScripts: [{ filename: '<probe>', code: 'globalThis.__probe = typeof $endpoints;' }],
    });
    assert.equal(pi.context.__probe, 'object', 'a later script must see an earlier script\'s const');
});

// ── the symptom, asserted directly ───────────────────────────────────────────

test('testalert: the form is revealed and the Stream key row is filled', () => {
    const pi = loadPropertyInspector('testalert');
    const wrapper = pi.document.querySelector('.sdpi-wrapper');
    assert.equal(wrapper.style.display, 'none', 'the HTML ships hidden');

    // Replay action.js's first didReceiveSettings, legacy settings and all.
    pi.evaluate(`(() => {
        const payload = { settings: { media: 'youtube', tokenId: 'legacykey01', quantity: 3 } };
        $websocket = { saveData() {} };
        $settings = new Proxy(payload.settings, { get: (t, p) => t[p], set: (t, p, v) => { t[p] = v; return true; } });
        if (!$back) $dom.main.style.display = 'block';
        $propEvent.didReceiveSettings(payload);
    })()`);

    assert.equal(wrapper.style.display, 'block', 'the form must become visible');
    // This is the exact thing Sopian saw missing on the device.
    assert.notEqual(pi.document.getElementById('streamKey').value, '', 'Stream key must be populated');
    assert.equal(
        pi.document.getElementById('media').value,
        'media-share-youtube',
        'a legacy newtip media id must be migrated to the real route segment',
    );
    assert.equal(pi.document.getElementById('widgetType').value, 'alert-box');
    assert.equal(pi.document.getElementById('quantity').value, '3');
});

test('widget: the action list follows the selected widget and extras appear', () => {
    const pi = loadPropertyInspector('widget');
    pi.evaluate(`(() => {
        const payload = { settings: { widget: 'timer', action: 'add', amount: '30', streamKey: 'mockstreamkey01' } };
        $websocket = { saveData() {} };
        $settings = new Proxy(payload.settings, { get: (t, p) => t[p], set: (t, p, v) => { t[p] = v; return true; } });
        if (!$back) $dom.main.style.display = 'block';
        $propEvent.didReceiveSettings(payload);
    })()`);

    assert.equal(pi.document.getElementById('widget').value, 'timer');
    assert.equal(pi.document.getElementById('action').value, 'add');
    assert.notEqual(pi.document.getElementById('streamKey').value, '', 'Stream key must be populated');
    // `add` declares needs: ['amount'], so that row must be shown and `kind` hidden.
    assert.equal(pi.document.getElementById('row-amount').classList.contains('hidden'), false);
    assert.equal(pi.document.getElementById('row-kind').classList.contains('hidden'), true);
    assert.match(pi.document.getElementById('endpoint-hint').textContent, /^GET \/api\/overlay\/timer\/control$/);
});

test('widget: polling and milestone are selectable and list their own actions', () => {
    const pi = loadPropertyInspector('widget');
    pi.evaluate(`(() => {
        const payload = { settings: { widget: 'polling', action: 'show-results', streamKey: 'mockstreamkey01' } };
        $websocket = { saveData() {} };
        $settings = new Proxy(payload.settings, { get: (t, p) => t[p], set: (t, p, v) => { t[p] = v; return true; } });
        if (!$back) $dom.main.style.display = 'block';
        $propEvent.didReceiveSettings(payload);
    })()`);

    const optionValues = (id) => pi.document.getElementById(id).children.map((o) => o.value);

    assert.ok(optionValues('widget').includes('milestone'), 'milestone is offered as a widget');
    assert.ok(optionValues('widget').includes('polling'), 'polling is offered as a widget');
    assert.equal(pi.document.getElementById('widget').value, 'polling');
    assert.equal(pi.document.getElementById('action').value, 'show-results');
    assert.ok(optionValues('action').includes('hide-results'), 'polling lists its own result actions');
    // The endpoint hint is the path; `show-results` has no :action segment to expand.
    assert.match(pi.document.getElementById('endpoint-hint').textContent, /^GET \/api\/overlay\/polling\/control$/);
    // Neither polling nor milestone actions declare `needs`, so both extra rows stay hidden.
    assert.equal(pi.document.getElementById('row-amount').classList.contains('hidden'), true);
    assert.equal(pi.document.getElementById('row-kind').classList.contains('hidden'), true);
});

for (const page of PAGES) {
    test(`${page}: the icon select lists Auto, then every shipped icon, and restores a stored choice`, () => {
        const registry = require('../id.trakteer.streamdock.sdPlugin/plugin/lib/endpoints');
        const show = (settings) => `(() => {
            const payload = { settings: ${JSON.stringify(settings)} };
            $websocket = { saveData() {} };
            $settings = new Proxy(payload.settings, { get: (t, p) => t[p], set: (t, p, v) => { t[p] = v; return true; } });
            if (!$back) $dom.main.style.display = 'block';
            $propEvent.didReceiveSettings(payload);
        })()`;

        const stored = loadPropertyInspector(page);
        stored.evaluate(show({ icon: 'Star' }));
        const select = stored.document.getElementById('icon');
        assert.ok(select, `${page} has an icon select`);
        assert.equal(select.children[0].value, '', 'Auto comes first and means "follow the action"');
        assert.equal(select.children[0].textContent, 'Auto');
        assert.deepEqual(select.children.slice(1).map((o) => o.value), registry.iconNames());
        assert.equal(select.value, 'Star', 'a stored choice is shown');

        const fresh = loadPropertyInspector(page);
        fresh.evaluate(show({}));
        assert.equal(fresh.document.getElementById('icon').value, '', 'no stored choice means Auto');
    });
}

test('generic: the broadcast action list is populated', () => {
    const pi = loadPropertyInspector('generic');
    pi.evaluate(`(() => {
        const payload = { settings: { action: 'pause', tokenId: 'legacykey01' } };
        $websocket = { saveData() {} };
        $settings = new Proxy(payload.settings, { get: (t, p) => t[p], set: (t, p, v) => { t[p] = v; return true; } });
        if (!$back) $dom.main.style.display = 'block';
        $propEvent.didReceiveSettings(payload);
    })()`);

    assert.equal(pi.document.getElementById('action').value, 'pause');
    assert.notEqual(pi.document.getElementById('tokenId').value, '');
});

// ── keep the registry from leaking into the page scope again ─────────────────

test('endpoints.js exposes the registry only through a namespace', () => {
    const pi = loadPropertyInspector('generic');
    // Reachable through the namespace object...
    assert.equal(pi.evaluate('typeof window.TRAKTEER_ENDPOINTS.WIDGETS'), 'object');
    assert.equal(pi.evaluate('typeof window.TRAKTEER_ENDPOINTS.findAction'), 'function');
    // ...and NOT as a bare binding in the page's shared scope, which is what made a
    // PI script's own `const WIDGETS` fatal.
    for (const name of ['WIDGETS', 'TEST_ALERT_MEDIA', 'TEST_ALERT_WIDGET_TYPES', 'BROADCAST_ACTIONS', 'LEGACY_TEST_ALERT_MEDIA', 'findAction', 'resolveTestAlertMedia', 'widgetIds', 'registry',
        'ACTION_ICONS', 'EXTRA_ICONS', 'ICON_CHOICES', 'iconNames', 'resolveWidgetIcon', 'resolveBroadcastIcon', 'resolveTestAlertIcon']) {
        assert.equal(
            pi.evaluate(`typeof ${name}`),
            'undefined',
            `endpoints.js must not declare a page-scoped '${name}'`,
        );
    }
});

test('PI scripts never re-declare a registry export', () => {
    const exported = Object.keys(require('../id.trakteer.streamdock.sdPlugin/plugin/lib/endpoints'));
    assert.ok(exported.length >= 8, 'sanity: the registry should export its action lists and helpers');

    for (const page of PAGES) {
        const source = fs.readFileSync(path.join(PLUGIN_DIR, 'propertyInspector', page, 'index.js'), 'utf8');
        for (const name of exported) {
            // Only top-level declarations collide, and the PI files are flat, so an
            // unindented declaration is exactly the dangerous case.
            const declaration = new RegExp(`^(?:const|let|var|function|class)\\s+${name}\\b|^(?:const|let|var)\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`, 'm');
            assert.doesNotMatch(
                source,
                declaration,
                `propertyInspector/${page}/index.js declares '${name}', which endpoints.js also owns — use window.TRAKTEER_ENDPOINTS.${name} instead`,
            );
        }
    }
});

test('the Node plugin still requires the registry normally', () => {
    // The IIFE that fixed the PI leak must not have broken the CommonJS consumer.
    const registry = require('../id.trakteer.streamdock.sdPlugin/plugin/lib/endpoints');
    assert.equal(typeof registry.findAction, 'function');
    assert.equal(registry.findAction('timer', 'add').method, 'GET');
    assert.equal(registry.resolveTestAlertMedia('youtube'), 'media-share-youtube');
    assert.ok(registry.widgetIds().includes('alert-queue'));
    assert.ok(Array.isArray(registry.TEST_ALERT_MEDIA));
});
