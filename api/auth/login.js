const { createSessionCookie, timingSafeEqStr } = require("../_lib/auth.js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method not allowed" });
  }

  if (!process.env.ADMIN_PANEL_SECRET) {
    return res.status(500).json({ error: "ADMIN_PANEL_SECRET no esta configurado en el servidor." });
  }
  const okUser = process.env.ADMIN_PANEL_USER || "";
  const okPass = process.env.ADMIN_PANEL_PASSWORD || "";
  if (!okUser || !okPass) {
    return res.status(500).json({ error: "ADMIN_PANEL_USER / ADMIN_PANEL_PASSWORD no estan configurados." });
  }

  const { username, password } = req.body || {};
  const validUser = username && timingSafeEqStr(username, okUser);
  const validPass = password && timingSafeEqStr(password, okPass);
  if (!validUser || !validPass) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
  }

  res.setHeader("Set-Cookie", createSessionCookie());
  return res.status(200).json({ ok: true });
};
