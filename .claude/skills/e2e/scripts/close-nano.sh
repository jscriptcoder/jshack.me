#!/usr/bin/env bash
# Closes the nano editor and returns only once the terminal is back for sure.
# Usage: close-nano.sh <session>
#
# ^X often needs more than one press, and a lone "editor gone" reading is noise:
# wait on the terminal's PRESENCE and believe it only twice in a row
# (see references/driving-the-terminal.md).
set -uo pipefail
session="$1"
browser() { agent-browser --session "$session" "$@"; }
terminal_back="(() => document.querySelector('input') !== null && document.querySelector('textarea') === null)()"

for _ in 1 2 3 4; do
  browser click "textarea"; browser press Control+x; sleep 3
  if [ "$(browser eval "$terminal_back" | tail -1)" = "true" ]; then
    sleep 2
    [ "$(browser eval "$terminal_back" | tail -1)" = "true" ] && exit 0
  fi
done
echo "nano did not close after 4 attempts" >&2
exit 1
