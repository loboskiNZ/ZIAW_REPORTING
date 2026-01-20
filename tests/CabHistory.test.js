const assert = require('assert');
const db = require('../src/config/database');
const request = require('http');

function getRequest(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 8080,
      path: path,
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    };
    const req = request.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data ? JSON.parse(data) : {} }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('Running CAB History Tests...');
  const connection = await db.getConnection();

  try {
    // Setup Workspace 6
    await connection.query('DELETE FROM workspace WHERE id = 6');
    await connection.query(`INSERT INTO workspace (id, name, pipeline_stage, cab_readiness_status) VALUES (6, 'HistoryWS', 'VERIFY_CAB', 'NOT_READY')`);
    
    // Insert some logs
    await connection.query(
      `INSERT INTO stage_transition_log (workspace_id, from_stage, to_stage, actor_type, decision, rationale, created_at)
       VALUES 
       (6, 'VERIFY_CAB', 'VERIFY_CAB', 'SYSTEM', 'FAILED_PRECONDITION', 'Test 1', '2023-01-01 10:00:00'),
       (6, 'VERIFY_CAB', 'RELEASE', 'HUMAN', 'APPROVED', 'Test 2', '2023-01-01 11:00:00')`
    );

    // Test 1: Invalid ID
    console.log('Test 1: Invalid ID');
    const r1 = await getRequest('/api/workspaces/bad/cab/history');
    assert.strictEqual(r1.statusCode, 400);

    // Test 2: Missing Workspace
    console.log('Test 2: Missing Workspace');
    const r2 = await getRequest('/api/workspaces/999/cab/history');
    assert.strictEqual(r2.statusCode, 404);

    // Test 3: Success
    console.log('Test 3: Success');
    const r3 = await getRequest('/api/workspaces/6/cab/history');
    assert.strictEqual(r3.statusCode, 200);
    assert.strictEqual(r3.body.workspace_id, 6);
    assert.strictEqual(r3.body.events.length, 2);
    
    // Check Event Structure
    const e1 = r3.body.events[0];
    assert.strictEqual(e1.action, 'FAILED_PRECONDITION');
    assert.strictEqual(e1.actor, 'SYSTEM');
    
    const e2 = r3.body.events[1];
    assert.strictEqual(e2.action, 'APPROVED');
    assert.strictEqual(e2.actor, 'HUMAN');

    console.log('✓ CAB History Tests Passed');

  } catch (err) {
    console.error('Test Failed:', err);
    process.exit(1);
  } finally {
    connection.release();
    process.exit(0);
  }
}

runTests();
