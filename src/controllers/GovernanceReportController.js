const db = require('../config/database');

exports.getGovernanceReport = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  if (isNaN(workspaceId) || workspaceId <= 0) {
    return res.status(400).json({ error: 'Invalid workspace ID' });
  }

  const connection = await db.getConnection();
  try {
    // 1. Fetch Workspace Status
    const [wRows] = await connection.query(
      'SELECT id, pipeline_stage, cab_readiness_status FROM workspace WHERE id = ?',
      [workspaceId]
    );

    if (wRows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }
    const workspace = wRows[0];

    // 2. Fetch Latest Snapshot
    // Using snapshot_at as the creation timestamp source
    const [snapRows] = await connection.query(
      `SELECT id, is_valid, snapshot_at 
       FROM workspace_snapshot 
       WHERE workspace_id = ? 
       ORDER BY snapshot_at DESC LIMIT 1`,
      [workspaceId]
    );

    let snapshot = null;
    if (snapRows.length > 0) {
      snapshot = {
        id: snapRows[0].id,
        is_valid: !!snapRows[0].is_valid,
        created_at: snapRows[0].snapshot_at // Map snapshot_at to created_at
      };
    }

    // 3. Fetch CAB Required Checklist Stats
    // "Strictly look at VERIFY_CAB required rules" as per similar logic in CabReadinessController
    const [checkRows] = await connection.query(
      `SELECT 
         wcs.status
       FROM stage_checklist_definition d
       LEFT JOIN workspace_checklist_status wcs 
         ON wcs.checklist_definition_id = d.id AND wcs.workspace_id = ?
       WHERE d.pipeline_stage = 'VERIFY_CAB' 
         AND d.is_active = 1 
         AND d.is_required = 1`,
      [workspaceId]
    );

    const checklistStats = {
      required_total: checkRows.length,
      required_passed: 0,
      required_failed: 0,
      required_incomplete: 0
    };

    checkRows.forEach(row => {
      const status = row.status; // Can be null if no status record exists
      if (status === 'PASS') checklistStats.required_passed++;
      else if (status === 'FAIL') checklistStats.required_failed++;
      else checklistStats.required_incomplete++; // Includes WAIVED, null (not evaluated), or other statuses
    });

    // 4. Fetch CAB Audit Stats
    // "submitted_at (latest SUBMITTED timestamp or null)"
    // "approved_at (latest APPROVED timestamp or null)"
    // "rejected_at (latest REJECTED timestamp or null)"
    const [auditRows] = await connection.query(
      `SELECT decision, created_at 
       FROM stage_transition_log 
       WHERE workspace_id = ? 
         AND decision IN ('SUBMITTED', 'APPROVED', 'REJECTED') 
       ORDER BY created_at DESC`,
      [workspaceId]
    );

    // Find latest of each type (first match in DESC list)
    let submittedAt = null;
    let approvedAt = null;
    let rejectedAt = null;

    for (const row of auditRows) {
      if (!submittedAt && row.decision === 'SUBMITTED') submittedAt = row.created_at;
      if (!approvedAt && row.decision === 'APPROVED') approvedAt = row.created_at;
      if (!rejectedAt && row.decision === 'REJECTED') rejectedAt = row.created_at;
      
      // Optimization: break if we found all three? 
      // Not strictly necessary as the log is likely short, but good for performance.
      if (submittedAt && approvedAt && rejectedAt) break;
    }

    const cabAudit = {
      submitted_at: submittedAt,
      approved_at: approvedAt,
      rejected_at: rejectedAt
    };

    // 5. Check SLA
    await require('../services/CabSlaService').enforceIfExpired(workspaceId);

    // Reload workspace to get updated state if expired
    const [wRefreshed] = await connection.query(
      'SELECT id, pipeline_stage, cab_readiness_status, cab_review_state, cab_submitted_at, cab_expires_at FROM workspace WHERE id = ?',
      [workspaceId]
    );
    const updatedWs = wRefreshed[0]; // Should exist

    // ...
    // ...

    // 6. Return JSON
    return res.json({
      workspace_id: updatedWs.id,
      pipeline_stage: updatedWs.pipeline_stage,
      cab_readiness_status: updatedWs.cab_readiness_status,
      cab_review_state: updatedWs.cab_review_state,
      cab_submitted_at: updatedWs.cab_submitted_at,
      cab_expires_at: updatedWs.cab_expires_at,
      snapshot: snapshot,
      cab_required_checklist: checklistStats,
      cab_audit: cabAudit
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
};
