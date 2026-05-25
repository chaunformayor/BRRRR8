const express  = require('express');
const router   = express.Router();
const crypto   = require('crypto');
const { supabase, supabaseAdmin } = require('../db/supabase');
const { requireAuth } = require('../middleware/auth');

const PLAN_ROLE_ENV = {
  starter:    'DISCORD_ROLE_STARTER',
  all_access: 'DISCORD_ROLE_ALL_ACCESS',
  vip:        'DISCORD_ROLE_VIP'
};

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

    // Log the user in automatically after setting password
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      res.cookie('sb_token', session.access_token, COOKIE_OPTS);
    }

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

// ── GET /api/auth/discord ─────────────────────────────────────────
// Kicks off Discord OAuth. Requires the user to already be logged in
// (sb_token cookie set after password reset).
router.get('/discord', async (req, res, next) => {
  // If not logged in, redirect to login instead of returning JSON
  const token = req.cookies?.sb_token;
  if (!token) return res.redirect('/login.html?redirect=/api/auth/discord');
  next();
}, requireAuth, (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('discord_state', state, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge:   10 * 60 * 1000   // 10 minutes
  });

  const clientId   = process.env.DISCORD_CLIENT_ID;
  const redirectUri = `${process.env.APP_URL}/api/auth/discord/callback`;
  console.log(`[discord] OAuth start — client_id=${clientId} redirect_uri=${redirectUri}`);

  const oauthUrl = 'https://discord.com/oauth2/authorize' +
    `?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=identify%20guilds.join` +
    `&state=${state}`;

  res.redirect(oauthUrl);
});

// ── GET /api/auth/discord/callback ────────────────────────────────
// Discord redirects here after user authorizes.
// Adds them to the guild and assigns their plan role via REST API.
router.get('/discord/callback', requireAuth, async (req, res) => {
  const { code, state } = req.query;
  const storedState = req.cookies.discord_state;

  if (!code || !state || state !== storedState) {
    console.error('[discord/callback] State mismatch or missing code');
    return res.redirect('/dashboard.html?discord=error');
  }
  res.clearCookie('discord_state');

  try {
    // 1. Exchange code for Discord access token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    new URLSearchParams({
        client_id:     process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  `${process.env.APP_URL}/api/auth/discord/callback`
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error(`Discord token exchange failed: ${JSON.stringify(tokenData)}`);
    const discordAccessToken = tokenData.access_token;

    // 2. Get Discord user info
    const userRes  = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${discordAccessToken}` }
    });
    const discordUser = await userRes.json();
    console.log(`[discord] OAuth user: ${discordUser.username} (${discordUser.id})`);

    // 3. Look up their active enrollment to get the plan role
    const { data: enrollment } = await supabaseAdmin
      .from('enrollments')
      .select('plan_id')
      .eq('user_id', req.user.id)
      .eq('status', 'active')
      .order('enrolled_at', { ascending: false })
      .limit(1)
      .single();

    const roleId = enrollment?.plan_id ? process.env[PLAN_ROLE_ENV[enrollment.plan_id]] : null;

    // 4. Add to guild + assign role in one REST call
    const memberRes = await fetch(
      `https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUser.id}`,
      {
        method:  'PUT',
        headers: {
          Authorization:  `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          access_token: discordAccessToken,
          roles:        roleId ? [roleId] : []
        })
      }
    );
    const memberStatus = memberRes.status;
    console.log(`[discord] Guild add status: ${memberStatus} (201=added, 204=already member)`);

    // If already a member (204), still assign the role separately
    if (memberStatus === 204 && roleId) {
      await fetch(
        `https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members/${discordUser.id}/roles/${roleId}`,
        {
          method:  'PUT',
          headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }
        }
      );
      console.log(`[discord] Role assigned to existing member`);
    }

    // 5. Save Discord info to their profile
    await supabaseAdmin
      .from('profiles')
      .update({ discord_id: discordUser.id, discord_username: discordUser.username })
      .eq('id', req.user.id);

    console.log(`[discord] Connected ${discordUser.username} → user ${req.user.id}, plan ${enrollment?.plan_id}`);
    res.redirect('/dashboard.html?discord=connected');

  } catch (err) {
    console.error('[discord/callback] Error:', err.message);
    res.redirect('/dashboard.html?discord=error');
  }
});

module.exports = router;
