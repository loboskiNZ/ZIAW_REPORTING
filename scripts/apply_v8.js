const db = require('../src/config/database');

async function applyMigration() {
  const connection = await db.getConnection();
  try {
    console.log('Applying V8 manual migration...');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS cab_reviewers (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        workspace_id BIGINT NOT NULL,
        reviewer_id VARCHAR(128) NOT NULL,
        role VARCHAR(32) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_workspace_reviewer (workspace_id, reviewer_id),
        INDEX idx_workspace (workspace_id),
        CONSTRAINT fk_reviewer_workspace FOREIGN KEY (workspace_id) REFERENCES workspace(id) ON DELETE CASCADE
      )
    `);
    console.log('V8 Migration Applied Successfully');
  } catch (err) {
    console.error('Migration Failed:', err);
  } finally {
    connection.release();
    process.exit(0);
  }
}

applyMigration();
