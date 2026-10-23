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
| milestone | `GET /api/overlay/milestone/control` | bebas (hanya di-publish sebagai `milestone:control` + `action`); server hanya cek **tidak kosong** | query `stream_key`, `item` (wajib, non-empty), `action` (wajib) | DB stream_key |
| milestone — nominal | `POST /api/overlay/milestone/update-adjustment-amount` | — | body `stream_key`, `amount` → publish `milestone:update-amount` | DB stream_key |
| polling | `GET /api/overlay/polling/control` | bebas; `result_visibility` dan `preview-data-source` memakai `item` sebagai string, action lain mengubah `item` jadi boolean | query `stream_key`, `item` (wajib), `action` (wajib) | DB stream_key |
| polling — vote | `POST /api/overlay/polling/post-polling-vote-modification` | — | body `stream_key`, `option_id`, `quantity_vote` → publish `polling:update-vote-by-creator` | DB stream_key |
| polling — reset | `POST /api/overlay/polling/post-reset-polling-vote-modification` | — | body (lihat file) | DB stream_key |
| room presence | `GET /api/rooms/:tokenId` | — | path `tokenId`, opsional query `widget` | **tanpa auth** |
| health | `GET /api/health` | — | — | tanpa auth |

Catatan: `milestone/control` dan `polling/control` **tidak punya whitelist action**.
Server hanya menolak kalau `action` atau `item` kosong. Nilai action yang dikenali
ditentukan oleh overlay di sisi browser, bukan server.

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

- Nilai `action` apa saja yang benar-benar ditangani overlay untuk
  `milestone/control` dan `polling/control` (butuh baca repo trakteer-overslay).
- Perilaku runtime melawan server produksi (butuh stream key nyata; tidak dilakukan).
- Apakah `token_id` dan `stream_key` identik untuk 100% setup kreator
  (jalur kode mengarah ke ya, belum diuji dengan data nyata).
