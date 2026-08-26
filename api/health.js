const { getSupabaseStatus } = require("./_lib/supabase.js");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  return res.status(200).json({
    ok: true,
    supabase: getSupabaseStatus(),
    admin: {
      hasUser: !!process.env.ADMIN_PANEL_USER,
      hasPassword: !!process.env.ADMIN_PANEL_PASSWORD,
      hasSecret: !!process.env.ADMIN_PANEL_SECRET
    },
    runtime: {
      node: process.version,
      vercel: !!process.env.VERCEL,
      railway: !!process.env.RAILWAY_ENVIRONMENT
    }
  });
};
