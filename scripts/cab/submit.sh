#!/bin/bash
source "$(dirname "$0")/config.sh"

curl -s -X POST "${BASE_URL}/api/workspaces/${WORKSPACE_ID}/cab/submit" \
  -H "Content-Type: application/json" \
  -H "X-Actor-ID: ${ACTOR_ID}" \
  -d '{}' \
  | json_pp 2>/dev/null || cat
