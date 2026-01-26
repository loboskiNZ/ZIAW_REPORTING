const express = require('express');
const router = express.Router();
// Define UI-specific Auth Middleware that redirects instead of 401 JSON
const requireUiAuth = (req, res, next) => {
  if (!req.user) {
    return res.redirect('/auth/entra/login');
  }
  next();
};

const uiController = require('../controllers/UiCabController');

// All UI routes require authentication (Redirect to login if missing)
router.use(requireUiAuth);

router.get('/', uiController.redirectIndex);
router.get('/workspaces', uiController.listWorkspaces);
router.get('/workspaces/:workspaceId', uiController.getWorkspace);

router.post('/workspaces/:workspaceId/submit', uiController.submitWorkspace);
router.post('/workspaces/:workspaceId/approve', uiController.approveWorkspace);
router.post('/workspaces/:workspaceId/reject', uiController.rejectWorkspace);

router.get('/workspaces/:workspaceId/reviewers', uiController.getReviewers);
router.post('/workspaces/:workspaceId/reviewers/add', uiController.addReviewer);
router.post('/workspaces/:workspaceId/reviewers/remove', uiController.removeReviewer);

router.get('/workspaces/:workspaceId/evidence', uiController.getEvidence);
router.post('/workspaces/:workspaceId/evidence/add', uiController.addEvidence);

module.exports = router;
