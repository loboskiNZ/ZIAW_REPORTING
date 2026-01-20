const assert = require('assert');
const db = require('../src/config/database');
const snapshotEngine = require('../src/services/SnapshotEngine');
const cabReadinessOrchestrator = require('../src/services/CabReadinessOrchestrator');
const checklistEvaluator = require('../src/services/ChecklistEvaluator');

async function runTests() {
  console.log('Running Snapshot Validity & CAB Readiness Tests...');
  const connection = await db.getConnection();

  try {
    // Setup: Workspace 2 (Clean slate)
    await connection.query('DELETE FROM workspace WHERE id = 2');
    await connection.query(`INSERT INTO workspace (id, name, pipeline_stage, cab_readiness_status) VALUES (2, 'Validity WS', 'VERIFY_CAB', 'NOT_READY')`);
    
    // Ensure VERIFY_CAB required rules exist (V2 migration handled this, cab_risks_reviewed etc)
    // We will verify against "cab_runbook_present" (AUTO) and "cab_risks_reviewed" (MANUAL).

    // --- TEST 1: First Snapshot Creation ---
    console.log('Test 1: First Snapshot Creation');
    const res1 = await snapshotEngine.computeAndPersistSnapshot(2);
    
    const [s1] = await connection.query('SELECT id, is_valid FROM workspace_snapshot WHERE id = ?', [res1.snapshot_id]);
    assert.strictEqual(s1[0].is_valid, 1, 'First snapshot should be valid');

    // --- TEST 2: Second Snapshot Creation (Supersedes) ---
    console.log('Test 2: Second Snapshot Creation');
    const res2 = await snapshotEngine.computeAndPersistSnapshot(2);
    
    const [s1_check] = await connection.query('SELECT is_valid FROM workspace_snapshot WHERE id = ?', [res1.snapshot_id]);
    const [s2_check] = await connection.query('SELECT is_valid FROM workspace_snapshot WHERE id = ?', [res2.snapshot_id]);
    
    assert.strictEqual(s1_check[0].is_valid, 0, 'Old snapshot should be invalid');
    assert.strictEqual(s2_check[0].is_valid, 1, 'New snapshot should be valid');

    const [allValid] = await connection.query('SELECT COUNT(*) as c FROM workspace_snapshot WHERE workspace_id = 2 AND is_valid = 1');
    assert.strictEqual(allValid[0].c, 1, 'Only one valid snapshot allowed per workspace');


    // --- TEST 3: CAB Readiness (Pending Review) ---
    console.log('Test 3: Reach PENDING_REVIEW');
    // Preconditions:
    // Stage: VERIFY_CAB (Done)
    // Valid Snapshot: Yes (Done)
    // Checklists: Need PASS.
    
    // Satisfy Checklists for VERIFY_CAB
    // 1. cab_runbook_present (AUTO HAS_ARTIFACT RUNBOOK)
    await connection.query(`INSERT INTO artifact (workspace_id, type, content) VALUES (2, 'RUNBOOK', '{"title":"Ops Manual"}')`);
    
    // 2. cab_risks_reviewed (MANUAL)
    // We need to manually insert the PASS status since we don't have a UI endpoint to click "Confirm" yet
    // But we should try to simulate "status change" triggering logic if we can, or just insert it.
    // Let's insert it simulating a manual update.
    const [rule] = await connection.query("SELECT id FROM stage_checklist_definition WHERE rule_key = 'cab_risks_reviewed'");
    await connection.query(`
      INSERT INTO workspace_checklist_status (workspace_id, checklist_definition_id, status, last_evaluated_at)
      VALUES (2, ?, 'PASS', NOW()) ON DUPLICATE KEY UPDATE status='PASS'`, [rule[0].id]);

    // Force re-eval of AUTO items (this will also trigger orchestrator)
    await checklistEvaluator.evaluate(2, 'VERIFY_CAB');
    
    // Wait for orchestrator (it awaited in evaluate, so logic is synchronous in Node)
    
    const [wsRow] = await connection.query('SELECT cab_readiness_status FROM workspace WHERE id = 2');
    console.log('Final CAB Status:', wsRow[0].cab_readiness_status);
    assert.strictEqual(wsRow[0].cab_readiness_status, 'PENDING_REVIEW', 'Should be PENDING_REVIEW when all conditions met');

    console.log('✓ All Validity Checks Passed');

  } catch (err) {
    console.error('Test Failed:', err);
    process.exit(1);
  } finally {
    connection.release();
    process.exit(0);
  }
}

runTests();
