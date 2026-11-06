# Trakteer Overlay Control — StreamDock plugin

Kontrol widget overlay Trakteer dari tombol macropad StreamDock.
Versi 0.1.0, langkah pertama: tiga action, tanpa knob, tanpa multi-state.

```
id.trakteer.streamdock.sdPlugin/   paket plugin (ini yang dipasang)
  manifest.json                    deklarasi 3 action
  plugin/                          proses Node.js
    index.js                       event StreamDock -> request
    lib/endpoints.js               registry endpoint trakteer-ws
    lib/trakteer-api.js            bangun + kirim request
    lib/feedback.js                umpan balik tombol
    lib/icons.js                   baca PNG ikon tombol (static/icons) untuk setImage
    utils/plugin.js                SDK Mirabox (SDNodeJsSDKV2, tidak dimodifikasi)
  propertyInspector/               UI pengaturan per tombol
  static/                          ikon plugin + key.png
  static/icons/                    ikon tombol (Phosphor, PNG 144x144, dibuat tools/make-key-icons.js)
tools/mock-ws-server.js            mock trakteer-ws untuk uji lokal
tools/check-manifest.js            cek manifest/paket
tools/check-property-inspectors.js cek halaman PI dalam satu scope bersama
tools/make-icons.js                ikon plugin/aksi dari logo (tools/assets) + key.png
tools/make-key-icons.js            render ikon Phosphor jadi PNG tombol (npm run icons)
test/                              112 test (unit + integrasi + runtime + PI + ikon)
docs/endpoint-map.md               peta endpoint kontrol trakteer-ws
docs/device-compatibility.md       riset perangkat yang didukung
```

## Action yang tersedia

| Action StreamDock | Endpoint | Untuk apa |
|---|---|---|
| Overlay control | `POST /api/controls/:action` | play, pause, next, censor text, censor media |
| Test alert | `GET /api/overlay/alert-queue/test/:mediaType` | memicu alert uji (notification, tts, youtube, tiktok, instagram, voice-note, gambar, gif) — route yang sama dengan tombol test di dashboard |
| Widget control | endpoint per widget | alert queue, soundboard, musicbox, mabar, qr-code, activity, timer, running text, leaderboard, goal, milestone, polling, gacha |

Tabel lengkap endpoint, action valid, dan field body ada di `docs/endpoint-map.md`.

## Install

Butuh software **Stream Dock** dari Mirabox/HotSpot (atau rebrand-nya: Ajazz
Stream Dock, Press Play, VSDinside, Fifine). Plugin ini **tidak** jalan di software
Elgato Stream Deck maupun Loupedeck — lihat `docs/device-compatibility.md`.

1. Install dependency proses plugin:

   ```bash
   cd id.trakteer.streamdock.sdPlugin/plugin
   npm install
   ```

2. Copy folder `id.trakteer.streamdock.sdPlugin` (lengkap dengan `plugin/node_modules`)
   ke direktori plugin StreamDock:

   - Windows: `%APPDATA%\HotSpot\StreamDock\plugins\`
   - macOS: `~/Library/Application Support/HotSpot/StreamDock/plugins/`

3. Restart aplikasi Stream Dock. Kategori **Trakteer** muncul di daftar action.

## Isi token

Tarik salah satu action ke tombol, lalu isi di Property Inspector:

- **Overlay control**: field `Token ID` — stream token dari pengaturan overlay
  Trakteer.
- **Test alert** dan **Widget control**: field `Stream key`.

Letak stream key: Dashboard → Stream Overlay → Controls → **Stream Deck**. Modal
itu menampilkan URL API lengkap per aksi; nilai `token=` di URL tersebut adalah
stream key yang dipakai kedua action di atas. Tombol **Test alert** yang dibuat
dengan versi plugin sebelumnya (field `Token ID` + media `youtube`/`null`/dst)
tetap jalan: nilainya dimigrasikan otomatis saat Property Inspector dibuka.

Token disimpan StreamDock di settings tombol itu saja. Plugin tidak pernah
menuliskannya ke file lain dan tidak pernah memasukkannya ke log: field `token`,
`token_id`, `stream_key`, `key`, dan `passcode` pada query string diganti `***`
sebelum dicatat (`redactUrl` di `lib/trakteer-api.js`). Ada test runtime yang
membaca file log nyata dan gagal kalau kredensial bocor ke sana.

`Server` default `https://ws.trakteer.id`. Untuk dev pakai `http://ws.trakteer.lab`.

## Umpan balik di tombol

Setiap tekan tombol menghasilkan verdict:

- sukses → overlay centang StreamDock (`showOk`) + judul `OK` selama 2,5 detik
- gagal → overlay silang (`showAlert`) + sebab singkat, lalu label kembali

Sebab yang dipetakan: `overlay offline` (404 `room_not_found`, overlay OBS tidak
aktif), `bad stream key` (401), isi error server untuk 400, `payload too large`
(413), `server error` (5xx), `timeout`, dan kode error jaringan.

Token/stream key yang salah format ditolak sebelum request dikirim.

## Ikon tombol

Setiap tombol tampil dengan ikon Phosphor, paket ikon yang sama dengan dashboard Trakteer
(`@phosphor-icons/react` 2.1.7). Ikon dipilih otomatis dari aksinya: Play untuk play, Megaphone
untuk alert box, Timer untuk widget timer, dan seterusnya. Aturannya ada di
`plugin/lib/endpoints.js`: ikon widget, `ACTION_ICONS` untuk id aksi yang dipakai bersama, dan
`icon` pada aksi tertentu. Di Property Inspector, field **Icon** bisa menimpanya; **Auto**
mengikuti aksi.

