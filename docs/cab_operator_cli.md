# CAB Operator CLI

Overview
This directory (`scripts/cab`) contains a set of shell scripts to manage the CAB Reviewer workflow without a UI.

## Setup
The scripts depend on environment variables to identify the workspace and the acting user.

### 1. Identify your Actor ID
You must know your user ID (e.g., `user_123`).

### 2. Configure Environment (Optional)
The scripts use `scripts/cab/config.sh`.
Defaults:
- `BASE_URL`: `http://localhost:3000`
- `WORKSPACE_ID`: `1`

You can override these by exporting them before running commands:
```bash
export WORKSPACE_ID=9001
export BASE_URL=http://production-api.internal
```

## Usage API

### Authentication Modes
- **DEV Mode** (Default): `ACTOR_ID` is passed as a header (`X-Actor-ID`). This is what CLI scripts use.
- **ENTRA Mode**: CLI scripts are intended for automation/service accounts or dev testing. For real Entra usage, users must login via browser at `/auth/entra/login` to establish a session.
- **Reviewer IDs in Entra**: When using Entra, reviewer IDs are formatted as `tenant_id:object_id` (e.g., `tid:oid`).

A valid `ACTOR_ID` is **REQUIRED** for every command in DEV mode. You can pass it inline:

```bash
ACTOR_ID=admin_chair ./scripts/cab/list_reviewers.sh
```

### 1. Manage Reviewers

#### Add a Chair
```bash
ACTOR_ID=current_chair ./scripts/cab/add_reviewer.sh new_chair_user CHAIR
```

#### Add a Member
```bash
ACTOR_ID=current_chair ./scripts/cab/add_reviewer.sh member_user MEMBER
```

#### List Reviewers
```bash
ACTOR_ID=current_chair ./scripts/cab/list_reviewers.sh
```

#### Remove a Reviewer
```bash
ACTOR_ID=current_chair ./scripts/cab/remove_reviewer.sh member_user
```

### 2. CAB Workflow

#### Check Readiness
```bash
ACTOR_ID=user_123 ./scripts/cab/readiness.sh
```

#### Submit for CAB
```bash
ACTOR_ID=user_123 ./scripts/cab/submit.sh
```

#### Approve (Chair Only)
```bash
ACTOR_ID=chair_user ./scripts/cab/approve.sh
```

#### Reject (Chair Only)
```bash
ACTOR_ID=chair_user ./scripts/cab/reject.sh
```

#### View History
```bash
ACTOR_ID=user_123 ./scripts/cab/history.sh
```
