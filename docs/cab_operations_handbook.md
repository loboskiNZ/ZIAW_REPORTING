# CAB Operations Handbook

## SECTION 1 — Purpose

The Change Advisory Board (CAB) governs the transition of workspaces from the `VERIFY_CAB` stage to the `RELEASE` stage. This handbook covers the operational procedures for managing CAB reviews, including role management, voting procedures, evidence requirements, and Service Level Agreement (SLA) enforcement. It serves as the authoritative guide for CAB Chairs, Members, and system auditors to ensure compliant and efficient change management.

## SECTION 2 — Roles

Reviewers are managed in the `cab_reviewers` table.

### CHAIR
- **Authority**: High
- **Capabilities**:
    - **Submit**: Can submit a workspace for CAB review.
    - **Vote**: Can cast an approval vote (`CHAIR_APPROVED`).
    - **Reject**: Can reject a review (`REJECTED`).
    - **Manage Reviewers**: Can add or remove other Chairs and Members.
    - **Attach Evidence**: Can attach supporting evidence.

### MEMBER
- **Authority**: Standard
- **Capabilities**:
    - **Submit**: Can submit a workspace for CAB review.
    - **Vote**: **Cannot** cast approval votes.
    - **Reject**: **Cannot** reject reviews.
    - **Attach Evidence**: Can attach supporting evidence.

## SECTION 3 — System States

### Workspace Fields
- **pipeline_stage**:
    - `VERIFY_CAB`: The holding stage where CAB review occurs.
    - `RELEASE`: The destination stage after successful CAB approval.
- **cab_readiness_status**:
    - `NOT_READY`: Default state, or after rejection/expiry.
    - `PENDING_REVIEW`: Active state when a review is in progress.
- **cab_review_state**:
    - `NONE`: No review active.
    - `IN_REVIEW`: Review process is ongoing.
    - `APPROVED`: Quorum reached, change approved.
    - `REJECTED`: Explicitly rejected by a Chair.
    - `EXPIRED`: SLA time limit exceeded.
- **cab_required_approvals**: Number of `CHAIR_APPROVED` votes required (Default: 2).
- **cab_approval_count**: Current number of valid Chair votes.
- **cab_submitted_at**: Timestamp of submission.
- **cab_expires_at**: Timestamp when the review window closes (Submission + 72 hours).

## SECTION 4 — Standard Operating Procedure (SOP)

1.  **Ensure at least one CHAIR exists**:
    - Use `list_reviewers.sh` to confirm a Chair is available to manage the process.
2.  **Confirm readiness**:
    - Ensure all required checklists are PASS in the `VERIFY_CAB` stage.
    - Ensure a valid snapshot exists.
3.  **Submit for CAB review**:
    - A Member or Chair triggers submission via `submit.sh`.
    - This sets the 72-hour SLA window.
4.  **Attach evidence**:
    - Reviewers attach Links, Notes, or Files to justify the change via `curl` (see Section 7).
5.  **Chairs cast approval votes**:
    - Chairs independently review and approve via `approve.sh`.
    - Each Chair can only vote once per review cycle.
6.  **Quorum reached → stage advances**:
    - Once `cab_approval_count` meets `cab_required_approvals` (2), the system automatically acts.
    - `cab_review_state` becomes `APPROVED`.
    - `pipeline_stage` advances to `RELEASE`.
7.  **Rejection or expiry handling**:
    - If rejected via `reject.sh`, status resets to `NOT_READY`.
    - If SLA expires, status automatically transitions to `EXPIRED`.
    - Issues must be resolved before re-submission.
8.  **Verify audit + governance report**:
    - Review `history.sh` and the Governance Report to confirm all actions are logged.

## SECTION 5 — Evidence Rules

- **Allowed Types**:
    - `LINK`: External URLs (e.g., design docs, Jira tickets).
    - `NOTE`: Text-based clarifications or reasoning.
    - `FILE`: References to uploaded files (path or object key).
