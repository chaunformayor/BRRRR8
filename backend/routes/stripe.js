const express        = require('express');
const router         = express.Router();
const stripe         = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Resend }     = require('resend');
const { supabaseAdmin } = require('../db/supabase');
const { requireAuth } = require('../middleware/auth');
const { assignDiscordRole } = require('../discord/bot');

const resend = new Resend(process.env.RESEND_API_KEY);

// Plan → Stripe price ID mapping
const PLAN_PRICES = {
  starter:    process.env.STRIPE_PRICE_STARTER,
  all_access: process.env.STRIPE_PRICE_ALL_ACCESS,
  vip:        process.env.STRIPE_PRICE_VIP
};

const PLAN_NAMES = {
  starter:    'Starter',
  all_access: 'All Access',
  vip:        'VIP'
};

// ── POST /api/stripe/create-checkout ─────────────────────────────
// Creates a Stripe Checkout session and returns the URL.
// Can be called with or without an existing account (guest checkout).
router.post('/create-checkout', async (req, res) => {
  const { plan, email, firstName, lastName } = req.body;

  if (!plan || !PLAN_PRICES[plan]) {
    return res.status(400).json({ error: 'Invalid plan selected' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode:                 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price:    PLAN_PRICES[plan],
        quantity: 1
      }],
      customer_email: email || undefined,
      metadata: {
        plan,
        planName:  PLAN_NAMES[plan],
        firstName: firstName || '',
        lastName:  lastName  || ''
      },
      success_url: `${process.env.APP_URL}/enroll/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${process.env.APP_URL}/enroll.html?cancelled=1`
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[stripe/create-checkout]', err.message);
    res.status(500).json({ error: 'Could not create checkout session' });
  }
});

// ── POST /api/stripe/webhook ──────────────────────────────────────
// Raw body required — registered BEFORE json middleware in server.js
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe/webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    await handleCheckoutComplete(event.data.object);
  }

  res.json({ received: true });
});

// ── GET /api/stripe/session/:id ───────────────────────────────────
// Used by the success page to show confirmation details.
// No auth required — only non-sensitive info is returned (plan name + email).
// The session_id itself acts as the token (unguessable Stripe ID).
router.get('/session/:id', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.id);

    // Only return data for completed (paid) sessions
    if (session.payment_status !== 'paid') {
      return res.status(403).json({ error: 'Payment not completed' });
    }

    res.json({
      planName:   session.metadata?.planName,
      email:      session.customer_email,
      amountPaid: session.amount_total
    });
  } catch (err) {
    res.status(404).json({ error: 'Session not found' });
  }
});

// ── GET /api/stripe/portal ────────────────────────────────────────
// Redirects to Stripe Customer Portal (manage billing / receipts).
router.get('/portal', requireAuth, async (req, res) => {
  const { data: enrollment } = await supabaseAdmin
    .from('enrollments')
    .select('stripe_customer_id')
    .eq('user_id', req.user.id)
    .not('stripe_customer_id', 'is', null)
    .limit(1)
    .single();

  if (!enrollment?.stripe_customer_id) {
    return res.status(404).json({ error: 'No billing record found' });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer:   enrollment.stripe_customer_id,
    return_url: `${process.env.APP_URL}/dashboard.html`
  });

  res.json({ url: session.url });
});

