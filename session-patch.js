const expressSession = require('express-session');
const originalSession = expressSession;

function patchedSession(options) {
  const middleware = originalSession(options);

  return function sessionMiddleware(req, res, next) {
    middleware(req, res, () => {
      if (req.method === 'POST' && req.originalUrl.split('?')[0] === '/api/auth/login') {
        const originalEnd = res.end.bind(res);
        let finished = false;

        res.end = function patchedEnd(...args) {
          if (finished || !req.session?.user || res.statusCode >= 400) return originalEnd(...args);
          finished = true;
          req.session.save(error => {
            if (error) {
              console.error('Login session save failed:', error);
              res.statusCode = 500;
            }
            return originalEnd(...args);
          });
        };
      }
      next();
    });
  };
}

require.cache[require.resolve('express-session')].exports = patchedSession;
