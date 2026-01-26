const express = require('express');
const passport = require('passport');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');

router.get('/entra/login',
  passport.authenticate('azuread-openidconnect', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/');
  }
);

router.get('/entra/callback',
  passport.authenticate('azuread-openidconnect', { failureRedirect: '/auth/failed' }),
  (req, res) => {
    res.redirect('/'); // Or return success JSON
  }
);

router.get('/failed', (req, res) => {
  res.status(401).json({ error: 'Authentication failed' });
});

// Dev Helper Login - Only registered if NOT in Entra mode
if (process.env.AUTH_MODE !== 'entra') {
  router.get('/dev-login', (req, res, next) => {
    const user = { 
      id: req.query.actor_id || 'dev_admin', 
      email: null, 
      tenant_id: null, 
      oid: null,
      isDevShim: true 
    };
    req.login(user, (err) => {
      if (err) return next(err);
      res.redirect('/ui/workspaces');
    });
  });
}

router.get('/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    tenant_id: req.user.tenant_id
  });
});

module.exports = router;
