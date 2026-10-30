# Peta endpoint kontrol trakteer-ws (untuk plugin StreamDock)

Sumber: repo `/usr/src/trakteer-ws`, commit `2393e7e` (main), dibaca langsung dari
`src/api/index.js`, `src/api/controls/`, `src/api/overlay/`, `src/widgets/`, `src/auth.js`, `src/db.js`.
Status: FAKTA (hasil baca kode), kecuali ditandai ASUMSI.

---

## 1. Dua kelas endpoint — jangan disamakan

### Kelas A — Generic broadcast (token_id)

`POST /api/controls/:action` — `src/api/controls/post-action.js`

- Header: `Content-Type: application/json` (wajib, kalau tidak → 400).
- Body: `{ "token_id": "<stream key>", ...sisa field }`.
- `:action` apa pun diterima; dipakai mentah sebagai `type` pada pesan broadcast.
  Tidak ada whitelist action di server. Overlay di browser yang memutuskan
  apakah `type` itu dikenali.
- Validasi token: `validateToken()` di `src/auth.js` → **format saja**
  (panjang 8..128, regex `^[a-zA-Z0-9_-]+$` dari `TOKEN_PATTERN`). TIDAK ada lookup DB
  di jalur ini. Jadi 401 yang disebut docs/api.md tidak pernah keluar dari handler ini;
  token salah format → 400, token valid-format tapi tak ada room → 404.
- Urutan respons:
  - `400` — content-type bukan JSON, body tidak bisa diparse, atau token gagal format.
  - `413` — body > `MAX_PAYLOAD` (default 4096).
  - `404 room_not_found` — format token lolos tapi tidak ada subscriber (`rooms.hasRoom`).
  - `200 {"success":true,"type":"<action>"}` — sukses.
- Action yang didokumentasikan resmi (`docs/stream-deck.md`): `play`, `pause`, `next`,
  `censor-text-alert`, `censor-media-share`, plus `newtip` untuk tes alert
  (body tambahan `payload: { media, quantity }`).

Konsekuensi penting: endpoint ini **hanya mem-broadcast**. Tidak menyentuh DB,
tidak mengubah session state widget. Overlay yang tidak menangani `type` tersebut
akan mengabaikannya, tapi server tetap balas 200.

### Kelas B — Endpoint per widget (stream_key + action tervalidasi)

Semua endpoint kelas B:
- memanggil `getCreatorIdByStreamKey(streamKey)` (`src/db.js:174`) → lookup DB nyata
  (tabel `creator_streams` lalu `stream_identities`), hasil di-cache
  `STREAM_KEY_CACHE_TTL_MS`;
- balas `401 invalid_stream_key` kalau key tidak ditemukan **atau** lookup DB gagal;
- balas `400 missing_stream_key` kalau param kosong, `400 invalid_action: must be one of ...`
  kalau action di luar whitelist;
- menulis state ke DB lalu `app.publish()` ke topic `stream:<stream_key>`.

Perbedaan dari kelas A: **ada whitelist action, ada lookup DB, ada persistensi state.**
Nama parameternya `stream_key` (bukan `token_id`), beberapa endpoint juga menerima alias `token`.

---

## 2. Tabel endpoint per widget

Kolom "auth": semua kelas B = lookup `stream_key` di DB (tidak ada header Authorization,
tidak ada passcode pada jalur ini). Kelas A = format token saja.

