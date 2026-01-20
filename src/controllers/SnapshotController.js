const snapshotEngine = require('../services/SnapshotEngine');
const db = require('../config/database');

exports.triggerSnapshot = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const result = await snapshotEngine.computeAndPersistSnapshot(workspaceId);
    res.status(201).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.getLatestSnapshot = async (req, res) => {
  try {
    const { workspaceId } = req.params;
    const [rows] = await db.query(
      `SELECT * FROM workspace_snapshot 
       WHERE workspace_id = ? 
       ORDER BY snapshot_at DESC LIMIT 1`,
      [workspaceId]
    );
    
    if (rows.length === 0) return res.status(404).json({ message: 'No snapshots found' });
    
    // Parse metrics_json for convenience
    const snapshot = rows[0];
    if (snapshot.metrics_json) snapshot.metrics_json = JSON.parse(snapshot.metrics_json);
    
    res.json(snapshot);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
