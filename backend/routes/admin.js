const express  = require('express');
const router   = express.Router();
const { supabaseAdmin } = require('../db/supabase');
const { requireAdmin }  = require('../middleware/auth');
const stripe   = require('stripe')(process.env.STRIPE_SECRET_KEY);

// All admin routes require admin role
router.use(requireAdmin);

// ── GET /api/admin/dashboard ──────────────────────────────────────
// Main dashboard stats: revenue, students, enrollments breakdown.
router.get('/dashboard', async (req, res) => {
  try {
    const [enrollments, profiles, recentEnrollments] = await Promise.all([
      supabaseAdmin
        .from('enrollments')
        .select('plan_id, amount_paid_cents, status, enrolled_at'),

      supabaseAdmin
        .from('profiles')
        .select('id', { count: 'exact', head: true }),

      supabaseAdmin
        .from('enrollments')
        .select(`
          id, plan_id, amount_paid_cents, enrolled_at, status,
          profiles ( first_name, last_name, email )
        `)
        .order('enrolled_at', { ascending: false })
        .limit(10)
    ]);

    const rows  = enrollments.data || [];
    const active = rows.filter(r => r.status === 'active');

    const planCounts = active.reduce((acc, r) => {
      acc[r.plan_id] = (acc[r.plan_id] || 0) + 1;
      return acc;
    }, {});

    const totalRevenue = active.reduce((sum, r) => sum + (r.amount_paid_cents || 0), 0);

    // Revenue over last 30 days (daily buckets)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recentRevenue = active
      .filter(r => r.enrolled_at >= thirtyDaysAgo)
      .reduce((sum, r) => sum + (r.amount_paid_cents || 0), 0);

    res.json({
      stats: {
        totalStudents:   profiles.count || 0,
        activeEnrollments: active.length,
        totalRevenueCents: totalRevenue,
        last30DaysRevenueCents: recentRevenue,
        byPlan: {
          starter:    planCounts.starter    || 0,
          all_access: planCounts.all_access || 0,
          vip:        planCounts.vip        || 0
        }
      },
      recentEnrollments: (recentEnrollments.data || []).map(formatEnrollment)
    });
  } catch (err) {
    console.error('[admin/dashboard]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/students ───────────────────────────────────────
// Paginated student list with search.
router.get('/students', async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 25);
  const search = req.query.search?.trim() || '';
  const offset = (page - 1) * limit;

  let query = supabaseAdmin
    .from('profiles')
    .select(`
      id, email, first_name, last_name, created_at, role, discord_username,
      enrollments ( plan_id, status, enrolled_at, amount_paid_cents )
    `, { count: 'exact' })
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false });

  if (search) {
    query = query.or(`email.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
  }

  const { data, count, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  res.json({
    students:   data || [],
    total:      count || 0,
    page,
    totalPages: Math.ceil((count || 0) / limit)
  });
});

// ── GET /api/admin/students/:id ───────────────────────────────────
router.get('/students/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select(`
      *,
      enrollments ( * ),
      video_progress ( lesson_id, completed, last_watched )
    `)
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Student not found' });
  res.json({ student: data });
});

// ── PATCH /api/admin/students/:id ────────────────────────────────
// Update student role or notes.
router.patch('/students/:id', async (req, res) => {
  const allowed = ['role', 'discord_username', 'first_name', 'last_name'];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );

  const { error } = await supabaseAdmin
    .from('profiles')
    .update(updates)
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── POST /api/admin/enrollments/refund ───────────────────────────
router.post('/enrollments/refund', async (req, res) => {
  const { enrollmentId } = req.body;

  const { data: enrollment } = await supabaseAdmin
    .from('enrollments')
    .select('stripe_payment_intent, status')
    .eq('id', enrollmentId)
    .single();

  if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
  if (enrollment.status !== 'active') return res.status(400).json({ error: 'Already refunded/cancelled' });

  try {
    if (enrollment.stripe_payment_intent) {
      await stripe.refunds.create({ payment_intent: enrollment.stripe_payment_intent });
    }
    await supabaseAdmin
      .from('enrollments')
      .update({ status: 'refunded' })
      .eq('id', enrollmentId);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/admin/revenue/chart ──────────────────────────────────
// Daily revenue for the last N days (for the chart).
router.get('/revenue/chart', async (req, res) => {
  const days = Math.min(90, parseInt(req.query.days) || 30);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await supabaseAdmin
    .from('enrollments')
    .select('enrolled_at, amount_paid_cents, plan_id')
    .eq('status', 'active')
    .gte('enrolled_at', since)
    .order('enrolled_at', { ascending: true });

  // Bucket by day
  const buckets = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - (days - 1 - i) * 24 * 60 * 60 * 1000);
    buckets[d.toISOString().slice(0, 10)] = 0;
  }
  for (const row of (data || [])) {
    const day = row.enrolled_at?.slice(0, 10);
    if (day && buckets[day] !== undefined) {
      buckets[day] += row.amount_paid_cents || 0;
    }
  }

  res.json({
    labels: Object.keys(buckets),
    values: Object.values(buckets).map(v => (v / 100).toFixed(2))
  });
});

// ─────────────────────────────────────────────────────────────────
function formatEnrollment(e) {
  return {
    id:          e.id,
    planId:      e.plan_id,
    amountPaid:  (e.amount_paid_cents || 0) / 100,
    enrolledAt:  e.enrolled_at,
    status:      e.status,
    student: {
      firstName: e.profiles?.first_name,
      lastName:  e.profiles?.last_name,
      email:     e.profiles?.email
    }
  };
}

module.exports = router;
