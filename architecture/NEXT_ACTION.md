# NEXT ACTION

## Goal
Fix the Snapshot Engine export/usage mismatch so the snapshot compute endpoint works end-to-end.

## Scope
- Do not apply V2 yet
- Do not add new migrations
- Do not add Jira integration
- Do not modify Docker
- Only fix Snapshot Engine module export + API route wiring

## Acceptance Criteria
1) `curl -X POST http://localhost:8080/api/workspaces/1/snapshots/compute` returns HTTP 200 and JSON that includes:
   - `snapshot_id`
   - `cores` (progress, risk, readiness, confidence)
   - `metrics` (checklist, risks, findings, readiness, stability)

2) A new row is inserted into `workspace_snapshot`:
   - verified by `SELECT * FROM workspace_snapshot ORDER BY snapshot_at DESC LIMIT 1;`

## Deliverables
- Code diff (files changed)
- One example curl response (clean JSON)
- DB verification output for workspace_snapshot
