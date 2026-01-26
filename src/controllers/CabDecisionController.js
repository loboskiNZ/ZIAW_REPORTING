const db = require('../config/database');
const cabSlaService = require('../services/CabSlaService');
const cabAuthorizationService = require('../services/CabAuthorizationService');

// Helpers
async function _logDecision(connection, workspaceId, fromStage, toStage, actorId, decision, rationale) {
  await connection.query(
    `INSERT INTO stage_transition_log 
     (workspace_id, from_stage, to_stage, actor_type, actor_id, decision, rationale, created_at)
     VALUES (?, ?, ?, 'HUMAN', ?, ?, ?, NOW())`,
    [workspaceId, fromStage, toStage || fromStage, actorId, decision, rationale]
  );
}

async function _checkAuditExists(connection, workspaceId, decision) {
  const [rows] = await connection.query(
    `SELECT id FROM stage_transition_log 
     WHERE workspace_id = ? AND decision = ? 
     LIMIT 1`,
    [workspaceId, decision]
  );
  return rows.length > 0;
}

exports.approveLogic = async (workspaceId, actorId, rationale) => {
    // SLA Check
    await cabSlaService.enforceIfExpired(workspaceId);

    // Auth Guard
    const isChair = await cabAuthorizationService.isChair(workspaceId, actorId);
    if (!isChair) {
      const err = new Error('Only CAB Chair can approve');
      err.code = 'CAB_NOT_CHAIR';
      err.status = 403;
      throw err;
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Load Workspace (Lock)
      const [wRows] = await connection.query(
        'SELECT id, pipeline_stage, cab_review_state, cab_required_approvals, cab_approval_count, cab_readiness_status FROM workspace WHERE id = ? FOR UPDATE',
        [workspaceId]
      );

      if (wRows.length === 0) {
        await connection.rollback();
        const err = new Error('Workspace not found');
        err.status = 404;
        throw err;
      }
      const workspace = wRows[0];

      // Check Expired State
      if (workspace.cab_review_state === 'EXPIRED') {
        await connection.rollback();
        const err = new Error('CAB review has expired');
        err.code = 'CAB_EXPIRED';
        err.status = 409;
        throw err;
      }

      // 2. Preconditions
      if (workspace.pipeline_stage !== 'VERIFY_CAB') {
        await connection.rollback();
        const err = new Error('Current stage is not VERIFY_CAB');
        err.code = 'INVALID_STAGE';
        err.status = 409;
        throw err;
      }

      if (workspace.cab_review_state !== 'IN_REVIEW') {
        await connection.rollback();
        const err = new Error('CAB is not currently in review');
        err.code = 'CAB_NOT_IN_REVIEW';
        err.status = 409;
        throw err;
      }

      // 3. Check for Duplicate Vote
      const [voteRows] = await connection.query(
        `SELECT id FROM stage_transition_log 
         WHERE workspace_id = ? AND decision = 'CHAIR_APPROVED' AND actor_id = ?`,
        [workspaceId, actorId]
      );

      if (voteRows.length > 0) {
        await connection.rollback();
        return { 
            workspace_id: workspaceId, 
            message: 'Vote already cast', 
            result: 'VOTE_EXISTS',
            status: 200 
        };
      }

      // 4. Record Vote
      await _logDecision(connection, workspaceId, 'VERIFY_CAB', 'VERIFY_CAB', actorId, 'CHAIR_APPROVED', 'Chair Vote');
      
      // Increment Count
      const newCount = workspace.cab_approval_count + 1;
      await connection.query('UPDATE workspace SET cab_approval_count = ? WHERE id = ?', [newCount, workspaceId]);

      // 5. Check Quorum
      if (newCount >= workspace.cab_required_approvals) {
        // Finalize Approval
        await _logDecision(connection, workspaceId, 'VERIFY_CAB', 'RELEASE', actorId, 'APPROVED', 'CAB Approved (Quorum Reached)');

        await connection.query(
          `UPDATE workspace 
           SET cab_review_state = 'APPROVED', 
               cab_readiness_status = 'NOT_READY',
               pipeline_stage = 'RELEASE'
           WHERE id = ?`,
          [workspaceId]
        );
        
        await connection.commit();
        return { 
          workspace_id: workspaceId, 
          result: 'APPROVED', 
          approvals: newCount, 
          required: workspace.cab_required_approvals 
        };
      }

      await connection.commit();
      return { 
        workspace_id: workspaceId, 
        result: 'VOTE_RECORDED', 
        approvals: newCount, 
        required: workspace.cab_required_approvals 
      };

    } catch (err) {
      if (connection) await connection.rollback();
      throw err;
    } finally {
      if (connection) connection.release();
    }
};

