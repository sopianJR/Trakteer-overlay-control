/**
 * Unit tests for request building — pure functions, no network.
 * Run: node --test test/
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    buildBroadcastRequest,
    buildWidgetRequest,
    validateTokenFormat,
    normalizeBaseUrl,
    describeFailure,
} = require('../id.trakteer.streamdock.sdPlugin/plugin/lib/trakteer-api');
const { WIDGETS, findAction } = require('../id.trakteer.streamdock.sdPlugin/plugin/lib/endpoints');

const TOKEN = 'mockstreamkey01';

test('token format mirrors the server rule', () => {
    assert.equal(validateTokenFormat(TOKEN).valid, true);
    assert.equal(validateTokenFormat('short').valid, false, '7 chars or fewer is rejected');
    assert.equal(validateTokenFormat('has space1').valid, false);
    assert.equal(validateTokenFormat('bad!chars1').valid, false);
    assert.equal(validateTokenFormat('a'.repeat(129)).valid, false);
    assert.equal(validateTokenFormat('a'.repeat(128)).valid, true);
    assert.equal(validateTokenFormat(undefined).valid, false);
});

test('base URL normalisation', () => {
    assert.equal(normalizeBaseUrl('https://ws.trakteer.id/'), 'https://ws.trakteer.id');
    assert.equal(normalizeBaseUrl('https://ws.trakteer.id///'), 'https://ws.trakteer.id');
    assert.equal(normalizeBaseUrl(''), 'https://ws.trakteer.id', 'empty falls back to production');
    assert.equal(normalizeBaseUrl('ws.trakteer.lab'), 'https://ws.trakteer.lab', 'scheme is added');
    assert.equal(normalizeBaseUrl('http://127.0.0.1:9123'), 'http://127.0.0.1:9123', 'http is kept');
});

test('broadcast request matches docs/stream-deck.md', () => {
    const built = buildBroadcastRequest({ baseUrl: 'https://ws.trakteer.id', action: 'next', tokenId: TOKEN });
    assert.equal(built.ok, true);
    assert.equal(built.request.method, 'POST');
    assert.equal(built.request.url, 'https://ws.trakteer.id/api/controls/next');
    assert.equal(built.request.headers['Content-Type'], 'application/json');
    assert.deepEqual(built.request.body, { token_id: TOKEN });
});

test('broadcast request carries the newtip payload', () => {
    const built = buildBroadcastRequest({
        baseUrl: 'https://ws.trakteer.id',
        action: 'newtip',
        tokenId: TOKEN,
        extraBody: { payload: { media: 'gif', quantity: 2 } },
    });
    assert.equal(built.ok, true);
    assert.deepEqual(built.request.body, { token_id: TOKEN, payload: { media: 'gif', quantity: 2 } });
});

test('broadcast request refuses a bad token before any I/O', () => {
    const built = buildBroadcastRequest({ baseUrl: '', action: 'play', tokenId: 'nope' });
    assert.equal(built.ok, false);
    assert.match(built.error, /too short/);
});

test('broadcast request refuses an empty action', () => {
    assert.equal(buildBroadcastRequest({ baseUrl: '', action: '', tokenId: TOKEN }).ok, false);
});

test('widget GET puts the action in the path and the key in the query', () => {
    const built = buildWidgetRequest({
        baseUrl: 'https://ws.trakteer.id',
        widget: 'alert-queue',
        action: 'next',
        streamKey: TOKEN,
    });
    assert.equal(built.ok, true);
    assert.equal(built.request.method, 'GET');
    assert.equal(built.request.url, `https://ws.trakteer.id/api/overlay/alert-queue/control/next?token=${TOKEN}`);
    assert.equal(built.request.body, null);
});

test('widget GET with a fixed action path sends no action segment', () => {
    const built = buildWidgetRequest({
        baseUrl: 'https://ws.trakteer.id',
        widget: 'alert-queue',
        action: 'censor-text',
        streamKey: TOKEN,
    });
    assert.equal(built.ok, true);
    assert.equal(built.request.url, `https://ws.trakteer.id/api/overlay/alert-queue/control/censor-text?token=${TOKEN}`);
});

test('widget GET with an action field puts it in the query', () => {
    const built = buildWidgetRequest({
        baseUrl: 'https://ws.trakteer.id',
        widget: 'timer',
        action: 'pause',
        streamKey: TOKEN,
    });
    assert.equal(built.ok, true);
    const url = new URL(built.request.url);
    assert.equal(url.pathname, '/api/overlay/timer/control');
    assert.equal(url.searchParams.get('stream_key'), TOKEN);
    assert.equal(url.searchParams.get('action'), 'pause');
});

test('widget POST sends a JSON body with the action field', () => {
    const built = buildWidgetRequest({
        baseUrl: 'https://ws.trakteer.id',
        widget: 'soundboard-queue',
        action: 'next',
        streamKey: TOKEN,
    });
    assert.equal(built.ok, true);
    assert.equal(built.request.method, 'POST');
    assert.equal(built.request.url, 'https://ws.trakteer.id/api/overlay/soundboard-queue/control');
    assert.deepEqual(built.request.body, { stream_key: TOKEN, action: 'next' });
});

test('widget extras are merged (qr-code widget_id)', () => {
    const built = buildWidgetRequest({
        baseUrl: 'https://ws.trakteer.id',
        widget: 'qr-code',
        action: 'toggle_hide',
        streamKey: TOKEN,
    });
    const url = new URL(built.request.url);
    assert.equal(url.searchParams.get('widget_id'), 'qr-code');
});

test('required extras are enforced', () => {
    const missing = buildWidgetRequest({ baseUrl: '', widget: 'timer', action: 'add', streamKey: TOKEN });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, 'missing amount');

    const supplied = buildWidgetRequest({
        baseUrl: '', widget: 'timer', action: 'add', streamKey: TOKEN, values: { amount: 60 },
    });
    assert.equal(supplied.ok, true);
    assert.equal(new URL(supplied.request.url).searchParams.get('amount'), '60');
});

test('activity test_event requires a kind', () => {
    assert.equal(buildWidgetRequest({ baseUrl: '', widget: 'activity', action: 'test_event', streamKey: TOKEN }).ok, false);
    const built = buildWidgetRequest({
        baseUrl: '', widget: 'activity', action: 'test_event', streamKey: TOKEN, values: { kind: 'support' },
    });
    assert.equal(built.ok, true);
    assert.equal(new URL(built.request.url).searchParams.get('kind'), 'support');
});

test('empty optional values are dropped, not sent blank', () => {
    const built = buildWidgetRequest({
        baseUrl: '', widget: 'goal', action: 'hide', streamKey: TOKEN, values: { amount: '', kind: '' },
    });
    const url = new URL(built.request.url);
    assert.equal(url.searchParams.has('amount'), false);
    assert.equal(url.searchParams.has('kind'), false);
});

test('unknown widget or action is rejected', () => {
    assert.equal(buildWidgetRequest({ baseUrl: '', widget: 'nope', action: 'play', streamKey: TOKEN }).ok, false);
    assert.equal(buildWidgetRequest({ baseUrl: '', widget: 'timer', action: 'explode', streamKey: TOKEN }).ok, false);
});

test('a bad stream key is rejected before any I/O', () => {
    const built = buildWidgetRequest({ baseUrl: '', widget: 'timer', action: 'pause', streamKey: 'x' });
    assert.equal(built.ok, false);
    assert.match(built.error, /stream key/);
});

test('every registry action builds a request', () => {
    for (const [widgetId, widget] of Object.entries(WIDGETS)) {
        for (const action of widget.actions) {
            const values = {};
            for (const need of action.needs || []) values[need] = need === 'amount' ? 10 : 'support';
            const built = buildWidgetRequest({
                baseUrl: 'https://ws.trakteer.id', widget: widgetId, action: action.id, streamKey: TOKEN, values,
            });
            assert.equal(built.ok, true, `${widgetId}/${action.id}: ${built.error}`);
            assert.doesNotThrow(() => new URL(built.request.url), `${widgetId}/${action.id} produced an invalid URL`);
        }
    }
});

test('registry descriptors are internally consistent', () => {
    for (const [widgetId, widget] of Object.entries(WIDGETS)) {
        assert.ok(widget.label, `${widgetId} has a label`);
        const ids = widget.actions.map((a) => a.id);
        assert.equal(new Set(ids).size, ids.length, `${widgetId} action ids are unique`);
        for (const action of widget.actions) {
            assert.ok(['GET', 'POST'].includes(action.method), `${widgetId}/${action.id} method`);
            assert.ok(['query', 'body'].includes(action.send), `${widgetId}/${action.id} send`);
            assert.ok(action.keyField, `${widgetId}/${action.id} keyField`);
            assert.ok(action.path.startsWith('/api/'), `${widgetId}/${action.id} path`);
            // The action must be addressable: either in the path or via a field.
            const addressable = action.path.includes(':action') || action.actionField || action.action === null;
            assert.ok(addressable, `${widgetId}/${action.id} has no way to carry its action`);
            assert.equal(findAction(widgetId, action.id), action);
        }
    }
});

test('failure descriptions map server errors to short button text', () => {
    assert.equal(describeFailure(404, { error: 'room_not_found' }), 'overlay offline');
    assert.equal(describeFailure(401, { error: 'invalid_stream_key' }), 'bad stream key');
    assert.equal(describeFailure(400, { error: 'missing_stream_key' }), 'missing_stream_key');
    assert.equal(describeFailure(413, {}), 'payload too large');
    assert.equal(describeFailure(500, {}), 'server error');
});

test('redactUrl hides credentials carried in the query string', () => {
    const { redactUrl } = require('../id.trakteer.streamdock.sdPlugin/plugin/lib/trakteer-api');

    const widget = buildWidgetRequest({
        baseUrl: 'https://ws.trakteer.id', widget: 'timer', action: 'pause', streamKey: TOKEN,
    });
    const safe = redactUrl(widget.request.url);
    assert.ok(!safe.includes(TOKEN), `token leaked into "${safe}"`);
    assert.match(safe, /stream_key=\*\*\*/);
    assert.match(safe, /action=pause/, 'non-sensitive params survive');
    assert.ok(!safe.startsWith('http'), 'the host is dropped');

    const alertQueue = buildWidgetRequest({
        baseUrl: 'https://ws.trakteer.id', widget: 'alert-queue', action: 'next', streamKey: TOKEN,
    });
    assert.ok(!redactUrl(alertQueue.request.url).includes(TOKEN), 'the "token" alias is redacted too');

    assert.equal(redactUrl('not a url'), '<unparseable url>');
});

test('redactUrl leaves a bodied request path intact', () => {
    const { redactUrl } = require('../id.trakteer.streamdock.sdPlugin/plugin/lib/trakteer-api');
    const built = buildBroadcastRequest({ baseUrl: 'https://ws.trakteer.id', action: 'next', tokenId: TOKEN });
    assert.equal(redactUrl(built.request.url), '/api/controls/next');
});
