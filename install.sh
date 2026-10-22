#!/usr/bin/env bash
# Installer for Spicie GNOME Shell Extension
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UUID="spotify-floating-lyrics@norang.dev"
TARGET_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

echo "======================================================="
echo "🎵 Installing Spicie GNOME Extension..."
echo "======================================================="

# 1. Compile GSettings schemas in source directory
echo "📦 Compiling GSettings schemas..."
glib-compile-schemas "${SCRIPT_DIR}/schemas"

# 2. Prepare destination directory
echo "📁 Target directory: ${TARGET_DIR}"
rm -rf "${TARGET_DIR}"
mkdir -p "${TARGET_DIR}"

# 3. Copy extension files
echo "🚀 Copying extension files..."
cp "${SCRIPT_DIR}/metadata.json" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/stylesheet.css" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/extension.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/indicator.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/popupMenu.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/playerCard.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/playerLyrics.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/playerArtwork.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/playerTheme.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/mpris.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/lyricsProvider.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/lyricsRequest.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/lyricsSync.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/lyricsPresentation.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/hudLifecycle.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/lyricsView.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/lyricsAttribution.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/sourceCredits.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/ttmlParser.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/karaokeTiming.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/karaokeLayout.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/romanizer.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/prefs.js" "${TARGET_DIR}/"
cp "${SCRIPT_DIR}/lyricsPreview.js" "${TARGET_DIR}/"

# Copy binary helpers (Smooth Standalone HUD)
mkdir -p "${TARGET_DIR}/bin"
cp "${SCRIPT_DIR}/bin/spotify-floating-hud" "${TARGET_DIR}/bin/"
chmod +x "${TARGET_DIR}/bin/spotify-floating-hud"

# Copy schemas
mkdir -p "${TARGET_DIR}/schemas"
cp -r "${SCRIPT_DIR}/schemas/"* "${TARGET_DIR}/schemas/"

# 4. Compile schemas in target directory
glib-compile-schemas "${TARGET_DIR}/schemas"

# 5. Enable extension
echo "✨ Enabling extension ${UUID}..."
if command -v gnome-extensions >/dev/null 2>&1; then
    gnome-extensions enable "${UUID}" || true
    echo "✅ Extension enabled successfully!"
else
    echo "⚠️ gnome-extensions command not found. Please enable it in GNOME Extensions app."
fi

echo "======================================================="
echo "🎉 Installation Complete!"
echo "👉 Note for GNOME Shell:"
echo "   - On X11: Press Alt+F2, type 'r', and press Enter to reload GNOME Shell."
echo "   - On Wayland: Log out and log back in, or run:"
echo "     gnome-extensions enable ${UUID}"
echo "   - To open settings: gnome-extensions prefs ${UUID}"
echo "======================================================="