| Widget | Metode + endpoint | Action valid | Field body / query | Auth |
|---|---|---|---|---|
| (generic) | `POST /api/controls/:action` | bebas; resmi: `play`, `pause`, `next`, `censor-text-alert`, `censor-media-share`, `newtip` | body `token_id` (+ field bebas, mis. `payload.media`, `payload.quantity`) | format token saja, **tanpa DB** |
| alert queue (alert box) | `GET /api/overlay/alert-queue/control/:action` | `play`, `pause`, `next`, `prev`, `hold`, `resume`, `autoplay`, `restart`, `clear`, `seek` | query `token` atau `stream_key`, opsional `widget_type`, `current_item_id`, `value`, `elapsed_seconds` | DB stream_key |
| alert queue — sensor | `GET /api/overlay/alert-queue/control/censor-text` / `censor-media` (toggle) dan `.../censor-text/:value` / `censor-media/:value` (`true`/`false`/`1`) | — | query `token`/`stream_key`, opsional `widget_type` | DB stream_key |
| alert queue — item | `POST /api/overlay/alert-queue/items/:id/action` | `play_now`, `play_next`, `censor`, `delete`, `restore` | body (lihat `post-alert-queue-item-action.js`) | DB stream_key |
| soundboard (overlay) | `GET /api/overlay/soundboard/control/:action` | `toggle_hide`, `restart` | query `token`/`stream_key` | DB stream_key |
| soundboard queue | `POST /api/overlay/soundboard-queue/control` | `play`, `pause`, `next`, `prev`, `hold`, `resume`, `clear` | body `stream_key`, `action`, `current_item_id` | DB stream_key |
| soundboard queue | `GET /api/overlay/soundboard-queue/control/:action` | idem | query `token`/`stream_key`, `current_item_id` | DB stream_key |
| soundboard — item | `POST /api/overlay/soundboard-queue/items/:id/action` | `play_now`, `play_next`, `delete`, `restore` | body | DB stream_key |
| musicbox queue | `GET /api/overlay/musicbox-queue/control/:action` | `play`, `pause`, `next`, `prev`, `hold`, `resume`, `restart`, `clear`, `progress`, `seek`, `remove`, `censor`, `reorder` | query `token`/`stream_key`, `item_id`, `elapsed_seconds`, `is_message_hidden`, `ordered_ids` | DB stream_key |
| mabar queue | `GET /api/overlay/mabar-queue/control/:action` dan `POST /api/overlay/mabar-queue/control` | `lock`, `unlock`, `move_all_to_queue`, `complete_all_lobby`, `remove_all_queued`, `reorder`, `widget_reset` | query/body `token`/`stream_key`, `action` | DB stream_key |
| mabar — item | `POST /api/overlay/mabar-queue/items/:id/action` | `move_to_lobby`, `move_to_queue`, `complete`, `remove`, `replay` | body | DB stream_key |
| qr-code | `GET /api/overlay/qr-code/control/:action` dan `POST /api/overlay/qr-code/control` | `toggle_hide`, `toggle_open_close`, `toggle_flash`, `restart` | `token`/`stream_key`, `widget_id` (default `qr-code`), `action` | DB stream_key |
| activity | `GET /api/overlay/activity/control/:action` dan `POST /api/overlay/activity/control` | `toggle_pause`, `toggle_hide`, `scroll_up`, `scroll_down`, `reset_scroll`, `clear_activity`, `restart`, `test_event` | `token`/`stream_key`, `widget_id` (default `activity`), `action`, `kind` (wajib untuk `test_event`), `display_format` (`unit`/`nominal`) | DB stream_key |
| timer | `GET /api/overlay/timer/control` | `pause`, `resume`, `hide`, `show`, `flash`, `unflash`, `lock`, `unlock`, `add`, `subtract`, `set`, `refresh`, `restart` | query `stream_key`, `action`, opsional `remaining_duration`, `amount`, `check_presence=1` | DB stream_key |
| running text | `GET /api/overlay/running-text/control` | `pause`, `resume`, `hide`, `show`, `flash`, `unflash`, `refresh`, `restart` | query `stream_key`, `action`, opsional `mode` (default `latest`), `limit` (1..100), `sort_by` | DB stream_key |
| leaderboard | `GET /api/overlay/leaderboard/control` | `hide`, `show`, `flash`, `unflash`, `mute`, `unmute`, `flash_supporter`, `unflash_supporter`, `refresh`, `restart` | query `stream_key`, `action`, opsional `supporter_email`, `supporter_key`, `is_anonym`, `limit`, `sort_by`, range tanggal | DB stream_key |
| goal | `GET /api/overlay/goal/control` | `hide`, `show`, `unhide`, `flash-on`, `flash-off` | query `stream_key`, `action` | DB stream_key |
| goal — nominal | `POST /api/overlay/goal/update-adjustment` | — (tidak pakai `action`) | body `stream_key`, `progress_adjustment`, `target_adjustment` → publish `goal:update-amount` | DB stream_key |
| gacha | `GET /api/overlay/gacha/control` | `get`/`status` (default), `spin` (alias `spin-gacha`, `spin_gacha`, `putar-gacha`), `close_result`/`close-result`, `close_and_remove`(+alias), `hide`, `show`/`unhide`, `flash-on`/`flash`, `flash-off`/`unflash`, `restart` | query `stream_key` atau `token`, `action` | DB stream_key |
| gacha — nominal | `POST /api/overlay/gacha-adjustment` | `add_progress`, `set_zero`, `update_queue`, `update_min_amount`, `update_target_amount`, `update_spin_mode` | body `stream_key`, `action`, `value` | DB stream_key |
| milestone | `GET /api/overlay/milestone/control` | server: bebas (hanya di-publish sebagai `milestone:control` + `action`), cek **tidak kosong**. Overlay menangani: `hide`, `flash` (`item` `true`/`false`), `restart` | query `stream_key`, `item` (wajib, non-empty), `action` (wajib) | DB stream_key |
| milestone — nominal | `POST /api/overlay/milestone/update-adjustment-amount` | — | body `stream_key`, `amount` → publish `milestone:update-amount` | DB stream_key |
| polling | `GET /api/overlay/polling/control` | server: bebas; `result_visibility` dan `preview-data-source` memakai `item` sebagai string, action lain mengubah `item` jadi boolean. Overlay menangani: `hide`, `flash` (`true`/`false`), `result_visibility` (`hidden` menyembunyikan, nilai lain menampilkan), `refetch`, `restart`, `preview-data-source` (`item` berisi JSON; tidak dipakai plugin) | query `stream_key`, `item` (wajib), `action` (wajib) | DB stream_key |
| polling — vote | `POST /api/overlay/polling/post-polling-vote-modification` | — | body `stream_key`, `option_id`, `quantity_vote` → publish `polling:update-vote-by-creator` | DB stream_key |
| polling — reset | `POST /api/overlay/polling/post-reset-polling-vote-modification` | — | body (lihat file) | DB stream_key |
| room presence | `GET /api/rooms/:tokenId` | — | path `tokenId`, opsional query `widget` | **tanpa auth** |
| health | `GET /api/health` | — | — | tanpa auth |

