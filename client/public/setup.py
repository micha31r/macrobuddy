# /// script
# requires-python = ">=3.9"
# ///
"""
MacroBuddy host setup — get the code, install, build, and start the server.

Run it with uv (no Python setup needed — uv fetches and runs this script):

    uv run https://macrobuddy.dev/setup.py

It clones/updates the repo to ~/macrobuddy, then runs `npm install`,
`npm run build`, and `npm start`. The server prints QR codes — scan one with
your phone to open your pad.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

# Change this one line if the repo moves.
REPO = "https://github.com/micha31r/macrobuddy.git"
DEST = Path.home() / "macrobuddy"


def have(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def run(args: list[str], cwd: Path | None = None) -> None:
    print(f"\n$ {' '.join(args)}")
    subprocess.run(args, cwd=str(cwd) if cwd else None, check=True)


def main() -> None:
    if not have("git"):
        sys.exit("git is required — install it from https://git-scm.com and re-run.")
    if not have("node") or not have("npm"):
        sys.exit("Node.js is required — install the LTS from https://nodejs.org and re-run.")

    if (DEST / ".git").exists():
        print(f"Updating {DEST} …")
        run(["git", "-C", str(DEST), "pull", "--ff-only"])
    else:
        print(f"Cloning into {DEST} …")
        run(["git", "clone", REPO, str(DEST)])

    npm = "npm.cmd" if os.name == "nt" else "npm"
    run([npm, "install"], cwd=DEST)
    run([npm, "run", "build"], cwd=DEST)

    print("\nStarting MacroBuddy — scan a QR code below with your phone.\n")
    run([npm, "start"], cwd=DEST)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        sys.exit(f"\nA step failed (exit {exc.returncode}). Fix the error above and re-run.")
    except KeyboardInterrupt:
        print("\nStopped.")
