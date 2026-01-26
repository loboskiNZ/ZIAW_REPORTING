const db = require('../config/database');
const cabAuthorizationService = require('../services/CabAuthorizationService');

// Helper for Auth (Used by listReviewers)
async function checkChairAuth(req, res, workspaceId, source) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Authentication required' });
      return false;
    }
    const actorId = req.user.id;
    
    const isChair = await cabAuthorizationService.isChair(workspaceId, actorId);
    
    if (!isChair) {
      res.status(403).json({ error: 'CAB_NOT_CHAIR', message: 'Only CAB Chair can manage reviewers' });
      return false;
    }
    return true;
  } catch (err) {
    console.error('Auth Check Failed:', err);
    res.status(500).json({ error: 'AUTH_ERROR', message: err.message });
    return false;
  }
}

exports.listReviewers = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  if (isNaN(workspaceId)) return res.status(400).json({ error: 'Invalid workspace ID' });

  if (!(await checkChairAuth(req, res, workspaceId, 'listReviewers'))) return;

  const connection = await db.getConnection();
  try {
    const [rows] = await connection.query(
      `SELECT reviewer_id, role, created_at 
       FROM cab_reviewers 
       WHERE workspace_id = ? 
       ORDER BY created_at ASC, id ASC`,
      [workspaceId]
    );
    res.json({ workspace_id: workspaceId, reviewers: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
};

exports.addReviewerLogic = async (workspaceId, actorId, reviewerId, role) => {
    // Auth Check
    const isChair = await cabAuthorizationService.isChair(workspaceId, actorId);
    if (!isChair) {
        const err = new Error('Only CAB Chair can manage reviewers');
        err.code = 'CAB_NOT_CHAIR';
        err.status = 403;
        throw err;
    }
    
    // Validation
    if (!reviewerId || typeof reviewerId !== 'string' || reviewerId.length > 128) {
        const err = new Error('Invalid reviewer_id');
        err.code = 'VALIDATION_ERROR';
        err.status = 400;
        throw err;
    }
    if (role !== 'CHAIR' && role !== 'MEMBER') {
        const err = new Error('Role must be CHAIR or MEMBER');
        err.code = 'VALIDATION_ERROR';
        err.status = 400;
        throw err;
    }

    const connection = await db.getConnection();
    try {
        await connection.query(
        `INSERT IGNORE INTO cab_reviewers (workspace_id, reviewer_id, role) VALUES (?, ?, ?)`,
        [workspaceId, reviewerId, role]
        );
        return { workspace_id: workspaceId, reviewer_id: reviewerId, role };
    } finally {
        connection.release();
    }
};

exports.removeReviewerLogic = async (workspaceId, actorId, reviewerId) => {
    const isChair = await cabAuthorizationService.isChair(workspaceId, actorId);
    if (!isChair) {
        const err = new Error('Only CAB Chair can manage reviewers');
        err.code = 'CAB_NOT_CHAIR';
        err.status = 403;
        throw err;
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [rows] = await connection.query(
        'SELECT role FROM cab_reviewers WHERE workspace_id = ? AND reviewer_id = ? FOR UPDATE',
        [workspaceId, reviewerId]
        );

        if (rows.length === 0) {
            await connection.rollback();
            return { workspace_id: workspaceId, reviewer_id: reviewerId };
        }

        const roleToRemove = rows[0].role;
        if (roleToRemove === 'CHAIR') {
            const [countRows] = await connection.query(
                'SELECT COUNT(*) as count FROM cab_reviewers WHERE workspace_id = ? AND role = "CHAIR"',
                [workspaceId]
            );
            if (countRows[0].count <= 1) {
                await connection.rollback();
                const err = new Error('Cannot remove last CAB chair');
                err.code = 'CAB_LAST_CHAIR';
                err.status = 409;
                throw err;
            }
        }

        await connection.query(
            'DELETE FROM cab_reviewers WHERE workspace_id = ? AND reviewer_id = ?',
            [workspaceId, reviewerId]
        );

        await connection.commit();
        return { workspace_id: workspaceId, reviewer_id: reviewerId };

    } catch (err) {
        if (connection) await connection.rollback();
        throw err;
    } finally {
        if (connection) connection.release();
    }
};

exports.addReviewer = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  if (isNaN(workspaceId)) return res.status(400).json({ error: 'Invalid workspace ID' });
  // Auth checks handled in Service (Restored Logic)

  if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
  const actorId = req.user.id;

  const { reviewer_id, role } = req.body;
  
  try {
    const result = await exports.addReviewerLogic(workspaceId, actorId, reviewer_id, role);
    return res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.code || 'ERROR', message: err.message });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.removeReviewer = async (req, res) => {
  const workspaceId = parseInt(req.params.workspaceId, 10);
  if (isNaN(workspaceId)) return res.status(400).json({ error: 'Invalid workspace ID' });
  const reviewerId = req.params.reviewerId;

  if (!req.user) return res.status(401).json({ error: 'UNAUTHENTICATED' });
  const actorId = req.user.id;

  try {
    const result = await exports.removeReviewerLogic(workspaceId, actorId, reviewerId);
    return res.json(result);
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.code || 'ERROR', message: err.message });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
