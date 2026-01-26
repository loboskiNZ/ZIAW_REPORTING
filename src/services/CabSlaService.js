const db = require('../config/database');

// Helper to log audit event
async function logAudit(connection, workspaceId, actorId, action, rationale) {
  await connection.query(
    `INSERT INTO stage_transition_log 
     (workspace_id, from_stage, to_stage, actor_type, actor_id, decision, rationale, created_at)
     VALUES (?, 'VERIFY_CAB', 'VERIFY_CAB', 'SYSTEM', ?, ?, ?, NOW())`,
    [workspaceId, actorId, action, rationale]
  );
}

exports.enforceIfExpired = async (workspaceId) => {
  if (isNaN(workspaceId) || workspaceId <= 0) return { enforced: false };

  const connection = await db.getConnection();
  try {
    const [rows] = await connection.query(
      'SELECT id, pipeline_stage, cab_review_state, cab_expires_at FROM workspace WHERE id = ? FOR UPDATE',
      [workspaceId]
    );

    if (rows.length === 0) return { enforced: false };
    const workspace = rows[0];

    // Check Eligibility
    if (workspace.pipeline_stage !== 'VERIFY_CAB') return { enforced: false };
    if (workspace.cab_review_state !== 'IN_REVIEW') return { enforced: false }; // Already APPROVED/REJECTED/EXPIRED
    if (!workspace.cab_expires_at) return { enforced: false };

    // Check Expiry
    const now = new Date();
    const expiresAt = new Date(workspace.cab_expires_at);

    if (now <= expiresAt) return { enforced: false };

    // Expired! Enforce.
    await connection.beginTransaction();

    await logAudit(connection, workspaceId, 'system', 'EXPIRED', 'CAB Review Window Expired');

    await connection.query(
      `UPDATE workspace 
       SET cab_review_state = 'EXPIRED', 
           cab_readiness_status = 'NOT_READY',
           cab_approval_count = 0
       WHERE id = ?`,
      [workspaceId]
    );

    await connection.commit();
    return { enforced: true };

  } catch (err) {
    if (connection) await connection.rollback();
    console.error('SLA Check Failed:', err);
    throw err;
  } finally {
    connection.release();
  }
};
