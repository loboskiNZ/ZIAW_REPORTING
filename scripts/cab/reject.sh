#!/bin/bash
source "$(dirname "$0")/config.sh"

curl -s -X POST "${BASE_URL}/api/workspaces/${WORKSPACE_ID}/cab/reject" \
  -H "X-Actor-ID: ${ACTOR_ID}" \
  | json_pp 2>/dev/null || cat
