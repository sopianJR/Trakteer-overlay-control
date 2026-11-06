/// <reference path="../utils/common.js" />
/// <reference path="../utils/action.js" />

const $local = false, $back = false, $dom = {
    main: $('.sdpi-wrapper')
};

// Reach the registry through its namespace object, never by re-declaring its names.
// endpoints.js is a classic script on this page, so a top-level `const TEST_ALERT_MEDIA`
// here used to collide with the one it declared and abort the page with a SyntaxError.
// `$endpoints` follows the `$`-prefixed convention common.js/action.js use for page
// singletons, so it cannot clash with a registry export.
const $endpoints = window.TRAKTEER_ENDPOINTS;

const FIELDS = [
    { id: 'media', key: 'media', default: 'notification' },
    { id: 'widgetType', key: 'widgetType', default: 'alert-box' },
    { id: 'quantity', key: 'quantity', default: 1, type: 'number' },
    { id: 'streamKey', key: 'streamKey', default: '' },
    { id: 'label', key: 'label', default: 'Test' },
    { id: 'icon', key: 'icon', default: '' },
    { id: 'baseUrl', key: 'baseUrl', default: 'https://ws.trakteer.id' },
];

fillSelect('media', $endpoints.TEST_ALERT_MEDIA);
fillSelect('widgetType', $endpoints.TEST_ALERT_WIDGET_TYPES);
fillIconSelect('icon', $endpoints.ICON_CHOICES);

const binding = bindFields(FIELDS);

/**
 * Migrate a button saved by the newtip version of this action.
 *
 * Those settings carry a `tokenId` and a newtip media id (`youtube`, `null`, …).
 * Both are translated once, on the first didReceiveSettings, so the form shows a
 * valid selection and the plugin stops reading the legacy keys.
 */
function migrateLegacySettings(settings) {
    if (typeof $settings === 'undefined' || !$settings) return;

    const media = $endpoints.resolveTestAlertMedia(settings.media);
    if (media !== settings.media) $settings.media = media;

    if (!settings.streamKey && settings.tokenId) $settings.streamKey = settings.tokenId;
    if (!settings.widgetType) $settings.widgetType = 'alert-box';
}

const $propEvent = {
    didReceiveSettings({ settings }) {
        const s = settings || {};
        migrateLegacySettings(s);
        binding.apply({
            ...s,
            media: $endpoints.resolveTestAlertMedia(s.media),
            streamKey: s.streamKey || s.tokenId || '',
            widgetType: s.widgetType || 'alert-box',
        });
    },
    sendToPropertyInspector() { }
};