Ikonnya PNG 144x144 (bobot bold, putih di atas gradien merah logo Trakteer, `#be1e2d` ke
`#db2935`, sama dengan `key.png`) di
`static/icons/`, dikirim ke tombol lewat `setImage`. PNG-nya sudah ada di repo, jadi memasang
plugin tidak butuh langkah tambahan. Untuk membuat ulang, misalnya setelah menambah ikon di
registry atau mengubah gaya di `tools/make-key-icons.js`:

```bash
npm install     # di root repo; memasang devDependency (Phosphor dan resvg), bukan dependency plugin
npm run icons
```

Ikon Phosphor berlisensi MIT; pemberitahuannya ada di `static/icons/LICENSE.txt`.

## Cara uji tanpa perangkat

Semua verifikasi di bawah berjalan di WSL/Linux, tanpa StreamDock dan tanpa
menyentuh server produksi.

```bash
# cek paket: manifest, UUID vs handler, PI, ikon, syntax
node tools/check-manifest.js

# cek halaman Property Inspector: muat tiap halaman dalam satu scope bersama
# (seperti <script src> di browser), lalu buktikan form terisi.
# Ini yang menangkap SyntaxError "Identifier 'X' has already been declared" —
# node --check tidak bisa, karena ia hanya melihat satu file sekaligus.
node tools/check-property-inspectors.js

# 112 test: unit (bangun request, wrap judul, redaksi log, pilihan ikon) + integrasi (HTTP ke mock)
#          + runtime (proses plugin nyata lewat fake host StreamDock)
#          + Property Inspector (scope bersama, migrasi setting legacy)
node --test test/

# semuanya
npm run verify
```

Menjalankan mock server sendiri untuk eksplorasi manual:

```bash
node tools/mock-ws-server.js 9123
# stream key yang dianggap valid: mockstreamkey01 (ubah via MOCK_KNOWN_KEY)
# MOCK_ROOM_ONLINE=0 memaksa semua broadcast menjawab 404 room_not_found
curl -i -X POST http://127.0.0.1:9123/api/controls/next \
  -H 'Content-Type: application/json' \
  -d '{"token_id":"mockstreamkey01"}'
```

Mock meniru perilaku server nyata: validasi format token tanpa lookup DB untuk
`/api/controls/:action`, dan lookup stream key + whitelist action untuk endpoint
per widget. Rute statis diprioritaskan di atas rute `:action`, sama seperti
uWebSockets.js.

Untuk uji terhadap server nyata, ganti `Server` di Property Inspector ke
`https://ws.trakteer.id` dan pakai stream key asli. Overlay harus terbuka di OBS,
kalau tidak server menjawab `room_not_found`.

## Yang belum diverifikasi

- Eksekusi di aplikasi Stream Dock Windows/macOS dan di perangkat fisik.
  Semua verifikasi di repo ini memakai fake host, bukan software vendor.
- Apakah versi Stream Dock AJAZZ 1.0/2.0 memenuhi `Software.MinimumVersion`
  `3.10.188.226` di manifest. Kalau plugin tidak muncul di perangkat Ajazz,
  turunkan nilai itu ke `2.9` dan uji ulang.
- Tampilan ikon di tombol asli: apakah judul menimpa ikon, ukuran 144 px terhadap 128 px yang
  disarankan SDK, dan apakah ikon tetap terlihat setelah overlay centang/silang. `ICON_SIZE` dan
  `ICON_TOP` di `tools/make-key-icons.js` disiapkan untuk disetel setelah dicoba di perangkat.
- Perilaku terhadap server produksi (butuh stream key asli).
- Efek tombol **milestone** dan **polling** di overlay yang terbuka. Server kedua
  endpoint itu tidak punya whitelist, jadi nilai `action`/`item`-nya dibaca dari source
  overlay (`useMilestoneWS.js`, `usePollingWS.js`, `apiCatalog.js`; bukti di
  `docs/endpoint-map.md` §5), belum dicoba ke server produksi. Kedua route menjawab 200
  walau overlay tidak terbuka, jadi `OK` di tombol ini belum membuktikan overlay menerima
  perintah. Aksi polling `preview-data-source` tidak disertakan karena `item`-nya JSON.

## Catatan teknis

- Wrapping judul tombol dilakukan di `lib/feedback.js`, bukan oleh SDK. Fungsi
  `setTitle` di SDK (`utils/plugin.js`) memulai akumulator pada `null` lalu
  mengonkatenasi, sehingga judul ter-wrap keluar dengan awalan literal `null`.
  File SDK dibiarkan apa adanya; jalur itu tidak dipakai.
- Gambar tombol memakai PNG lewat `setImage`, bukan SVG. Dokumentasi SDK menyebut SVG
  diterima, tetapi repo ini mencatat laporan SVG data URI tampil hitam di perangkat. Laporan
  itu belum punya sumber dan belum diuji, jadi PNG dipilih karena aman di kedua kemungkinan
  (lihat `docs/device-compatibility.md`).
- `lib/endpoints.js` dimuat dua cara: `require` oleh proses plugin dan `<script src>`
  oleh Property Inspector, supaya daftar action hanya punya satu sumber.
