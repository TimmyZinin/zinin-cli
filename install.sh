#!/bin/sh
# ZININ CLI — установщик одной командой. Mac / Linux. Без Node, без Homebrew.
#   curl -fsSL https://zinin.ai/install | sh
set -e

REPO="TimmyZinin/zinin-cli"
DEST="$HOME/.local/bin"
BIN="$DEST/zinin"

OS=$(uname -s); ARCH=$(uname -m)
case "$OS" in
  Darwin) T="darwin" ;;
  Linux)  T="linux" ;;
  *) echo "ZININ: ОС $OS пока не поддержана. Напиши @timzinin."; exit 1 ;;
esac
case "$ARCH" in
  arm64|aarch64) A="arm64" ;;
  x86_64|amd64)  A="x64" ;;
  *) echo "ZININ: архитектура $ARCH не поддержана."; exit 1 ;;
esac

URL="https://github.com/$REPO/releases/latest/download/zinin-$T-$A"

printf '\n  Ставлю ZININ (%s-%s)…\n' "$T" "$A"
mkdir -p "$DEST"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$URL" -o "$BIN"
else
  wget -qO "$BIN" "$URL"
fi
chmod +x "$BIN"

# гарантируем, что ~/.local/bin в PATH
case ":$PATH:" in
  *":$DEST:"*) PATH_OK=1 ;;
  *) PATH_OK=0 ;;
esac
if [ "$PATH_OK" = "0" ]; then
  for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.profile"; do
    [ -f "$rc" ] && ! grep -q '.local/bin' "$rc" 2>/dev/null && \
      printf '\nexport PATH="%s:$PATH"\n' "$DEST" >> "$rc"
  done
  echo "  Добавил ~/.local/bin в PATH (новый терминал подхватит)."
fi

printf '\n  Готово. Запусти: \033[1mzinin\033[0m\n'
printf '  (если «команда не найдена» — открой новый терминал)\n\n'
