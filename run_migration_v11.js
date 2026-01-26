const db = require('./src/config/database');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const sql = fs.readFileSync(path.join(__dirname, 'src/database/migrations/V11__create_cab_evidence.sql'), 'utf8');
  const connection = await db.getConnection();
  try {
    await connection.query(sql);
    console.log('Migration V11 applied successfully.');
  } catch (err) {
      if (err.code === 'ER_TABLE_EXISTS_ERROR') {
          console.log('Migration V11 already applied.');
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
