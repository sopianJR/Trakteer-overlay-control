/**
 * Unit tests for button title wrapping.
 *
 * These exist because the vendored SDK's own wrapping is broken: in
 * SDNodeJsSDKV2 plugin/utils/plugin.js, setTitle(context, str, row, num) starts
 * its accumulator at `null` and concatenates onto it, so any wrapped title comes
 * back prefixed with the literal string "null" (observed live through the fake
 * host before this module took over wrapping). We wrap ourselves and never pass
 * a row argument to the SDK.
 *
 * Run: node --test test/
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { wrapTitle, TITLE_ROWS, TITLE_COLS } = require('../id.trakteer.streamdock.sdPlugin/plugin/lib/feedback');

test('short text is returned unchanged', () => {
    assert.equal(wrapTitle('OK'), 'OK');
    assert.equal(wrapTitle('Play'), 'Play');
});

test('no wrapped title is ever prefixed with "null"', () => {
    for (const input of ['OK', 'overlay offline', 'bad stream key', 'missing amount', 'ECONNREFUSED']) {
        assert.ok(!wrapTitle(input).startsWith('null'), `"${input}" came back as "${wrapTitle(input)}"`);
    }
});

test('text breaks on spaces, not mid-word', () => {
    assert.equal(wrapTitle('overlay offline'), 'overlay\noffline');
    assert.equal(wrapTitle('bad stream key'), 'bad\nstream\nkey');
});

test('a long single word is cut rather than dropped', () => {
    const wrapped = wrapTitle('ECONNREFUSEDLONGERSTILL');
    assert.ok(wrapped.length > 0);
    for (const line of wrapped.split('\n')) {
        assert.ok(line.length <= TITLE_COLS, `line "${line}" is ${line.length} chars`);
    }
});

test('output never exceeds the row budget', () => {
    const wrapped = wrapTitle('one two three four five six seven eight nine ten');
    assert.ok(wrapped.split('\n').length <= TITLE_ROWS);
    assert.ok(wrapped.endsWith('…'), `expected a truncation marker, got "${wrapped}"`);
});

test('empty and nullish input produce an empty title', () => {
    assert.equal(wrapTitle(''), '');
    assert.equal(wrapTitle('   '), '');
    assert.equal(wrapTitle(undefined), '');
    assert.equal(wrapTitle(null), '');
});

test('numbers are accepted', () => {
    assert.equal(wrapTitle(42), '42');
});
