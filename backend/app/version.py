"""The app version, alone in a module with no imports of its own.

`config.py` re-exports it, `desktop_app.py` reads it before the window opens
(where pulling pandas in through config would delay the first frame), and
`desktop/scripts/build.mjs` parses this file to name the setup file. Bump it
here and everything else follows.
"""
from __future__ import annotations

APP_VERSION = "0.3.0"
