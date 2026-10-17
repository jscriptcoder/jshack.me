#!/usr/bin/env bash
# Types ONE command at the game's terminal prompt and submits it.
# Usage: type-command.sh <session> "<command>"
#
# Each step guards a silent failure (see references/driving-the-terminal.md):
# the <input> is gone while a command runs, a type right after Enter lands in
# nothing, and Git Bash rewrites anything that looks like an absolute unix path.
set -euo pipefail
session="$1"
cmd="$2"
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'
browser() { agent-browser --session "$session" "$@"; }

for _ in $(seq 1 60); do
  [ "$(browser eval "(() => document.querySelector('input') !== null)()" | tail -1)" = "true" ] && break
  sleep 1
done

browser eval "(() => { const input = document.querySelector('input'); input.focus(); input.value = ''; })()" > /dev/null
browser keyboard type "$cmd"
typed=$(browser eval "(() => document.querySelector('input').value)()" | tail -1)
if [ "$typed" != "\"$cmd\"" ] && [ "$typed" != "$cmd" ]; then
  echo "typed $typed, expected $cmd — not submitting" >&2
  exit 1
fi
browser press Enter
