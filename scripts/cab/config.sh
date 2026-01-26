#!/bin/bash

# Configuration
export BASE_URL="${BASE_URL:-http://localhost:8080}"
export WORKSPACE_ID="${WORKSPACE_ID:-1}"

# Check for required ACTOR_ID
if [ -z "$ACTOR_ID" ]; then
    echo "Error: ACTOR_ID environment variable is not set."
    echo "Usage: ACTOR_ID=<userid> ./script.sh [args]"
    exit 1
fi
