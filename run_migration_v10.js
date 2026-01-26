const db = require('./src/config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const sql = fs.readFileSync(path.join(__dirname, 'src/database/migrations/V10__add_chair_approved_enum.sql'), 'utf8');
  const connection = await db.getConnection();
  try {
    await connection.query(sql);
    console.log('Migration V10 applied successfully.');
  } catch (err) {
      console.error('Migration failed:', err);
      process.exit(1);
  } finally {
    connection.release();
    process.exit(0);
  }
}

runMigration();
