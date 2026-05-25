const express  = require('express');
const router   = express.Router();
const { supabase, supabaseAdmin } = require('../db/supabase');
const { requireAuth } = require('../middleware/auth');

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge:   7 * 24 * 60 * 60 * 1000   // 7 days
};

// ── POST /api/auth/login ──────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: error.message });

  const { session, user } = data;

  // Fetch profile
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role, first_name')
    .eq('id', user.id)
    .single();

  res.cookie('sb_token', session.access_token, COOKIE_OPTS);
  res.json({
    user: {
      id:         user.id,
      email:      user.email,
      firstName:  profile?.first_name,
      role:       profile?.role ?? 'student'
    },
    redirectTo: profile?.role === 'admin' ? '/admin/' : '/dashboard.html'
  });
});

// ── POST /api/auth/logout ─────────────────────────────────────────
router.post('/logout', requireAuth, async (req, res) => {
  await supabase.auth.signOut();
  res.clearCookie('sb_token');
  res.json({ ok: true });
});

// ── POST /api/auth/forgot-password ───────────────────────────────
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.APP_URL}/reset-password.html`
  });
  // Always return 200 — don't reveal whether email exists
  if (error) console.error('[forgot-password]', error.message);
  res.json({ ok: true });
});

// ── POST /api/auth/reset-password ────────────────────────────────
// Handles two Supabase flows:
//   1. PKCE (resetPasswordForEmail)  → body has { password, code }
//   2. Hash-based (admin.generateLink) → body has { password, accessToken, refreshToken }
router.post('/reset-password', async (req, res) => {
  const { password, code, accessToken, refreshToken } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  try {
    if (code) {
      // PKCE flow — exchange the code for a session
      const { error: sessionErr } = await supabase.auth.exchangeCodeForSession(code);
      if (sessionErr) return res.status(400).json({ error: 'Invalid or expired reset link' });
    } else if (accessToken && refreshToken) {
      // Hash-based flow — set the session directly from the tokens in the URL hash
      const { error: sessionErr } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (sessionErr) return res.status(400).json({ error: 'Invalid or expired reset link' });
    } else {
      return res.status(400).json({ error: 'Missing reset token' });
    }

    const { error } = await supabase.auth.updateUser({ password });
    if (error) return res.status(400).json({ error: error.message });

    res.json({ ok: true });
  } catch (err) {
    console.error('[reset-password]', err.message);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const { data: enrollment } = await supabaseAdmin
    .from('enrollments')
    .select('plan_id, enrolled_at, status')
    .eq('user_id', req.user.id)
    .eq('status', 'active')
    .order('enrolled_at', { ascending: false })
    .limit(1)
    .single();

  res.json({
    user: {
      id:              req.user.id,
      email:           req.user.email,
      firstName:       req.profile?.first_name,
      lastName:        req.profile?.last_name,
      role:            req.profile?.role ?? 'student',
      discordUsername: req.profile?.discord_username
    },
    enrollment: enrollment || null
  });
});

module.exports = router;
