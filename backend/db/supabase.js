const { createClient } = require('@supabase/supabase-js');

// Public client — uses anon key (respects Row Level Security)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Service client — bypasses RLS (admin operations only, server-side)
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = { supabase, supabaseAdmin };
