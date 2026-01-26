const db = require('../config/database');

class CabAuthorizationService {
  
  /**
   * Checks if an actor is an authorized reviewer (CHAIR or MEMBER) for a workspace.
   * @param {number} workspaceId 
   * @param {string} actorId 
   * @returns {Promise<boolean>}
   */
  async isReviewer(workspaceId, actorId) {
    if (!workspaceId || !actorId) return false;
    
    const connection = await db.getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT role FROM cab_reviewers WHERE workspace_id = ? AND reviewer_id = ?',
        [workspaceId, actorId]
      );
      
      console.error(`[DEBUG] isReviewer check WS:${workspaceId} Actor:${actorId} Rows:${rows.length}`);
      if (rows.length === 0) return false;
      const role = rows[0].role;
      return role === 'CHAIR' || role === 'MEMBER';
      
    } finally {
      connection.release();
    }
  }

  /**
   * Checks if an actor is a CHAIR for a workspace.
   * @param {number} workspaceId 
   * @param {string} actorId 
   * @returns {Promise<boolean>}
   */
  async isChair(workspaceId, actorId) {
    if (!workspaceId || !actorId) return false;

    const connection = await db.getConnection();
    try {
      const [rows] = await connection.query(
        'SELECT role FROM cab_reviewers WHERE workspace_id = ? AND reviewer_id = ?',
        [workspaceId, actorId]
      );

      if (rows.length === 0) return false;
      return rows[0].role === 'CHAIR';

    } finally {
      connection.release();
    }
  }
}

module.exports = new CabAuthorizationService();
