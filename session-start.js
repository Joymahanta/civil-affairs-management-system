const expressSession = require('express-session');
const originalSession = expressSession;

function sessionWithLoginSave(options) {
  const middleware = originalSession(options);

  return function wrappedSession(req, res, next) {
    middleware(req, res, () => {
      if (req.method === 'POST' && req.path === '/api/auth/login') {
        const originalJson = res.json.bind(res);

        res.json = body => {
          if (!req.session?.user) return originalJson(body);

          return req.session.save(error => {
            if (error) {
              res.status(500);
              return originalJson({ error: 'Could not save your secure session.' });
            }
            return originalJson(body);
          });
        };
      }

      next();
    });
  };
}

require.cache[require.resolve('express-session')].exports = sessionWithLoginSave;
require('./server.js');
