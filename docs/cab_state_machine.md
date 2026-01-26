# CAB State Machine Reference

**Status:** Authoritative
**Scope:** Governance & Reporting Logic
**Version:** 1.0

This document defines the exact behavior of the Change Advisory Board (CAB) state machine. All engineering implementation, QA testing, and governance auditing must strictly align with this definition.

## SECTION 1 — Entities

### Workspace
The unit of governance.
- **`pipeline_stage`**: The current lifecycle phase. CAB governance applies specifically to the `VERIFY_CAB` stage.
- **`cab_readiness_status`**: The governance gate status.

### Snapshot
A point-in-time record of workspace health and compliance.
- **`is_valid`**: Boolean flag (1/0). Only **one** snapshot per workspace can be `is_valid=1` at any time. This allows strict "Latest Valid Snapshot" logic.

### Checklist
A set of required validation rules for each stage.
- **`VERIFY_CAB` Required Items**: Rules that must be satisfied (status `PASS` or `WAIVED`) before a workspace can be considered for CAB.

## SECTION 2 — States

### CAB Readiness Status
| Status | Description |
| :--- | :--- |
| **`NOT_READY`** | Default state. Criteria for CAB review have not been met, or the workspace was rejected. |
| **`PENDING_REVIEW`** | The workspace has met all automated criteria (Valid Snapshot, Passing Checklists) and has been formally submitted for review. |
| **`APPROVED`** | Transient state indicating successful CAB approval before stage transition. |

### Pipeline Stages (Governance Scope)
| Stage | Relevance |
| :--- | :--- |
| **`VERIFY_CAB`** | The holding stage where CAB governance is enforced. Workspaces cannot exit this stage without approval. |
| **`RELEASE`** | The target stage after successful CAB approval. |

## SECTION 3 — Events

1.  **Snapshot Creation**: Computing and persisting a new workspace snapshot.
2.  **Checklist Update**: Changing the status of a specific checklist item (e.g., uploading an artifact).
3.  **CAB Submit**: A human actor formally requesting CAB review.
4.  **CAB Approve**: A human actor (CAB member) approving the workspace for release.
5.  **CAB Reject**: A human actor rejecting the workspace, requiring remediation.
6.  **Pipeline Stage Transition**: Moving the workspace from one stage to another.

## SECTION 4 — Transition Rules

| Event | Preconditions | State Changes | Rejected If |
| :--- | :--- | :--- | :--- |
| **Evaluate Readiness** (System Internal) | `pipeline_stage` = `VERIFY_CAB`<br>Latest Snapshot `is_valid` = 1<br>All Required Checklists = `PASS`/`WAIVED` | `NOT_READY` → `PENDING_REVIEW` (Calculated only, not persisted until Submit) | Snapshot Missing/Invalid<br>Checklist Incomplete<br>Wrong Stage |
| **CAB Submit** | `pipeline_stage` = `VERIFY_CAB`<br>Actor = `HUMAN`<br>Readiness Logic evaluates to `PENDING_REVIEW` | `cab_readiness_status`: `NOT_READY` → `PENDING_REVIEW` | System evaluation fails (Criteria not met)<br>Actor is System |
| **CAB Approve** | `pipeline_stage` = `VERIFY_CAB`<br>`cab_readiness_status` = `PENDING_REVIEW`<br>Actor = `HUMAN` | 1. Log `APPROVED`<br>2. `cab_readiness_status`: → `APPROVED`<br>3. `pipeline_stage`: → `RELEASE`<br>4. `cab_readiness_status`: → `NOT_READY` | Status != `PENDING_REVIEW`<br>Stage != `VERIFY_CAB`<br>Missing/Failing Checklists |
| **CAB Reject** | `pipeline_stage` = `VERIFY_CAB`<br>`cab_readiness_status` = `PENDING_REVIEW` | 1. Log `REJECTED`<br>2. `cab_readiness_status`: → `NOT_READY` | Status != `PENDING_REVIEW` |
| **Stage Transition** (Generic) | Target Stage != `VERIFY_CAB` | `pipeline_stage` → Target<br>`cab_readiness_status` → `NOT_READY` | **Gate:** Current Stage = `VERIFY_CAB` AND `cab_readiness_status` != `PENDING_REVIEW`/`APPROVED` |

## SECTION 5 — Invariants (Hard Rules)

These rules are enforced by Database Triggers and cannot be bypassed by application code.

### 1. Stage/Status Alignment (`trg_workspace_cab_consistency`)
> **Rule:** If `pipeline_stage` is NOT `VERIFY_CAB`, then `cab_readiness_status` MUST be `NOT_READY`.
>
> **Error:** `CAB_STATUS_INVALID_FOR_STAGE`

### 2. Audit Eligibility (`trg_audit_cab_validity`)
> **Rule A (SUBMITTED):** `pipeline_stage` must be `VERIFY_CAB`.
> **Error:** `CAB_AUDIT_ACTION_INVALID`

> **Rule B (APPROVED):** `pipeline_stage` must be `VERIFY_CAB` AND `cab_readiness_status` must be `PENDING_REVIEW` (at moment of decision).
> **Error:** `CAB_AUDIT_ACTION_INVALID`

> **Rule C (REJECTED):** `pipeline_stage` must be `VERIFY_CAB` AND `cab_readiness_status` must be `PENDING_REVIEW`.
> **Error:** `CAB_AUDIT_ACTION_INVALID`

## SECTION 6 — Examples

### Happy Path
1.  **Start:** Workspace in `VERIFY_CAB`, Status `NOT_READY`.
2.  **Action:** User fixes finding. Checklist updates to `PASS`.
3.  **Action:** System Snapshot runs. `is_valid`=1.
4.  **Action:** User calls `POST /cab/submit`.
5.  **State:** Status becomes `PENDING_REVIEW`.
6.  **Action:** CAB Member calls `POST /cab/approve`.
7.  **Result:**
    - Audit Log: `APPROVED`
    - Stage: `RELEASE`
    - Status: `NOT_READY` (Reset for new stage)

### Rejection Path
1.  **State:** Workspace in `VERIFY_CAB`, Status `PENDING_REVIEW`.
2.  **Action:** CAB Member calls `POST /cab/reject`.
3.  **Result:**
    - Audit Log: `REJECTED`
    - Status: `NOT_READY`
4.  **Recovery:** User must address issues, triggering re-evaluation, then re-submit.

### Invalid Transition Attempt
1.  **State:** Workspace in `VERIFY_CAB`, Status `NOT_READY`.
2.  **Action:** User attempts `POST /governance/transition` to `RELEASE`.
3.  **Result:** HTTP 409 `CAB_NOT_READY`. (Blocked by Controller Gate).
