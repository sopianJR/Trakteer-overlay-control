/// <reference path="../utils/common.js" />
/// <reference path="../utils/action.js" />

const $local = false, $back = false, $dom = {
    main: $('.sdpi-wrapper')
};

const FIELDS = [
    { id: 'media', key: 'media', default: 'null' },
    { id: 'quantity', key: 'quantity', default: 1, type: 'number' },
    { id: 'tokenId', key: 'tokenId', default: '' },
    { id: 'label', key: 'label', default: 'Test' },
    { id: 'baseUrl', key: 'baseUrl', default: 'https://ws.trakteer.id' },
];

fillSelect('media', window.TRAKTEER_ENDPOINTS.TEST_ALERT_MEDIA);

const binding = bindFields(FIELDS);

const $propEvent = {
    didReceiveSettings({ settings }) {
        binding.apply(settings || {});
    },
    sendToPropertyInspector() { }
};
