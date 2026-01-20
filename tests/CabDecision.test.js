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
      headers: { 'Content-Type': 'application/json' }
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
  console.log('Running CAB Decision Tests...');
  const connection = await db.getConnection();

  try {
    // Setup Workspace 5
    await connection.query('DELETE FROM workspace WHERE id = 5');
    await connection.query(`INSERT INTO workspace (id, name, pipeline_stage, cab_readiness_status) VALUES (5, 'DecisionWS', 'VERIFY_CAB', 'PENDING_REVIEW')`);
    // Ensure no logs
    await connection.query('DELETE FROM stage_transition_log WHERE workspace_id = 5');

    // --- Test 1: Reject ---
    console.log('Test 1: Reject');
    const r1 = await postRequest('/api/workspaces/5/cab/reject', {});
    assert.strictEqual(r1.statusCode, 200);
    assert.strictEqual(r1.body.workspace_id, 5);
    
    // Check DB state
    const [w1] = await connection.query('SELECT cab_readiness_status, pipeline_stage FROM workspace WHERE id = 5');
    assert.strictEqual(w1[0].cab_readiness_status, 'NOT_READY');
    assert.strictEqual(w1[0].pipeline_stage, 'VERIFY_CAB'); // No stage change

    // Check Log
    const [l1] = await connection.query('SELECT decision, actor_type FROM stage_transition_log WHERE workspace_id = 5 ORDER BY id DESC LIMIT 1');
    assert.strictEqual(l1[0].decision, 'REJECTED');
    assert.strictEqual(l1[0].actor_type, 'SYSTEM');

    // --- Test 2: Idempotent Reject ---
    console.log('Test 2: Idempotent Reject');
    const r2 = await postRequest('/api/workspaces/5/cab/reject', {});
    assert.strictEqual(r2.statusCode, 200);
    // Should NOT insert new log (verify count)
    const [countRow] = await connection.query('SELECT COUNT(*) as c FROM stage_transition_log WHERE workspace_id = 5');
    assert.strictEqual(countRow[0].c, 1, 'Should not insert duplicate log');


    // --- Test 3: Approve (Setup first) ---
    console.log('Test 3: Approve');
    // Reset to PENDING_REVIEW for test
    await connection.query("UPDATE workspace SET cab_readiness_status = 'PENDING_REVIEW' WHERE id = 5");
    
    const r3 = await postRequest('/api/workspaces/5/cab/approve', {});
    assert.strictEqual(r3.statusCode, 200);
    
    // Check DB
    const [w2] = await connection.query('SELECT cab_readiness_status, pipeline_stage FROM workspace WHERE id = 5');
    assert.strictEqual(w2[0].pipeline_stage, 'RELEASE');
    assert.strictEqual(w2[0].cab_readiness_status, 'PENDING_REVIEW'); // Should NOT change
    
    // Check Log
    const [l2] = await connection.query('SELECT decision, actor_type FROM stage_transition_log WHERE workspace_id = 5 ORDER BY id DESC LIMIT 1');
    assert.strictEqual(l2[0].decision, 'APPROVED');

    // --- Test 4: Idempotency / Invalid Stage ---
    // Now we are in RELEASE.
    // Spec: "Precondition... pipeline_stage must equal VERIFY_CAB".
    // So attempting to approve AGAIN should Fail 409 INVALID_STAGE, UNLESS idempotency checks logic bypasses it?
    // My implementation checks stage first.
    // So it should be 409.
    
    console.log('Test 4: Approve Again (Invalid Stage)');
    const r4 = await postRequest('/api/workspaces/5/cab/approve', {});
    
    // If we followed instruction "4. Load... enforce... 1. Stage must equal VERIFY_CAB", we expect 409.
    // If we followed "6. If APPROVED audit exists... return 200", we might expect 200.
    // But since I implemented strict sequential checks, I expect 409.
    // NOTE: This reflects "You can't Cab Approve something in RELEASE stage". 
    // This seems correct. Idempotency is for "Retry while in state".
    
    assert.strictEqual(r4.statusCode, 409, 'Should be 409 because stage is now RELEASE');
    assert.strictEqual(r4.body.error, 'INVALID_STAGE');


    console.log('✓ CAB Decision Tests Passed');

  } catch (err) {
    console.error('Test Failed:', err);
    process.exit(1);
  } finally {
    connection.release();
    process.exit(0);
  }
}

runTests();
