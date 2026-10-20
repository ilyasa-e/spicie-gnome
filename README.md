# Spotify Floating Lyrics - Standalone GNOME Shell Extension

Ekstensi **GNOME Shell (GJS)** mandiri (*standalone*) untuk menampilkan lirik Spotify secara real-time langsung di desktop GNOME, tanpa membutuhkan Spicetify, Electron, atau modifikasi pada client Spotify.

---

## 🌟 Fitur Utama

1. **3 Mode Tampilan Sekaligus**:
   - **Taskbar / Top Bar Panel**: Menampilkan baris lirik yang sedang dinyanyikan langsung di panel atas GNOME.
   - **Desktop Floating Overlay HUD**: Lirik melayang transparan di atas semua window desktop (selalu di atas / *always-on-top*).
   - **System Tray Popup Menu**: Klik ikon di taskbar untuk melihat album art, kontrol pemutar (Play/Pause, Next, Prev), daftar lirik lengkap yang bergulir otomatis mengikuti lagu, dan tombol pintasan setting.

2. **100% Standalone (Bebas Spicetify)**:
   - Berkomunikasi langsung dengan Spotify resmi lewat standar Linux **MPRIS D-Bus** (`org.mpris.MediaPlayer2.spotify`).
   - Kebal terhadap pembaruan Spotify desktop karena tidak mengubah binary atau file Spotify.

3. **Multi-Source Lyrics & Transliterasi (Romanisasi)**:
   - **LRCLIB Provider**: Mengambil lirik sinkron milidetik secara gratis tanpa perlu login/token.
   - **Spicy Lyrics Provider (Apple Music Syllables)**: Opsional dapat diaktifkan di setting dengan memasukkan Spotify Web Token.
   - **Romanisasi Otomatis**: Transliterasi ke alfabet Latin/Romaji untuk lirik berbahasa Korea (Hangul), Jepang (Kana), dan Cyrillic.

4. **Kustomisasi Lengkap via GNOME Preferences (Libadwaita)**:
   - **Display & Behavior**:
     - Toggle Lirik di Top Bar Panel
     - Toggle Desktop Floating HUD
     - Posisi Floating (Top-Right, Top-Left, Bottom-Right, Bottom-Left, Center, Custom Drag)
     - Always on Top
     - Click Passthrough (klik mouse menembus lirik ke aplikasi di belakangnya)
   - **Appearance & Typography**:
     - Backdrop Background: 100% Transparan, Frosted Glass Blur, atau Dark Pill Card
     - Font Family & Font Size (12px - 48px)
     - Line Spacing (4px - 36px)
     - Toggle Romanisasi Romaji
     - Toggle & Token Spicy Lyrics API

---

## 🚀 Cara Instalasi

Jalankan script installer otomatis:

```bash
cd /mnt/dev/Dev/personal/spotify-floating-lyrics-gnome
./install.sh
```

Script akan:
1. Mengompilasi skema GSettings (`org.gnome.shell.extensions.spotify-floating-lyrics`).
2. Memasang ekstensi ke `~/.local/share/gnome-shell/extensions/spotify-floating-lyrics@norang.dev`.
3. Mengaktifkan ekstensi via `gnome-extensions enable`.

### Memuat Ulang GNOME Shell:
- **Di Wayland**: Log out dan log in kembali ke sesi GNOME.
- **Di X11**: Tekan `Alt + F2`, ketik `r`, lalu tekan `Enter`.

### Membuka Menu Pengaturan (Preferences):
```bash
gnome-extensions prefs spotify-floating-lyrics@norang.dev
```
Atau klik ikon Spotify di taskbar atas -> klik ikon gear pengaturan.

---

## 🧪 Menjalankan Pengujian (Testing)

Semua komponen dilengkapi unit test mandiri di GJS:

```bash
cd /mnt/dev/Dev/personal/spotify-floating-lyrics-gnome

# 1. Uji Validasi Skema GSettings & Metadata
bash tests/test_schema.sh

# 2. Uji D-Bus MPRIS & Pelacakan Posisi Waktu
gjs -m tests/test_mpris.js

# 3. Uji Provider Lirik & Romanizer (Hangul, Kana, Cyrillic)
gjs -m tests/test_lyrics.js

# 4. Uji Engine Sinkronisasi Baris Lirik
gjs -m tests/test_sync.js

# 5. Uji Sintaks Seluruh Modul Ekstensi
bash tests/test_extension.sh
```
