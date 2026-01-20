-- V3__init_workspace_checklist_status.sql
-- Initialize checklist status rows for all existing workspaces

INSERT INTO workspace_checklist_status (
  workspace_id,
  checklist_definition_id,
  status,
  created_at,
  updated_at
)
SELECT
  w.id AS workspace_id,
  d.id AS checklist_definition_id,
  'NOT_EVALUATED' AS status,
  NOW(),
  NOW()
FROM workspace w
JOIN stage_checklist_definition d
  ON d.pipeline_stage = w.pipeline_stage
  AND d.is_active = 1
LEFT JOIN workspace_checklist_status wcs
  ON wcs.workspace_id = w.id
  AND wcs.checklist_definition_id = d.id
WHERE wcs.id IS NULL;

