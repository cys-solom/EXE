const { getSupabase, getSupabaseStatus, checkSupabaseConnection } = require("./_lib/supabase.js");

const REQUIRED_TABLES = [
  "users",
  "api_providers",
  "products",
  "products_manual",
  "stock_manual",
  "orders",
  "transactions",
  "bep20_pending",
  "binance_payments",
  "email_activation_products",
  "admin_activity_log",
  "support_tickets"
];

const REQUIRED_COLUMNS = {
  api_providers: ["provider_type"],
  products: ["sort_order"],
  products_manual: ["sort_order"]
};

async function checkSchema() {
  const supabase = getSupabase();
  const checks = await Promise.all(REQUIRED_TABLES.map(async table => {
    const { error } = await supabase.from(table).select("id", { count: "exact", head: true });
    return { table, ok: !error, error: error ? error.message : null };
  }));
  const columnChecks = await Promise.all(Object.entries(REQUIRED_COLUMNS).flatMap(([table, columns]) =>
    columns.map(async column => {
      const { error } = await supabase.from(table).select(column, { count: "exact", head: true });
      return { table, column, ok: !error, error: error ? error.message : null };
    })
  ));
  return {
    ok: checks.every(c => c.ok) && columnChecks.every(c => c.ok),
    tables: checks,
    columns: columnChecks
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method not allowed" });
  }

  const supabase = getSupabaseStatus();
  const connection = await checkSupabaseConnection();
  let schema = null;
  if (connection.ok) {
    try {
      schema = await checkSchema();
    } catch (err) {
      schema = { ok: false, error: err.message || String(err) };
    }
  }

  return res.status(200).json({
    ok: true,
    supabase: {
      ...supabase,
      connection,
      schema
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
