const db = require('../src/config/database');

async function applyMigration() {
  const connection = await db.getConnection();
  try {
    console.log('Applying actor_id schema update...');
    // Alter actor_id to VARCHAR(128)
    await connection.query(`
      ALTER TABLE stage_transition_log 
      MODIFY COLUMN actor_id VARCHAR(128) NULL
    `);
    console.log('Schema Updated Successfully');
  } catch (err) {
    console.error('Migration Failed:', err);
  } finally {
    connection.release();
    process.exit(0);
  }
}

applyMigration();
