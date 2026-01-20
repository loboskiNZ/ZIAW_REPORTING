const db = require('../config/database');

class CabReadinessService {

  /**
   * pure evaluation of CAB readiness
   * @param {number} workspaceId 
   * @returns {Promise<string>} 'NOT_READY' | 'PENDING_REVIEW'
   */
  async evaluateCabReadiness(workspaceId) {
    const connection = await db.getConnection();
    try {
      // 1. Load Pipeline Stage
      const [wRows] = await connection.query('SELECT pipeline_stage FROM workspace WHERE id = ?', [workspaceId]);
      if (wRows.length === 0) return 'NOT_READY'; // Or throw error, but logic says return status
      const pipelineStage = wRows[0].pipeline_stage;

      // 2. Load Checklist Statuses (Required ones for VERIFY_CAB)
      // We explicitly check VERIFY_CAB requirements
      const [checklistRows] = await connection.query(
        `SELECT 
           d.rule_key, 
           COALESCE(wcs.status, 'NOT_EVALUATED') as status
         FROM stage_checklist_definition d
         LEFT JOIN workspace_checklist_status wcs 
           ON wcs.checklist_definition_id = d.id AND wcs.workspace_id = ?
         WHERE d.pipeline_stage = 'VERIFY_CAB' 
           AND d.is_active = 1 
           AND d.is_required = 1`,
        [workspaceId]
      );

      // 3. Load Latest Snapshot
      const [snapRows] = await connection.query(
        `SELECT * FROM workspace_snapshot 
         WHERE workspace_id = ? 
         ORDER BY snapshot_at DESC LIMIT 1`,
        [workspaceId]
      );
      const latestSnapshot = snapRows.length > 0 ? snapRows[0] : null;

      // --- LOGIC CHECKS ---

      // A) Precondition: Stage must be VERIFY_CAB
      if (pipelineStage !== 'VERIFY_CAB') {
        return 'NOT_READY';
      }

      // B) Precondition: Snapshot must exist
      if (!latestSnapshot) {
        return 'NOT_READY';
      }

      // C) Precondition: Snapshot Must be Valid
      // Strict Schema Check
      if (latestSnapshot.is_valid !== 1) { 
        return 'NOT_READY';
      }

      // D) Checklist Completion
      // All required items must be PASS
      const allPassed = checklistRows.every(r => r.status === 'PASS');
      if (!allPassed) {
        return 'NOT_READY';
      }

      // All Pass
      return 'PENDING_REVIEW';

    } finally {
      connection.release();
    }
  }
}

module.exports = new CabReadinessService();
