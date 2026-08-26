const { getSupabaseStatus, checkSupabaseConnection } = require("./_lib/supabase.js");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  const supabase = getSupabaseStatus();
  const connection = await checkSupabaseConnection();

  return res.status(200).json({
    ok: true,
    supabase: {
      ...supabase,
      connection
    },
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
