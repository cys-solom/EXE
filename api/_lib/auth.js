// ============================================================
//  Sesion del panel admin — cookie firmada con HMAC (sin libs externas).
// ============================================================
const crypto = require("crypto");

const SESSION_HOURS = 24 * 7; // 7 dias
const COOKIE_NAME = "admin_session";

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64");
}

function getSecret() {
  return process.env.ADMIN_PANEL_SECRET || "";
}

function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", getSecret()).update(body).digest());
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const secret = getSecret();
  if (!secret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString("utf8"));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function createSessionCookie() {
  const token = sign({ admin: true, exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
  const secure = process.env.VERCEL ? " Secure;" : "";
  return `${COOKIE_NAME}=${token}; HttpOnly;${secure} SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookies(req) {
  const header = (req.headers && req.headers.cookie) || "";
  const out = {};
  header.split(";").forEach(pair => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function isAuthed(req) {
  const cookies = parseCookies(req);
  const payload = verify(cookies[COOKIE_NAME]);
  return !!(payload && payload.admin);
}

// Envuelve un handler para exigir sesion valida antes de ejecutarlo.
function requireAuth(handler) {
  return async (req, res) => {
    try {
      if (!isAuthed(req)) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      return await handler(req, res);
    } catch (err) {
      console.error("[ADMIN API]", err);
      if (!res.writableEnded) {
        const detail = err.message || String(err);
        const hint = detail.includes("database connection string")
          ? "ضع SUPABASE_URL كرابط Project API وليس DATABASE_URL. الشكل الصحيح: https://PROJECT.supabase.co"
          : detail.includes("Supabase connection failed")
            ? "السيرفر لا يستطيع الوصول إلى Supabase. افتح /api/health وتأكد من supabase.connection، وراجع أن مشروع Supabase غير متوقف وأن SUPABASE_URL صحيح."
            : null;
        res.status(500).json({
          error: "تعذر الاتصال بخدمات لوحة التحكم. راجع إعدادات Supabase أو الشبكة.",
          detail,
          hint
        });
      }
    }
  };
}

function timingSafeEqStr(a, b) {
  const ab = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = {
  createSessionCookie,
  clearSessionCookie,
  parseCookies,
  isAuthed,
  requireAuth,
  timingSafeEqStr
};
