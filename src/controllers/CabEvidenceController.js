const db = require('../config/database');
const cabSlaService = require('../services/CabSlaService');
const cabAuthorizationService = require('../services/CabAuthorizationService');

exports.attachEvidenceLogic = async (workspaceId, actorId, auditId, evidenceType, evidenceValue) => {
    // SLA Check
    await cabSlaService.enforceIfExpired(workspaceId);

    const isReviewer = await cabAuthorizationService.isReviewer(workspaceId, actorId);
    if (!isReviewer) {
        const err = new Error('User is not an authorized reviewer');
        err.code = 'CAB_NOT_REVIEWER';
        err.status = 403;
        throw err;
    }

    // Validation
    if (!['LINK', 'NOTE', 'FILE'].includes(evidenceType)) {
        const err = new Error('Invalid evidence_type');
        err.code = 'VALIDATION_ERROR';
        err.status = 400;
        throw err;
    }
    if (!evidenceValue || evidenceValue.trim() === '') {
        const err = new Error('evidence_value must be non-empty');
        err.code = 'VALIDATION_ERROR';
        err.status = 400;
        throw err;
    }

    const connection = await db.getConnection();
    try {
        const [wRows] = await connection.query('SELECT pipeline_stage, cab_review_state FROM workspace WHERE id = ?', [workspaceId]);
        if (wRows.length === 0) {
            const err = new Error('Workspace not found');
            err.status = 404;
            throw err;
        }
        const workspace = wRows[0];

        const [aRows] = await connection.query('SELECT id FROM stage_transition_log WHERE id = ? AND workspace_id = ?', [auditId, workspaceId]);
        if (aRows.length === 0) {
            const err = new Error('Audit event not found in this workspace');
            err.status = 404;
            throw err;
        }

        if (workspace.pipeline_stage !== 'VERIFY_CAB') {
            const err = new Error('Current stage is not VERIFY_CAB');
            err.code = 'INVALID_STAGE';
            err.status = 409;
            throw err;
        }

        if (workspace.cab_review_state === 'EXPIRED') {
             const err = new Error('CAB review has expired');
             err.code = 'CAB_EXPIRED';
             err.status = 409;
             throw err;
        }

        if (workspace.cab_review_state !== 'IN_REVIEW') {
            const err = new Error('CAB status is not IN_REVIEW');
            err.code = 'CAB_NOT_IN_REVIEW';
            err.status = 409;
            throw err;
        }

        await connection.query(
        `INSERT INTO cab_review_evidence 
         (workspace_id, audit_id, evidence_type, evidence_value, actor, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [workspaceId, auditId, evidenceType, evidenceValue, actorId]
        );

        return {
            workspace_id: workspaceId,
            audit_id: auditId,
            evidence_type: evidenceType
        };

    } finally {
        connection.release();
    }
};

exports.attachEvidence = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  if (isNaN(workspaceId) || workspaceId <= 0) {
    return res.status(400).json({ error: 'Invalid workspace ID' });
  }
  if (!req.user) {
    return res.status(401).json({ error: 'UNAUTHENTICATED' });
  }
  const actorId = req.user.id;

  const { audit_id, evidence_type, evidence_value } = req.body;

  try {
    const result = await exports.attachEvidenceLogic(workspaceId, actorId, audit_id, evidence_type, evidence_value);
    return res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.code || 'ERROR', message: err.message });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.listEvidence = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  const auditIdFilter = req.query.audit_id;

  if (isNaN(workspaceId) || workspaceId <= 0) {
    return res.status(400).json({ error: 'Invalid workspace ID' });
  }

  if (!req.user) {
     return res.status(401).json({ error: 'UNAUTHENTICATED' });
  }
  const actorId = req.user.id;
  const isReviewer = await cabAuthorizationService.isReviewer(workspaceId, actorId);
  if (!isReviewer) {
    return res.status(403).json({ error: 'CAB_NOT_REVIEWER', message: 'User is not an authorized reviewer' });
  }

  const connection = await db.getConnection();
  try {
    let query = `
      SELECT id, audit_id, evidence_type, evidence_value, actor, created_at
      FROM cab_review_evidence
      WHERE workspace_id = ?
    `;
    const params = [workspaceId];

    if (auditIdFilter) {
      query += ` AND audit_id = ?`;
      params.push(auditIdFilter);
    }

    query += ` ORDER BY created_at ASC, id ASC`;

    const [rows] = await connection.query(query, params);

    res.json({
      workspace_id: workspaceId,
      evidence: rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
};
