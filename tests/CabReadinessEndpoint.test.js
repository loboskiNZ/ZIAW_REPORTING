const assert = require('assert');
const db = require('../src/config/database');
const request = require('http');

// Helper for http request (since we don't have supertest)
function makeRequest(path) {
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
  console.log('Running CAB Readiness Endpoint Tests...');

  // Prerequisite: Server must be running (curl/node app.js)
  // We'll rely on existing running server. if it's not up, this fails.

  // Setup Test Data
  const connection = await db.getConnection();
  try {
    // Workspace 3 for this test
    await connection.query('DELETE FROM workspace WHERE id = 3');
    await connection.query(`INSERT INTO workspace (id, name, pipeline_stage, cab_readiness_status) VALUES (3, 'ReadinessAPI', 'VERIFY_CAB', 'NOT_READY')`);
    
    // Insert Snapshot
    await connection.query(`
      INSERT INTO workspace_snapshot (workspace_id, pipeline_stage, progress_score, risk_score, readiness_score, confidence_score, snapshot_at, is_valid)
      VALUES (3, 'VERIFY_CAB', 50, 10, 50, 50, NOW(), 1)
    `);

    // Insert Checklists (2 Required: 1 Pass, 1 Fail)
    // We assume definitions exist for VERIFY_CAB (seeded in V2)
    // 'cab_runbook_present', 'cab_risks_reviewed'
    
    // Get def IDs
    const [defs] = await connection.query("SELECT id, rule_key FROM stage_checklist_definition WHERE pipeline_stage='VERIFY_CAB' AND is_required=1");
    // Insert statuses
    if (defs.length >= 2) {
       await connection.query(`INSERT INTO workspace_checklist_status (workspace_id, checklist_definition_id, status) VALUES (3, ?, 'PASS')`, [defs[0].id]);
       await connection.query(`INSERT INTO workspace_checklist_status (workspace_id, checklist_definition_id, status) VALUES (3, ?, 'FAIL')`, [defs[1].id]);
    }

    // --- TEST 1: Invalid ID ---
    console.log('Test 1: GET /api/workspaces/invalid/cab-readiness');
    // Just curl/request
    // Node http request requires "running" server. 
    // We will assume the tool `run_command` can execute `curl` more reliably if we want external verify.
    // Ideally this script should be self-contained but it needs the app running.
    // I'll assume app is running from previous step.
    
    const r1 = await makeRequest('/api/workspaces/abc/cab-readiness');
    assert.strictEqual(r1.statusCode, 400);

    // --- TEST 2: Not Found ---
    console.log('Test 2: GET /api/workspaces/999/cab-readiness');
    const r2 = await makeRequest('/api/workspaces/999/cab-readiness');
    assert.strictEqual(r2.statusCode, 404);

    // --- TEST 3: Valid Success ---
    console.log('Test 3: GET /api/workspaces/3/cab-readiness');
    const r3 = await makeRequest('/api/workspaces/3/cab-readiness');
    assert.strictEqual(r3.statusCode, 200);
    const body = r3.body;
    
    assert.strictEqual(body.workspace_id, 3);
    assert.strictEqual(body.pipeline_stage, 'VERIFY_CAB');
    assert.strictEqual(body.cab_readiness_status, 'NOT_READY');
    assert.ok(body.latest_snapshot);
    assert.strictEqual(body.latest_snapshot.is_valid, true);
    
    assert.ok(body.cab_required_checklist);
    assert.strictEqual(body.cab_required_checklist.required_total, defs.length); // Should match count of required rules
    assert.strictEqual(body.cab_required_checklist.required_passed, 1);

    console.log('✓ All Readiness Endpoint Tests Passed');

  } catch (err) {
    console.error('Test Error:', err);
    process.exit(1);
  } finally {
    connection.release();
    process.exit(0);
  }
}

runTests();
