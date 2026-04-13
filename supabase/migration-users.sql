-- Users table: authorized LOMAF members (admin + 10 coaches)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'coach' CHECK (role IN ('admin', 'coach')),
  team_id INT,
  team_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_login TIMESTAMPTZ
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on users" ON users FOR ALL USING (true) WITH CHECK (true);

-- Seed with placeholder emails. Lipi updates the admin row with his real Gmail
-- immediately after deploy, then edits the rest via Settings > Users.
INSERT INTO users (email, display_name, role, team_id, team_name) VALUES
  ('placeholder-lipi@example.com',   'Lipi',             'admin', 3194003, 'Littl'' bit LIPI'),
  ('placeholder-tim@example.com',    'Tim Freed',        'coach', 3194002, 'Mansion Mambas'),
  ('placeholder-jacob@example.com',  'Jacob Wytwornik',  'coach', 3194005, 'South Tel Aviv Dragons'),
  ('placeholder-shir@example.com',   'Shir Maran',       'coach', 3194009, 'I believe in SEANO'),
  ('placeholder-coby@example.com',   'Coby Felbel',      'coach', 3194009, 'I believe in SEANO'),
  ('placeholder-gadi@example.com',   'Gadi Herskovitz',  'coach', 3194006, 'Melech Mitchito'),
  ('placeholder-daniel@example.com', 'Daniel Penso',     'coach', 3194010, 'Cripps Don''t Lie'),
  ('placeholder-alon@example.com',   'Alon Esterman',    'coach', 3194008, 'Take Me Home Country Road'),
  ('placeholder-ronen@example.com',  'Ronen Slonim',     'coach', 3194001, 'Doge Bombers'),
  ('placeholder-josh@example.com',   'Josh Sacks',       'coach', 3194004, 'Gun M Down'),
  ('placeholder-lior@example.com',   'Lior Davis',       'coach', 3194007, 'Warnered613')
ON CONFLICT (email) DO NOTHING;
