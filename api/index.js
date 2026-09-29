// Vercel serverless entrypoint for the Express app.
// The database initializes lazily: the first request waits for `app.ready`,
// and every later invocation reuses the already-initialized state.
const app = require('../server');

module.exports = async (req, res) => {
  await app.ready;
  return app(req, res);
};