// ═══════════════════════════════════════════════════════════════════
//  Internal: handle successful checkout
// ═══════════════════════════════════════════════════════════════════
async function handleCheckoutComplete(session) {
  const { metadata, customer_email, customer, amount_total, payment_intent } = session;
  const { plan, planName, firstName, lastName } = metadata || {};

  console.log(`[stripe] Checkout complete — plan=${plan} email=${customer_email}`);

  try {
    // 1. Look up existing user by email via profiles table (fast — avoids listUsers)
    let userId;
    let isNewUser = false;

    console.log('[stripe] Looking up user by email...');
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', customer_email)
      .maybeSingle();

    if (existingProfile) {
      userId = existingProfile.id;
      console.log(`[stripe] Existing user found: ${userId}`);
    } else {
      // Create auth account with a temp password
      console.log('[stripe] Creating new user...');
      const tempPassword = generateTempPassword();
      const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email:         customer_email,
        password:      tempPassword,
        email_confirm: true,
        user_metadata: { firstName, lastName }
      });
      if (createErr) throw new Error(`createUser: ${createErr.message}`);
      userId = newUser.user.id;
      isNewUser = true;
      console.log(`[stripe] New user created: ${userId}`);
    }

    // 2. Upsert profile
    console.log('[stripe] Upserting profile...');
    const { error: profileErr } = await supabaseAdmin.from('profiles').upsert({
      id:         userId,
      email:      customer_email,
      first_name: firstName || '',
      last_name:  lastName  || ''
    }, { onConflict: 'id' });
    if (profileErr) throw new Error(`upsertProfile: ${profileErr.message}`);

    // 3. Create enrollment record
    console.log('[stripe] Inserting enrollment...');
    const { error: enrollErr } = await supabaseAdmin.from('enrollments').insert({
      user_id:               userId,
      plan_id:               plan,
      stripe_session_id:     session.id,
      stripe_payment_intent: payment_intent,
      stripe_customer_id:    customer,
      amount_paid_cents:     amount_total,
      status:                'active'
    });
    if (enrollErr) throw new Error(`insertEnrollment: ${enrollErr.message}`);

    console.log(`[stripe] Enrollment created for user=${userId} plan=${plan}`);

    // 4. Send password setup email for new users via Resend
    if (isNewUser) {
      console.log('[stripe] Generating password setup link...');
      const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
        type:    'recovery',
        email:   customer_email,
        options: { redirectTo: `${process.env.APP_URL}/reset-password.html` }
      });
      if (linkErr) {
        console.error(`[stripe] generateLink failed: ${linkErr.message}`);
      } else {
        const actionLink = linkData?.properties?.action_link;
        console.log(`[stripe] Action link generated: ${actionLink ? 'yes' : 'no'}`);
        const { error: emailErr } = await resend.emails.send({
          from:    process.env.EMAIL_FROM || 'BRRRR⁸ Academy <noreply@brrrr8academy.com>',
          to:      customer_email,
          subject: 'Welcome to BRRRR⁸ Academy — Set your password',
          html: `
            <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;">
              <h1 style="color:#0A1628;font-size:24px;margin-bottom:8px;">Welcome, ${firstName || 'friend'}! 🎉</h1>
              <p style="color:#555;font-size:16px;line-height:1.6;">
                Your enrollment in <strong>${planName}</strong> is confirmed.
                Click below to set your password and access your courses.
              </p>
              <div style="text-align:center;margin:32px 0;">
                <a href="${actionLink}"
                   style="background:#C9A84C;color:#0A1628;padding:14px 32px;border-radius:6px;
                          text-decoration:none;font-weight:bold;font-size:16px;display:inline-block;">
                  Set My Password →
                </a>
              </div>
              <div style="background:#f0f0ff;border-radius:8px;padding:16px 20px;margin-top:24px;">
                <p style="margin:0 0 8px;font-weight:700;color:#333;">💬 Activate your Discord community access</p>
                <p style="margin:0 0 4px;color:#555;font-size:14px;">Connect your Discord account from your dashboard to join the private investor community and get your member role.</p>
                <p style="margin:0 0 12px;color:#888;font-size:12px;">Don't have Discord? It's free — you can create an account in seconds when you connect.</p>
                <a href="${process.env.APP_URL}/dashboard.html"
                   style="display:inline-block;background:#5865F2;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700;font-size:14px;">
                  Go to Dashboard →
                </a>
              </div>
              <p style="color:#888;font-size:13px;margin-top:24px;">This password link expires in 24 hours. If you didn't purchase a course, you can safely ignore this email.</p>
              <hr style="border:none;border-top:1px solid #eee;margin:24px 0;" />
              <p style="color:#aaa;font-size:12px;text-align:center;">BRRRR⁸ Academy · St. Louis, MO</p>
            </div>
          `
        });
        if (emailErr) console.error(`[stripe] Resend failed: ${emailErr.message}`);
        else console.log(`[stripe] Welcome email sent to ${customer_email}`);
      }
    }

    // 5. Assign Discord role (non-blocking)
    assignDiscordRole(userId, plan).catch(err =>
      console.error('[discord] Role assignment failed:', err.message)
    );

  } catch (err) {
    console.error('[stripe/webhook] handleCheckoutComplete error:', err.message);
  }
}

function generateTempPassword() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2).toUpperCase() + '!8';
}

module.exports = router;
