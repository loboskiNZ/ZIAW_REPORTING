const express = require('express');
const app = express();
const snapshotController = require('./controllers/SnapshotController');
const checklistController = require('./controllers/ChecklistController');
const governanceController = require('./controllers/GovernanceController');
const cabController = require('./controllers/CabController');
const cabDecisionController = require('./controllers/CabDecisionController');
const cabReadinessController = require('./controllers/CabReadinessController');
const cabReviewerAdminController = require('./controllers/CabReviewerAdminController');

app.use(express.json());

const { initAuth } = require('./middleware/auth');
initAuth(app);

app.set('view engine', 'ejs');
app.set('views', require('path').join(__dirname, 'views'));
app.use(express.urlencoded({ extended: false }));

// Make user available to views
app.use((req, res, next) => {
  res.locals.user = req.user;
  next();
});

app.use('/auth', require('./routes/authRoutes'));
app.use('/ui', require('./routes/uiRoutes'));


// Routes
// POST /api/workspaces/:id/snapshots/compute
app.post('/api/workspaces/:workspaceId/snapshots/compute', snapshotController.triggerSnapshot);
app.get('/api/workspaces/:workspaceId/snapshots/latest', snapshotController.getLatestSnapshot);
app.get('/api/workspaces/:workspaceId/checklists/current', checklistController.getCurrentStageChecklist);
app.post('/api/workspaces/:workspaceId/governance/transition', governanceController.transitionStage);
app.post('/api/workspaces/:workspaceId/cab/submit', cabController.submitCab);
app.post('/api/workspaces/:workspaceId/cab/approve', cabDecisionController.approve);
app.post('/api/workspaces/:workspaceId/cab/reject', cabDecisionController.reject);
app.post('/api/workspaces/:workspaceId/cab/reject', cabDecisionController.reject);
app.get('/api/workspaces/:workspaceId/cab/history', cabDecisionController.getHistory);
app.get('/api/workspaces/:workspaceId/cab/reviewers', cabReviewerAdminController.listReviewers);
app.post('/api/workspaces/:workspaceId/cab/reviewers', cabReviewerAdminController.addReviewer);
app.delete('/api/workspaces/:workspaceId/cab/reviewers/:reviewerId', cabReviewerAdminController.removeReviewer);
app.get('/api/workspaces/:workspaceId/cab-readiness', cabReadinessController.getCabReadiness);
app.get('/api/workspaces/:workspaceId/governance/report', require('./controllers/GovernanceReportController').getGovernanceReport);

const cabEvidenceController = require('./controllers/CabEvidenceController');
app.post('/api/workspaces/:workspaceId/cab/evidence', cabEvidenceController.attachEvidence);
app.get('/api/workspaces/:workspaceId/cab/evidence', cabEvidenceController.listEvidence);

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`ZIAW Governance API running on port ${PORT}`);
});
