const assert = require('assert');
const db = require('../src/config/database');
const request = require('http');

async function runTests() {
  console.log('Running CAB Governance Invariant Tests...');
  const connection = await db.getConnection();

  try {
    // Setup Workspace 7
    await connection.query('DELETE FROM workspace WHERE id = 7');
    await connection.query(`INSERT INTO workspace (id, name, pipeline_stage, cab_readiness_status) VALUES (7, 'GovWS', 'VERIFY_CAB', 'PENDING_REVIEW')`);

    // TEST 1: Rule A - Stage Exit without Status Reset
    // Attempting to move to RELEASE while keeping PENDING_REVIEW
    console.log('Test 1: Rule A - Stage Exit Invariant');
    try {
      await connection.query("UPDATE workspace SET pipeline_stage = 'RELEASE' WHERE id = 7");
      assert.fail('Should have been blocked by trg_workspace_cab_consistency');
    } catch (err) {
      assert.ok(err.message.includes('CAB_STATUS_INVALID_FOR_STAGE'), 'Expected CAB_STATUS_INVALID_FOR_STAGE, got: ' + err.message);
      console.log('✓ Blocked invalid stage update');
    }

    // TEST 2: Rule B - Invalid Audit Insert (APPROVED when not PENDING_REVIEW)
    console.log('Test 2: Rule B - Audit Invariant');
    // Set status to NOT_READY
    await connection.query("UPDATE workspace SET cab_readiness_status = 'NOT_READY' WHERE id = 7");
    
    // Attempt to insert APPROVED log
    try {
      await connection.query(
        `INSERT INTO stage_transition_log 
         (workspace_id, from_stage, to_stage, actor_type, decision, rationale, created_at)
         VALUES (7, 'VERIFY_CAB', 'VERIFY_CAB', 'SYSTEM', 'APPROVED', 'Fail', NOW())`
      );
      assert.fail('Should have been blocked by trg_audit_cab_validity');
    } catch (err) {
      assert.ok(err.message.includes('CAB_AUDIT_ACTION_INVALID'), 'Expected CAB_AUDIT_ACTION_INVALID, got: ' + err.message);
      console.log('✓ Blocked invalid audit insert');
    }

    // TEST 3: Verify Valid Path (Code updates)
    // We can't easily call internal controller logic directly without mocking req/res, 
    // but we can simulate the DB operations that CabDecisionController performs to prove they PASS.
    
    console.log('Test 3: Verify Valid Transitions pass triggers');
    
    // Reset to PENDING_REVIEW
    await connection.query("UPDATE workspace SET cab_readiness_status = 'PENDING_REVIEW' WHERE id = 7");
    
    // A) Insert APPROVED Log (Should pass as PENDING_REVIEW)
    await connection.query(
        `INSERT INTO stage_transition_log 
         (workspace_id, from_stage, to_stage, actor_type, decision, rationale, created_at)
         VALUES (7, 'VERIFY_CAB', 'RELEASE', 'SYSTEM', 'APPROVED', 'Pass', NOW())`
    );
    console.log('✓ Inserted APPROVED log');

    // B) Update Stage + Reset Status (Should pass Rule A)
    await connection.query("UPDATE workspace SET pipeline_stage = 'RELEASE', cab_readiness_status = 'NOT_READY' WHERE id = 7");
    console.log('✓ Updated Stage+Status');

    console.log('✓ All Governance Invariant Tests Passed');

  } catch (err) {
    console.error('Test Failed:', err);
    process.exit(1);
  } finally {
    connection.release();
    process.exit(0);
  }
}

runTests();
