#!/usr/bin/env python3
"""MacroBuddy demo script: appends a timestamped line to a log in the OS temp dir."""

import os
import sys
import tempfile
import time

line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} hello from MacroBuddy args={sys.argv[1:]}"
out = os.path.join(tempfile.gettempdir(), "macrobuddy-demo.log")
with open(out, "a", encoding="utf-8") as f:
    f.write(line + "\n")
print(f"{line} -> {out}")