- **Attachment Window**: Evidence can only be attached while `cab_review_state` is `IN_REVIEW`.
- **Audit Linkage**: Every piece of evidence is linked to a specific Audit Event ID (e.g., the Submission event or a specific Vote).
- **Immutability**: Once attached, evidence cannot be modified or deleted to ensure audit integrity.

## SECTION 6 — SLA & Expiry

- **Definition**: A strictly enforced **72-hour** window starting from the moment of submission (`cab_submitted_at`).
- **Expiry Behavior**:
    - If no decision is reached by `cab_expires_at`, any attempt to interact with the review triggers enforcement.
    - **Audit**: An `EXPIRED` event is logged (Actor: `SYSTEM`).
    - **State**: `cab_review_state` changes to `EXPIRED`.
    - **Readiness**: `cab_readiness_status` changes to `NOT_READY`.
- **Blocked Actions**:
    - `approve` (Voting)
    - `reject`
    - `attach evidence`
    - **Database Trigger**: Direct SQL inserts of `APPROVED`/`REJECTED` decisions are blocked at the database level.

## SECTION 7 — Verification & Troubleshooting

### Operational Commands
Assuming scripts are in `scripts/cab/`:

- **List Reviewers**: `sh list_reviewers.sh`
- **Add Reviewer**: `sh add_reviewer.sh <id> <role>`
- **Remove Reviewer**: `sh remove_reviewer.sh <id>`
- **Check Readiness**: `sh readiness.sh`
- **Submit**: `sh submit.sh`
- **Approve (Vote)**: `sh approve.sh`
- **Reject**: `sh reject.sh`
- **View History**: `sh history.sh`
- **Governance Report**: `curl -s http://localhost:8080/api/workspaces/1/governance/report | jq`

- **Attach Evidence (Curl Example)**:
  ```bash
  curl -X POST http://localhost:8080/api/workspaces/1/cab/evidence \
    -H "Content-Type: application/json" \
    -H "x-actor-id: quorum_chair_1" \
    -d '{
      "audit_id": 123,
      "evidence_type": "NOTE",
      "evidence_value": "Performance tests passed."
    }'
  ```

### Development Verification
- **Run Migrations**: `node run_migration_v12.js`
- **Run Unit/Integration Tests**:
    - `node tests/CabQuorum.test.js`
    - `node tests/CabEvidence.test.js`
    - `node tests/CabSla.test.js`

### Common Errors
- **`403 CAB_NOT_CHAIR`**: The `x-actor-id` actor does not have the `CHAIR` role required for this action.
- **`409 CAB_NOT_IN_REVIEW`**: Detailed checks require the review to be active. Check if the review has already been approved, rejected, or expired.
- **`409 CAB_EXPIRED`**: The 72-hour validation window has passed. Steps must be taken to re-submit or reset validity.

## SECTION 8 — Audit Expectations

All state transitions produce an immutable `stage_transition_log` entry.

- **`SUBMITTED`**: Marks the start of the review and SLA timer.
- **`CHAIR_APPROVED`**: Represents a single vote from a Chair. Does **not** change the stage.
- **`APPROVED`**: Generated automatically when Quorum (2 votes) is reached. Moves stage to `RELEASE`.
- **`REJECTED`**: Explicit stop by a Chair. Resets readiness to `NOT_READY`.
- **`EXPIRED`**: System-generated event when the SLA window closes.

**Evidence Retrieval**:
Evidence counts are visible in the history summary. Full details are retrieved via the Evidence API, strictly filtered by Workspace ID.

## SECTION 9 — Authentication & Security
- **DEV Mode**: Uses `X-Actor-ID` header for easy testing and CLI usage.
- **ENTRA Mode**: Uses Microsoft Entra ID (OIDC).
  - Users MUST login via `/auth/entra/login`.
  - CLI scripts using `X-Actor-ID` will fail in this mode.
  - Reviewer IDs are strictly `tid:oid`.

