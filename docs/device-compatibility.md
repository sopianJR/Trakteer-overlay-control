# Riset Kompatibilitas Perangkat untuk Plugin StreamDock (.sdPlugin)

Tanggal riset: 2026-10-23. Konteks: plugin overlay Trakteer.id berbasis
StreamDock Plugin SDK (SDNodeJsSDK / SDNodeJsSDKV2).

Penandaan: **[FAKTA]** = ada URL sumber. **[ASUMSI]** = inferensi.
**[TIDAK DITEMUKAN BUKTI]** = tidak ada sumber.

## Ringkasan Tabel

| Perangkat | Vendor | Software resmi | Terima .sdPlugin StreamDock? | Status |
|---|---|---|---|---|
| Pressplay SHORTCUT Macro Pad (alias "Pressplay N3") | Press Play ID (rebrand; HW = Mirabox N3 family) | **Stream Dock** (Mirabox/HotSpot) — link unduh di situs Press Play menunjuk langsung ke `cdn1.key123.vip` dan `key123.vip/mac` | **YA** | FAKTA |
| Ajazz AKP03 / AKP03E / AKP05 / AKP153 / AKP815 | Ajazz (A-JAZZ) | **Stream Dock AJAZZ** (1.0 untuk AKP153/AKP815/AKP01/AKP03/AKP05/AKP032/N1; 2.0 untuk AKP153 PLUS) | **YA** (folder `%appdata%\HotSpot\StreamDock\plugins` atau `...\Stream Dock AJAZZ\installedPlugins`) | FAKTA |
| Mirabox Stream Dock N3 / N4 / 293V3 / 293S | Mirabox (HotSpot) | **Stream Dock** v3.10.203 (Win/Mac) | **YA** — target utama SDK | FAKTA |
| Elgato Stream Deck (semua model) | Elgato (Corsair) | **Stream Deck** app | Format foldernya juga `*.sdPlugin`, tapi distribusi resmi `.streamDeckPlugin` + validasi manifest Elgato. Plugin StreamDock TIDAK didukung resmi; manifest `Software.MinimumVersion: "2.9"` tidak valid di Elgato (butuh 6.x/7.1+) | SEBAGIAN / tidak resmi |
| Loupedeck CT / Live / Live S / MX Creative Console | Loupedeck (Logitech) | **Loupedeck software** / **Logi Options+** + Logi Plugin Service | **TIDAK.** Format plugin `.lplug4` (C#/.NET atau Node.js SDK), arsitektur berbeda total | FAKTA |

## Detail + Bukti

### 1. Pressplay — "SHORTCUT Macro Pad" (6 LCD + 3 tombol + 3 knob = spesifikasi N3)
- Halaman unduhan resmi Press Play ID, bagian **Accessories → Shortcut Macropad**:
  - "Download for Windows" → `https://cdn1.key123.vip/StreamDock/Stream-Dock-Installer_Windows.exe`
  - "Download for macOS" → `https://key123.vip/mac`
  - Sumber: https://pressplayid.com/pages/press-play-softwares-drivers-and-manuals
- Spesifikasi produk (6 tombol LCD, 3 tombol reguler, 3 knob) cocok persis Mirabox N3:
  https://pressplayid.com/products/shortcut-macro-pad-shorcuts-pad
- **Kesimpulan [FAKTA]:** Pressplay adalah rebrand yang memakai software Stream Dock
  Mirabox/HotSpot → plugin `.sdPlugin` StreamDock BISA diinstal (salin ke
  `%appdata%\HotSpot\StreamDock\plugins\`).
- **[TIDAK DITEMUKAN BUKTI]** untuk nama produk literal "Pressplay N3 Mini/Pro"
  di situs resmi Press Play; listing marketplace memakai nama "Shortcut Macro Pad N3".

### 2. Ajazz AKP series
- Halaman driver resmi: https://ajazz.key123.vip/win — judul "AJAZZ Stream Dock Driver
  Download". Stream Dock AJAZZ 1.0 mendukung: **AKP153 Series, AKP815, AKP01, AKP03,
  AKP05, AKP05 PRO, AKP032, ajazz N1**. Versi 2.0 hanya AKP153 PLUS.
  Binary: `cdn1.key123.vip/Custom/AJAZZ/global/Stream-Dock-AJAZZ-Installer_Windows_global.exe`
- Manual AKP153: "Use the included **Stream Dock** app" → `AJAZZ.key123.vip/ENGwin|ENGmac`
  https://manuals.plus/ajazz/akp153-desktop-studio-controller-manual-2
- Manual AKP03: "Download and install the Stream Dock app"
  https://ja.manuals.plus/m/61f546a8528b59cebea9aa010b680e43d39b76bc7be08217c027682a52fef6df
- Instalasi plugin manual terbukti di proyek pihak ketiga (Ajazz AKP03):
  unzip ke `%appdata%\HotSpot\StreamDock\Plugins\<id>.sdPlugin\`, restart app.
  https://github.com/iu2frl/StreamDock.Plugins.Olliter
- Reverse-engineering mendalam `Stream Dock AJAZZ.exe` (manifest schema, lifecycle):
  https://github.com/Aiacos/ajazz-control-center/blob/develop/docs/protocols/streamdeck/akp_plugin_sdk.md
  - Manifest: `Software.MinimumVersion: "2.9"`, `Nodejs: {Version: "20"}`,
    `CodePathWin/CodePathMac` — identik dengan yang dipakai SDNodeJsSDK.
  - Discovery path: `%APPDATA%/HotSpot/Stream Dock AJAZZ/installedPlugins/*.sdPlugin/`
  - Validasi: ditolak jika `OS` tidak memuat platform saat ini **atau**
    `Software.MinimumVersion` > versi app yang berjalan.
- **[FAKTA]** AKP03, AKP153, AKP815 semuanya didukung software Stream Dock AJAZZ →
  plugin `.sdPlugin` StreamDock bisa dipasang.
- **Catatan [FAKTA]:** AKP153 secara hardware adalah klon Mirabox 293S; app Stream Dock
  Mirabox mendeteksinya di Windows, tapi di macOS tersambung tidak sempurna.
  https://github.com/Judd1zzz/yandex-music-streamdeck

### 3. Mirabox Stream Dock N3 / N4 / 293V3
- Unduhan resmi: https://mirabox.net/pages/download — "Stream Dock 3.10.203",
  compatible: 293, 293s, N3, N4, 298, H1, XL, N4 Pro. (Versi lama 3.10.185.1120 juga
  mencantumkan M18, N1.)
- Mirror/CN: https://mirabox.key123.vip/download (SPA; konten sama)
- FAQ resmi driver: https://support.key123.vip/faqs/streamDock.html
  (`key123.vip/win`, `key123.vip/mac`; syarat Win7 64-bit+ / macOS 10.15+)
- Plugin store resmi: https://space.key123.vip/ — plugin dipublikasikan ke "Space".
- **[FAKTA]** Target utama SDK; `.sdPlugin` dipasang di
  `%appdata%\HotSpot\StreamDock\plugins\` (Win) atau
  `~/Library/Application Support/HotSpot/StreamDock/plugins/` (Mac).
  https://github.com/helviojunior/fifine-d6-plugins

### 4. Elgato Stream Deck
- Software resmi: Stream Deck app — https://www.elgato.com/us/en/s/stream-deck-app
- SDK & distribusi: folder `*.sdPlugin` lalu dipaketkan jadi `.streamDeckPlugin`
  via `streamdeck pack`; wajib lolos `streamdeck validate`.
  https://docs.elgato.com/streamdeck/sdk/guides/distribution/
- Elgato SDK v3 mewajibkan `Software.MinimumVersion: "7.1"` dan Node.js 24.
  https://docs.elgato.com/streamdeck/sdk/releases/upgrading/v3
- **[FAKTA]** Elgato TIDAK menyediakan jalur impor plugin StreamDock. Plugin
  StreamDock dengan `Software.MinimumVersion: "2.9"` tidak akan lolos validasi Elgato.
- **[FAKTA, informal]** Secara praktis protokolnya mirip; developer pihak ketiga
  merilis satu codebase untuk dua platform dengan manifest berbeda
  (contoh: MSFSDock, PilotsDock, iRaceDeck, Yandex Music) — tapi itu artinya
  **mem-build ulang/menyesuaikan manifest**, bukan "impor" langsung.

### 5. Loupedeck
- Unduhan resmi: https://loupedeck.com/downloads/ (Loupedeck Software + Loupedeck Marketplace)
- SDK resmi sekarang **Logi Actions SDK**; host app = Logi Options+ atau Loupedeck,
  plugin dikemas sebagai **`.lplug4`**, dijalankan oleh **Logi Plugin Service**.
  https://logitech.github.io/actions-sdk-docs/plugin-basics
  https://logitech.github.io/actions-sdk-docs/supported-devices
- **[FAKTA]** Tidak ada dukungan `.sdPlugin` sama sekali. Arsitektur (C# DLL /
  Node.js IPC) berbeda total dari WebSocket Elgato/StreamDock.

## Kompatibilitas Silang

### StreamDock ← plugin Elgato: **BISA (sebagian besar), tidak resmi** [FAKTA]
- Dokumentasi SDK StreamDock sendiri menyatakan: *"To ensure compatibility with Elgato,
  we use the same function names as theirs so that your plugin can be compatible with
  Elgato software"* (`connectElgatoStreamDeckSocket`).
  https://sdk.key123.vip/en/guide/registration.html
- RE Ajazz: *"The SDK is almost verbatim Elgato Stream Deck v6 … Existing `.sdPlugin`
  packages built for Elgato hardware load on Stream Dock with no edits in most cases."*
  https://github.com/Aiacos/ajazz-control-center/blob/develop/docs/protocols/streamdeck/akp_plugin_sdk.md
- Bukti praktis pengguna: plugin Elgato (Calendar, CPU Monitor, StreamElements)
  bekerja setelah di-unzip ke `%appdata%\HotSpot\StreamDock\plugins`; plugin
  dengan autentikasi OAuth (Streamlabs) gagal.
  https://bbs.key123.vip/forum.php?extra=&mod=viewthread&tid=1265
- Mirabox Space bahkan punya panduan mengakses *Elgato Marketplace order history*.
  https://support.key123.vip/faqs/space.html
- **Perbedaan yang diketahui [FAKTA]:**
  - `Controllers: ["Keypad","Knob"]` — StreamDock pakai `"Knob"`, bukan `"Encoder"`
    (versi baru sudah mulai mendukung `"Encoder"`, `setFeedback`, `setFeedbackLayout`).
  - `Encoder.layout` / layout display knob: tidak/belum didukung.
  - `touchTap` tidak didukung (butuh perubahan firmware).
  - Knob mengirim press+release bersamaan (tak ada event release terpisah).
  - Pada Windows, host menjalankan `CodePathWin` sebagai **executable native** —
    menunjuk langsung ke `.js` TIDAK jalan; butuh launcher `.exe` atau `Nodejs: {Version:"20"}`.
    Sumber: https://github.com/pre-martin/StreamDeckSimHubPlugin/issues/117
    dan https://github.com/helviojunior/fifine-d6-plugins

### Elgato ← plugin StreamDock: **TIDAK resmi** [FAKTA]
- Tidak ada fitur impor. Harus repack jadi `.streamDeckPlugin` dan manifest
  disesuaikan (`Software.MinimumVersion` ≥ 6.x/7.1, `Encoder` bukan `Knob`).
- Trik komunitas: ganti ekstensi `.streamDeckPlugin` → `.zip`, edit, kompres,
  rename jadi `.sdPlugin` untuk StreamDock (arah sebaliknya).
  https://github.com/pre-martin/StreamDeckSimHubPlugin/issues/117

## Merek lain yang memakai software yang sama (bonus) [FAKTA]
Semuanya ekosistem HotSpot/StreamDock, jadi plugin `.sdPlugin` kita juga jalan:
- **VSDinside** — software "VSD Craft" / Stream Dock, model VSD N3/M18/293S/N4 Pro
  (https://www.vsdplay.com/pages/download)
- **Fifine AmpliGame Stream Deck D6** — path `HotSpot/StreamDock/plugins`
  (https://github.com/helviojunior/fifine-d6-plugins)
- **SOOMFON, VAPOURD, KILOGOGRAPH, HALCONTORNO, Nouvolo** — disebut satu ekosistem
  Mirabox (https://iracedeck.com/docs/getting-started/installation/)
- **Mars Gaming MSD-TWO, TreasLin N3, Redragon Skyrider SS-551** — rebadge N3
  (katalog VID/PID: https://github.com/Aiacos/ajazz-control-center/blob/develop/docs/protocols/streamdeck/_research-sources.md)

## Yang TIDAK ditemukan buktinya
- Nama produk resmi "Pressplay N3 Mini" / "Pressplay N3 Pro" di kanal resmi Press Play.
- Pernyataan resmi Mirabox/Elgato tentang dukungan impor plugin lintas platform
  (yang ada hanya dokumentasi SDK + bukti komunitas).
- Halaman unduh resmi AKP815 di domain ajazz internasional selain
  `ajazz.key123.vip/win` dan `ajazzstore.com/blogs/software/ajazz-akp815-driver`
  (yang terakhir hanya menyebut "Download Driver (Windows Only)" tanpa nama produk software).
- Versi minimum Stream Dock app yang dibutuhkan masing-masing merek rebrand
  (Pressplay dll.) — installer yang mereka tautkan adalah build generik Mirabox.

## Gambar tombol (`setImage`)

Riset: 2026-10-30, dari dokumentasi SDK Stream Dock.

- **[FAKTA]** Event `setImage` menerima `image` berupa data URI base64 (contoh di dokumen:
  `data:image/png;base64,…`, `jpg`, `gif`), dengan `target` (0 hardware dan software, 1 hanya
  hardware, 2 hanya software) dan `state` opsional. Dokumen yang sama menulis "This API also
  accepts SVG images" dengan contoh `data:image/svg+xml;charset=utf8,<svg></svg>`.
  https://sdk.key123.vip/en/guide/events-sent.html
- **[FAKTA]** Panduan gaya SDK: ikon tombol 128 x 128 px, ikon action 40 x 40, ikon kategori
  48 x 48, ikon plugin 128 x 128; "Use vector images whenever possible". Resolusi layar tiap
  perangkat tidak disebut. https://sdk.key123.vip/en/guide/style-guide.html
- **[TIDAK DITEMUKAN BUKTI]** Laporan bahwa SVG data URI tampil hitam di perangkat StreamDock.
  Laporan ini dikutip di README dan di `plugin/lib/feedback.js`, tadinya dengan rujukan ke
  dokumen ini, padahal dokumen ini tidak memuatnya. Tidak ada sumber untuk klaim itu, ia
  bertentangan dengan dokumentasi SDK di atas, dan belum diuji di perangkat.
- **Keputusan:** plugin memakai PNG (`static/icons/`, dibuat oleh `tools/make-key-icons.js`)
  karena aman di kedua kemungkinan. Kalau kelak diuji di perangkat dan SVG ternyata tampil
  benar, jalur SVG bisa menggantikannya tanpa langkah rasterisasi.

## Implikasi untuk plugin Trakteer
1. Satu build `.sdPlugin` (manifest `Software.MinimumVersion: "2.9"`) menjangkau
   Mirabox + Ajazz + Pressplay + VSDinside + Fifine + rebrand lain. **FAKTA**
2. Jika perlu `SDNodeJsSDKV2` (`MinimumVersion 3.10.188.226`), cek: rilis stabil
   Mirabox saat ini 3.10.203 (OK), tapi **Stream Dock AJAZZ 1.0/2.0 belum tentu
   mencapai versi itu** — perlu verifikasi di perangkat. **ASUMSI/risiko**
3. Jangan menunjuk `CodePathWin` ke `.js` mentah. Gunakan blok `Nodejs: {Version:"20"}`
   atau launcher native. **FAKTA**
4. Elgato Stream Deck butuh build terpisah (manifest berbeda + `.streamDeckPlugin`).
   Loupedeck butuh plugin `.lplug4` yang ditulis ulang total. **FAKTA**
