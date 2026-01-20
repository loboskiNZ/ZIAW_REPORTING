const express = require('express');
const app = express();
const snapshotController = require('./controllers/SnapshotController');
const checklistController = require('./controllers/ChecklistController');
const governanceController = require('./controllers/GovernanceController');
const cabController = require('./controllers/CabController');
const cabDecisionController = require('./controllers/CabDecisionController');
const cabReadinessController = require('./controllers/CabReadinessController');

app.use(express.json());

// Routes
// POST /api/workspaces/:id/snapshots/compute
app.post('/api/workspaces/:workspaceId/snapshots/compute', snapshotController.triggerSnapshot);
app.get('/api/workspaces/:workspaceId/snapshots/latest', snapshotController.getLatestSnapshot);
app.get('/api/workspaces/:workspaceId/checklists/current', checklistController.getCurrentStageChecklist);
app.post('/api/workspaces/:workspaceId/governance/transition', governanceController.transitionStage);
app.post('/api/workspaces/:workspaceId/cab/submit', cabController.submitCab);
app.post('/api/workspaces/:workspaceId/cab/approve', cabDecisionController.approve);
app.post('/api/workspaces/:workspaceId/cab/reject', cabDecisionController.reject);
app.get('/api/workspaces/:workspaceId/cab/history', cabDecisionController.getHistory);
app.get('/api/workspaces/:workspaceId/cab-readiness', cabReadinessController.getCabReadiness);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`ZIAW Governance API running on port ${PORT}`);
});
