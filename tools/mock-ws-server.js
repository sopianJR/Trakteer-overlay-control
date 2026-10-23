/**
 * Mock trakteer-ws control server.
 *
 * Reproduces the response behaviour the real server shows on the control routes,
 * read off /usr/src/trakteer-ws at commit 2393e7e:
 *
 *   POST /api/controls/:action   token format only, 404 room_not_found when the
 *                                room has no subscribers, 400 on a malformed token
 *                                or a non-JSON content type.
 *   widget endpoints             stream_key looked up against a fixed list →
 *                                401 invalid_stream_key, 400 missing_stream_key,
 *                                400 invalid_action for an action outside the whitelist.
 *   GET /api/overlay/alert-queue/test/:mediaType
 *                                stream_key looked up the same way, any media type
 *                                accepted, and 200 with the hydrated transient item
 *                                even when no overlay is listening.
 *
 * It exists so the plugin's request building can be exercised end to end without
 * touching production. Every received request is echoed on stdout as one JSON line
 * so tests can assert on exactly what the plugin sent.
 *
 * Usage: node tools/mock-ws-server.js [port]
 *   env MOCK_KNOWN_KEY    stream key / token treated as valid (default mockstreamkey01)
 *   env MOCK_ROOM_ONLINE  "0" to make every broadcast answer 404 room_not_found
 */

'use strict';

const http = require('node:http');
const { WIDGETS } = require('../id.trakteer.streamdock.sdPlugin/plugin/lib/endpoints');

const TOKEN_PATTERN = /^[a-zA-Z0-9_-]+$/;
const KNOWN_KEY = process.env.MOCK_KNOWN_KEY || 'mockstreamkey01';
const ROOM_ONLINE = process.env.MOCK_ROOM_ONLINE !== '0';

/** Flat lookup: path template → { widget, actions, send, keyFields, actionField } */
function buildRouteTable() {
    const routes = new Map();
    for (const [widgetId, widget] of Object.entries(WIDGETS)) {
        for (const action of widget.actions) {
            const key = `${action.method} ${action.path}`;
            if (!routes.has(key)) {
                routes.set(key, {
                    widget: widgetId,
                    method: action.method,
                    path: action.path,
                    send: action.send,
                    keyField: action.keyField,
                    actionField: action.actionField || null,
                    actions: new Set(),
                });
            }
            routes.get(key).actions.add(action.id);
        }
    }
    return routes;
}

const ROUTES = buildRouteTable();

function json(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

/**
 * Match an incoming pathname against the registry route templates.
 *
 * Static routes are tried before parameterised ones, which is how uWebSockets.js
 * resolves them on the real server: `/alert-queue/control/censor-text` is its own
 * registered route and must not be swallowed by `/alert-queue/control/:action`.
 */
function matchRoute(method, pathname) {
    const candidates = [...ROUTES.values()].filter((r) => r.method === method);

    for (const route of candidates) {
        if (!route.path.includes(':action') && route.path === pathname) {
            return { route, pathAction: null };
        }
    }

    for (const route of candidates) {
        if (!route.path.includes(':action')) continue;
        const prefix = route.path.replace(':action', '');
        if (pathname.startsWith(prefix)) {
            const tail = pathname.slice(prefix.length);
            if (tail && !tail.includes('/')) return { route, pathAction: decodeURIComponent(tail) };
        }
    }

    return null;
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const raw = await readBody(req);

    // One JSON line per request: the test harness reads these back.
    process.stdout.write(`${JSON.stringify({
        at: Date.now(),
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        contentType: req.headers['content-type'] || null,
        body: raw || null,
    })}\n`);

    // ── generic broadcast ────────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname.startsWith('/api/controls/')) {
        const action = decodeURIComponent(url.pathname.slice('/api/controls/'.length));
        if (!action) {
            json(res, 404, { error: 'not_found' });
            return;
        }
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('application/json')) {
            json(res, 400, { error: 'Content-Type must be application/json' });
            return;
        }
        let body;
        try {
            body = JSON.parse(raw);
        } catch {
            json(res, 400, { error: 'invalid_json' });
            return;
        }
        const token = body.token_id;
        if (typeof token !== 'string') {
            json(res, 400, { error: 'token must be a string' });
            return;
        }
        if (token.length < 8) {
            json(res, 400, { error: 'token too short (min 8)' });
            return;
        }
        if (token.length > 128) {
            json(res, 400, { error: 'token too long (max 128)' });
            return;
        }
        if (!TOKEN_PATTERN.test(token)) {
            json(res, 400, { error: 'token contains invalid characters' });
            return;
        }
        if (!ROOM_ONLINE || token !== KNOWN_KEY) {
            // Real server: format-valid token with no subscribed room → 404.
            json(res, 404, { error: 'room_not_found' });
            return;
        }
        json(res, 200, { success: true, type: action });
        return;
    }

    // ── per-widget endpoints ─────────────────────────────────────────────────
    const matched = matchRoute(req.method, url.pathname);
    if (!matched) {
        json(res, 404, { error: 'not_found' });
        return;
    }

    const { route, pathAction } = matched;
    let fields;
    if (route.send === 'query') {
        fields = Object.fromEntries(url.searchParams);
    } else {
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('application/json')) {
            json(res, 400, { error: 'Content-Type must be application/json' });
            return;
        }
        try {
            fields = JSON.parse(raw);
        } catch {
            json(res, 400, { error: 'invalid_json' });
            return;
        }
    }

    const streamKey = fields[route.keyField] || fields.stream_key || fields.token;
    if (!streamKey) {
        json(res, 400, { error: 'missing_stream_key' });
        return;
    }

    const action = pathAction || (route.actionField ? fields[route.actionField] : null);
    // Routes with no action at all (censor toggles) skip the whitelist check.
    // The test alert route also skips it: the real server takes any `:mediaType`
    // and falls back to a default payload, so whitelisting here would be stricter
    // than production and could hide a bad media id the server tolerates.
    const isTestRoute = url.pathname.startsWith('/api/overlay/alert-queue/test/');
    const needsAction = !isTestRoute && (route.path.includes(':action') || route.actionField);
    if (needsAction) {
        if (!action) {
            json(res, 400, { error: 'missing_action' });
            return;
        }
        if (!route.actions.has(action)) {
            json(res, 400, { error: `invalid_action: must be one of ${[...route.actions].join(', ')}` });
            return;
        }
    }

    if (streamKey !== KNOWN_KEY) {
        json(res, 401, { error: 'invalid_stream_key' });
        return;
    }

    // The test alert route answers with the hydrated transient item, not a widget
    // state blob (trakteer-ws src/api/overlay/get-alert-queue-test.js). It answers
    // 200 even when no overlay is subscribed — the publish is simply skipped — so a
    // 200 here does NOT prove an alert was shown. Mirrored faithfully, including
    // that asymmetry with the broadcast route's 404.
    if (url.pathname.startsWith('/api/overlay/alert-queue/test/')) {
        const mediaType = action;
        json(res, 200, {
            success: true,
            item: {
                id: `test-${mediaType}-${Date.now()}`,
                widget_type: fields.widget_type || 'alert-box',
                variant: 'test',
                source_type: 'tip',
                quantity: Number(fields.quantity || 10),
                status: 'playing',
            },
            mock_broadcast: ROOM_ONLINE,
        });
        return;
    }

    json(res, 200, { success: true, action: action || null, state: { widget: route.widget, mock: true } });
});

const port = Number(process.argv[2]) || 0;
server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    process.stderr.write(`mock-ws-server listening on http://127.0.0.1:${address.port}\n`);
});

module.exports = { server };