Catatan: `milestone/control` dan `polling/control` **tidak punya whitelist action**.
Server hanya menolak kalau `action` atau `item` kosong. Nilai action yang dikenali
ditentukan oleh overlay di sisi browser, bukan server (daftarnya di kolom "Action valid"
di atas, dibaca dari source overlay; lihat §5).

Tiga hal yang membedakan dua route ini dari widget lain:

- Hanya membaca `stream_key`. Alias `token` **tidak** dibaca, jadi `?token=` dijawab
  `400 missing_stream_key`.
- Urutan cek: `stream_key` → `item` → `action` → lookup DB (`401 invalid_stream_key`).
- Tidak memeriksa room (`rooms.hasRoom`), jadi menjawab `200` walau tidak ada overlay yang
  terbuka. Sama seperti test alert, 200 di sini **bukan** bukti overlay menerima perintah.
  Body respons juga menggemakan `stream_key`.

Satu action server dipakai beberapa tombol, dibedakan lewat `item`: "Show" milestone/polling
adalah `action=hide&item=false`. Plugin menamai tombolnya `show` dan mengirim `hide`
lewat field `action` di registry (lihat `lib/endpoints.js`).

`result_visibility`: katalog Stream Deck dan default widget memakai `immediate`, panel
dashboard mengirim `visible`. Renderer hanya membandingkan dengan `'hidden'`
(`PollingCustom.jsx:211`, `PollingLite.jsx:353`), jadi keduanya sama-sama menampilkan hasil.
Plugin mengikuti katalog (`immediate`).

---

## 2b. Test alert: pakai route overlay, bukan `newtip`

FAKTA (dibaca dari trakteer-ws dan trakteer-overslay, lihat §5 untuk daftar baris):

- `POST /api/controls/newtip` **tidak menampilkan alert apa pun di OBS**. Handler
  generic hanya mem-`publish` `{...payload, type: 'newtip', _ts}` lalu balas 200.
  Tidak ada handler untuk `type: 'newtip'` di overlay v2 (`src` maupun `dist`),
  maupun di overlay v1. Jadi 200 dari endpoint itu hanya berarti "ada subscriber
  di room", bukan "alert tampil".
