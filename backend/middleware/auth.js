const { supabaseAdmin } = require('../db/supabase');

// ── requireAuth ───────────────────────────────────────────────────
// Verifies the Supabase JWT from the Authorization header or cookie.
// Attaches req.user (Supabase user) and req.profile (our profiles row).
async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ error: 'Not authenticated' });

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid or expired session' });

    // Fetch our extended profile
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    req.user    = user;
    req.profile = profile;
    req.token   = token;
    next();
  } catch (err) {
    console.error('[auth]', err.message);
    res.status(500).json({ error: 'Auth middleware error' });
  }
}

// ── requireAdmin ──────────────────────────────────────────────────
async function requireAdmin(req, res, next) {
  await requireAuth(req, res, () => {
    if (req.profile?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

// ── requireEnrollment ─────────────────────────────────────────────
// Checks the user has an active enrollment for the requested content.
async function requireEnrollment(req, res, next) {
  await requireAuth(req, res, async () => {
    const { data: enrollment } = await supabaseAdmin
      .from('enrollments')
      .select('plan_id, status')
      .eq('user_id', req.user.id)
      .eq('status', 'active')
      .order('enrolled_at', { ascending: false })
      .limit(1)
      .single();

    if (!enrollment) {
      return res.status(403).json({ error: 'No active enrollment found' });
    }
    req.enrollment = enrollment;
    next();
  });
}

// ── helpers ───────────────────────────────────────────────────────
function extractToken(req) {
  // Check Authorization header first
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  // Fall back to cookie
  return req.cookies?.sb_token || null;
}

module.exports = { requireAuth, requireAdmin, requireEnrollment };
