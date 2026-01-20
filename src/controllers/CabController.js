const db = require('../config/database');
const checklistEvaluator = require('../services/ChecklistEvaluator');

/**
 * Helper to log transition attempts
 */
async function logTransition(connection, workspaceId, fromStage, toStage, actorType, actorId, decision, rationale) {
  await connection.query(
    `INSERT INTO stage_transition_log 
     (workspace_id, from_stage, to_stage, actor_type, actor_id, decision, rationale, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [workspaceId, fromStage, toStage || fromStage, actorType, actorId, decision, rationale]
  );
}

exports.submitCab = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const workspaceId = parseInt(req.params.workspaceId, 10);
    if (isNaN(workspaceId)) return res.status(400).json({ error: 'Invalid workspace ID' });

    const { rationale } = req.body;
    const actorType = req.headers['x-actor-type']; 
    const actorId = req.headers['x-actor-id'] || null;

    // 1. Auth Guard (HUMAN only)
    if (!actorType || actorType.toUpperCase() !== 'HUMAN') {
      await connection.beginTransaction();
      // Try to get stage for logging
      const [wRows] = await connection.query('SELECT pipeline_stage FROM workspace WHERE id = ? FOR UPDATE', [workspaceId]);
      if (wRows.length > 0) {
        await logTransition(connection, workspaceId, wRows[0].pipeline_stage, wRows[0].pipeline_stage, 'SYSTEM', null, 'FAILED_PRECONDITION', 'CAB_SUBMIT: Missing X-Actor-Type: HUMAN');
        await connection.commit();
      } else {
        await connection.rollback();
      }
      return res.status(403).json({ error: 'Human actor required' });
    }

    // 2. Get Workspace Init (No Lock) for Evaluator
    const [wInit] = await connection.query('SELECT pipeline_stage FROM workspace WHERE id = ?', [workspaceId]);
    if (wInit.length === 0) return res.status(404).json({ error: 'Workspace not found' });
    const currentStage = wInit[0].pipeline_stage;

    // 3. Evaluate Checklists (Pre-Transaction)
    await checklistEvaluator.evaluate(workspaceId, currentStage);

    // 4. Main Transaction
    await connection.beginTransaction();
    
    // Lock Workspace
    const [wRows] = await connection.query('SELECT * FROM workspace WHERE id = ? FOR UPDATE', [workspaceId]);
    if (wRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Workspace not found' });
    }
    const workspace = wRows[0];

    // Update Status
    await connection.query('UPDATE workspace SET cab_readiness_status = ? WHERE id = ?', ['PENDING_REVIEW', workspaceId]);

    // Log Success
    const logRationale = rationale ? `CAB_SUBMIT: ${rationale}` : 'CAB_SUBMIT';
    // Use SUBMITTED decision for audit trigger compatibility (Rule B)
    await logTransition(connection, workspaceId, workspace.pipeline_stage, workspace.pipeline_stage, 'HUMAN', actorId, 'SUBMITTED', logRationale);

    await connection.commit();

    return res.json({
      workspace_id: workspaceId,
      pipeline_stage: workspace.pipeline_stage,
      cab_readiness_status: 'PENDING_REVIEW'
    });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
};

exports.approveCab = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const workspaceId = parseInt(req.params.workspaceId, 10);
    if (isNaN(workspaceId)) return res.status(400).json({ error: 'Invalid workspace ID' });

    const { rationale } = req.body;
    const actorType = req.headers['x-actor-type'];
    const actorId = req.headers['x-actor-id'] || null;

    // 1. Auth Guard (HUMAN only)
    if (!actorType || actorType.toUpperCase() !== 'HUMAN') {
      await connection.beginTransaction();
       const [wRows] = await connection.query('SELECT pipeline_stage FROM workspace WHERE id = ? FOR UPDATE', [workspaceId]);
      if (wRows.length > 0) {
        await logTransition(connection, workspaceId, wRows[0].pipeline_stage, wRows[0].pipeline_stage, 'SYSTEM', null, 'FAILED_PRECONDITION', 'CAB_APPROVE: Missing X-Actor-Type: HUMAN');
        await connection.commit();
      } else {
         await connection.rollback();
      }
      return res.status(403).json({ error: 'Human actor required' });
    }

    // 2. Get Workspace Init (No Lock) for Evaluator
    const [wInit] = await connection.query('SELECT pipeline_stage FROM workspace WHERE id = ?', [workspaceId]);
    if (wInit.length === 0) return res.status(404).json({ error: 'Workspace not found' });
    const stageForEval = wInit[0].pipeline_stage;

    // 3. Evaluate Checklists (Pre-Transaction)
    await checklistEvaluator.evaluate(workspaceId, stageForEval);

     // 4. Main Transaction
    await connection.beginTransaction();
    
    // Lock Workspace
    const [wRows] = await connection.query('SELECT * FROM workspace WHERE id = ? FOR UPDATE', [workspaceId]);
    if (wRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Workspace not found' });
    }
    const workspace = wRows[0];
    const currentStage = workspace.pipeline_stage;

    const blockingKeys = [];
    
    // A) Check Stage
    if (currentStage !== 'VERIFY_CAB') {
      blockingKeys.push('stage_not_verify_cab');
    }

    // B) Check Required Rules for VERIFY_CAB
    const [rules] = await connection.query(
      `SELECT
         d.rule_key,
         COALESCE(wcs.status, 'NOT_EVALUATED') AS status
       FROM stage_checklist_definition d
       LEFT JOIN workspace_checklist_status wcs
         ON wcs.checklist_definition_id = d.id
         AND wcs.workspace_id = ?
       WHERE d.pipeline_stage = 'VERIFY_CAB'
         AND d.is_active = 1
         AND d.is_required = 1`,
       [workspaceId]
    );

    for (const r of rules) {
      if (r.status !== 'PASS' && r.status !== 'WAIVED') {
        blockingKeys.push(r.rule_key);
      }
    }

    if (blockingKeys.length > 0) {
      // Blocked
      const logRationale = `CAB_APPROVE blocked: ${blockingKeys.join(', ')}`;
      await logTransition(connection, workspaceId, currentStage, currentStage, 'HUMAN', actorId, 'FAILED_PRECONDITION', logRationale);
      await connection.commit();

      return res.status(409).json({
        workspace_id: workspaceId,
        pipeline_stage: currentStage,
        cab_readiness_status: workspace.cab_readiness_status,
        decision: 'FAILED_PRECONDITION',
        blocking_rule_keys: blockingKeys
      });
    }

    // Allowed - Approve
    await connection.query('UPDATE workspace SET cab_readiness_status = ? WHERE id = ?', ['APPROVED', workspaceId]);

    const logRationale = rationale ? `CAB_APPROVE: ${rationale}` : 'CAB_APPROVE';
    await logTransition(connection, workspaceId, currentStage, currentStage, 'HUMAN', actorId, 'APPROVED', logRationale);

    await connection.commit();

    return res.json({
      workspace_id: workspaceId,
      pipeline_stage: 'VERIFY_CAB',
      cab_readiness_status: 'APPROVED',
      decision: 'APPROVED'
    });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    if (connection) connection.release();
  }
};
