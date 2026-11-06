/// <reference path="../utils/common.js" />
/// <reference path="../utils/action.js" />

// $local: no translation files shipped yet, so leave it off.
// $back:  false → action.js reveals the form once settings arrive.
const $local = false, $back = false, $dom = {
    main: $('.sdpi-wrapper')
};

const FIELDS = [
    { id: 'action', key: 'action', default: 'next' },
    { id: 'tokenId', key: 'tokenId', default: '' },
    { id: 'label', key: 'label', default: '' },
    { id: 'icon', key: 'icon', default: '' },
    { id: 'baseUrl', key: 'baseUrl', default: 'https://ws.trakteer.id' },
];

fillSelect('action', window.TRAKTEER_ENDPOINTS.BROADCAST_ACTIONS);
fillIconSelect('icon', window.TRAKTEER_ENDPOINTS.ICON_CHOICES);

const binding = bindFields(FIELDS);

const $propEvent = {
    didReceiveSettings({ settings }) {
        binding.apply(settings || {});
    },
    sendToPropertyInspector() { }
};
