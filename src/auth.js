function requireAuth(req, res, next) {
  if (!req.session.userId) {
    req.session.flash = { type: 'warning', message: 'Please log in to continue.' };
    return res.redirect('/auth');
  }

  return next();
}

module.exports = {
  requireAuth
};
