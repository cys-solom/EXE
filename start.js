// ============================================================
//  ARRANQUE FACIL — KOKORO SHOP LITE
//  Instala las dependencias automaticamente la PRIMERA vez
//  y luego arranca el bot. Solo usa modulos nativos de Node,
//  asi que funciona aunque no hayas corrido "npm install".
//
//  Como arrancar el bot:   node start.js     (o  npm start)
// ============================================================
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = __dirname;
const NODE_MODULES = path.join(ROOT, "node_modules");

// Dependencias que el bot necesita (tienen que existir en node_modules).
// "ws" hace falta para que Supabase funcione con Node 20 o inferior.
const REQUIRED_DEPS = ["node-telegram-bot-api", "@supabase/supabase-js", "dotenv", "ws"];

function depsInstalled() {
  return REQUIRED_DEPS.every(d => fs.existsSync(path.join(NODE_MODULES, ...d.split("/"))));
}

if (!depsInstalled()) {
  console.log("============================================================");
  console.log("  Primera vez: instalando dependencias...");
  console.log("  (esto puede tardar 1-2 minutos, solo pasa una vez)");
  console.log("============================================================");
  // shell:true es OBLIGATORIO en Windows con Node 18+ (Node 24 bloquea ejecutar
  // npm.cmd sin shell). Con shell:true, "npm" se resuelve solo en todos los SO.
  const res = spawnSync("npm install --no-audit --no-fund", {
    cwd: ROOT,
    stdio: "inherit",
    shell: true
  });
  if (res.status !== 0) {
    console.error("");
    console.error("❌ No se pudieron instalar las dependencias.");
    console.error("   Revisa que Node.js 18+ este instalado:  node -v");
    process.exit(1);
  }
  console.log("✅ Dependencias instaladas correctamente.");
}

// Arrancar el bot (ya con las dependencias listas)
console.log("🚀 Iniciando KOKORO SHOP LITE...");
require("./botlite.js");
