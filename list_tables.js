const db = require('./src/config/database');

async function listTables() {
  const connection = await db.getConnection();
  try {
    const [rows] = await connection.query('SHOW TABLES');
    console.log('Tables:', rows);
  } catch (err) {
    console.error(err);
  } finally {
    connection.release();
    process.exit(0);
  }
}

listTables();
