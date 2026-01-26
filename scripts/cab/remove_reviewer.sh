#!/bin/bash
source "$(dirname "$0")/config.sh"

REVIEWER_ID=$1

if [ -z "$REVIEWER_ID" ]; then
  echo "Usage: $0 <reviewer_id>"
  exit 1
fi

curl -s -X DELETE "${BASE_URL}/api/workspaces/${WORKSPACE_ID}/cab/reviewers/${REVIEWER_ID}" \
  -H "X-Actor-ID: ${ACTOR_ID}" \
  | json_pp 2>/dev/null || cat
