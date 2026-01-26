const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const db = require('../src/config/database');

const WORKSPACE_ID = 1;
const ACTORS = [
  { id: 'quorum_chair_1', role: 'CHAIR' },
  { id: 'quorum_chair_2', role: 'CHAIR' },
  { id: 'quorum_member', role: 'MEMBER' },
  { id: 'admin', role: 'CHAIR' } // Ensure admin is chair too
];

async function seed() {
  const connection = await db.getConnection();
  try {
    // 2. DB Identity Probe
    const [identity] = await connection.query(`
      SELECT 
        DATABASE() as db, 
        @@hostname as mysql_host, 
        @@port as mysql_port, 
        CURRENT_USER() as curr_user, 
        USER() as db_user, 
        @@autocommit as autocommit
    `);
    console.log('DB Identity:', JSON.stringify(identity[0], null, 2));

    // 3. Print Env Config
    console.log('Env Config:', {
      DB_HOST: process.env.DB_HOST,
      DB_PORT: process.env.DB_PORT,
      MYSQL_DATABASE: process.env.MYSQL_DATABASE,
      MYSQL_USER: process.env.MYSQL_USER
    });

    // 3.5 Ensure Workspace Exists & Reset State
    // Force update to correct stage/status in case it was left in RELEASE
    await connection.query(`
      INSERT INTO workspace (id, name, pipeline_stage, cab_readiness_status, cab_review_state) 
      VALUES (1, 'Test Workspace', 'VERIFY_CAB', 'PENDING_REVIEW', 'IN_REVIEW')
      ON DUPLICATE KEY UPDATE 
        pipeline_stage = 'VERIFY_CAB',
        cab_readiness_status = 'PENDING_REVIEW',
        cab_review_state = 'IN_REVIEW',
        cab_approval_count = 0
    `);
    console.log('Reset Workspace 1 state.');

    // 3.8 Clear Audit Log for Fresh Test
    // Must clear evidence first due to FK
    await connection.query('DELETE FROM cab_review_evidence WHERE workspace_id = ?', [WORKSPACE_ID]);
    await connection.query('DELETE FROM stage_transition_log WHERE workspace_id = ?', [WORKSPACE_ID]);
    await connection.query('UPDATE workspace SET cab_approval_count = 0 WHERE id = ?', [WORKSPACE_ID]);
    console.log('Cleared audit logs and reset approval count.');

    // Insert Loop
    for (const actor of ACTORS) {
      await connection.query(
        `INSERT IGNORE INTO cab_reviewers (workspace_id, reviewer_id, role) VALUES (?, ?, ?)`,
        [WORKSPACE_ID, actor.id, actor.role]
      );
      console.log(`Seeded ${actor.id} as ${actor.role}`);
    }

    // 4. Verify Inserts
    const [countRows] = await connection.query(`
      SELECT COUNT(*) as cnt 
      FROM cab_reviewers 
      WHERE workspace_id = ? 
      AND reviewer_id IN ('quorum_chair_1','quorum_chair_2','quorum_member','admin')
    `, [WORKSPACE_ID]);
    
    console.log('Verification Count:', countRows[0].cnt);

  } catch (err) {
    console.error(err);
  } finally {
    connection.release();
    // 5. Clean exit
    await db.end();
  }
}

seed();
