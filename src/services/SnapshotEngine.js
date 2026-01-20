const db = require('../config/database');
const checklistEvaluator = require('./ChecklistEvaluator');
const cabReadinessOrchestrator = require('./CabReadinessOrchestrator');

class SnapshotEngine {
  async computeAndPersistSnapshot(workspaceId) {
    const connection = await db.getConnection();
    try {
      // 1. Get Workspace
      const [wRows] = await connection.query('SELECT * FROM workspace WHERE id = ?', [workspaceId]);
      if (wRows.length === 0) throw new Error('Workspace not found');
      const workspace = wRows[0];
      const stage = workspace.pipeline_stage;

      // 2. Evaluate Checklists
      await checklistEvaluator.evaluate(workspaceId, stage);

      // 3. Gather Data
      // 3a. Checklist Stats
      const [checkRows] = await connection.query(
        `SELECT 
           wcs.status, 
           def.is_required, 
           def.rule_key
         FROM stage_checklist_definition def
         LEFT JOIN workspace_checklist_status wcs 
           ON def.id = wcs.checklist_definition_id AND wcs.workspace_id = ?
         WHERE def.pipeline_stage = ? AND def.is_active = 1`,
        [workspaceId, stage]
      );
      
      let totalRequired = 0;
      let passedRequired = 0;
      const missingKeys = [];
      const checklistStats = { total: 0, passed: 0, failed: 0, waived: 0 }; // Full stats

      checkRows.forEach(row => {
        checklistStats.total++;
        if (row.status === 'PASS') checklistStats.passed++;
        if (row.status === 'FAIL') checklistStats.failed++;
        if (row.status === 'WAIVED') checklistStats.waived++;

        if (row.is_required) {
          totalRequired++;
          if (row.status === 'PASS' || row.status === 'WAIVED') {
            passedRequired++;
          } else {
            missingKeys.push(row.rule_key);
          }
        }
      });
      
      const missingChecklistCount = missingKeys.length;

      // 3b. Risks
      // Fetch artifacts of type RISK
      const [riskRows] = await connection.query(
        `SELECT content, type FROM artifact WHERE workspace_id = ? AND type = 'RISK'`,
        [workspaceId]
      );
      
      let riskScoreRaw = 0;
      let openRisks = 0;
      let acceptedRisks = 0;
      const riskBreakdown = { critical: 0, high: 0, medium: 0, low: 0 };

      riskRows.forEach(row => {
        // Parse content (mysql2 might parse JSON automatically)
        const content = (typeof row.content === 'string') ? JSON.parse(row.content || '{}') : row.content;
        const severity = (content.severity || 'LOW').toUpperCase();
        const status = (content.status || 'OPEN').toUpperCase();
        
        if (status === 'ACCEPTED') acceptedRisks++;
        else openRisks++;

        let weight = 0;
        if (severity === 'CRITICAL') { weight = 40; riskBreakdown.critical++; }
        else if (severity === 'HIGH') { weight = 20; riskBreakdown.high++; }
        else if (severity === 'MEDIUM') { weight = 10; riskBreakdown.medium++; }
        else { weight = 2; riskBreakdown.low++; }

        if (status === 'ACCEPTED') weight = weight / 2; // Half weight for accepted
        riskScoreRaw += weight;
      });

      // 3c. Findings
      const [findingRows] = await connection.query(
        `SELECT severity, status FROM review_finding WHERE workspace_id = ? AND status != 'RESOLVED'`,
        [workspaceId]
      );
      
      let openFindings = 0;
      let criticalFindings = 0;
      findingRows.forEach(f => {
        openFindings++;
        if (f.severity === 'CRITICAL' && f.status === 'CONFIRMED') criticalFindings++;
      });

      // 3d. Core Artifacts (Readiness Check)
      // Check for INTEGRATION_FLOW, SECURITY_CONTROL, RUNBOOK
      // In V1, simple type check. Spec requires Zachman logic, approximating with type check 
      // since we don't have robust Zachman columns in 'artifact' table yet (only type/content).
      const [artifactTypeRows] = await connection.query(
        `SELECT type, content FROM artifact WHERE workspace_id = ?`,
        [workspaceId]
      );
      const artifactTypes = new Set(artifactTypeRows.map(r => r.type));
      
      const missingCore = [];
      if (!artifactTypes.has('INTEGRATION_FLOW')) missingCore.push('INTEGRATION_FLOW');
      if (!artifactTypes.has('SECURITY_CONTROL')) missingCore.push('SECURITY_CONTROL');
      if (!artifactTypes.has('RUNBOOK')) missingCore.push('RUNBOOK');

      // 3e. Stability (Churn)
      // Mocked Churn for V1 Skeleton (Requires audit log of artifact updates which we don't have fully yet)
      const churn = { adr: 0, api: 0, integration: 0 }; // Assume 0 churn for now
      // Query would be: SELECT COUNT(*) ... FROM artifact_history WHERE ...
      
      // 4. Compute Scores

      // Progress
      const progressScore = totalRequired > 0 
        ? Math.floor((passedRequired / totalRequired) * 100) 
        : 0;

      // Risk
      const riskScore = Math.min(100, riskScoreRaw);

      // Readiness
      let readinessScore = 100;
      readinessScore -= (criticalFindings * 50);
      if (missingCore.length > 0) readinessScore -= 30;
      // High Unresolved Risk Penalty? Spec says yes (-20).
      // Assuming non-accepted High/Critical risks trigger this.
      const hasHighUnresolved = riskRows.some(r => {
        const c = (typeof r.content === 'string') ? JSON.parse(r.content||'{}') : r.content;
        const s = (c.severity || '').toUpperCase();
        const st = (c.status || '').toUpperCase();
        return (s === 'HIGH' || s === 'CRITICAL') && st !== 'ACCEPTED';
      });
      if (hasHighUnresolved) readinessScore -= 20;
      
      readinessScore = Math.max(0, readinessScore);

      // Confidence
      const stabilityPenalty = (churn.adr * 10) + (churn.api * 5) + (churn.integration * 5);
      const stabilityScore = Math.max(0, 100 - stabilityPenalty);
      
      const confidenceScore = Math.floor(
        (readinessScore * 0.4) + 
        ((100 - riskScore) * 0.3) + 
        (progressScore * 0.2) + 
        (stabilityScore * 0.1)
      );

      // 5. Build Metrics JSON
      const metrics = {
        checklist: { 
          total_required: totalRequired, 
          passed: passedRequired, 
          missing_keys: missingKeys,
          stats: checklistStats
        },
        risks: {
          breakdown: riskBreakdown,
          open: openRisks,
          accepted: acceptedRisks,
          total_weight: riskScoreRaw
        },
        findings: {
          open: openFindings,
          critical_confirmed: criticalFindings
        },
        readiness: {
          missing_core_artifacts: missingCore
        },
        stability: {
          churn: churn,
          score: stabilityScore
        }
      };

      // 6. Persist (Initially is_valid = 0)
      const [res] = await connection.query(
        `INSERT INTO workspace_snapshot 
         (workspace_id, pipeline_stage, progress_score, risk_score, readiness_score, confidence_score, 
          open_findings_count, critical_findings_count, open_risks_count, accepted_risks_count, 
          missing_checklist_count, metrics_json, snapshot_at, is_valid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)`,
        [workspaceId, stage, progressScore, riskScore, readinessScore, confidenceScore,
         openFindings, criticalFindings, openRisks, acceptedRisks, missingChecklistCount, JSON.stringify(metrics)]
      );

      const newSnapshotId = res.insertId;

      // 7. Validity Swap (Atomic in Transaction)
      // Invalidate existing valid snapshots for this workspace
      await connection.query(
        'UPDATE workspace_snapshot SET is_valid = 0 WHERE workspace_id = ? AND is_valid = 1',
        [workspaceId]
      );
      
      // Validate the new one
      await connection.query(
        'UPDATE workspace_snapshot SET is_valid = 1 WHERE id = ?',
        [newSnapshotId]
      );

      await cabReadinessOrchestrator.recomputeAndPersist(workspaceId);

      return {
        snapshot_id: res.insertId,
        cores: { progress: progressScore, risk: riskScore, readiness: readinessScore, confidence: confidenceScore },
        metrics
      };

    } finally {
      connection.release();
    }
  }
}

module.exports = new SnapshotEngine();
