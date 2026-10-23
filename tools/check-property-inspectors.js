/**
 * Reproduce / verify: load every Property Inspector page in a shared-scope browser
 * context and report whether its scripts load and wire up didReceiveSettings.
 *
 * This is the check that catches the class of bug `node --check` structurally cannot:
 * classic `<script src>` tags share one top-level lexical scope, so a `const` that
 * plugin/lib/endpoints.js declares and a PI index.js re-declares is a SyntaxError
 * that aborts the page and leaves the form stuck at `display: none`.
 *
 * Run from the repo root: node tools/check-property-inspectors.js
 * Exit 0 = every PI page loads clean.
 */

'use strict';

const { loadPropertyInspector, propertyInspectorPages } = require('../test/helpers/pi-dom');

/** Settings a real button would have, including legacy keys worth exercising. */
const SAMPLE_SETTINGS = {
    testalert: { media: 'youtube', tokenId: 'legacykey01', quantity: 3 },
    widget: { widget: 'timer', action: 'add', amount: '30', streamKey: 'mockstreamkey01' },
    generic: { action: 'pause', tokenId: 'legacykey01' },
};

/**
 * Fields that must come back non-empty for the given settings.
 *
 * `label` is deliberately absent everywhere: it is optional and defaults to ''.
 * This list is what makes the check assert the *symptom* Sopian saw (an empty
 * Stream key row) and not merely the absence of a SyntaxError.
 */
const REQUIRED_FIELDS = {
    testalert: ['media', 'widgetType', 'quantity', 'streamKey', 'baseUrl'],
    widget: ['widget', 'action', 'amount', 'streamKey', 'baseUrl'],
    generic: ['action', 'tokenId', 'baseUrl'],
};

let failures = 0;

for (const page of propertyInspectorPages()) {
    console.log(`\n=== propertyInspector/${page} ===`);

    let pi;
    try {
        pi = loadPropertyInspector(page);
    } catch (err) {
        failures++;
        console.log(`  LOAD FAILED  ${err.name}: ${err.message}`);
        const frame = String(err.stack || '').split('\n').find((l) => l.includes('.js:'));
        if (frame) console.log(`  at           ${frame.trim()}`);
        continue;
    }

    console.log(`  scripts      ${pi.loaded.join(' -> ')}`);

    // $propEvent / $back are lexical consts, so they must be read inside the page scope.
    const handlers = pi.evaluate('typeof $propEvent === "object" && $propEvent ? Object.keys($propEvent) : []');
    const back = pi.evaluate('typeof $back === "undefined" ? "(undeclared)" : String($back)');
    const wrapper = pi.document.querySelector('.sdpi-wrapper');
    const ids = pi.document.elements.filter((e) => e.id).map((e) => e.id);

    console.log(`  $propEvent   ${handlers.length ? handlers.join(', ') : '(undefined)'}`);
    console.log(`  $back        ${back}`);
    console.log(`  form ids     ${ids.join(', ')}`);
    console.log(`  wrapper      display=${JSON.stringify(wrapper.style.display)} (before any event)`);

    const installed = pi.evaluate('typeof $propEvent?.didReceiveSettings === "function"');
    if (!installed) {
        failures++;
        console.log('  FAIL         didReceiveSettings is not installed');
        continue;
    }

    // Replay what action.js's onmessage does for the host's first didReceiveSettings:
    // build the $settings proxy, reveal the form, then dispatch to $propEvent.
    const settings = SAMPLE_SETTINGS[page] || {};
    try {
        pi.evaluate(`(() => {
            const payload = { settings: ${JSON.stringify(settings)} };
            $websocket = { saveData() {} };
            $settings = new Proxy(payload.settings, {
                get: (t, p) => t[p],
                set: (t, p, v) => { t[p] = v; return true; },
            });
            if (!$back) $dom.main.style.display = 'block';
            $propEvent.didReceiveSettings(payload);
        })()`);
    } catch (err) {
        failures++;
        console.log(`  FAIL         didReceiveSettings threw ${err.name}: ${err.message}`);
        continue;
    }

    const filled = Object.fromEntries(
        pi.document.elements
            .filter((e) => e.id && ['INPUT', 'SELECT'].includes(e.tagName))
            // Never print credential-ish values; report only whether the field got filled.
            .map((e) => [e.id, /key|token/i.test(e.id) ? (e.value ? '<set>' : '<empty>') : e.value]),
    );
    console.log(`  wrapper      display=${JSON.stringify(wrapper.style.display)} (after didReceiveSettings)`);
    console.log(`  fields       ${JSON.stringify(filled)}`);

    const required = REQUIRED_FIELDS[page] || [];
    const emptyFields = required.filter((id) => {
        const value = filled[id];
        return value === undefined || value === '' || value === '<empty>';
    });
    if (emptyFields.length) {
        failures++;
        console.log(`  FAIL         required field(s) left empty: ${emptyFields.join(', ')}`);
        continue;
    }
    if (wrapper.style.display !== 'block') {
        failures++;
        console.log('  FAIL         form was never revealed');
        continue;
    }
    console.log(`  OK           page loads, form revealed, required fields filled (${required.join(', ')})`);
}

console.log(failures ? `\n${failures} Property Inspector page(s) failed` : '\nall Property Inspector pages load clean');
process.exit(failures ? 1 : 0);
