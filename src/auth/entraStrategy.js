const OIDCStrategy = require('passport-azure-ad').OIDCStrategy;
// Config injected via env vars

// Using inline env vars for simplicity as per instructions, or a config file. 
// Instructions said: "Use passport-azure-ad OIDCStrategy with: identityMetadata using ENTRA_TENANT=common..."

module.exports = function(passport) {
  const tenant = process.env.ENTRA_TENANT || 'common';
  
  passport.serializeUser(function(user, done) {
    done(null, user);
  });

  passport.deserializeUser(function(user, done) {
    done(null, user);
  });

  // Check if we have necessary config for Entra
  if (!process.env.ENTRA_CLIENT_ID) {
    if (process.env.AUTH_MODE === 'entra') {
      console.error('FATAL: AUTH_MODE is entra but ENTRA_CLIENT_ID is missing.');
      process.exit(1);
    } else {
      console.log('Skipping Entra OIDC Strategy setup (ENTRA_CLIENT_ID missing, and not in entra mode).');
      return;
    }
  }

  const strategyConfig = {
    identityMetadata: `https://login.microsoftonline.com/${tenant}/v2.0/.well-known/openid-configuration`,
    clientID: process.env.ENTRA_CLIENT_ID,
    responseType: 'code',
    responseMode: 'query',
    redirectUrl: process.env.ENTRA_REDIRECT_URI,
    allowHttpForRedirectUrl: true, // DEV ONLY
    clientSecret: process.env.ENTRA_CLIENT_SECRET,
    validateIssuer: false, // For multi-tenant
    passReqToCallback: false,
    scope: ['profile', 'email', 'openid']
  };

  try {
      passport.use(new OIDCStrategy(strategyConfig,
        function(iss, sub, profile, accessToken, refreshToken, done) {
          if (!profile.oid) {
            return done(new Error("No OID found"), null);
          }
          
          const tid = profile._json.tid;
          const oid = profile._json.oid;
          const preferred_username = profile._json.preferred_username || profile.upn;
          
          const actor_user_id = `${tid}:${oid}`;
          
          const user = {
            id: actor_user_id,
            tenant_id: tid,
            oid: oid,
            email: preferred_username
          };
          
          return done(null, user);
        }
      ));
  } catch (err) {
      console.error('Failed to initialize Entra OIDC Strategy:', err.message);
      // In DEV we might continue, in PROD/Entra mode this is fatal
      if (process.env.AUTH_MODE === 'entra') throw err;
  }
};
