const db = require('./src/config/database');

async function check() {
  const connection = await db.getConnection();
  try {
    const [rows] = await connection.query('DESCRIBE workspace');
    console.log(rows);
  } catch (err) {
    console.error(err);
  } finally {
    connection.release();
    process.exit(0);
  }
}

check();
