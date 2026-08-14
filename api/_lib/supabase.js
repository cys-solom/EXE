require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

let client = null;
function getSupabase() {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  }
  return client;
}

module.exports = { getSupabase };
