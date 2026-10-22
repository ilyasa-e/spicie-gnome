#!/usr/bin/env bash
set -e
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Verifying Extension Code and Syntax ==="

# 1. Metadata JSON validity
jq . "$PROJECT_DIR/metadata.json" > /dev/null
echo "✓ metadata.json is valid JSON"

# 2. Strict Schema Compilation
glib-compile-schemas --strict --dry-run "$PROJECT_DIR/schemas"
echo "✓ GSettings schema compiles strictly without warnings"

# 3. Check syntax of all JavaScript ES Modules
for f in "$PROJECT_DIR"/*.js; do
    if [ -f "$f" ]; then
        # Use gjs -c in temp file or check imports
        python3 -c "
import subprocess, sys
res = subprocess.run(['gjs', '-m', '-c', 'import * as mod from \"$f\";'], capture_output=True, text=True)
if 'SyntaxError' in res.stderr:
    print(f'SyntaxError in $f:\n{res.stderr}')
    sys.exit(1)
" || {
            echo "✗ Syntax check failed for $f"
            exit 1
        }
        echo "✓ Syntax valid: $(basename "$f")"
    fi
done

echo "=========================================="
echo "PASS: All extension files verified successfully!"
echo "=========================================="
