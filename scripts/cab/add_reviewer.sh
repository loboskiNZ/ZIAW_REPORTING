#!/bin/bash
source "$(dirname "$0")/config.sh"

REVIEWER_ID=$1
ROLE=$2

if [ -z "$REVIEWER_ID" ] || [ -z "$ROLE" ]; then
  echo "Usage: $0 <reviewer_id> <role>"
  echo "  role: CHAIR or MEMBER"
  exit 1
fi

curl -s -X POST "${BASE_URL}/api/workspaces/${WORKSPACE_ID}/cab/reviewers" \
  -H "X-Actor-ID: ${ACTOR_ID}" \
  -H "Content-Type: application/json" \
  -d "{\"reviewer_id\": \"$REVIEWER_ID\", \"role\": \"$ROLE\"}" \
  | json_pp 2>/dev/null || cat
