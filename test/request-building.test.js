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
    buildTestAlertRequest,
    validateTokenFormat,
    normalizeBaseUrl,
    describeFailure,
} = require('../id.trakteer.streamdock.sdPlugin/plugin/lib/trakteer-api');
const {
    WIDGETS,
    findAction,
    TEST_ALERT_MEDIA,
    resolveTestAlertMedia,
} = require('../id.trakteer.streamdock.sdPlugin/plugin/lib/endpoints');

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

// ── Test alert ──────────────────────────────────────────────────────────────
// The alert only appears in OBS via GET /api/overlay/alert-queue/test/:mediaType;
// POST /api/controls/newtip answers 200 but publishes a type no overlay handles.

test('test alert hits the alert-queue test route with the key as ?token=', () => {
    const built = buildTestAlertRequest({
        baseUrl: 'https://ws.trakteer.id',
        media: 'notification',
        streamKey: TOKEN,
        quantity: 3,
    });
    assert.equal(built.ok, true);
    assert.equal(built.request.method, 'GET');
    assert.equal(built.request.body, null, 'GET carries no body');

    const url = new URL(built.request.url);
    assert.equal(url.pathname, '/api/overlay/alert-queue/test/notification');
    assert.equal(url.searchParams.get('token'), TOKEN);
    assert.equal(url.searchParams.get('quantity'), '3');
    assert.equal(url.searchParams.get('widget_type'), 'alert-box', 'alert box is the default target');
    assert.equal(url.searchParams.has('token_id'), false, 'this route reads token, not token_id');
});

test('test alert media ids are the server path segments', () => {
    for (const media of TEST_ALERT_MEDIA) {
        const built = buildTestAlertRequest({ baseUrl: '', media: media.id, streamKey: TOKEN });
        assert.equal(built.ok, true, `${media.id}: ${built.error}`);
        assert.equal(
            new URL(built.request.url).pathname,
            `/api/overlay/alert-queue/test/${media.id}`,
        );
    }
});

test('legacy newtip media ids are translated, not rejected', () => {
    assert.equal(resolveTestAlertMedia('null'), 'notification');
    assert.equal(resolveTestAlertMedia(null), 'notification');
    assert.equal(resolveTestAlertMedia(undefined), 'notification');
    assert.equal(resolveTestAlertMedia(''), 'notification');
    assert.equal(resolveTestAlertMedia('youtube'), 'media-share-youtube');
    assert.equal(resolveTestAlertMedia('tiktok'), 'media-share-tiktok');
    assert.equal(resolveTestAlertMedia('voice'), 'voice-note');
    assert.equal(resolveTestAlertMedia('image'), 'gambar');
    assert.equal(resolveTestAlertMedia('gif'), 'gif', 'already valid, passes through');
    assert.equal(resolveTestAlertMedia('nonsense'), 'notification', 'unknown degrades to text');

    const built = buildTestAlertRequest({ baseUrl: '', media: 'youtube', streamKey: TOKEN });
    assert.equal(
        new URL(built.request.url).pathname,
        '/api/overlay/alert-queue/test/media-share-youtube',
    );
});

test('test alert can target the media-share queue', () => {
    const built = buildTestAlertRequest({
        baseUrl: '', media: 'media-share-tiktok', streamKey: TOKEN, widgetType: 'media-share',
    });
    assert.equal(new URL(built.request.url).searchParams.get('widget_type'), 'media-share');
});

test('test alert omits quantity when none is given', () => {
    const built = buildTestAlertRequest({ baseUrl: '', media: 'gif', streamKey: TOKEN });
    assert.equal(new URL(built.request.url).searchParams.has('quantity'), false);
});

test('test alert refuses a bad stream key before any I/O', () => {
    const built = buildTestAlertRequest({ baseUrl: '', media: 'gif', streamKey: 'x' });
    assert.equal(built.ok, false);
    assert.match(built.error, /stream key/);
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
            // An explicit wire action is a non-empty string, or null for "no action".
            const wireOk = action.action === undefined
                || action.action === null
                || (typeof action.action === 'string' && action.action !== '');
            assert.ok(wireOk, `${widgetId}/${action.id} action override must be a non-empty string or null`);
            assert.equal(findAction(widgetId, action.id), action);
        }
    }
});

test('no two actions of a widget send the same request', () => {
    // Guards the shared-server-action pairs (milestone hide/show): a typo in `item`
    // or `action` would make two buttons do the same thing.
    for (const [widgetId, widget] of Object.entries(WIDGETS)) {
        const seen = new Map();
        for (const action of widget.actions) {
            const values = {};
            for (const need of action.needs || []) values[need] = need === 'amount' ? 10 : 'support';
            const built = buildWidgetRequest({
                baseUrl: 'https://ws.trakteer.id', widget: widgetId, action: action.id, streamKey: TOKEN, values,
            });
            const signature = `${built.request.method} ${built.request.url} ${JSON.stringify(built.request.body)}`;
            assert.equal(
                seen.has(signature),
                false,
                `${widgetId}/${action.id} sends the same request as ${widgetId}/${seen.get(signature)}`,
            );
            seen.set(signature, action.id);
        }
    }
});

test('milestone: show and hide share the server action `hide`, told apart by item', () => {
    const query = (action) => {
        const built = buildWidgetRequest({ baseUrl: '', widget: 'milestone', action, streamKey: TOKEN });
        assert.equal(built.ok, true, `${action}: ${built.error}`);
        const url = new URL(built.request.url);
        assert.equal(built.request.method, 'GET');
        assert.equal(url.pathname, '/api/overlay/milestone/control');
        assert.equal(url.searchParams.get('stream_key'), TOKEN);
        assert.equal(url.searchParams.has('token'), false, 'this route reads stream_key only');
        return Object.fromEntries(url.searchParams);
    };

    assert.deepEqual(query('hide'), { stream_key: TOKEN, item: 'true', action: 'hide' });
    assert.deepEqual(query('show'), { stream_key: TOKEN, item: 'false', action: 'hide' });
    assert.deepEqual(query('flash-on'), { stream_key: TOKEN, item: 'true', action: 'flash' });
    assert.deepEqual(query('flash-off'), { stream_key: TOKEN, item: 'false', action: 'flash' });
    assert.deepEqual(query('restart'), { stream_key: TOKEN, item: 'false', action: 'restart' });
});

test('polling: result visibility sends the string the overlay compares against', () => {
    const query = (action) => {
        const built = buildWidgetRequest({ baseUrl: '', widget: 'polling', action, streamKey: TOKEN });
        assert.equal(built.ok, true, `${action}: ${built.error}`);
        const url = new URL(built.request.url);
        assert.equal(url.pathname, '/api/overlay/polling/control');
        return Object.fromEntries(url.searchParams);
    };

    // The overlay only tests `=== 'hidden'`; anything else shows the results.
    assert.deepEqual(query('hide-results'), { stream_key: TOKEN, item: 'hidden', action: 'result_visibility' });
    assert.deepEqual(query('show-results'), { stream_key: TOKEN, item: 'immediate', action: 'result_visibility' });
    assert.deepEqual(query('refetch'), { stream_key: TOKEN, item: 'true', action: 'refetch' });
    assert.deepEqual(query('show'), { stream_key: TOKEN, item: 'false', action: 'hide' });
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
