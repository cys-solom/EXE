// Registro de actividad del panel admin (auditoria / historial de acciones).
async function logActivity(supabase, action, summary, meta) {
  try {
    await supabase.from("admin_activity_log").insert({ action, summary, meta: meta || null });
  } catch (e) {
    console.error("[ACTIVITY LOG]", e.message);
  }
}

module.exports = { logActivity };
