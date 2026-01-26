const assert = require('assert');
const db = require('../src/config/database');
const cabOrchestrator = require('../src/services/CabReadinessOrchestrator');
const request = require('http');

function postRequest(path, body, actorId = 'gate_tester') {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 8080,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Actor-Type': 'HUMAN',
        'X-Actor-ID': actorId
      }
    };

    const req = request.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            body: data ? JSON.parse(data) : {}
          });
        } catch (e) {
          // If non-JSON, surface raw
          resolve({ statusCode: res.statusCode, body: { raw: data } });
        }
      });
    });

    req.on('error', reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('Running CAB Gate Tests...');
  const connection = await db.getConnection();

  try {
    // Setup Workspace 4
    await connection.query('DELETE FROM workspace WHERE id = 4');
    await connection.query(
      "INSERT INTO workspace (id, name, pipeline_stage, cab_readiness_status, cab_review_state, cab_required_approvals, cab_approval_count) VALUES (4, 'GateWS', 'VERIFY_CAB', 'NOT_READY', 'NONE', 2, 0)"
    );

    // Pass ALL required checklist definitions for VERIFY_CAB
    const [defs] = await connection.query(
      "SELECT id FROM stage_checklist_definition WHERE pipeline_stage = 'VERIFY_CAB' AND is_active = 1 AND is_required = 1"
    );

    for (const d of defs) {
      await connection.query(
        `INSERT INTO workspace_checklist_status (workspace_id, checklist_definition_id, status, last_evaluated_at)
         VALUES (4, ?, 'PASS', NOW())
         ON DUPLICATE KEY UPDATE status='PASS', last_evaluated_at=NOW()`,
        [d.id]
      );
    }

    // Insert a valid snapshot that satisfies the current schema
    await connection.query(
      `INSERT INTO workspace_snapshot (
          workspace_id,
          pipeline_stage,
          progress_score,
          risk_score,
          readiness_score,
          confidence_score,
          open_findings_count,
          critical_findings_count,
          open_risks_count,
          accepted_risks_count,
          missing_checklist_count,
          jira_total_count,
          jira_done_count,
          metrics_json,
          snapshot_at,
          is_valid
        ) VALUES (
          4, 'VERIFY_CAB',
          0, 0, 0, 0,
          0, 0, 0, 0, 0,
          0, 0,
          '{}',
          NOW(),
          1
        )`
    );

    // IMPORTANT: readiness is persisted; recompute it exactly the way production does.
    const persisted = await cabOrchestrator.recomputeAndPersist(4);
    console.log('Persisted CAB readiness after recompute:', persisted);

    // TEST 1: Attempt Transition NOT_READY -> must be rejected by CAB gate
    // Force workspace readiness back to NOT_READY to validate gate behavior deterministically.
    await connection.query("UPDATE workspace SET cab_readiness_status='NOT_READY' WHERE id=4");

    console.log('Test 1: Transition NOT_READY -> Reject');
    const r1 = await postRequest('/api/workspaces/4/governance/transition', {
      to_stage: 'RELEASE',
      rationale: 'Testing Gate'
    });

    assert.strictEqual(r1.statusCode, 409);
    assert.strictEqual(r1.body.error, 'CAB_NOT_READY');

    // TEST 2: Transition PENDING_REVIEW -> must not be blocked by CAB gate
    // Recompute & persist again (this sets PENDING_REVIEW if snapshot+checklists meet criteria)
    await cabOrchestrator.recomputeAndPersist(4);

    const [ws] = await connection.query('SELECT cab_readiness_status FROM workspace WHERE id=4');
    console.log('CAB status before transition attempt:', ws[0].cab_readiness_status);

    console.log('Test 2: Transition PENDING_REVIEW -> Allow (not CAB_NOT_READY)');
    const r2 = await postRequest('/api/workspaces/4/governance/transition', {
      to_stage: 'RELEASE',
      rationale: 'Testing Gate Pass'
    });

    if (r2.statusCode === 409 && r2.body.error === 'CAB_NOT_READY') {
      assert.fail('Should not be blocked by CAB Gate (CAB_NOT_READY)');
    }

    console.log('Response 2:', r2.statusCode, r2.body);
    console.log('✓ CAB Gate Tests Passed');
  } catch (err) {
    console.error('Test Failed:', err);
    process.exit(1);
  } finally {
    connection.release();
    process.exit(0);
  }
}

runTests();
