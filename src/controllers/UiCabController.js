const db = require('../config/database');
const CabController = require('./CabController');
const CabDecisionController = require('./CabDecisionController');
const CabReviewerAdminController = require('./CabReviewerAdminController');
const CabEvidenceController = require('./CabEvidenceController');

/**
 * UI Controller for CAB Operations (Server-Rendered)
 */
exports.redirectIndex = (req, res) => {
  res.redirect('/ui/workspaces');
};

exports.listWorkspaces = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT id, name, pipeline_stage, cab_readiness_status, cab_review_state, cab_approval_count, cab_required_approvals, cab_expires_at 
       FROM workspace 
       ORDER BY id ASC`
    );
    res.render('workspaces', { workspaces: rows });
  } finally {
    connection.release();
  }
};

exports.getWorkspace = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  if (isNaN(workspaceId)) return res.status(400).render('error', { status: 400, code: 'INVALID_ID', message: 'Invalid Workspace ID' });

  const connection = await db.getConnection();
  try {
    // Core Fields
    const [wRows] = await connection.query(
      `SELECT id, name, pipeline_stage, cab_readiness_status, cab_review_state, 
              cab_approval_count, cab_required_approvals, cab_submitted_at, cab_expires_at 
       FROM workspace WHERE id = ?`, 
      [workspaceId]
    );
    if (wRows.length === 0) return res.status(404).render('error', { status: 404, code: 'NOT_FOUND', message: 'Workspace not found' });
    const workspace = wRows[0];

    // Latest Snapshot
    const [snapRows] = await connection.query(
      'SELECT * FROM workspace_snapshot WHERE workspace_id=? ORDER BY snapshot_at DESC, id DESC LIMIT 1',
      [workspaceId]
    );
    const snapshot = snapRows.length > 0 ? snapRows[0] : null;

    // Checklist Summary
    // 1. Get definitions for VERIFY_CAB
    const [defRows] = await connection.query(
      "SELECT id FROM stage_checklist_definition WHERE pipeline_stage = 'VERIFY_CAB' AND is_active = 1 AND is_required = 1"
    );
    const requiredCount = defRows.length;
    let passCount = 0;
    
    // 2. Get status
    if (requiredCount > 0) {
      const defIds = defRows.map(d => d.id);
      const [statusRows] = await connection.query(
        `SELECT status FROM workspace_checklist_status 
         WHERE workspace_id = ? AND checklist_definition_id IN (?)`,
        [workspaceId, defIds]
      );
      statusRows.forEach(r => {
        if (r.status === 'PASS' || r.status === 'WAIVED') passCount++;
      });
    }

    // Reviewers
    const [reviewers] = await connection.query(
      'SELECT reviewer_id, role, created_at FROM cab_reviewers WHERE workspace_id=? ORDER BY created_at ASC, id ASC',
      [workspaceId]
    );

    // Audit History (with evidence count)
    const [audit] = await connection.query(
      `SELECT a.id, a.decision AS action, a.actor_type, a.actor_id AS actor, a.rationale, a.created_at,
              (SELECT COUNT(*) FROM cab_review_evidence e WHERE e.audit_id=a.id) AS evidence_count
       FROM stage_transition_log a
       WHERE a.workspace_id=?
       ORDER BY a.created_at DESC, a.id DESC`,
      [workspaceId]
    );

    res.render('workspace', { 
      workspace, 
      snapshot, 
      checklist: { required: requiredCount, passed: passCount, failed: requiredCount - passCount },
      reviewers,
      audit
    });
  } finally {
    connection.release();
  }
};

exports.submitWorkspace = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  const actorId = req.user.id;
  try {
    await CabController.submitCabLogic(workspaceId, actorId, req.body.rationale);
    res.redirect(`/ui/workspaces/${workspaceId}`);
  } catch (err) {
    res.status(err.status || 500).render('error', { 
      status: err.status || 500, 
      code: err.code || 'ERROR', 
      message: err.message 
    });
  }
};

exports.approveWorkspace = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  const actorId = req.user.id;
  try {
    await CabDecisionController.approveLogic(workspaceId, actorId, req.body.rationale);
    res.redirect(`/ui/workspaces/${workspaceId}`);
  } catch (err) {
    res.status(err.status || 500).render('error', { 
      status: err.status || 500, 
      code: err.code || 'ERROR', 
      message: err.message 
    });
  }
};

exports.rejectWorkspace = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  const actorId = req.user.id;
  try {
    await CabDecisionController.rejectLogic(workspaceId, actorId);
    res.redirect(`/ui/workspaces/${workspaceId}`);
  } catch (err) {
    res.status(err.status || 500).render('error', { 
      status: err.status || 500, 
      code: err.code || 'ERROR', 
      message: err.message 
    });
  }
};

exports.getReviewers = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  // Manual Auth check or reuse service
  const authService = require('../services/CabAuthorizationService');
  const isChair = await authService.isChair(workspaceId, req.user.id);
  if (!isChair) {
    return res.status(403).render('error', { status: 403, code: 'FORBIDDEN', message: 'Only Chair can manage reviewers' });
  }

  const connection = await db.getConnection();
  try {
     const [reviewers] = await connection.query(
      'SELECT reviewer_id, role, created_at FROM cab_reviewers WHERE workspace_id=? ORDER BY created_at ASC, id ASC',
      [workspaceId]
    );
    res.render('reviewers', { workspaceId, reviewers });
  } finally {
    connection.release();
  }
};

exports.addReviewer = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  try {
    await CabReviewerAdminController.addReviewerLogic(workspaceId, req.user.id, req.body.reviewer_id, req.body.role);
    res.redirect(`/ui/workspaces/${workspaceId}/reviewers`);
  } catch (err) {
    res.status(err.status || 500).render('error', { status: err.status||500, code: err.code||'ERROR', message: err.message });
  }
};

exports.removeReviewer = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  try {
    await CabReviewerAdminController.removeReviewerLogic(workspaceId, req.user.id, req.body.reviewer_id);
    res.redirect(`/ui/workspaces/${workspaceId}/reviewers`);
  } catch (err) {
    res.status(err.status || 500).render('error', { status: err.status||500, code: err.code||'ERROR', message: err.message });
  }
};

exports.getEvidence = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  const auditId = req.query.audit_id;
  if (!auditId) return res.status(400).render('error', { status: 400, code: 'MISSING_PARAM', message: 'audit_id required' });

  const connection = await db.getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT id, audit_id, evidence_type, evidence_value, actor, created_at
       FROM cab_review_evidence
       WHERE workspace_id = ? AND audit_id = ?
       ORDER BY created_at ASC, id ASC`,
      [workspaceId, auditId]
    );
    res.render('evidence', { workspaceId, auditId, evidence: rows });
  } finally {
    connection.release();
  }
};

exports.addEvidence = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  try {
    await CabEvidenceController.attachEvidenceLogic(
      workspaceId, 
      req.user.id, 
      req.body.audit_id, 
      req.body.evidence_type, 
      req.body.evidence_value
    );
    res.redirect(`/ui/workspaces/${workspaceId}/evidence?audit_id=${req.body.audit_id}`);
  } catch (err) {
    res.status(err.status || 500).render('error', { status: err.status||500, code: err.code||'ERROR', message: err.message });
  }
};
