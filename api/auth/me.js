const { isAuthed } = require("../_lib/auth.js");

module.exports = async function handler(req, res) {
  return res.status(200).json({ authed: isAuthed(req) });
};
