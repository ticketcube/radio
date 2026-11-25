#!/usr/bin/env bash
# One-line setup on a Mac:
#   curl -fsSL https://raw.githubusercontent.com/ticketcube/radio/main/tools/split-set/install.sh | bash
set -euo pipefail
BRANCH="${SPLIT_SET_BRANCH:-main}"
URL="https://raw.githubusercontent.com/ticketcube/radio/${BRANCH}/tools/split-set/split-set.py"

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is needed first. Install it from https://brew.sh, then run this again." >&2
  exit 1
fi
command -v ffmpeg >/dev/null 2>&1 || brew install ffmpeg
python3 -c 'import sys; sys.exit(sys.version_info < (3, 9))' 2>/dev/null || brew install python

BIN="$(brew --prefix)/bin"
curl -fsSL "$URL" -o "$BIN/split-set"
chmod +x "$BIN/split-set"

ENVFILE="$HOME/.otw-split-set.env"
if [ ! -f "$ENVFILE" ]; then
  curl -fsSL "https://raw.githubusercontent.com/ticketcube/radio/${BRANCH}/tools/split-set/.env.example" -o "$ENVFILE"
  chmod 600 "$ENVFILE"
  echo "Created $ENVFILE. Add your AzuraCast/AIMC keys there if you want uploads."
fi
echo "Installed: $(split-set --version). Try: split-set --help"
