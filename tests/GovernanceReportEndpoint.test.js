const assert = require('assert');
const db = require('../src/config/database');
const http = require('http');

function getRequest(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 8080,
      path: path,
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
            const parsed = data ? JSON.parse(data) : {};
            resolve({ statusCode: res.statusCode, body: parsed });
        } catch (e) {
            resolve({ statusCode: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Helper to execute query directly
async function exec(connection, sql, args=[]) {
    return connection.query(sql, args);
}

async function runTests() {
  console.log('Running Governance Report Endpoint Tests...');
  const connection = await db.getConnection();

  try {
    const wsId = 9991;
    await exec(connection, 'DELETE FROM workspace WHERE id = ?', [wsId]);
    await exec(connection, 'DELETE FROM workspace_snapshot WHERE workspace_id = ?', [wsId]);
    await exec(connection, 'DELETE FROM stage_transition_log WHERE workspace_id = ?', [wsId]);
    await exec(connection, 'DELETE FROM workspace_checklist_status WHERE workspace_id = ?', [wsId]);

    // 1. Test 404
    console.log('Test 1: 404 Workspace Not Found');
    const r1 = await getRequest(`/api/workspaces/${wsId}/governance/report`);
    assert.strictEqual(r1.statusCode, 404);
    assert.strictEqual(r1.body.error, 'Workspace not found');

    // 2. Setup Workspace
    console.log('Test 2: Setup Workspace and Test Empty Report');
    await exec(connection, `INSERT INTO workspace (id, name, pipeline_stage, cab_readiness_status) VALUES (?, 'GovTestWS', 'VERIFY_CAB', 'PENDING_REVIEW')`, [wsId]);
    
    const r2 = await getRequest(`/api/workspaces/${wsId}/governance/report`);
    assert.strictEqual(r2.statusCode, 200);
    assert.strictEqual(r2.body.workspace_id, wsId);
    assert.strictEqual(r2.body.snapshot, null);
    
    // 3. Insert Snapshot
    console.log('Test 3: Snapshot Retrieval');
    const snapTime = new Date('2026-01-20T10:00:00.000Z');
    await exec(connection, 
        `INSERT INTO workspace_snapshot 
         (workspace_id, pipeline_stage, snapshot_at, is_valid,
          progress_score, risk_score, readiness_score, confidence_score,
          open_findings_count, critical_findings_count, open_risks_count, accepted_risks_count,
          missing_checklist_count, metrics_json) 
         VALUES (?, 'VERIFY_CAB', ?, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, '{}')`, 
        [wsId, snapTime]
    );
    
    const r3 = await getRequest(`/api/workspaces/${wsId}/governance/report`);
    assert.strictEqual(r3.statusCode, 200);
    assert.notStrictEqual(r3.body.snapshot, null);
    assert.strictEqual(r3.body.snapshot.is_valid, true);
    assert.strictEqual(new Date(r3.body.snapshot.created_at).toISOString(), snapTime.toISOString());

    // 4. Audit Log
    console.log('Test 4: Audit Log Retrieval');
    const tSubmitted = new Date('2026-01-20T12:00:00.000Z');
    const tApproved = new Date('2026-01-20T13:00:00.000Z');
    
    await exec(connection, 'DELETE FROM stage_transition_log WHERE workspace_id = ?', [wsId]);
    await exec(connection, 
        `INSERT INTO stage_transition_log (workspace_id, decision, created_at, from_stage, to_stage, actor_type, rationale) VALUES (?, 'SUBMITTED', ?, 'VERIFY_CAB', 'VERIFY_CAB', 'HUMAN', 'Test Rationale')`, 
        [wsId, tSubmitted]
    );
    await exec(connection, 
        `INSERT INTO stage_transition_log (workspace_id, decision, created_at, from_stage, to_stage, actor_type, rationale) VALUES (?, 'APPROVED', ?, 'VERIFY_CAB', 'RELEASE', 'HUMAN', 'Test Rationale')`, 
        [wsId, tApproved]
    );

    const r4 = await getRequest(`/api/workspaces/${wsId}/governance/report`);
    
    assert.strictEqual(r4.body.cab_audit.submitted_at, tSubmitted.toISOString());
    assert.strictEqual(r4.body.cab_audit.approved_at, tApproved.toISOString());
    assert.strictEqual(r4.body.cab_audit.rejected_at, null);

    // 5. Test SLA Fields (cab_submitted_at, cab_expires_at)
    console.log('Test 5: SLA Fields');
    const tExpires = new Date('2026-01-27T12:00:00.000Z');
    // Manually update workspace to simulate what the submission service checks/sets
    await exec(connection, 
        `UPDATE workspace SET cab_submitted_at = ?, cab_expires_at = ? WHERE id = ?`, 
        [tSubmitted, tExpires, wsId]
    );

    const r5 = await getRequest(`/api/workspaces/${wsId}/governance/report`);
    assert.strictEqual(r5.body.cab_submitted_at, tSubmitted.toISOString());
    assert.strictEqual(r5.body.cab_expires_at, tExpires.toISOString());

    console.log('✓ Governance Report Endpoint Tests Passed');

  } catch (err) {
    console.error('Test Failed:', err);
    process.exit(1);
  } finally {
    // Cleanup
    const wsId = 9991;
    await exec(connection, 'DELETE FROM workspace WHERE id = ?', [wsId]);
    await exec(connection, 'DELETE FROM workspace_snapshot WHERE workspace_id = ?', [wsId]);
    await exec(connection, 'DELETE FROM stage_transition_log WHERE workspace_id = ?', [wsId]);
    
    connection.release();
    process.exit(0);
  }
}

runTests();
