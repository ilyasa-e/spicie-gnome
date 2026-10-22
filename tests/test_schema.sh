#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Running Schema and Scaffolding Verification ==="

# -----------------------------------------------------------------------------
# 1. Validate metadata.json
# -----------------------------------------------------------------------------
METADATA_FILE="$PROJECT_DIR/metadata.json"
if [[ ! -f "$METADATA_FILE" ]]; then
    echo "ERROR: metadata.json does not exist at $METADATA_FILE" >&2
    exit 1
fi

jq . "$METADATA_FILE" > /dev/null
echo "✓ metadata.json is valid JSON"

UUID=$(jq -r '.uuid // empty' "$METADATA_FILE")
SCHEMA_ID=$(jq -r '."settings-schema" // empty' "$METADATA_FILE")
VERSIONS=$(jq -r '."shell-version"[]?' "$METADATA_FILE" | tr '\n' ' ')

if [[ "$UUID" != "spotify-floating-lyrics@norang.dev" && "$UUID" != "spotify-floating-lyrics-gnome@norang.dev" ]]; then
    echo "ERROR: Unexpected UUID in metadata.json: '$UUID'" >&2
    exit 1
fi
echo "✓ UUID verified: $UUID"

if [[ "$SCHEMA_ID" != "org.gnome.shell.extensions.spotify-floating-lyrics" ]]; then
    echo "ERROR: Unexpected settings-schema in metadata.json: '$SCHEMA_ID'" >&2
    exit 1
fi
echo "✓ settings-schema verified: $SCHEMA_ID"

for ver in "46" "47" "48" "49" "50"; do
    if [[ ! "$VERSIONS" =~ $ver ]]; then
        echo "ERROR: Missing shell-version $ver in metadata.json" >&2
        exit 1
    fi
done
echo "✓ shell-versions verified: $VERSIONS"

# -----------------------------------------------------------------------------
# 2. Validate GSettings XML Schema Syntax & Compilation
# -----------------------------------------------------------------------------
SCHEMA_FILE="$PROJECT_DIR/schemas/org.gnome.shell.extensions.spotify-floating-lyrics.gschema.xml"
if [[ ! -f "$SCHEMA_FILE" ]]; then
    echo "ERROR: GSettings schema file not found at $SCHEMA_FILE" >&2
    exit 1
fi

glib-compile-schemas --strict --dry-run "$PROJECT_DIR/schemas"
echo "✓ glib-compile-schemas passed strictly with zero warnings"

# -----------------------------------------------------------------------------
# 3. Verify all 14 settings keys and types
# -----------------------------------------------------------------------------
EXPECTED_KEYS=(
    "show-in-panel"
    "show-floating"
    "floating-always-on-top"
    "floating-click-passthrough"
    "floating-position"
    "floating-x"
    "floating-y"
    "font-family"
    "font-size"
    "line-spacing"
    "background-style"
    "enable-spicy-lyrics"
    "spicy-lyrics-token"
    "enable-romanization"
)

for key in "${EXPECTED_KEYS[@]}"; do
    if ! grep -q "name=\"$key\"" "$SCHEMA_FILE"; then
        echo "ERROR: Schema missing key: $key" >&2
        exit 1
    fi
done
echo "✓ All 14 settings keys present in schema"

# -----------------------------------------------------------------------------
# 4. Validate Core Stylesheet Classes
# -----------------------------------------------------------------------------
STYLESHEET_FILE="$PROJECT_DIR/stylesheet.css"
if [[ ! -f "$STYLESHEET_FILE" ]]; then
    echo "ERROR: stylesheet.css not found at $STYLESHEET_FILE" >&2
    exit 1
fi

REQUIRED_CLASSES=(
    "floating-lyrics-box"
    "floating-lyrics-line"
    "floating-lyrics-active"
    "panel-lyric-label"
)

for cls in "${REQUIRED_CLASSES[@]}"; do
    if ! grep -q "\.$cls" "$STYLESHEET_FILE"; then
        echo "ERROR: stylesheet.css missing required class: .$cls" >&2
        exit 1
    fi
done
echo "✓ stylesheet.css contains required base classes"

# -----------------------------------------------------------------------------
# 5. Compile schemas for downstream unit and integration tests
# -----------------------------------------------------------------------------
glib-compile-schemas "$PROJECT_DIR/schemas"
echo "✓ Compiled schemas to $PROJECT_DIR/schemas/gschemas.compiled"

echo "PASS: metadata and schema valid"
exit 0
