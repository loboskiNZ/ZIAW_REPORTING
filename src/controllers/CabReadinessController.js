const db = require('../config/database');

exports.getCabReadiness = async (req, res) => {
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

    // 2. Fetch Latest Snapshot (Minimal)
    const [snapRows] = await connection.query(
      `SELECT id, is_valid FROM workspace_snapshot 
       WHERE workspace_id = ? 
       ORDER BY snapshot_at DESC LIMIT 1`,
      [workspaceId]
    );
    
    let latestSnapshot = null;
    if (snapRows.length > 0) {
      latestSnapshot = {
        id: snapRows[0].id,
        is_valid: !!snapRows[0].is_valid // ensure boolean
      };
    }

    // 3. Fetch CAB Required Checklist Stats
    // We strictly look at VERIFY_CAB required rules
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

    const stats = {
      required_total: 0,
      required_passed: 0,
      required_failed: 0,
      required_incomplete: 0
    };

    stats.required_total = checkRows.length;
    
    checkRows.forEach(row => {
      const status = row.status || 'NOT_EVALUATED'; // Join might return null status
      if (status === 'PASS') stats.required_passed++;
      else if (status === 'FAIL') stats.required_failed++;
      else stats.required_incomplete++; // WAIVED? Spec didn't clarify, assuming strict pass. 
      // Actually WAIVED counts as PASS usually, but let's stick to simple buckets. 
      // If "WAIVED" is considered incomplete for strict readiness, fine. 
      // Task 1 said: "All ... must be in status PASS". So WAIVED might be incomplete.
    });
    
    // Note: If no rows found (no definitions), total is 0.
    
    // 4. Return
    return res.json({
      workspace_id: workspace.id,
      pipeline_stage: workspace.pipeline_stage,
      cab_readiness_status: workspace.cab_readiness_status,
      latest_snapshot: latestSnapshot,
      cab_required_checklist: stats
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
};
