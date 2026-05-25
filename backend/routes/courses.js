const express  = require('express');
const router   = express.Router();
const { supabaseAdmin } = require('../db/supabase');
const { requireAuth, requireEnrollment } = require('../middleware/auth');

// Plan access levels (higher tiers include lower tiers)
const PLAN_ACCESS = {
  starter:    ['track1'],
  all_access: ['track1', 'track2', 'track3', 'track4'],
  vip:        ['track1', 'track2', 'track3', 'track4']  // + live calls
};

// ── GET /api/courses/my-access ────────────────────────────────────
// Returns the student's plan + which tracks they can access.
router.get('/my-access', requireAuth, async (req, res) => {
  const { data: enrollment } = await supabaseAdmin
    .from('enrollments')
    .select('plan_id, enrolled_at, status')
    .eq('user_id', req.user.id)
    .eq('status', 'active')
    .order('enrolled_at', { ascending: false })
    .limit(1)
    .single();

  if (!enrollment) {
    return res.json({ enrolled: false, plan: null, tracks: [] });
  }

  res.json({
    enrolled:   true,
    plan:       enrollment.plan_id,
    tracks:     PLAN_ACCESS[enrollment.plan_id] ?? [],
    enrolledAt: enrollment.enrolled_at
  });
});

// ── GET /api/courses/progress ─────────────────────────────────────
// Returns all video progress records for the current student.
router.get('/progress', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('video_progress')
    .select('lesson_id, completed, progress_seconds, duration_seconds, last_watched')
    .eq('user_id', req.user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ progress: data || [] });
});

// ── POST /api/courses/progress ────────────────────────────────────
// Saves progress for a single lesson. Called every ~30s from the video player.
router.post('/progress', requireEnrollment, async (req, res) => {
  const { lessonId, progressSeconds, durationSeconds, completed } = req.body;
  if (!lessonId) return res.status(400).json({ error: 'lessonId required' });

  // Validate the student can access this lesson's track
  const track = lessonToTrack(lessonId);
  const allowedTracks = PLAN_ACCESS[req.enrollment.plan_id] ?? [];
  if (track && !allowedTracks.includes(track)) {
    return res.status(403).json({ error: 'Your plan does not include this track' });
  }

  const { error } = await supabaseAdmin
    .from('video_progress')
    .upsert({
      user_id:          req.user.id,
      lesson_id:        lessonId,
      progress_seconds: progressSeconds ?? 0,
      duration_seconds: durationSeconds ?? 0,
      completed:        completed ?? false,
      last_watched:     new Date().toISOString()
    }, { onConflict: 'user_id,lesson_id' });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ── GET /api/courses/video/:lessonId ─────────────────────────────
// Returns a Bunny.net signed embed URL for the requested lesson.
router.get('/video/:lessonId', requireEnrollment, async (req, res) => {
  const { lessonId } = req.params;

  // Validate track access
  const track = lessonToTrack(lessonId);
  const allowedTracks = PLAN_ACCESS[req.enrollment.plan_id] ?? [];
  if (track && !allowedTracks.includes(track)) {
    return res.status(403).json({ error: 'Upgrade your plan to access this track' });
  }

  // Build Bunny.net embed URL
  // Lesson IDs map to Bunny video IDs via your upload process
  const videoId = await lookupBunnyVideoId(lessonId);
  if (!videoId) return res.status(404).json({ error: 'Video not found' });

  const embedUrl = buildBunnyEmbedUrl(videoId);
  res.json({ embedUrl, lessonId });
});

// ═══════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════

function lessonToTrack(lessonId) {
  // Lesson IDs are formatted: track1-mod2-lesson3
  const match = lessonId?.match(/^(track\d+)-/);
  return match ? match[1] : null;
}

async function lookupBunnyVideoId(lessonId) {
  // In production: query a lessons table or a JSON mapping file.
  // For now, check a JSON config file if it exists.
  try {
    const lessons = require('../db/lessons.json');
    return lessons[lessonId]?.bunnyVideoId || null;
  } catch {
    return null;
  }
}

function buildBunnyEmbedUrl(videoId) {
  const libraryId = process.env.BUNNY_LIBRARY_ID;
  const hostname  = process.env.BUNNY_CDN_HOSTNAME;
  // Bunny iframe embed format
  return `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}?autoplay=false&loop=false&muted=false&preload=true`;
}

module.exports = router;
