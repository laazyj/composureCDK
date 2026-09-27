#!/bin/bash
# SessionStart hook for Claude Code on the web: arrive with the toolchain
# `nx verify` (and so the husky pre-push hook) needs. See AGENTS.md#build-system.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo '{"async": true, "asyncTimeout": 300000}'

cd "$CLAUDE_PROJECT_DIR"

# npm 11 via npx, not `npm install -g npm@11`; see AGENTS.md#build-system.
# Skipped while npm's own record of the last install is newer than the lockfile,
# so resume/clear/compact do not wipe and rebuild an up-to-date tree.
if [ ! package-lock.json -ot node_modules/.package-lock.json ]; then
  npx -y npm@11 ci
fi

# `verify` runs actionlint, which refuses to run without shellcheck.
if ! command -v shellcheck >/dev/null; then
  apt-get update -qq && apt-get install -y -qq shellcheck >/dev/null
fi
