const passport = require('passport');
const session = require('express-session');
const cookieParser = require('cookie-parser');
require('../auth/entraStrategy')(passport);

exports.initAuth = function(app) {
  app.use(cookieParser());
  app.use(session({
    secret: 'super_secret_session_key_dev', // In real app, use env var
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // false for http dev
  }));
  app.use(passport.initialize());
  app.use(passport.session());

  // DEV SHIM: If AUTH_MODE != 'entra', polyfill req.user from X-Actor-ID
  app.use((req, res, next) => {
    const authMode = process.env.AUTH_MODE || 'dev';
    if (authMode !== 'entra') {
      const actorId = req.headers['x-actor-id'];
      if (actorId && !req.user) {
        // Mock a user object based on the header
        req.user = {
          id: actorId,
          email: null,
          tenant_id: null,
          oid: null,
          isDevShim: true
        };
      }
    }
    next();
  });
};

exports.requireAuth = function(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'UNAUTHENTICATED' });
  }
  next();
};
