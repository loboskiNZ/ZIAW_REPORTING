// tests/CabReadinessService.test.js
const assert = require('assert');
const cabReadinessService = require('../src/services/CabReadinessService');
const db = require('../src/config/database');

// Mock Data Setup
let mockWorkspace = [];
let mockChecklists = [];
let mockSnapshots = [];

// Mock DB Implementation
const mockConnection = {
  query: async (sql, params) => {
    if (sql.includes('FROM workspace WHERE')) {
      return [mockWorkspace];
    }
    if (sql.includes('FROM stage_checklist_definition')) {
      return [mockChecklists];
    }
    if (sql.includes('FROM workspace_snapshot')) {
      return [mockSnapshots];
    }
    return [[]];
  },
  release: () => {}
};

// Hijack db.getConnection
db.getConnection = async () => mockConnection;

async function runTests() {
  console.log('Running CabReadinessService Tests...');

  // Test 1: Wrong Stage
  mockWorkspace = [{ pipeline_stage: 'BUILD' }];
  mockChecklists = [{ rule_key: 'test', status: 'PASS' }];
  mockSnapshots = [{ is_valid: 1 }];
  let result = await cabReadinessService.evaluateCabReadiness(1);
  assert.strictEqual(result, 'NOT_READY', 'TEST 1 FAILED: Should be NOT_READY for BUILD stage');
  console.log('✓ Test 1: Wrong Stage -> NOT_READY');

  // Test 2: Missing Snapshot
  mockWorkspace = [{ pipeline_stage: 'VERIFY_CAB' }];
  mockChecklists = [{ rule_key: 'test', status: 'PASS' }];
  mockSnapshots = [];
  result = await cabReadinessService.evaluateCabReadiness(1);
  assert.strictEqual(result, 'NOT_READY', 'TEST 2 FAILED: Should be NOT_READY for missing snapshot');
  console.log('✓ Test 2: Missing Snapshot -> NOT_READY');

  // Test 3: Invalid Snapshot
  mockWorkspace = [{ pipeline_stage: 'VERIFY_CAB' }];
  mockChecklists = [{ rule_key: 'test', status: 'PASS' }];
  mockSnapshots = [{ is_valid: 0 }];
  result = await cabReadinessService.evaluateCabReadiness(1);
  assert.strictEqual(result, 'NOT_READY', 'TEST 3 FAILED: Should be NOT_READY for invalid snapshot');
  console.log('✓ Test 3: Invalid Snapshot -> NOT_READY');

  // Test 4: Checklist Incomplete
  mockWorkspace = [{ pipeline_stage: 'VERIFY_CAB' }];
  mockChecklists = [{ rule_key: 'rule1', status: 'PASS' }, { rule_key: 'rule2', status: 'FAIL' }];
  mockSnapshots = [{ is_valid: 1 }];
  result = await cabReadinessService.evaluateCabReadiness(1);
  assert.strictEqual(result, 'NOT_READY', 'TEST 4 FAILED: Should be NOT_READY for failed checklist');
  console.log('✓ Test 4: Checklist Incomplete -> NOT_READY');

  // Test 5: All Pass
  mockWorkspace = [{ pipeline_stage: 'VERIFY_CAB' }];
  mockChecklists = [{ rule_key: 'rule1', status: 'PASS' }];
  mockSnapshots = [{ is_valid: 1 }];
  result = await cabReadinessService.evaluateCabReadiness(1);
  assert.strictEqual(result, 'PENDING_REVIEW', 'TEST 5 FAILED: Should be PENDING_REVIEW when all valid');
  console.log('✓ Test 5: All Pass -> PENDING_REVIEW');

  console.log('All CabReadinessService tests passed!');
}

runTests().catch(err => console.error(err));
