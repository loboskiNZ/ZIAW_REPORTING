const db = require('./src/config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const sql = fs.readFileSync(path.join(__dirname, 'src/database/migrations/V9__add_cab_quorum_fields.sql'), 'utf8');
  const connection = await db.getConnection();
  try {
    await connection.query(sql);
    console.log('Migration V9 applied successfully.');
  } catch (err) {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('Migration V9 already applied (Duplicate column name).');
    } else {
      console.error('Migration failed:', err);
      process.exit(1);
    }
  } finally {
    connection.release();
    process.exit(0);
  }
}

runMigration();
