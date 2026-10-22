#!/usr/bin/env bash
# ==============================================================================
# Spotify Floating Lyrics GNOME Extension - Headless E2E Test Suite Runner
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=================================================================="
echo " Running Spotify Floating Lyrics E2E Test Suite"
echo " Project Directory: $PROJECT_DIR"
echo "=================================================================="

# Export GI_TYPELIB_PATH for Mutter and GNOME Shell typelibs if present
export GI_TYPELIB_PATH="/usr/lib/gnome-shell:/usr/lib/x86_64-linux-gnu/mutter-18:${GI_TYPELIB_PATH:-}"

# Validate GSettings schemas if present
if [ -d "$PROJECT_DIR/schemas" ] && [ -f "$PROJECT_DIR/schemas/org.gnome.shell.extensions.spotify-floating-lyrics.gschema.xml" ]; then
    echo "Compiling and validating root GSettings schemas..."
    glib-compile-schemas --strict --dry-run "$PROJECT_DIR/schemas"
    echo "✔ Root GSettings schema compilation successful."
else
    echo "Validating test fixture GSettings schema..."
    FIXTURE_SCHEMA_DIR="$SCRIPT_DIR/fixtures"
    # Create temporary directory for fixture compile validation
    TMP_SCHEMA_DIR=$(mktemp -d)
    cp "$FIXTURE_SCHEMA_DIR/sample_schema.xml" "$TMP_SCHEMA_DIR/org.gnome.shell.extensions.spotify-floating-lyrics.gschema.xml"
    glib-compile-schemas --strict --dry-run "$TMP_SCHEMA_DIR"
    rm -rf "$TMP_SCHEMA_DIR"
    echo "✔ Test fixture schema compilation successful."
fi

# Determine runner executable: prefer gjs -m, fallback to node
if command -v gjs >/dev/null 2>&1; then
    echo "Executing via GJS (GNOME JavaScript):"
    gjs -m "$SCRIPT_DIR/runner.js"
elif command -v node >/dev/null 2>&1; then
    echo "Executing via Node.js:"
    node "$SCRIPT_DIR/runner.js"
else
    echo "ERROR: Neither 'gjs' nor 'node' found in PATH!"
    exit 1
fi

echo "=================================================================="
echo " E2E Test Suite Execution Complete. All Tiers Passed!"
echo "=================================================================="