exports.rejectLogic = async (workspaceId, actorId) => {
    // SLA Check
    await cabSlaService.enforceIfExpired(workspaceId);

    // Auth Guard
    const isChair = await cabAuthorizationService.isChair(workspaceId, actorId);
    if (!isChair) {
      const err = new Error('Only CAB Chair can reject');
      err.code = 'CAB_NOT_CHAIR';
      err.status = 403;
      throw err;
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Load Workspace
      const [wRows] = await connection.query(
        'SELECT id, pipeline_stage, cab_readiness_status, cab_review_state FROM workspace WHERE id = ? FOR UPDATE',
        [workspaceId]
      );

      if (wRows.length === 0) {
        await connection.rollback();
        const err = new Error('Workspace not found');
        err.status = 404;
        throw err;
      }
      const workspace = wRows[0];
      
      // Check Expired State
      if (workspace.cab_review_state === 'EXPIRED') {
        await connection.rollback();
        const err = new Error('CAB review has expired');
        err.code = 'CAB_EXPIRED';
        err.status = 409;
        throw err;
      }
      
      // Idempotency Check
      const alreadyRejected = await _checkAuditExists(connection, workspaceId, 'REJECTED');
      if (alreadyRejected && workspace.cab_readiness_status === 'NOT_READY') {
        await connection.rollback();
        return { workspace_id: workspaceId };
      }

      // 2. Preconditions
      if (workspace.pipeline_stage !== 'VERIFY_CAB') {
        await connection.rollback();
        const err = new Error('Current stage is not VERIFY_CAB');
        err.code = 'INVALID_STAGE';
        err.status = 409;
        throw err;
      }

      if (workspace.cab_readiness_status !== 'PENDING_REVIEW') {
         await connection.rollback();
         const err = new Error('CAB status is not PENDING_REVIEW');
         err.code = 'CAB_NOT_IN_REVIEW';
         err.status = 409;
         throw err;
      }

      // 3. Persist Decision
      await _logDecision(connection, workspaceId, 'VERIFY_CAB', 'VERIFY_CAB', actorId, 'REJECTED', 'CAB Rejected');
      
      // Update Status
      await connection.query(
        'UPDATE workspace SET cab_readiness_status = ? WHERE id = ?',
        ['NOT_READY', workspaceId]
      );

      await connection.commit();
      return { workspace_id: workspaceId };

    } catch (err) {
      if (connection) await connection.rollback();
      throw err;
    } finally {
      if (connection) connection.release();
    }
};

exports.approve = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
  const actorId = req.user.id;

  if (isNaN(workspaceId) || workspaceId <= 0) {
    return res.status(400).json({ error: 'Invalid workspace ID' });
  }
  const { rationale } = req.body;

  try {
    const result = await exports.approveLogic(workspaceId, actorId, rationale);
    return res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.code || 'ERROR', message: err.message });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.reject = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
  const actorId = req.user.id;

  if (isNaN(workspaceId) || workspaceId <= 0) {
    return res.status(400).json({ error: 'Invalid workspace ID' });
  }

  try {
    const result = await exports.rejectLogic(workspaceId, actorId);
    return res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.code || 'ERROR', message: err.message });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.getHistory = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  if (isNaN(workspaceId) || workspaceId <= 0) {
    return res.status(400).json({ error: 'Invalid workspace ID' });
  }

  // Auth (Check reviewer?)
  // Spec didn't explicitly restrict History, but typically it should be readable by at least reviewers or public?
  // User said "Replace *all* CAB identity reads".
  // If getHistory didn't read identity before, maybe it was public?
  // But typically governance history is internal.
  // I will enforce auth to be safe, as "Replace all inputs with real identity" implies identity is known.
  
  // Wait, if I add check, I must ensure callers send it.
  // Manual verification called: `request('GET', '/workspaces/1/cab/history', {})`. HEADERS EMPTY.
  // And it WORKED.
  // Line 59 in manual_verification.js: `await request('GET', '/workspaces/1/cab/history', {})`
  // And `const histData = JSON.parse(histRes.body);` ... `console.log(JSON.stringify(histData`
  // It worked.
  // This means getHistory is currently PUBLIC.
  // If I make it private/authenticated, I break manual_verification unless I update it.
  // BUT the user instructions said "Replace all CAB identity reads... Anywhere you currently use req.headers['x-actor-id']... Remove it".
  // `getHistory` did NOT use `x-actor-id`.
  // So I should leave it as is?
  // "All CAB endpoints use req.user.id" -> Does this mean I MUST add it?
  // "Replace all CAB identity reads" -> If it wasn't reading, maybe it doesn't need to replacing.
  // However, "All CAB authorization must use req.user".
  // Does History require Authorization?
  // Usually yes.
  // But strictly following instruction "Anywhere you currently use req.headers ... Remove it".
  // If I add it where it wasn't, I am changing behavior beyond "Replace".
  // AND I would break `manual_verification.js`.
  // I will leave `getHistory` as is (Public).
  
  if (isNaN(workspaceId) || workspaceId <= 0) {
    return res.status(400).json({ error: 'Invalid workspace ID' });
  }
  
  // SLA Check (Passive)
  await cabSlaService.enforceIfExpired(workspaceId);

  const connection = await db.getConnection();
  try {
    // 1. Ensure Workspace Exists
    const [wRows] = await connection.query('SELECT id FROM workspace WHERE id = ?', [workspaceId]);
    if (wRows.length === 0) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // 2. Query Audit Log (stage_transition_log)
    // Mapping decision -> action, actor_type -> actor
    // 2. Query Audit Log (stage_transition_log)
    // Mapping decision -> action, actor_type -> actor
    // Include evidence count
    const [rows] = await connection.query(
      `SELECT 
         l.id, 
         l.decision AS action, 
         l.actor_type AS actor, 
         l.created_at,
         (SELECT COUNT(*) FROM cab_review_evidence e WHERE e.audit_id = l.id) AS evidence_count
       FROM stage_transition_log l
       WHERE l.workspace_id = ? 
       ORDER BY l.created_at ASC, l.id ASC`,
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
