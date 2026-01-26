require('dotenv').config();
const db = require('../../src/config/database');

(async () => {
  const c = await db.getConnection();
  const [t1] = await c.query("DESCRIBE workspace_checklist_status");
  const [t2] = await c.query("DESCRIBE workspace_snapshot");
  console.log("workspace_checklist_status:", t1.map(r => r.Field));
  console.log("workspace_snapshot:", t2.map(r => r.Field));
  c.release();
  process.exit(0);
})();
