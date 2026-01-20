const db = require('../config/database');

exports.getCurrentStageChecklist = async (req, res) => {
  try {
    const workspaceId = parseInt(req.params.workspaceId, 10);
    if (isNaN(workspaceId)) {
      return res.status(400).json({ error: 'Invalid workspace ID' });
    }

    const connection = await db.getConnection();
    try {
      // 1. Get Workspace Stage (and verify existence)
      const [wRows] = await connection.query('SELECT id, pipeline_stage FROM workspace WHERE id = ?', [workspaceId]);
      if (wRows.length === 0) {
        return res.status(404).json({ error: 'Workspace not found' });
      }
      const workspace = wRows[0];

      // 2. Fetch Checklist with Status
      const [rows] = await connection.query(
        `SELECT
          d.pipeline_stage,
          d.rule_key,
          d.title,
          d.ownership_type,
          d.is_required,
          COALESCE(wcs.status, 'NOT_EVALUATED') AS status,
          wcs.last_evaluated_at,
          wcs.evaluation_detail_json
        FROM workspace w
        JOIN stage_checklist_definition d
          ON d.pipeline_stage = w.pipeline_stage
          AND d.is_active = 1
        LEFT JOIN workspace_checklist_status wcs
          ON wcs.workspace_id = w.id
          AND wcs.checklist_definition_id = d.id
        WHERE w.id = ?
        ORDER BY d.display_order ASC`,
        [workspaceId]
      );

      // 3. Format Response
      const items = rows.map(r => ({
        rule_key: r.rule_key,
        title: r.title,
        ownership_type: r.ownership_type,
        is_required: r.is_required,
        status: r.status,
        last_evaluated_at: r.last_evaluated_at,
        evaluation_detail_json: (typeof r.evaluation_detail_json === 'string' && r.evaluation_detail_json) 
            ? JSON.parse(r.evaluation_detail_json) 
            : r.evaluation_detail_json
      }));

      res.json({
        workspace_id: workspace.id,
        pipeline_stage: workspace.pipeline_stage,
        items
      });

    } finally {
      connection.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};
