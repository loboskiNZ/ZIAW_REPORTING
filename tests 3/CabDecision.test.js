const assert = require('assert');
const db = require('../src/config/database');
const request = require('http');

function postRequest(path, body, actorId) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost',
      port: 8080,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Actor-ID': actorId,
        'X-Actor-Type': 'HUMAN'
      }
    };

    const req = request.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode, body: data ? JSON.parse(data) : {} });
        } catch (e) {
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
  console.log('Running CAB Decision Tests...');
  const connection = await db.getConnection();

  try {
    // ----- Common Setup (Workspace 5) -----
    await connection.query('DELETE FROM workspace WHERE id = 5');
    await connection.query(
      "INSERT INTO workspace (id, name, pipeline_stage, cab_readiness_status, cab_review_state, cab_required_approvals, cab_approval_count) VALUES (5, 'DecisionWS', 'VERIFY_CAB', 'PENDING_REVIEW', 'NONE', 2, 0)"
    );

    // Clear logs
    await connection.query('DELETE FROM stage_transition_log WHERE workspace_id = 5');

    // Seed reviewers (two chairs)
    await connection.query('DELETE FROM cab_reviewers WHERE workspace_id = 5');
    await connection.query("INSERT INTO cab_reviewers (workspace_id, reviewer_id, role) VALUES (5, 'chair_one', 'CHAIR')");
    await connection.query("INSERT INTO cab_reviewers (workspace_id, reviewer_id, role) VALUES (5, 'chair_two', 'CHAIR')");

    // ---------------- Test 1: Reject ----------------
    console.log('Test 1: Reject');
    const r1 = await postRequest('/api/workspaces/5/cab/reject', {}, 'chair_one');
    assert.strictEqual(r1.statusCode, 200);
    assert.strictEqual(r1.body.workspace_id, 5);

    const [w1] = await connection.query('SELECT cab_readiness_status, pipeline_stage, cab_review_state FROM workspace WHERE id = 5');
    assert.strictEqual(w1[0].cab_readiness_status, 'NOT_READY');
    assert.strictEqual(w1[0].pipeline_stage, 'VERIFY_CAB');

    const [l1] = await connection.query(
      "SELECT decision, actor_type, actor_id FROM stage_transition_log WHERE workspace_id = 5 ORDER BY id DESC LIMIT 1"
    );
    assert.strictEqual(l1[0].decision, 'REJECTED');
    assert.strictEqual(l1[0].actor_type, 'HUMAN');
    assert.strictEqual(l1[0].actor_id, 'chair_one');

    // ------------- Test 2: Idempotent Reject -------------
    console.log('Test 2: Idempotent Reject');
    const r2 = await postRequest('/api/workspaces/5/cab/reject', {}, 'chair_one');
    assert.strictEqual(r2.statusCode, 200);

    const [countRow] = await connection.query('SELECT COUNT(*) as c FROM stage_transition_log WHERE workspace_id = 5 AND decision = \'REJECTED\'');
    assert.strictEqual(countRow[0].c, 1, 'Should not insert duplicate REJECTED log');

    // ---------------- Test 3: Approve (Quorum) ----------------
    console.log('Test 3: Approve (Quorum)');

    // Reset state for approval path
    await connection.query(
      "UPDATE workspace SET pipeline_stage='VERIFY_CAB', cab_review_state='IN_REVIEW', cab_readiness_status='PENDING_REVIEW', cab_approval_count=0, cab_required_approvals=2 WHERE id=5"
    );
    await connection.query("DELETE FROM stage_transition_log WHERE workspace_id = 5");

    // Insert checklists PASS (not required by approve, but keeps workspace realistic)
    const [defs] = await connection.query(
      "SELECT id FROM stage_checklist_definition WHERE pipeline_stage = 'VERIFY_CAB' AND is_active = 1 AND is_required = 1"
    );
    for (const d of defs) {
      await connection.query(
        `INSERT INTO workspace_checklist_status (workspace_id, checklist_definition_id, status, last_evaluated_at)
         VALUES (5, ?, 'PASS', NOW())
         ON DUPLICATE KEY UPDATE status='PASS', last_evaluated_at=NOW()`,
        [d.id]
      );
    }

    // Insert valid snapshot satisfying schema
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
        5, 'VERIFY_CAB',
        0, 0, 0, 0,
        0, 0, 0, 0, 0,
        0, 0,
        '{}',
        NOW(),
        1
      )`
    );

    // Chair one votes
    const v1 = await postRequest('/api/workspaces/5/cab/approve', {}, 'chair_one');
    assert.strictEqual(v1.statusCode, 200);
    assert.strictEqual(v1.body.workspace_id, 5);
    assert.strictEqual(v1.body.result, 'VOTE_RECORDED');
    assert.strictEqual(v1.body.approvals, 1);
    assert.strictEqual(v1.body.required, 2);

    const [w2] = await connection.query('SELECT pipeline_stage, cab_readiness_status, cab_review_state, cab_approval_count FROM workspace WHERE id=5');
    assert.strictEqual(w2[0].pipeline_stage, 'VERIFY_CAB');
    assert.strictEqual(w2[0].cab_review_state, 'IN_REVIEW');
    assert.strictEqual(w2[0].cab_approval_count, 1);

    // Chair two votes -> quorum reached -> final APPROVED + stage advance + readiness reset
    const v2 = await postRequest('/api/workspaces/5/cab/approve', {}, 'chair_two');
    assert.strictEqual(v2.statusCode, 200);
    assert.strictEqual(v2.body.workspace_id, 5);
    assert.strictEqual(v2.body.result, 'APPROVED');
    assert.strictEqual(v2.body.approvals, 2);
    assert.strictEqual(v2.body.required, 2);

    const [w3] = await connection.query('SELECT pipeline_stage, cab_readiness_status, cab_review_state, cab_approval_count FROM workspace WHERE id=5');
    assert.strictEqual(w3[0].pipeline_stage, 'RELEASE');
    assert.strictEqual(w3[0].cab_review_state, 'APPROVED');
    assert.strictEqual(w3[0].cab_readiness_status, 'NOT_READY');
    assert.strictEqual(w3[0].cab_approval_count, 2);

    const [logs] = await connection.query(
      "SELECT decision, actor_id FROM stage_transition_log WHERE workspace_id=5 ORDER BY id ASC"
    );

    // Expect: CHAIR_APPROVED (chair_one), CHAIR_APPROVED (chair_two), APPROVED (chair_two)
    assert.strictEqual(logs[0].decision, 'CHAIR_APPROVED');
    assert.strictEqual(logs[0].actor_id, 'chair_one');
    assert.strictEqual(logs[1].decision, 'CHAIR_APPROVED');
    assert.strictEqual(logs[1].actor_id, 'chair_two');
    assert.strictEqual(logs[2].decision, 'APPROVED');
    assert.strictEqual(logs[2].actor_id, 'chair_two');

    // ---------------- Test 4: Approve Again (Invalid Stage) ----------------
    console.log('Test 4: Approve Again (Invalid Stage)');
    const v3 = await postRequest('/api/workspaces/5/cab/approve', {}, 'chair_one');
    assert.strictEqual(v3.statusCode, 409);
    assert.strictEqual(v3.body.error, 'INVALID_STAGE');

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
