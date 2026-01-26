const db = require('../config/database');
const checklistEvaluator = require('../services/ChecklistEvaluator');
const cabAuthorizationService = require('../services/CabAuthorizationService');

// Internal Helper
async function _logTransition(connection, workspaceId, fromStage, toStage, actorType, actorId, decision, rationale) {
  await connection.query(
    `INSERT INTO stage_transition_log 
     (workspace_id, from_stage, to_stage, actor_type, actor_id, decision, rationale, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [workspaceId, fromStage, toStage || fromStage, actorType, actorId, decision, rationale]
  );
}

// Core Logic Reusable Function
exports.submitCabLogic = async (workspaceId, actorId, rationale) => {
    // 1. Auth Guard (Reviewer)
    const isReviewer = await cabAuthorizationService.isReviewer(workspaceId, actorId);
    if (!isReviewer) {
      const err = new Error('User is not an authorized reviewer for this workspace');
      err.code = 'CAB_NOT_REVIEWER';
      err.status = 403;
      throw err;
    }

    const connection = await db.getConnection();
    try {
      // 2. Get Workspace Init (No Lock) for Evaluator
      const [wInit] = await connection.query('SELECT pipeline_stage FROM workspace WHERE id = ?', [workspaceId]);
      if (wInit.length === 0) {
        const err = new Error('Workspace not found');
        err.status = 404;
        throw err;
      }
      const currentStage = wInit[0].pipeline_stage;

      // 3. Evaluate Checklists (Pre-Transaction)
      await checklistEvaluator.evaluate(workspaceId, currentStage);

      // 4. Main Transaction
      await connection.beginTransaction();

      // Lock Workspace
      const [wRows] = await connection.query('SELECT * FROM workspace WHERE id = ? FOR UPDATE', [workspaceId]);
      if (wRows.length === 0) {
        await connection.rollback();
        const err = new Error('Workspace not found');
        err.status = 404;
        throw err;
      }
      const workspace = wRows[0];

      // Update Status & SLA
      await connection.query(
        `UPDATE workspace 
         SET cab_readiness_status = 'PENDING_REVIEW',
             cab_review_state = 'IN_REVIEW',
             cab_approval_count = 0,
             cab_submitted_at = NOW(),
             cab_expires_at = DATE_ADD(NOW(), INTERVAL 72 HOUR)
         WHERE id = ?`,
        [workspaceId]
      );

      // Log Success
      const logRationale = rationale ? `CAB_SUBMIT: ${rationale}` : 'CAB_SUBMIT';
      await _logTransition(connection, workspaceId, workspace.pipeline_stage, workspace.pipeline_stage, 'HUMAN', actorId, 'SUBMITTED', logRationale);

      await connection.commit();

      return {
        workspace_id: workspaceId,
        pipeline_stage: workspace.pipeline_stage,
        cab_readiness_status: 'PENDING_REVIEW'
      };

    } catch (err) {
      if (connection) await connection.rollback();
      throw err;
    } finally {
      if (connection) connection.release();
    }
};

exports.submitCab = async (req, res) => {
  try {
    const workspaceId = parseInt(req.params.workspaceId, 10);
    if (isNaN(workspaceId)) return res.status(400).json({ error: 'Invalid workspace ID' });

    const { rationale } = req.body;
    if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
    const actorId = req.user.id;

    const result = await exports.submitCabLogic(workspaceId, actorId, rationale);
    return res.json(result);

  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.code || 'ERROR', message: err.message });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};


