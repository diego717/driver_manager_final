#!/usr/bin/env python3
"""
Compat wrapper for the historical embed_dashboard.py entrypoint.

build_dashboard.py is the canonical implementation. This file remains only
to preserve existing docs and operator habits.
"""

from __future__ import annotations

from build_dashboard import update_worker


def main() -> int:
    return 0 if update_worker() else 1


if __name__ == "__main__":
    raise SystemExit(main())
