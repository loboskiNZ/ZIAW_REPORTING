const assert = require('assert');
const db = require('../src/config/database');
const request = require('http');

function postRequest(path, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 8080,
      path: path,
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Actor-Type': 'HUMAN',
        'X-Actor-ID': 'gate_tester'
      }
    };
    const req = request.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data ? JSON.parse(data) : {} }));
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
    // Cleanup Workspace 4 and related data
    await connection.query('DELETE FROM workspace_checklist_status WHERE workspace_id = 4');
    await connection.query('DELETE FROM workspace_snapshot WHERE workspace_id = 4');
    await connection.query('DELETE FROM stage_transition_log WHERE workspace_id = 4');
    await connection.query('DELETE FROM artifact WHERE workspace_id = 4'); // Clean artifacts
    await connection.query('DELETE FROM workspace WHERE id = 4');
    
    await connection.query(`INSERT INTO workspace (id, name, pipeline_stage, cab_readiness_status) VALUES (4, 'GateWS', 'VERIFY_CAB', 'NOT_READY')`);

    // Ensure Evaluation calculates PENDING_REVIEW later:
    
    // TEST 1: Attempt Transition NOT_READY -> fail
    console.log('Test 1: Transition NOT_READY -> Reject');
    const r1 = await postRequest('/api/workspaces/4/governance/transition', {
      to_stage: 'RELEASE',
      rationale: 'Testing Gate'
    });
    // Expected 409
    assert.strictEqual(r1.statusCode, 409);
    assert.strictEqual(r1.body.error, 'CAB_NOT_READY');

    // --- SETUP FOR TEST 2 ---
    // Make Workspace Ready (PENDING_REVIEW)
    
    // 1. Insert Artifact to satisfy AUTO rule (cab_runbook_present -> RUNBOOK)
    await connection.query(
      `INSERT INTO artifact (workspace_id, type, content, created_at)
       VALUES (4, 'RUNBOOK', CAST('{}' AS JSON), NOW())`
    );

    // 2. Insert PASS for HUMAN rules only (Auto rules are evaluated by system)
    const [defs] = await connection.query("SELECT id FROM stage_checklist_definition WHERE pipeline_stage = 'VERIFY_CAB' AND is_active = 1 AND is_required = 1 AND ownership_type = 'HUMAN'");
    for (const d of defs) {
       await connection.query(
         `INSERT INTO workspace_checklist_status (workspace_id, checklist_definition_id, status) VALUES (4, ?, 'PASS') 
          ON DUPLICATE KEY UPDATE status='PASS'`,
         [d.id]
       );
    }

    // 3. Insert Valid Snapshot
    await connection.query(
        `INSERT INTO workspace_snapshot 
         (workspace_id, pipeline_stage, snapshot_at, is_valid, metrics_json,
          progress_score, risk_score, readiness_score, confidence_score,
          open_findings_count, critical_findings_count, open_risks_count, accepted_risks_count, missing_checklist_count) 
         VALUES (4, 'VERIFY_CAB', NOW(), 1, '{}', 0, 0, 0, 0, 0, 0, 0, 0, 0)`
    );

    // TEST 2: Update to PENDING_REVIEW -> Pass
    // Now that we added Checklists=PASS, the evaluator (called by controller) should calculate PENDING_REVIEW.
    // So we don't even need to force Update (but we can to be sure).
    // Actually, controller calls evaluate() FIRST.
    // So if checklists pass, it sets PENDING_REVIEW. 
    // Then Gate check happens.
    console.log('Test 2: Transition PENDING_REVIEW (via Passing Checklists) -> Allow');
    
    const r2 = await postRequest('/api/workspaces/4/governance/transition', {
      to_stage: 'RELEASE',
      rationale: 'Testing Gate Pass'
    });
    
    // NOTE: It might fail on checklist requirements if we didn't seed them?
    // The "Check Required Rules" logic comes AFTER the Gate in controller.
    // If we passed the gate, we might hit "FAILED_PRECONDITION" for checklists.
    // But r2 should NOT be CAB_NOT_READY. 
    // If it returns 409 with blocking_rule_keys, that means it passed the CAB Gate!
    
    if (r2.statusCode === 409 && r2.body.error === 'CAB_NOT_READY') {
      assert.fail('Should not be blocked by CAB Gate');
    }
    
    // Check if it's strictly the CAB error we are testing.
    console.log('Response 2:', r2.statusCode, r2.body);
    // If we want it to 200 OK, we need to satisfy checklists.
    // For this test, verifying it passed the specific gate is enough.
    
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
