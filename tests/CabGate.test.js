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
        'X-Actor-Type': 'HUMAN'
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
    // Setup Workspace 4
    await connection.query('DELETE FROM workspace WHERE id = 4');
    await connection.query(`INSERT INTO workspace (id, name, pipeline_stage, cab_readiness_status) VALUES (4, 'GateWS', 'VERIFY_CAB', 'NOT_READY')`);

    // TEST 1: Attempt Transition NOT_READY -> fail
    console.log('Test 1: Transition NOT_READY -> Reject');
    const r1 = await postRequest('/api/workspaces/4/governance/transition', {
      to_stage: 'RELEASE',
      rationale: 'Testing Gate'
    });
    assert.strictEqual(r1.statusCode, 409);
    assert.strictEqual(r1.body.error, 'CAB_NOT_READY');
    
    // TEST 2: Update to PENDING_REVIEW -> Pass
    console.log('Test 2: Transition PENDING_REVIEW -> Allow');
    await connection.query("UPDATE workspace SET cab_readiness_status = 'PENDING_REVIEW' WHERE id = 4");
    
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
