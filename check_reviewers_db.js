const db = require('./src/config/database');

async function check() {
  const connection = await db.getConnection();
  try {
    const [rows] = await connection.query('SELECT * FROM cab_reviewers WHERE workspace_id = 1');
    console.log('Reviewers in DB:', rows);
  } catch (err) {
    console.error(err);
  } finally {
    connection.release();
    process.exit(0);
  }
}

check();
