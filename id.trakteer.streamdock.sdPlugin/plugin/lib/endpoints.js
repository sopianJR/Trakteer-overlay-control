/**
 * Registry of trakteer-ws control endpoints.
 *
 * Data only — no I/O. Derived from reading the trakteer-ws source at commit 2393e7e:
 *   src/api/controls/post-action.js
 *   src/api/overlay/*.js
 *   src/widgets/*.js
 * See docs/endpoint-map.md for the full table and the evidence behind it.
 *
 * Two classes of endpoint, deliberately kept apart:
 *
 *   class "broadcast" — POST /api/controls/:action, body { token_id }.
 *       The server does NOT whitelist the action; it only checks the token format
 *       and that the room has subscribers, then republishes the action as `type`.
 *
 *   class "widget" — per-widget endpoints keyed on stream_key. The server looks the
 *       stream key up in the database, validates the action against a whitelist,
 *       persists widget state and then publishes.
 */

'use strict';

// Everything below lives inside this IIFE on purpose.
//
// The Property Inspector loads this file as a classic `<script src>`, and classic
// scripts all share ONE top-level lexical scope. Declaring `const WIDGETS` at the
// top level therefore reserved that name for the whole PI page: any other script on
// the page that declared it too made V8 abort the page with
// "SyntaxError: Identifier 'WIDGETS' has already been declared", which silently left
// the PI form stuck at `display: none`. Scoping the bodies here means the registry is
// reachable only through `module.exports` / `window.TRAKTEER_ENDPOINTS`, so no PI
// script can ever collide with it again.
//
// Body indentation is left as-is to keep this a scoping change and nothing else.
(function () {
/** Actions documented for the generic broadcast endpoint (docs/stream-deck.md). */
const BROADCAST_ACTIONS = [
    { id: 'play', label: 'Play' },
    { id: 'pause', label: 'Pause' },
    { id: 'next', label: 'Next' },
    { id: 'censor-text-alert', label: 'Censor text' },
    { id: 'censor-media-share', label: 'Censor media' },
];

/**
 * Media types for the real test alert route, `GET /api/overlay/alert-queue/test/:mediaType`.
 *
 * These ids ARE the path segment, so they must match the server's
 * `normalizeMediaType` / `DEFAULT_MEDIA_PAYLOAD` keys in
 * trakteer-ws `src/api/overlay/get-alert-queue-test.js` and the list the dashboard
 * itself offers in trakteer-overslay `src/constants/apiCatalog.js`.
 *
 * The earlier `POST /api/controls/newtip` media ids (`null`, `youtube`, …) are NOT
 * these: that endpoint only rebroadcast a `newtip` type no overlay build listens
 * for. `LEGACY_TEST_ALERT_MEDIA` below translates settings saved by that version.
 */
const TEST_ALERT_MEDIA = [
    { id: 'notification', label: 'Text only' },
    { id: 'tts', label: 'TTS' },
    { id: 'media-share-youtube', label: 'YouTube' },
    { id: 'media-share-tiktok', label: 'TikTok' },
    { id: 'media-share-instagram', label: 'Instagram reel' },
    { id: 'voice-note', label: 'Voice note' },
    { id: 'gambar', label: 'Image' },
    { id: 'gif', label: 'GIF' },
];

/** Old newtip media id → its equivalent on the real test route. */
const LEGACY_TEST_ALERT_MEDIA = {
    null: 'notification',
    '': 'notification',
    text: 'notification',
    youtube: 'media-share-youtube',
    tiktok: 'media-share-tiktok',
    instagram: 'media-share-instagram',
    voice: 'voice-note',
    image: 'gambar',
    gif: 'gif',
};

/**
 * Coerce a stored `media` setting to a media type the server route accepts.
 *
 * Buttons configured against the old newtip action keep working: their media id is
 * translated rather than rejected. Anything unrecognised becomes a text
 * notification, which is the one type that needs no media payload.
 *
 * @param {string|null|undefined} media
 * @returns {string} a media type id present in TEST_ALERT_MEDIA
 */
function resolveTestAlertMedia(media) {
    const raw = media === null || media === undefined ? '' : String(media);
    if (TEST_ALERT_MEDIA.some((m) => m.id === raw)) return raw;
    return LEGACY_TEST_ALERT_MEDIA[raw] || 'notification';
}

/** Queues the test route can aim at (server: resolveQueueWidgetType). */
const TEST_ALERT_WIDGET_TYPES = [
    { id: 'alert-box', label: 'Alert box' },
    { id: 'media-share', label: 'Media share' },
];

/**
 * Per-widget control endpoints.
 *
 * Each action describes exactly how to build the request:
 *   method    'GET' | 'POST'
 *   path      literal path, or a path with ":action" substituted from `action`
 *   send      'query' | 'body' — where stream_key and the extras go
 *   keyField  name the endpoint uses for the stream key
 *   action    value put in the path or in the action field; defaults to `id`. Set it
 *             when several buttons share one server action (milestone show/hide are
 *             both `hide`); null when the endpoint takes no action at all (e.g.
 *             goal/update-adjustment)
 *   actionField  field name for the action when it is not in the path
 *   extras    fixed extra fields merged into query/body
 *   needs     user-supplied fields this action requires, declared so the Property
 *             Inspector can ask for them and the plugin can refuse early
 *
 * `free_action: true` on a widget means the server accepts any non-empty action
 * string (milestone, polling); the listed ones are what the code publishes.
 */
const WIDGETS = {
    'alert-queue': {
        label: 'Alert box / queue',
        actions: [
            { id: 'play', label: 'Play', method: 'GET', path: '/api/overlay/alert-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'pause', label: 'Pause', method: 'GET', path: '/api/overlay/alert-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'next', label: 'Next', method: 'GET', path: '/api/overlay/alert-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'prev', label: 'Previous', method: 'GET', path: '/api/overlay/alert-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'hold', label: 'Hold', method: 'GET', path: '/api/overlay/alert-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'resume', label: 'Resume', method: 'GET', path: '/api/overlay/alert-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'autoplay', label: 'Toggle autoplay', method: 'GET', path: '/api/overlay/alert-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'restart', label: 'Restart widget', method: 'GET', path: '/api/overlay/alert-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'clear', label: 'Clear queue', method: 'GET', path: '/api/overlay/alert-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'censor-text', label: 'Toggle censor text', method: 'GET', path: '/api/overlay/alert-queue/control/censor-text', send: 'query', keyField: 'token', action: null },
            { id: 'censor-media', label: 'Toggle censor media', method: 'GET', path: '/api/overlay/alert-queue/control/censor-media', send: 'query', keyField: 'token', action: null },
            // Test alerts. One action per media type because the media type is the
            // path segment, exactly as the dashboard's own Stream Deck URLs do it.
            ...TEST_ALERT_MEDIA.map((media) => ({
                id: media.id,
                label: `Test: ${media.label}`,
                method: 'GET',
                path: '/api/overlay/alert-queue/test/:action',
                send: 'query',
                keyField: 'token',
                extras: { widget_type: 'alert-box' },
            })),
        ],
    },
    soundboard: {
        label: 'Soundboard (overlay)',
        actions: [
            { id: 'toggle_hide', label: 'Toggle hide', method: 'GET', path: '/api/overlay/soundboard/control/:action', send: 'query', keyField: 'token' },
            { id: 'restart', label: 'Restart widget', method: 'GET', path: '/api/overlay/soundboard/control/:action', send: 'query', keyField: 'token' },
        ],
    },
    'soundboard-queue': {
        label: 'Soundboard queue',
        actions: [
            { id: 'play', label: 'Play', method: 'POST', path: '/api/overlay/soundboard-queue/control', send: 'body', keyField: 'stream_key', actionField: 'action' },
            { id: 'pause', label: 'Pause', method: 'POST', path: '/api/overlay/soundboard-queue/control', send: 'body', keyField: 'stream_key', actionField: 'action' },
            { id: 'next', label: 'Next', method: 'POST', path: '/api/overlay/soundboard-queue/control', send: 'body', keyField: 'stream_key', actionField: 'action' },
            { id: 'prev', label: 'Previous', method: 'POST', path: '/api/overlay/soundboard-queue/control', send: 'body', keyField: 'stream_key', actionField: 'action' },
            { id: 'hold', label: 'Hold', method: 'POST', path: '/api/overlay/soundboard-queue/control', send: 'body', keyField: 'stream_key', actionField: 'action' },
            { id: 'resume', label: 'Resume', method: 'POST', path: '/api/overlay/soundboard-queue/control', send: 'body', keyField: 'stream_key', actionField: 'action' },
            { id: 'clear', label: 'Clear queue', method: 'POST', path: '/api/overlay/soundboard-queue/control', send: 'body', keyField: 'stream_key', actionField: 'action' },
        ],
    },
    'musicbox-queue': {
        label: 'Musicbox queue',
        actions: [
            { id: 'play', label: 'Play', method: 'GET', path: '/api/overlay/musicbox-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'pause', label: 'Pause', method: 'GET', path: '/api/overlay/musicbox-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'next', label: 'Next', method: 'GET', path: '/api/overlay/musicbox-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'prev', label: 'Previous', method: 'GET', path: '/api/overlay/musicbox-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'hold', label: 'Hold', method: 'GET', path: '/api/overlay/musicbox-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'resume', label: 'Resume', method: 'GET', path: '/api/overlay/musicbox-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'restart', label: 'Restart widget', method: 'GET', path: '/api/overlay/musicbox-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'clear', label: 'Clear queue', method: 'GET', path: '/api/overlay/musicbox-queue/control/:action', send: 'query', keyField: 'token' },
        ],
    },
    'mabar-queue': {
        label: 'Mabar queue',
        actions: [
            { id: 'lock', label: 'Lock', method: 'GET', path: '/api/overlay/mabar-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'unlock', label: 'Unlock', method: 'GET', path: '/api/overlay/mabar-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'move_all_to_queue', label: 'Move all to queue', method: 'GET', path: '/api/overlay/mabar-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'complete_all_lobby', label: 'Complete all in lobby', method: 'GET', path: '/api/overlay/mabar-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'remove_all_queued', label: 'Remove all queued', method: 'GET', path: '/api/overlay/mabar-queue/control/:action', send: 'query', keyField: 'token' },
            { id: 'widget_reset', label: 'Reset widget', method: 'GET', path: '/api/overlay/mabar-queue/control/:action', send: 'query', keyField: 'token' },
        ],
    },
    'qr-code': {
        label: 'QR code',
        actions: [
            { id: 'toggle_hide', label: 'Toggle hide', method: 'GET', path: '/api/overlay/qr-code/control/:action', send: 'query', keyField: 'token', extras: { widget_id: 'qr-code' } },
            { id: 'toggle_open_close', label: 'Toggle open/close', method: 'GET', path: '/api/overlay/qr-code/control/:action', send: 'query', keyField: 'token', extras: { widget_id: 'qr-code' } },
            { id: 'toggle_flash', label: 'Toggle flash', method: 'GET', path: '/api/overlay/qr-code/control/:action', send: 'query', keyField: 'token', extras: { widget_id: 'qr-code' } },
            { id: 'restart', label: 'Restart widget', method: 'GET', path: '/api/overlay/qr-code/control/:action', send: 'query', keyField: 'token', extras: { widget_id: 'qr-code' } },
        ],
    },
    activity: {
        label: 'Activity feed',
        actions: [
            { id: 'toggle_pause', label: 'Toggle pause', method: 'GET', path: '/api/overlay/activity/control/:action', send: 'query', keyField: 'token', extras: { widget_id: 'activity' } },
            { id: 'toggle_hide', label: 'Toggle hide', method: 'GET', path: '/api/overlay/activity/control/:action', send: 'query', keyField: 'token', extras: { widget_id: 'activity' } },
            { id: 'scroll_up', label: 'Scroll up', method: 'GET', path: '/api/overlay/activity/control/:action', send: 'query', keyField: 'token', extras: { widget_id: 'activity' } },
            { id: 'scroll_down', label: 'Scroll down', method: 'GET', path: '/api/overlay/activity/control/:action', send: 'query', keyField: 'token', extras: { widget_id: 'activity' } },
            { id: 'reset_scroll', label: 'Reset scroll', method: 'GET', path: '/api/overlay/activity/control/:action', send: 'query', keyField: 'token', extras: { widget_id: 'activity' } },
            { id: 'clear_activity', label: 'Clear activity', method: 'GET', path: '/api/overlay/activity/control/:action', send: 'query', keyField: 'token', extras: { widget_id: 'activity' } },
            { id: 'restart', label: 'Restart widget', method: 'GET', path: '/api/overlay/activity/control/:action', send: 'query', keyField: 'token', extras: { widget_id: 'activity' } },
            { id: 'test_event', label: 'Test event (needs kind)', method: 'GET', path: '/api/overlay/activity/control/:action', send: 'query', keyField: 'token', extras: { widget_id: 'activity' }, needs: ['kind'] },
        ],
    },
    timer: {
        label: 'Timer',
        actions: [
            { id: 'pause', label: 'Pause', method: 'GET', path: '/api/overlay/timer/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'resume', label: 'Resume', method: 'GET', path: '/api/overlay/timer/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'hide', label: 'Hide', method: 'GET', path: '/api/overlay/timer/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'show', label: 'Show', method: 'GET', path: '/api/overlay/timer/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'flash', label: 'Flash', method: 'GET', path: '/api/overlay/timer/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'unflash', label: 'Unflash', method: 'GET', path: '/api/overlay/timer/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'lock', label: 'Lock', method: 'GET', path: '/api/overlay/timer/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'unlock', label: 'Unlock', method: 'GET', path: '/api/overlay/timer/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'add', label: 'Add time (needs amount)', method: 'GET', path: '/api/overlay/timer/control', send: 'query', keyField: 'stream_key', actionField: 'action', needs: ['amount'] },
            { id: 'subtract', label: 'Subtract time (needs amount)', method: 'GET', path: '/api/overlay/timer/control', send: 'query', keyField: 'stream_key', actionField: 'action', needs: ['amount'] },
            { id: 'set', label: 'Set time (needs amount)', method: 'GET', path: '/api/overlay/timer/control', send: 'query', keyField: 'stream_key', actionField: 'action', needs: ['amount'] },
            { id: 'refresh', label: 'Refresh', method: 'GET', path: '/api/overlay/timer/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'restart', label: 'Restart widget', method: 'GET', path: '/api/overlay/timer/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
        ],
    },
    'running-text': {
        label: 'Running text',
        actions: [
            { id: 'pause', label: 'Pause', method: 'GET', path: '/api/overlay/running-text/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'resume', label: 'Resume', method: 'GET', path: '/api/overlay/running-text/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'hide', label: 'Hide', method: 'GET', path: '/api/overlay/running-text/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'show', label: 'Show', method: 'GET', path: '/api/overlay/running-text/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'flash', label: 'Flash', method: 'GET', path: '/api/overlay/running-text/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'unflash', label: 'Unflash', method: 'GET', path: '/api/overlay/running-text/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'refresh', label: 'Refresh', method: 'GET', path: '/api/overlay/running-text/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'restart', label: 'Restart widget', method: 'GET', path: '/api/overlay/running-text/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
        ],
    },
    leaderboard: {
        label: 'Leaderboard',
        actions: [
            { id: 'hide', label: 'Hide', method: 'GET', path: '/api/overlay/leaderboard/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'show', label: 'Show', method: 'GET', path: '/api/overlay/leaderboard/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'flash', label: 'Flash', method: 'GET', path: '/api/overlay/leaderboard/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'unflash', label: 'Unflash', method: 'GET', path: '/api/overlay/leaderboard/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'mute', label: 'Mute', method: 'GET', path: '/api/overlay/leaderboard/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'unmute', label: 'Unmute', method: 'GET', path: '/api/overlay/leaderboard/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'refresh', label: 'Refresh', method: 'GET', path: '/api/overlay/leaderboard/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'restart', label: 'Restart widget', method: 'GET', path: '/api/overlay/leaderboard/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
        ],
    },
    goal: {
        label: 'Goal',
        actions: [
            { id: 'hide', label: 'Hide', method: 'GET', path: '/api/overlay/goal/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'show', label: 'Show', method: 'GET', path: '/api/overlay/goal/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'flash-on', label: 'Flash on', method: 'GET', path: '/api/overlay/goal/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'flash-off', label: 'Flash off', method: 'GET', path: '/api/overlay/goal/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
        ],
    },
    // milestone and polling: the server has no action whitelist (free_action), so the
    // values below are the ones the overlay actually handles, read from trakteer-overslay
    // src/hooks/useMilestoneWS.js:99-130 and usePollingWS.js:126-183, and from the
    // dashboard's own Stream Deck list in src/constants/apiCatalog.js:105-152.
    // `item` is mandatory on both routes; the server turns it into a boolean unless the
    // action is result_visibility. Both routes read `stream_key` only (no `token` alias).
    milestone: {
        label: 'Milestone',
        free_action: true,
        actions: [
            { id: 'hide', label: 'Hide', method: 'GET', path: '/api/overlay/milestone/control', send: 'query', keyField: 'stream_key', actionField: 'action', extras: { item: 'true' } },
            { id: 'show', label: 'Show', method: 'GET', path: '/api/overlay/milestone/control', send: 'query', keyField: 'stream_key', actionField: 'action', action: 'hide', extras: { item: 'false' } },
            { id: 'flash-on', label: 'Flash on', method: 'GET', path: '/api/overlay/milestone/control', send: 'query', keyField: 'stream_key', actionField: 'action', action: 'flash', extras: { item: 'true' } },
            { id: 'flash-off', label: 'Flash off', method: 'GET', path: '/api/overlay/milestone/control', send: 'query', keyField: 'stream_key', actionField: 'action', action: 'flash', extras: { item: 'false' } },
            { id: 'restart', label: 'Restart widget', method: 'GET', path: '/api/overlay/milestone/control', send: 'query', keyField: 'stream_key', actionField: 'action', extras: { item: 'false' } },
        ],
    },
    polling: {
        label: 'Polling',
        free_action: true,
        actions: [
            { id: 'hide', label: 'Hide', method: 'GET', path: '/api/overlay/polling/control', send: 'query', keyField: 'stream_key', actionField: 'action', extras: { item: 'true' } },
            { id: 'show', label: 'Show', method: 'GET', path: '/api/overlay/polling/control', send: 'query', keyField: 'stream_key', actionField: 'action', action: 'hide', extras: { item: 'false' } },
            { id: 'flash-on', label: 'Flash on', method: 'GET', path: '/api/overlay/polling/control', send: 'query', keyField: 'stream_key', actionField: 'action', action: 'flash', extras: { item: 'true' } },
            { id: 'flash-off', label: 'Flash off', method: 'GET', path: '/api/overlay/polling/control', send: 'query', keyField: 'stream_key', actionField: 'action', action: 'flash', extras: { item: 'false' } },
            // The overlay only tests `=== 'hidden'`, so 'immediate' (the catalog and the
            // widget default) and the dashboard panel's 'visible' both show the results.
            { id: 'hide-results', label: 'Hide results', method: 'GET', path: '/api/overlay/polling/control', send: 'query', keyField: 'stream_key', actionField: 'action', action: 'result_visibility', extras: { item: 'hidden' } },
            { id: 'show-results', label: 'Show results', method: 'GET', path: '/api/overlay/polling/control', send: 'query', keyField: 'stream_key', actionField: 'action', action: 'result_visibility', extras: { item: 'immediate' } },
            { id: 'refetch', label: 'Refresh data', method: 'GET', path: '/api/overlay/polling/control', send: 'query', keyField: 'stream_key', actionField: 'action', extras: { item: 'true' } },
            { id: 'restart', label: 'Restart widget', method: 'GET', path: '/api/overlay/polling/control', send: 'query', keyField: 'stream_key', actionField: 'action', extras: { item: 'false' } },
        ],
    },
    gacha: {
        label: 'Gacha',
        actions: [
            { id: 'spin', label: 'Spin', method: 'GET', path: '/api/overlay/gacha/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'close_result', label: 'Close result', method: 'GET', path: '/api/overlay/gacha/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'close_and_remove', label: 'Close and remove result', method: 'GET', path: '/api/overlay/gacha/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'hide', label: 'Hide', method: 'GET', path: '/api/overlay/gacha/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'show', label: 'Show', method: 'GET', path: '/api/overlay/gacha/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'flash-on', label: 'Flash on', method: 'GET', path: '/api/overlay/gacha/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'flash-off', label: 'Flash off', method: 'GET', path: '/api/overlay/gacha/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
            { id: 'restart', label: 'Restart widget', method: 'GET', path: '/api/overlay/gacha/control', send: 'query', keyField: 'stream_key', actionField: 'action' },
        ],
    },
};

/** @returns {string[]} widget ids in registry order */
function widgetIds() {
    return Object.keys(WIDGETS);
}

/**
 * Look an action up.
 * @param {string} widgetId
 * @param {string} actionId
 * @returns {object|null} the action descriptor, or null when unknown
 */
function findAction(widgetId, actionId) {
    const widget = WIDGETS[widgetId];
    if (!widget) return null;
    return widget.actions.find((a) => a.id === actionId) || null;
}

const registry = {
    BROADCAST_ACTIONS,
    TEST_ALERT_MEDIA,
    LEGACY_TEST_ALERT_MEDIA,
    TEST_ALERT_WIDGET_TYPES,
    resolveTestAlertMedia,
    WIDGETS,
    widgetIds,
    findAction,
};

// Loaded two ways: `require`d by the Node plugin process, and <script src>'d by the
// Property Inspector page so both sides share one source of truth for the action lists.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = registry;
} else if (typeof window !== 'undefined') {
    window.TRAKTEER_ENDPOINTS = registry;
}
})();
