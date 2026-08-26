require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

let client = null;
const SUPABASE_TIMEOUT_MS = Number(process.env.ADMIN_SUPABASE_TIMEOUT_MS || 8000);

function env(name) {
  return String(process.env[name] || "").trim();
}

function getSupabaseConfig() {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_KEY") || env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_ANON_KEY") || env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return { url, key };
}

function validateSupabaseUrl(url) {
  if (!url) return "SUPABASE_URL is missing";
  if (/^postgres(ql)?:\/\//i.test(url)) return "SUPABASE_URL is a database connection string. Use the Supabase Project URL: https://PROJECT.supabase.co";
  if (!/^https:\/\//i.test(url)) return "SUPABASE_URL must start with https://";
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("supabase")) return "SUPABASE_URL does not look like a Supabase project URL";
  } catch (e) {
    return "SUPABASE_URL is not a valid URL";
  }
  return null;
}

function getSupabaseStatus() {
  const { url, key } = getSupabaseConfig();
  let host = "";
  try { host = url ? new URL(url).host : ""; } catch (e) {}
  const urlIssue = validateSupabaseUrl(url);
  return {
    configured: !!(url && key),
    hasUrl: !!url,
    hasKey: !!key,
    host,
    urlIssue,
    timeoutMs: SUPABASE_TIMEOUT_MS
  };
}

async function supabaseFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    const msg = err && err.name === "AbortError"
      ? `Supabase timeout after ${SUPABASE_TIMEOUT_MS}ms`
      : `Supabase connection failed: ${err.message || err}`;
    const e = new Error(msg);
    e.code = "SUPABASE_FETCH_FAILED";
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function checkSupabaseConnection() {
  const { url, key } = getSupabaseConfig();
  const urlIssue = validateSupabaseUrl(url);
  if (urlIssue) return { ok: false, stage: "config", error: urlIssue };
  if (!key) return { ok: false, stage: "config", error: "Supabase key is missing" };
  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/`;
  try {
    const started = Date.now();
    const response = await supabaseFetch(endpoint, {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`
      }
    });
    return {
      ok: response.status < 500,
      stage: "network",
      status: response.status,
      latencyMs: Date.now() - started
    };
  } catch (err) {
    return {
      ok: false,
      stage: "network",
      error: err.message || String(err)
    };
  }
}

function getSupabase() {
  if (!client) {
    const { url, key } = getSupabaseConfig();
    if (!url || !key) {
      throw new Error("Supabase env missing. Set SUPABASE_URL and SUPABASE_KEY or SUPABASE_SERVICE_ROLE_KEY.");
    }
    const urlIssue = validateSupabaseUrl(url);
    if (urlIssue) throw new Error(urlIssue);
    client = createClient(url, key, {
      global: { fetch: supabaseFetch },
      auth: { persistSession: false }
    });
  }
  return client;
}

module.exports = { getSupabase, getSupabaseStatus, checkSupabaseConnection };
