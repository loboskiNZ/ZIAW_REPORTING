const db = require('../config/database');

// Helper to check audit existence
async function checkAuditExists(connection, workspaceId, decision) {
  const [rows] = await connection.query(
    `SELECT id FROM stage_transition_log 
     WHERE workspace_id = ? AND decision = ? 
     LIMIT 1`,
    [workspaceId, decision]
  );
  return rows.length > 0;
}

// Helper to log decision
async function logDecision(connection, workspaceId, fromStage, toStage, decision, rationale) {
  await connection.query(
    `INSERT INTO stage_transition_log 
     (workspace_id, from_stage, to_stage, actor_type, decision, rationale, created_at)
     VALUES (?, ?, ?, 'SYSTEM', ?, ?, NOW())`,
    [workspaceId, fromStage, toStage, decision, rationale]
  );
}

exports.approve = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  if (isNaN(workspaceId) || workspaceId <= 0) {
    return res.status(400).json({ error: 'Invalid workspace ID' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Load Workspace (Lock)
    const [wRows] = await connection.query(
      'SELECT id, pipeline_stage, cab_readiness_status FROM workspace WHERE id = ? FOR UPDATE',
      [workspaceId]
    );

    if (wRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Workspace not found' });
    }
    const workspace = wRows[0];

    // Idempotency Check
    const alreadyApproved = await checkAuditExists(connection, workspaceId, 'APPROVED');
    // Note: User spec says "If an APPROVED audit already exists ... return 200". 
    // It implies we should check if we already did THIS approval.
    // But realistically, if we moved to RELEASE, we might have approved before.
    // If we are strictly checking "APPROVED audit exists", that might be true from previous stages?
    // User probably means "Approved for THIS stage transition"?
    // "If an APPROVED audit already exists for this workspace".
    // I will stick to the literal instruction but maybe filter by "recent"?
    // Or perhaps relying on stage check is enough?
    // If I am already in RELEASE, the stage check below fails.
    // So if I am in VERIFY_CAB and have an APPROVED audit... that's weird (approved but didn't move?).
    // Let's implement the specific check requested.
    if (alreadyApproved) {
       // If strict check passes, we assume we are done. 
       // However, we should check if we are already in target state?
       // The instruction says "return 200 and do not insert another".
    }
    
    // 2. Preconditions
    if (workspace.pipeline_stage !== 'VERIFY_CAB') {
       // If strictly enforcing stage, we fail here.
       // But if idempotency logic is paramount?
       // "4. Load workspace and enforce preconditions... pipeline_stage must equal VERIFY_CAB"
       // So if I already approved and moved to RELEASE, I fail rule 2?
       // -> 409 INVALID_STAGE.
       // So "Idempotency" check only helps if I am STILL in VERIFY_CAB but somehow have an approved log? 
       // Or is idempotency step 6 checked BEFORE step 4?
       // Instructions order: "4. Load... enforce... 5. Persist... 6. Idempotency".
       // The order in the list usually implies execution order, BUT idempotency usually shortcuts processing.
       // Item 6 says: "If an APPROVED audit already exists ... return 200".
       // If I check this after failing stage check, I return 409.
       // I'll check Idempotency AFTER fetching workspace, but BEFORE failing constraints if possible, 
       // OR I follow the numbers.
       // "4. Load... enforce...". If I enforce first, I fail if stage moved.
       // If passed stage check (VERIFY_CAB), then I check idempotency.
       // If I am in VERIFY_CAB and have APPROVED log, it means I approved but failed to update stage?
       // Or simply re-submitting.
       // I will place Idempotency check AFTER stage validation if following list strictness, 
       // but typically idempotency guards against valid re-tries.
       // Given "6. Idempotency rules", I will put it *inside* the logic flow where sensible.
       // If I am already in RELEASE, I return 409 INVALID_STAGE.
       // If I am in VERIFY_CAB, I check if I already approved.
       
       // WAIT: "Idempotency rules... If APPROVED audit exists... return 200".
       // If I moved to RELEASE, I have an APPROVED audit.
       // So if I am in RELEASE, do I return 200 or 409?
       // Logic says 409 INVALID_STAGE.
       // I will Implement Preconditions FIRST.
       
       await connection.rollback();
       return res.status(409).json({ error: 'INVALID_STAGE', message: 'Current stage is not VERIFY_CAB' });
    }

    if (workspace.cab_readiness_status !== 'PENDING_REVIEW') {
       await connection.rollback();
       return res.status(409).json({ error: 'CAB_NOT_IN_REVIEW', message: 'CAB status is not PENDING_REVIEW' });
    }
    
    // Now Check Idempotency (We are in correct stage and status)
    if (alreadyApproved) {
      await connection.rollback();
      return res.status(200).json({ workspace_id: workspaceId });
    }

    // 3. Persist Decision (Approve)
    // Log
    await logDecision(connection, workspaceId, 'VERIFY_CAB', 'RELEASE', 'APPROVED', 'CAB Approved');
    
    // Update Stage AND Reset Readiness (Rule A)
    await connection.query(
      'UPDATE workspace SET pipeline_stage = ?, cab_readiness_status = ? WHERE id = ?',
      ['RELEASE', 'NOT_READY', workspaceId]
    );
    // Note: Do NOT change cab_readiness_status

    await connection.commit();
    res.json({ workspace_id: workspaceId });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
};

exports.reject = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  if (isNaN(workspaceId) || workspaceId <= 0) {
    return res.status(400).json({ error: 'Invalid workspace ID' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Load Workspace
    const [wRows] = await connection.query(
      'SELECT id, pipeline_stage, cab_readiness_status FROM workspace WHERE id = ? FOR UPDATE',
      [workspaceId]
    );

    if (wRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Workspace not found' });
    }
    const workspace = wRows[0];
    
    // Idempotency Check for Reject
    // "If REJECTED audit exists AND cab_readiness_status is already NOT_READY -> 200"
    const alreadyRejected = await checkAuditExists(connection, workspaceId, 'REJECTED');
    if (alreadyRejected && workspace.cab_readiness_status === 'NOT_READY') {
      await connection.rollback();
      return res.status(200).json({ workspace_id: workspaceId });
    }

    // 2. Preconditions
    if (workspace.pipeline_stage !== 'VERIFY_CAB') {
      await connection.rollback();
      return res.status(409).json({ error: 'INVALID_STAGE', message: 'Current stage is not VERIFY_CAB' });
    }

    if (workspace.cab_readiness_status !== 'PENDING_REVIEW') {
       // Wait, if I am trying to REJECT, I must be in PENDING_REVIEW?
       // The spec says "4. Preconditions... cab_readiness_status must equal PENDING_REVIEW... else 409".
       // IDEMPOTENCY check (above) handled the case where we already rejected (status NOT_READY).
       // If we are NOT_READY and NO rejection log (maybe manual reset?), we fail this check. Correct.
       
       await connection.rollback();
       return res.status(409).json({ error: 'CAB_NOT_IN_REVIEW', message: 'CAB status is not PENDING_REVIEW' });
    }

    // 3. Persist Decision (Reject)
    // Log
    await logDecision(connection, workspaceId, 'VERIFY_CAB', 'VERIFY_CAB', 'REJECTED', 'CAB Rejected');
    
    // Update Status
    await connection.query(
      'UPDATE workspace SET cab_readiness_status = ? WHERE id = ?',
      ['NOT_READY', workspaceId]
    );

    await connection.commit();
    res.json({ workspace_id: workspaceId });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
};

exports.getHistory = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  if (isNaN(workspaceId) || workspaceId <= 0) {
    return res.status(400).json({ error: 'Invalid workspace ID' });
  }

  const connection = await db.getConnection();
  try {
    // 1. Ensure Workspace Exists
    const [wRows] = await connection.query('SELECT id FROM workspace WHERE id = ?', [workspaceId]);
    if (wRows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // 2. Query Audit Log (stage_transition_log)
    // Mapping decision -> action, actor_type -> actor
    const [rows] = await connection.query(
      `SELECT id, decision AS action, actor_type AS actor, created_at 
       FROM stage_transition_log 
       WHERE workspace_id = ? 
       ORDER BY created_at ASC, id ASC`,
      [workspaceId]
    );

    // 3. Return JSON
    return res.json({
      workspace_id: workspaceId,
      events: rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
};
