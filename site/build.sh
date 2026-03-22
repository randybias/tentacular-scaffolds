#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
INDEX_FILE="$REPO_ROOT/scaffolds-index.yaml"
OUTPUT_DIR="$SCRIPT_DIR/data"
OUTPUT_FILE="$OUTPUT_DIR/scaffolds.json"

if [[ ! -f "$INDEX_FILE" ]]; then
  echo "ERROR: scaffolds-index.yaml not found at $INDEX_FILE" >&2
  exit 1
fi

if ! command -v yq &>/dev/null; then
  echo "ERROR: yq is required but not installed" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

yq -o=json "$INDEX_FILE" > "$OUTPUT_FILE"

echo "Generated $OUTPUT_FILE from $INDEX_FILE"