- Route yang nyata memunculkan alert, dan yang dipakai tombol test di dashboard:

  `GET /api/overlay/alert-queue/test/:mediaType?token=<stream key>[&widget_type=][&quantity=]`

  Server menghidrasi satu item tip transient (`id: test-<mediaType>-<ts>`,
  `source_type: 'tip'`, `variant: 'test'`, media payload default per tipe) lalu
  mem-publish `alert-queue:test-alert` (atau `media-share-queue:test-alert` bila
  `widget_type=media-share`). Overlay menangani event itu.
- `:mediaType` yang didukung = daftar yang sama dengan dashboard:
  `notification`, `tts`, `media-share-youtube`, `media-share-tiktok`,
  `media-share-instagram`, `voice-note`, `gambar`, `gif`.
  Tipe tak dikenal tidak ditolak: server menormalkannya dan jatuh ke alert teks.
- Kredensialnya **stream key di query `token`** (alias `stream_key`), di-lookup ke DB
  → `401 invalid_stream_key` kalau salah. `token_id` tidak dibaca route ini.
- `widget_type` opsional; default server `alert-box`. Plugin mengirimnya eksplisit.
- Route ini balas `200` walau tidak ada overlay yang subscribe (publish dilewati
  lewat `rooms.hasRoom`), berbeda dengan route generic yang balas `404 room_not_found`.
  Konsekuensi: pada aksi test alert, **200 bukan bukti alert tampil**.
- Session `hold` membuat test diabaikan: balas `200 { ignored: true, reason: 'on_hold' }`.

Di mana kreator melihat stream key-nya: Dashboard → Stream Overlay → Controls →
**Stream Deck**. Modal itu menyusun URL API lengkap per aksi; nilai `token=` pada
URL tersebut adalah stream key yang dipakai plugin. (`StreamDeckModal` di
`trakteer-overslay/src/components/reusables/ControlModals.jsx:248,351`, diisi dari
`frontend/fragments/loka/tools/streamOverlay/controlsPanel.js:112`.)

---

## 3. Jawaban pertanyaan autentikasi

1. `validateToken` (`src/auth.js:15`) = **validasi format saja**: tipe string,
   panjang `TOKEN_MIN_LENGTH`..`TOKEN_MAX_LENGTH` (8..128), cocok `TOKEN_PATTERN`
   (`^[a-zA-Z0-9_-]+$`). Dipakai oleh `POST /api/controls/:action` dan oleh
   upgrade WebSocket sebagai saringan cepat.
2. `validateTokenFromDB` = format + (kalau `DB_VALIDATE_TOKEN != 'false'`, default aktif)
   `validateStreamKey` → lookup DB. Dipakai **hanya oleh auth WebSocket**, bukan oleh
   `POST /api/controls/:action`.
3. Endpoint kelas B memakai `getCreatorIdByStreamKey` → selalu lookup DB,
   balas `401 invalid_stream_key` kalau gagal.
4. `stream_key` dan `token_id` di konteks ini **nilainya sama** (stream key kreator):
   `POST /api/controls` menamainya `token_id`, endpoint overlay menamainya `stream_key`
   dan sebagian menerima alias `token`. Kesimpulan ini FAKTA untuk jalur kode
   (topic WS sama-sama `stream:<key>`), tapi plugin tetap menyediakan dua field terpisah
   di Property Inspector supaya tidak mengasumsikan keduanya selalu identik untuk semua
   setup kreator.
5. Tidak ada header Authorization / bearer / passcode pada jalur kontrol di atas.
   Passcode (`validateControlPasscode`, `POST /api/overlay/validate-passcode`) adalah
   mekanisme terpisah untuk panel kontrol web, tidak dipakai endpoint kontrol di tabel.

## 4. Yang belum diverifikasi

- Efek `milestone/control` dan `polling/control` di overlay yang benar-benar terbuka.
  Nilai action-nya sudah dipastikan dari source overlay (§5), tapi belum dicoba ke
  server produksi.
- Perilaku runtime melawan server produksi (butuh stream key nyata; tidak dilakukan).
- Apakah `token_id` dan `stream_key` identik untuk 100% setup kreator
  (jalur kode mengarah ke ya, belum diuji dengan data nyata).
