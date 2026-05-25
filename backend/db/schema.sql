-- ══════════════════════════════════════════════════════════════════
--  BRRRR⁸ Academy — Supabase / PostgreSQL schema
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════════════

-- ── Profiles (extends Supabase auth.users) ────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id              UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT        NOT NULL,
  first_name      TEXT,
  last_name       TEXT,
  phone           TEXT,
  city            TEXT,
  state           TEXT,
  doors_owned     INTEGER     DEFAULT 0,
  discord_username TEXT,
  discord_id      TEXT,
  role            TEXT        NOT NULL DEFAULT 'student',  -- 'student' | 'admin'
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id),
  CONSTRAINT role_check CHECK (role IN ('student', 'admin'))
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Plans ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id                TEXT    PRIMARY KEY,  -- 'starter' | 'all_access' | 'vip'
  name              TEXT    NOT NULL,
  price_cents       INTEGER NOT NULL,
  stripe_price_id   TEXT,
  discord_role_id   TEXT,
  features          JSONB   DEFAULT '[]'
);

INSERT INTO plans (id, name, price_cents) VALUES
  ('starter',    'Starter',    149700),
  ('all_access', 'All Access', 249700),
  ('vip',        'VIP',        399700)
ON CONFLICT (id) DO NOTHING;

-- ── Enrollments ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enrollments (
  id                     UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                UUID        REFERENCES profiles(id) ON DELETE CASCADE,
  plan_id                TEXT        REFERENCES plans(id),
  stripe_session_id      TEXT        UNIQUE,
  stripe_payment_intent  TEXT,
  stripe_customer_id     TEXT,
  amount_paid_cents      INTEGER,
  status                 TEXT        NOT NULL DEFAULT 'active',
  enrolled_at            TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT status_check CHECK (status IN ('active', 'cancelled', 'refunded'))
);

-- ── Video Progress ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS video_progress (
  id               UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          UUID        REFERENCES profiles(id) ON DELETE CASCADE,
  lesson_id        TEXT        NOT NULL,  -- e.g. 'track1-mod2-lesson3'
  completed        BOOLEAN     DEFAULT FALSE,
  progress_seconds INTEGER     DEFAULT 0,
  duration_seconds INTEGER     DEFAULT 0,
  last_watched     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, lesson_id)
);

-- ── Row Level Security ─────────────────────────────────────────────
ALTER TABLE profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_progress ENABLE ROW LEVEL SECURITY;

-- Students can only see/edit their own rows
CREATE POLICY "own profile"       ON profiles       FOR ALL USING (auth.uid() = id);
CREATE POLICY "own enrollments"   ON enrollments    FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "own progress"      ON video_progress FOR ALL USING (auth.uid() = user_id);

-- Plans are public (anyone can read)
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plans are public"  ON plans          FOR SELECT USING (true);

-- ── Indexes ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_enrollments_user      ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_stripe    ON enrollments(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_progress_user         ON video_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_lesson       ON video_progress(lesson_id);
