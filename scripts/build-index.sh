#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INDEX_FILE="$REPO_ROOT/scaffolds-index.yaml"
QUICKSTARTS_DIR="$REPO_ROOT/quickstarts"

check_dependencies() {
  if ! command -v yq &> /dev/null; then
    echo "ERROR: yq is required but not installed." >&2
    echo "Install: https://github.com/mikefarah/yq#install" >&2
    exit 1
  fi
}

list_scaffold_files() {
  local scaffold_dir="$1"
  # List all files relative to the scaffold directory.
  # Exclude hidden files except .secrets.yaml.example.
  find "$scaffold_dir" -type f \
    | sed "s|^${scaffold_dir}/||" \
    | grep -v '^\.' \
    | sort
  # Include .secrets.yaml.example if it exists
  if [ -f "$scaffold_dir/.secrets.yaml.example" ]; then
    echo ".secrets.yaml.example"
  fi
}

build_scaffold_entry() {
  local scaffold_dir="$1"
  local name
  name="$(basename "$scaffold_dir")"
  local scaffold="$scaffold_dir/scaffold.yaml"

  if [ ! -f "$scaffold" ]; then
    echo "WARNING: skipping $name -- no scaffold.yaml" >&2
    return
  fi

  if [ ! -f "$scaffold_dir/workflow.yaml" ]; then
    echo "WARNING: skipping $name -- no workflow.yaml" >&2
    return
  fi

  # Read metadata fields from scaffold.yaml
  local display_name description category author min_version complexity
  display_name="$(yq eval '.displayName' "$scaffold")"
  description="$(yq eval '.description' "$scaffold")"
  category="$(yq eval '.category' "$scaffold")"
  author="$(yq eval '.author' "$scaffold")"
  min_version="$(yq eval '.minTentacularVersion' "$scaffold")"
  complexity="$(yq eval '.complexity' "$scaffold")"

  # Build tags array
  local tags
  tags="$(yq eval '.tags' "$scaffold")"

  # Build files array
  local files_yaml=""
  while IFS= read -r file; do
    [ -z "$file" ] && continue
    files_yaml="${files_yaml}      - \"${file}\""$'\n'
  done < <(list_scaffold_files "$scaffold_dir")

  printf '    - name: "%s"\n' "$name"
  printf '      displayName: "%s"\n' "$display_name"
  printf '      description: "%s"\n' "$description"
  printf '      category: "%s"\n' "$category"
  printf '      tags: %s\n' "$tags"
  printf '      author: "%s"\n' "$author"
  printf '      minTentacularVersion: "%s"\n' "$min_version"
  printf '      complexity: "%s"\n' "$complexity"
  printf '      path: "quickstarts/%s"\n' "$name"
  printf '      files:\n'
  printf '%s' "$files_yaml"
}

build_index() {
  local generated
  generated="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  local header
  header="$(cat <<HEADER
version: "1"
generated: "${generated}"
scaffolds:
HEADER
)"

  local entries=""
  # Sort scaffold directories by name
  for scaffold_dir in $(find "$QUICKSTARTS_DIR" -mindepth 1 -maxdepth 1 -type d | sort); do
    local entry
    entry="$(build_scaffold_entry "$scaffold_dir")"
    if [ -n "$entry" ]; then
      entries="${entries}${entry}"$'\n'
    fi
  done

  if [ -z "$entries" ]; then
    # No scaffolds found -- write empty index
    cat > "$INDEX_FILE" <<EOF
version: "1"
generated: "${generated}"
scaffolds: []
EOF
  else
    printf '%s\n%s' "$header" "$entries" > "$INDEX_FILE"
  fi

  echo "Generated $INDEX_FILE"
}

main() {
  check_dependencies

  if [ ! -d "$QUICKSTARTS_DIR" ]; then
    echo "No quickstarts/ directory found. Creating empty index." >&2
    mkdir -p "$QUICKSTARTS_DIR"
  fi

  build_index
}

main "$@"
