#!/usr/bin/env bash
# Runs the database authorization tests against a throw-away local PostgreSQL.
# Usage: tests/sql/run.sh <psql connection options, e.g. -h /var/tmp/wpg -p 5544 -U postgres>
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=wishly_test_$$
psql "$@" -q -c "create database $DB" >/dev/null
trap 'psql "$@" -q -c "drop database if exists $DB" >/dev/null' EXIT
psql "$@" -d "$DB" -q -v ON_ERROR_STOP=1 -f tests/sql/supabase_shim.sql >/dev/null
psql "$@" -d "$DB" -q -v ON_ERROR_STOP=1 -f supabase/schema.sql >/dev/null
psql "$@" -d "$DB" -v ON_ERROR_STOP=1 -f tests/sql/test_rls.sql
