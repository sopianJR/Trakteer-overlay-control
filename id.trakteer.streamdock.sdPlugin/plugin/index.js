/**
 * Trakteer StreamDock plugin — entry point.
 *
 * Three actions:
 *   generic   — POST /api/controls/:action with token_id (play/pause/next/censor…)
 *   testalert — GET /api/overlay/alert-queue/test/:mediaType with a stream key
 *   widget    — the per-widget control endpoints (stream_key based)
 *
 * All request building lives in lib/; this file only wires StreamDock events to it.
 * Each key also shows a Phosphor icon (lib/endpoints.js picks the name, lib/icons.js
 * supplies the PNG), set when the key appears and when its icon setting changes.
 * Credentials are read from each action's own settings and never written to disk
 * by this plugin.
 */

'use strict';

const { Plugins, Actions, log } = require('./utils/plugin');
const { DEFAULT_BASE_URL, buildBroadcastRequest, buildWidgetRequest, buildTestAlertRequest, sendRequest, redactUrl } = require('./lib/trakteer-api');
const { findAction, resolveWidgetIcon, resolveBroadcastIcon, resolveTestAlertIcon } = require('./lib/endpoints');
const { iconDataUri } = require('./lib/icons');
const { reportResult, clearTimer, setTitle } = require('./lib/feedback');

const plugin = new Plugins('trakteer');

/** Resting label for a button: the user's own title wins, else the action id. */
function restingLabel(settings, fallback) {
    const custom = (settings && settings.label) || '';
    return custom || fallback || '';
}

/** Icon last sent to each key, so editing a label in the Property Inspector does not resend the image. */
const shownIcon = new Map();

/**
 * Put an icon on a key.
 * @param {string} context action context
 * @param {string|null} name Phosphor icon name from one of the registry's resolve*Icon
 * @param {boolean} force send even when the key already shows it (a key that has just appeared)
 */
function applyIcon(context, name, force) {
    if (!force && shownIcon.get(context) === name) return;
    const uri = iconDataUri(name);
    if (!uri) {
        // Keep the manifest image rather than blank the key.
        log.warn('icon-missing', { icon: name });
        return;
    }
    shownIcon.set(context, name);
    plugin.setImage(context, uri);
}

/** Shared press handler: build → send → report. */
async function press({ context, settings, build, label }) {
    const built = build();
    if (!built.ok) {
        log.error('build-failed', { error: built.error });
        reportResult(plugin, context, { ok: false, error: built.error }, label);
        return;
    }

    const result = await sendRequest(built.request, {
        timeoutMs: Number(settings.timeoutMs) || undefined,
    });

    // Log the verdict, never the credentials: redactUrl strips the token/stream_key
    // values that per-widget endpoints carry in the query string.
    log.info('control-request', {
        method: built.request.method,
        path: redactUrl(built.request.url),
        status: result.status,
        ok: result.ok,
        error: result.error,
    });

    reportResult(plugin, context, result, label);
}

// ── Action: generic broadcast ────────────────────────────────────────────────
plugin.generic = new Actions({
    default: { baseUrl: DEFAULT_BASE_URL, action: 'next', tokenId: '', label: '', icon: '' },
    _willAppear({ context }) {
        const settings = plugin.generic.data[context] || {};
        setTitle(plugin, context, restingLabel(settings, settings.action));
        applyIcon(context, resolveBroadcastIcon(settings.action, settings.icon), true);
    },
    _didReceiveSettings({ context }) {
        const settings = plugin.generic.data[context] || {};
        setTitle(plugin, context, restingLabel(settings, settings.action));
        applyIcon(context, resolveBroadcastIcon(settings.action, settings.icon), false);
    },
    _willDisappear({ context }) {
        clearTimer(context);
        shownIcon.delete(context);
    },
    keyUp({ context }) {
        const settings = plugin.generic.data[context] || {};
        const label = restingLabel(settings, settings.action);
        press({
            context,
            settings,
            label,
            build: () => buildBroadcastRequest({
                baseUrl: settings.baseUrl,
                action: settings.action,
                tokenId: settings.tokenId,
            }),
        });
    },
});

// ── Action: test alert ───────────────────────────────────────────────────────
// GET /api/overlay/alert-queue/test/:mediaType?token=<stream key> — the route the
// dashboard's own test buttons use. The previous POST /api/controls/newtip answered
// 200 but published a `newtip` type no overlay build handles, so nothing appeared
// in OBS. `streamKey` is preferred; `tokenId` is still read so buttons configured
// before this change keep working without being reconfigured.
plugin.testalert = new Actions({
    default: { baseUrl: DEFAULT_BASE_URL, media: 'notification', quantity: 1, streamKey: '', widgetType: 'alert-box', label: 'Test', icon: '' },
    _willAppear({ context }) {
        const settings = plugin.testalert.data[context] || {};
        setTitle(plugin, context, restingLabel(settings, 'Test'));
        applyIcon(context, resolveTestAlertIcon(settings.media, settings.icon), true);
    },
    _didReceiveSettings({ context }) {
        const settings = plugin.testalert.data[context] || {};
        setTitle(plugin, context, restingLabel(settings, 'Test'));
        applyIcon(context, resolveTestAlertIcon(settings.media, settings.icon), false);
    },
    _willDisappear({ context }) {
        clearTimer(context);
        shownIcon.delete(context);
    },
    keyUp({ context }) {
        const settings = plugin.testalert.data[context] || {};
        const label = restingLabel(settings, 'Test');
        const quantity = Math.max(1, parseInt(settings.quantity, 10) || 1);
        press({
            context,
            settings,
            label,
            build: () => buildTestAlertRequest({
                baseUrl: settings.baseUrl,
                media: settings.media,
                streamKey: settings.streamKey || settings.tokenId,
                quantity,
                widgetType: settings.widgetType,
            }),
        });
    },
});

// ── Action: per-widget control ───────────────────────────────────────────────
plugin.widget = new Actions({
    default: { baseUrl: DEFAULT_BASE_URL, widget: 'alert-queue', action: 'play', streamKey: '', amount: '', kind: '', label: '', icon: '' },
    _willAppear({ context }) {
        const settings = plugin.widget.data[context] || {};
        setTitle(plugin, context, widgetLabel(settings));
        applyIcon(context, resolveWidgetIcon(settings.widget, settings.action, settings.icon), true);
    },
    _didReceiveSettings({ context }) {
        const settings = plugin.widget.data[context] || {};
        setTitle(plugin, context, widgetLabel(settings));
        applyIcon(context, resolveWidgetIcon(settings.widget, settings.action, settings.icon), false);
    },
    _willDisappear({ context }) {
        clearTimer(context);
        shownIcon.delete(context);
    },
    keyUp({ context }) {
        const settings = plugin.widget.data[context] || {};
        const label = widgetLabel(settings);
        press({
            context,
            settings,
            label,
            build: () => buildWidgetRequest({
                baseUrl: settings.baseUrl,
                widget: settings.widget,
                action: settings.action,
                streamKey: settings.streamKey,
                values: { amount: settings.amount, kind: settings.kind },
            }),
        });
    },
});

/** Prefer the user's label, else the registry label, else the raw action id. */
function widgetLabel(settings) {
    if (settings.label) return settings.label;
    const descriptor = findAction(settings.widget, settings.action);
    return (descriptor && descriptor.label) || settings.action || '';
}

module.exports = { plugin };