- Apakah aksi generic `censor-text-alert` / `censor-media-share` masih ditangani
  overlay mana pun. Grep di overlay v2 (`src` + `dist`), overlay v1, dan edge-cdn
  = 0 hasil; satu-satunya pemakai yang tersisa adalah
  `trakteer-ws/public/test-control.html:460`. Jadi nasibnya mungkin sama dengan
  `newtip`: 200 tanpa efek. Belum dipastikan, karena bukan cakupan audit ini —
  padanan kelas B-nya sudah tersedia di registry
  (`alert-queue/censor-text`, `alert-queue/censor-media`).

## 5. Bukti untuk §2b (path + baris)

| Klaim | Bukti |
|---|---|
| route generic hanya publish `type` mentah lalu 200 | `trakteer-ws/src/api/controls/post-action.js:59-84` |
| validasi token generic = format saja | `trakteer-ws/src/auth.js:15-29`, dipanggil di `post-action.js:43` |
| route test alert + param `token`/`stream_key` | `trakteer-ws/src/api/overlay/get-alert-queue-test.js:113-126` |
| media type didukung + payload default | `get-alert-queue-test.js:27-65,196-197` |
| item transient yang dibentuk | `get-alert-queue-test.js:216-239` |
| publish `alert-queue:test-alert`, dilewati bila room kosong | `get-alert-queue-test.js:242-251`; nama event dari `trakteer-ws/src/utils/queue-events.js:19-47` |
| test diabaikan saat hold | `get-alert-queue-test.js:159-169` |
| overlay menangani `queue:test-alert` | `trakteer-overslay/src/hooks/useAlertQueueWS.js:375-381,544-548`; prefix di `src/utils/queueEvents.js:19-67`; efek render di `src/hooks/useAlertBoxLiveState.js:183-201` |
| tidak ada handler `newtip` di overlay | `grep -rn newtip` di `trakteer-overslay/src` = 0, di `trakteer-overslay/dist` = 0, di `trakteer/public/stream-overlay/{src,build}` = 0; overlay v1 hanya kenal `new-tip-success`/`-approved`/`-replay`/`-simulation` via Laravel Echo (`public/stream-overlay/src/notification/index.js:1075-1106`) |
| daftar media type yang dipakai dashboard | `trakteer-overslay/src/constants/apiCatalog.js:55-62` |
| dashboard memanggil route test ini | `trakteer-overslay/src/services/overlayService.js:440-456` |
| `newtip` hanya dipakai doc lama + panel test | `trakteer-ws/docs/stream-deck.md:53`, `trakteer-ws/public/test-control.html:916` |

### Milestone dan polling (§2 baris milestone/polling)

Server `trakteer-ws` 2393e7e; overlay `trakteer-overslay` 43bfc63
(`/usr/src/trakteer/data/web/html/web/resources/trakteer-overslay`).

| Klaim | Bukti |
|---|---|
| wajib `stream_key`, `item`, `action` (urutan cek), lalu lookup DB; tanpa alias `token`; tanpa cek room | `trakteer-ws/src/api/overlay/get-milestone-control.js:21-44`, `get-polling-control.js:21-44` |
| `item` jadi boolean (`'true'` → true), kecuali polling `result_visibility` / `preview-data-source` yang string | `get-milestone-control.js:48`, `get-polling-control.js:46` |
| overlay milestone menangani `flash`, `hide`, `restart` | `trakteer-overslay/src/hooks/useMilestoneWS.js:99-130` |
| overlay polling menangani `flash`, `hide`, `result_visibility`, `refetch`, `preview-data-source`, `restart` | `src/hooks/usePollingWS.js:126-183` |
| daftar Stream Deck resmi: hide/show/flash (+ `result_visibility` `hidden`/`immediate` untuk polling) | `src/constants/apiCatalog.js:105-152` |
| panel dashboard mengirim `restart` dengan `item=false` | `src/components/widgets/milestone/control/MilestoneControl.jsx:176`, `polling/control/PollingControl.jsx:190` |
| renderer hanya membandingkan `resultVisibility` dengan `'hidden'`; panel dashboard mengirim `visible` | `src/components/widgets/PollingCustom.jsx:211`, `PollingLite.jsx:353`, `polling/control/PollingControl.jsx:239` |
| default `resultVisibility` = `immediate` | `src/constants/widgetDefaults.js:982` |
