const db = require('../config/database');

class CabReadinessStatusWriter {
  /**
   * Persists the CAB readiness status for a workspace.
   * @param {number} workspaceId 
   * @param {string} status 
   */
  async write(workspaceId, status) {
    const connection = await db.getConnection();
    try {
      await connection.query(
        'UPDATE workspace SET cab_readiness_status = ? WHERE id = ?',
        [status, workspaceId]
      );
    } finally {
      connection.release();
    }
  }
}

module.exports = new CabReadinessStatusWriter();
