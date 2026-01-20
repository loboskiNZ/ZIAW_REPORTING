-- V5__add_snapshot_is_valid.sql

ALTER TABLE workspace_snapshot
ADD COLUMN is_valid TINYINT(1) NOT NULL DEFAULT 0;

-- Backfill: Set is_valid=1 for the latest snapshot (max ID) for each workspace
UPDATE workspace_snapshot ws
JOIN (
    SELECT workspace_id, MAX(id) as max_id
    FROM workspace_snapshot
    GROUP BY workspace_id
) max_snaps ON ws.workspace_id = max_snaps.workspace_id AND ws.id = max_snaps.max_id
SET ws.is_valid = 1;
