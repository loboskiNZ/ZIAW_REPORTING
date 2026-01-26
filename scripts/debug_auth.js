const db = require('../src/config/database');
const authService = require('../src/services/CabAuthorizationService');

async function debugAuth() {
  const connection = await db.getConnection();
  try {
    const wsId = 9993; // Different ID
    
    // Setup
    await connection.query('DELETE FROM workspace WHERE id = ?', [wsId]);
    await connection.query('DELETE FROM cab_reviewers WHERE workspace_id = ?', [wsId]);

    // Create WS
    await connection.query(`INSERT INTO workspace (id, name) VALUES (?, 'DebugWS')`, [wsId]);
    
    // Create Member
    await connection.query(`INSERT INTO cab_reviewers (workspace_id, reviewer_id, role) VALUES (?, 'user_member', 'MEMBER')`, [wsId]);
    console.log('Inserted user_member as MEMBER');

    // Test isChair
    console.log('Testing isChair for user_member...');
    const result = await authService.isChair(wsId, 'user_member');
    console.log('isChair result:', result);

    if (result === true) {
        console.error('CRITICAL FAILURE: MEMBER identified as CHAIR');
    } else {
        console.log('SUCCESS: MEMBER is NOT CHAIR');
    }

  } catch (err) {
    console.error(err);
  } finally {
    connection.release();
    process.exit(0);
  }
}

debugAuth();
