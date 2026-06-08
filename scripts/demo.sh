#!/usr/bin/env bash
# MacroBuddy demo script: appends a timestamped line to a log in the OS temp dir.
set -euo pipefail

line="$(date '+%Y-%m-%d %H:%M:%S') hello from MacroBuddy args=$*"
out="${TMPDIR:-/tmp}/macrobuddy-demo.log"
echo "$line" >>"$out"
echo "$line -> $out"
