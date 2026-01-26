const assert = require('assert');
const db = require('../../src/config/database'); // Adjusted path for nested dir
const request = require('http');
const cabReadinessOrchestrator = require('../../src/services/CabReadinessOrchestrator'); // Adjust path

// Helper for API requests
function apiRequest(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 8080,
      path: path,
      method: method,
      headers: { 
        'Content-Type': 'application/json',
        'X-Actor-Type': 'HUMAN',
        ...headers 
      }
    };
    const req = request.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data ? JSON.parse(data) : {} }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('Running CAB End-to-End Flow Tests...');
  const connection = await db.getConnection();

  try {
    const WORKSPACE_ID = 11;

    // --- 2. Test Setup ---
    console.log('--- Step 2: Test Setup ---');
    await connection.query('DELETE FROM workspace WHERE id = ?', [WORKSPACE_ID]);
    await connection.query(`INSERT INTO workspace (id, name, pipeline_stage, cab_readiness_status) VALUES (?, 'E2E_CAB_WS', 'VERIFY_CAB', 'NOT_READY')`, [WORKSPACE_ID]);
    
    // Seed Checklists (Ensure we have definition for VERIFY_CAB)
    // We assume V2 migration seeded definitions. We trigger logic by inserting status 'PASS'.
    // Get a rule key for VERIFY_CAB
    const [rules] = await connection.query("SELECT id, rule_key FROM stage_checklist_definition WHERE pipeline_stage = 'VERIFY_CAB' AND is_required = 1 LIMIT 1");
    if (rules.length === 0) throw new Error('No required checklist rules found for VERIFY_CAB');
    const ruleId = rules[0].id;
    
    // Insert 'PASS' status
    await connection.query(
        `INSERT INTO workspace_checklist_status (workspace_id, checklist_definition_id, status) VALUES (?, ?, 'PASS')`,
        [WORKSPACE_ID, ruleId]
    );

    // Create Valid Snapshot (Latest)
    await connection.query(
        `INSERT INTO workspace_snapshot (workspace_id, pipeline_stage, progress_score, risk_score, readiness_score, confidence_score, is_valid, snapshot_at)
         VALUES (?, 'VERIFY_CAB', 100, 0, 100, 100, 1, NOW())`,
        [WORKSPACE_ID]
    );

    // --- 3. Trigger Readiness Persistence ---
    console.log('--- Step 3: Trigger Readiness Persistence ---');
    // Using Orchestrator directly as requested ("system code path")
    await cabReadinessOrchestrator.recomputeAndPersist(WORKSPACE_ID);

    // Assert PENDING_REVIEW
    const [w1] = await connection.query('SELECT cab_readiness_status FROM workspace WHERE id = ?', [WORKSPACE_ID]);
    assert.strictEqual(w1[0].cab_readiness_status, 'PENDING_REVIEW', 'Orchestrator should have set status to PENDING_REVIEW');
    console.log('✓ Orchestrator set PENDING_REVIEW');

    // --- 4. Call CAB Submit ---
    console.log('--- Step 4: CAB Submit ---');
    const resSubmit = await apiRequest('POST', `/api/workspaces/${WORKSPACE_ID}/cab/submit`, { rationale: 'Ready to go' });
    assert.strictEqual(resSubmit.statusCode, 200);
    assert.strictEqual(resSubmit.body.cab_readiness_status, 'PENDING_REVIEW');
    
    // Assert Audit SUBMITTED
    const [a1] = await connection.query("SELECT * FROM stage_transition_log WHERE workspace_id = ? AND decision = 'SUBMITTED'", [WORKSPACE_ID]);
    assert.strictEqual(a1.length, 1, 'Should have exactly one SUBMITTED audit');
    console.log('✓ Submit successful and audited');

    // --- 5. Verify Stage Transition Gating ---
    console.log('--- Step 5: Verify Gating ---');
    // First Reject to set status to NOT_READY (so we can test the blocked transition)
    const resReject = await apiRequest('POST', `/api/workspaces/${WORKSPACE_ID}/cab/reject`, {});
    assert.strictEqual(resReject.statusCode, 200, 'Reject should succeed');
    
    // Verify NOT_READY
    const [wRej] = await connection.query('SELECT cab_readiness_status FROM workspace WHERE id = ?', [WORKSPACE_ID]);
    assert.strictEqual(wRej[0].cab_readiness_status, 'NOT_READY');

    // Attempt Transition (Should Fail)
    const resGate = await apiRequest('POST', `/api/workspaces/${WORKSPACE_ID}/governance/transition`, { to_stage: 'RELEASE' });
    assert.strictEqual(resGate.statusCode, 409);
    assert.strictEqual(resGate.body.error, 'CAB_NOT_READY');
    console.log('✓ Transition blocked by CAB Gate');

    // --- 6. Restore to Review Ready ---
    console.log('--- Step 6: Restore State ---');
    // Recompute
    await cabReadinessOrchestrator.recomputeAndPersist(WORKSPACE_ID);
    // Submit again to log it? Or just recompute?
    // Instruction says "Recompute... Assert PENDING_REVIEW".
    // Since we rejected, status is NOT_READY. Orchestrator should flip it back because snapshot/checklists are still valid.
    
    const [wRestored] = await connection.query('SELECT cab_readiness_status FROM workspace WHERE id = ?', [WORKSPACE_ID]);
    assert.strictEqual(wRestored[0].cab_readiness_status, 'PENDING_REVIEW');
    console.log('✓ State restored to PENDING_REVIEW');

    // --- 7. Approve ---
    console.log('--- Step 7: Approve ---');
    const resApprove = await apiRequest('POST', `/api/workspaces/${WORKSPACE_ID}/cab/approve`, { rationale: 'Ship it' });
    assert.strictEqual(resApprove.statusCode, 200, 'Approve should succeed');
    
    // Assert State Changes
    const [wFinal] = await connection.query('SELECT pipeline_stage, cab_readiness_status FROM workspace WHERE id = ?', [WORKSPACE_ID]);
    assert.strictEqual(wFinal[0].pipeline_stage, 'RELEASE', 'Stage should be RELEASE');
    assert.strictEqual(wFinal[0].cab_readiness_status, 'NOT_READY', 'Status should be NOT_READY (Invariants)');
    
    // Assert Audit APPROVED
    const [a2] = await connection.query("SELECT * FROM stage_transition_log WHERE workspace_id = ? AND decision = 'APPROVED'", [WORKSPACE_ID]);
    assert.ok(a2.length >= 1, 'Should have APPROVED audit');
    console.log('✓ Approval advanced stage and reset status');

    // --- 8. Verify Invariants (Negative Assertion) ---
    console.log('--- Step 8: DB Invariants ---');
    // Workspace is now in RELEASE. Attempting to insert APPROVED audit should fail rule B.
    try {
        await connection.query(
            `INSERT INTO stage_transition_log 
             (workspace_id, from_stage, to_stage, actor_type, decision, rationale, created_at)
             VALUES (?, 'RELEASE', 'RELEASE', 'SYSTEM', 'APPROVED', 'Fail', NOW())`,
            [WORKSPACE_ID]
        );
        assert.fail('Should be blocked by DB trigger');
    } catch (err) {
        assert.ok(err.message.includes('CAB_AUDIT_ACTION_INVALID'), 'Expected constraint error');
        console.log('✓ DB Trigger blocked invalid audit');
    }

    console.log('✓ TASK 11 COMPLETE: End-to-End Flow Passed');

  } catch (err) {
    console.error('Test Failed:', err);
    process.exit(1);
  } finally {
    connection.release();
    process.exit(0);
  }
}

runTests();
