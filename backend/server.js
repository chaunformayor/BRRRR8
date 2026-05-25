const path    = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit    = require('express-rate-limit');

const authRoutes   = require('./routes/auth');
const stripeRoutes = require('./routes/stripe');
const courseRoutes = require('./routes/courses');
const adminRoutes  = require('./routes/admin');
const { initDiscordBot } = require('./discord/bot');

const app  = express();
const PORT = process.env.PORT || 7000;
const ROOT = path.join(__dirname, '..');  // brrrr8/ folder

// ── Trust Vercel / reverse-proxy headers ─────────────────────────
// Required for express-rate-limit to correctly identify client IPs
// behind Vercel's edge network (X-Forwarded-For header).
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'", 'https://js.stripe.com'],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc:     ["'self'", 'https://fonts.gstatic.com'],
      imgSrc:      ["'self'", 'data:', 'https:', 'blob:'],
      frameSrc:    ["'self'", 'https://js.stripe.com', 'https://iframe.mediadelivery.net'],
      connectSrc:  ["'self'", 'https://*.supabase.co', 'https://api.stripe.com']
    }
  }
}));

// ── Stripe webhook must receive raw body ─────────────────────────
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// ── General middleware ────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ── Rate limiting ─────────────────────────────────────────────────
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,
  message: { error: 'Too many requests, please try again in 15 minutes.' }
}));

app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 120
}));

// ── CORS (dev only) ───────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use(cors({ origin: `http://localhost:${PORT}`, credentials: true }));
}

// ── API routes ────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/stripe',  stripeRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/admin',   adminRoutes);

// ── Health check ──────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));


// ── Static files ──────────────────────────────────────────────────
// Serve the whole brrrr8/ folder (index.html, courses.html, etc.)
app.use(express.static(ROOT, { index: 'index.html' }));

// SPA fallback: unknown paths → 404.html or index.html
app.use((req, res) => {
  res.status(404).sendFile(path.join(ROOT, 'index.html'));
});

// ── Error handler ─────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[server error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start (local dev only) ────────────────────────────────────────
// On Vercel: module is imported by the serverless runtime — don't listen.
// Discord.js needs persistent WebSocket connections and can't run on
// Vercel serverless. Role assignment falls back to "Bot not ready" silently.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🏠 BRRRR⁸ Academy running at http://localhost:${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}\n`);
    initDiscordBot();
  });
}

module.exports = app;
