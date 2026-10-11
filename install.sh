#!/bin/sh
# Install the current local checkout of Zinin OS on this Mac.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEST="$HOME/.local/bin"
BIN="$DEST/zinin"
BUILD="$ROOT/dist/zinin.js"

if ! command -v bun >/dev/null 2>&1; then
  echo 'zinin: нужен установленный Bun' >&2
  exit 127
fi
if ! command -v git >/dev/null 2>&1; then
  echo 'zinin: нужен git для проверки версии checkout' >&2
  exit 127
fi

mkdir -p "$DEST" "$ROOT/dist"
bun build "$ROOT/src/cli.ts" --target bun --outfile "$BUILD"
chmod +x "$BUILD"

# Preserve the previous regular binary once; replacing a link needs no copy.
if [ -e "$BIN" ] && [ ! -L "$BIN" ]; then
  BACKUP="$BIN.legacy-$(date '+%Y%m%d-%H%M%S')-$$"
  mv "$BIN" "$BACKUP"
  echo "Старый бинарь сохранён: $BACKUP"
fi

TMP="$DEST/.zinin-new-$$"
trap 'rm -f "$TMP"' EXIT HUP INT TERM
ln -s "$BUILD" "$TMP"
mv -f "$TMP" "$BIN"

EXPECTED=$(git -C "$ROOT" rev-parse --short HEAD)
ACTUAL=$($BIN --version)
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "zinin: версия установки $ACTUAL не совпала с checkout $EXPECTED" >&2
  exit 1
fi
echo "Установлено: $BIN → $BUILD ($ACTUAL)"
