#!/usr/bin/env bash
# Runs every automated check. Needs Node 18+, and for the database tests a
# local PostgreSQL 15+ you can connect to (pass psql options as arguments).
# Example: tests/run_all.sh -h localhost -U postgres
set -uo pipefail
cd "$(dirname "$0")/.."
echo "== Unit: matching engine";   TZ=UTC node tests/unit/engine.test.cjs | tail -1
echo "== Unit: English/Arabic text"; node tests/unit/i18n.test.cjs | tail -1
if [ "$#" -gt 0 ]; then echo "== Database authorization (PostgreSQL)"; tests/sql/run.sh "$@" | tail -4; else echo "== Database tests skipped (pass psql options to run them)"; fi
echo "== Browser end-to-end (Playwright + Chromium)"
python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 & SERVER=$!
sleep 1; node tests/e2e/e2e.cjs http://127.0.0.1:8765 | tail -1; kill $SERVER
