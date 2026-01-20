const db = require('../config/database');

class ChecklistEvaluator {
  /**
   * Evaluates AUTO checklist items.
   */
  async evaluate(workspaceId, stage) {
    const connection = await db.getConnection();
    try {
      // 1. Fetch AUTO Definitions
      const [definitions] = await connection.query(
        `SELECT * FROM stage_checklist_definition 
         WHERE pipeline_stage = ? AND ownership_type = 'AUTO' AND is_active = 1`,
        [stage]
      );

      const results = [];

      for (const def of definitions) {
        let status = 'NOT_EVALUATED';
        let detail = {};

        if (def.rule_kind === 'HAS_ARTIFACT') {
           const ruleSpec = def.rule_spec_json; // mysql2 parses JSON automatically if configured, else JSON.parse
           const spec = (typeof ruleSpec === 'string') ? JSON.parse(ruleSpec) : ruleSpec;

           const artifactType = spec.artifact_type_in; // e.g., ["THREAT_MODEL"]
           const minCount = spec.min_count || 1;

           // Count Artifacts
           // Note: Simple type check for now. Zachman tags would be in content JSON usually.
           const [rows] = await connection.query(
             `SELECT COUNT(*) as count FROM artifact 
              WHERE workspace_id = ? AND type IN (?)`,
             [workspaceId, artifactType]
           );
           const count = rows[0].count;

           if (count >= minCount) {
             status = 'PASS';
             detail = { check: 'HAS_ARTIFACT', expected: minCount, actual: count, types: artifactType };
           } else {
             status = 'FAIL';
             detail = { check: 'HAS_ARTIFACT', expected: minCount, actual: count, types: artifactType, missing: true };
           }
        } else if (def.rule_kind === 'MANUAL_CONFIRM') {
           // Skip evaluation
           continue; 
        }

        // Upsert Status
        if (status !== 'NOT_EVALUATED') {
          await connection.query(
            `INSERT INTO workspace_checklist_status 
             (workspace_id, checklist_definition_id, status, last_evaluated_at, evaluation_detail_json)
             VALUES (?, ?, ?, NOW(), ?)
             ON DUPLICATE KEY UPDATE
             status = VALUES(status),
             last_evaluated_at = VALUES(last_evaluated_at),
             evaluation_detail_json = VALUES(evaluation_detail_json)`,
            [workspaceId, def.id, status, JSON.stringify(detail)]
          );
        }
        results.push({ rule_key: def.rule_key, status });
      }
      
      // Trigger CAB Recompute
      try {
        const cabReadinessOrchestrator = require('./CabReadinessOrchestrator');
        await cabReadinessOrchestrator.recomputeAndPersist(workspaceId);
      } catch (err) {
        console.error('CAB Recompute Error:', err);
      }

      return results;
    } finally {
      connection.release();
    }
  }
}

module.exports = new ChecklistEvaluator();
