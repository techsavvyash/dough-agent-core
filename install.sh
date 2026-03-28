#!/bin/sh
# Install the `dough` CLI globally
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_ENTRY="$REPO_DIR/packages/cli/src/index.ts"

# Ensure bun is available
if ! command -v bun >/dev/null 2>&1; then
  echo "Error: bun is required. Install it: https://bun.sh"
  exit 1
fi

# Install dependencies
echo "Installing dependencies..."
cd "$REPO_DIR" && bun install --frozen-lockfile 2>/dev/null || bun install

# Find a writable directory in PATH
TARGET=""
for dir in "$HOME/.local/bin" "$HOME/.bun/bin" /usr/local/bin; do
  if [ -d "$dir" ] && [ -w "$dir" ]; then
    TARGET="$dir"
    break
  fi
done

# Create ~/.local/bin if nothing found (it's the XDG standard)
if [ -z "$TARGET" ]; then
  TARGET="$HOME/.local/bin"
  mkdir -p "$TARGET"
  echo "Created $TARGET — add it to your PATH:"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi

# Create the symlink
ln -sf "$CLI_ENTRY" "$TARGET/dough"
chmod +x "$CLI_ENTRY"

echo ""
echo "✓ Installed dough → $TARGET/dough"
echo ""
echo "Usage:"
echo "  dough              Launch TUI (starts server if needed)"
echo "  dough server start Start server daemon only"
echo "  dough server stop  Stop server daemon"
echo "  dough --help       Show all commands"
