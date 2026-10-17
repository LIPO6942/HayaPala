-- =========================================================================
-- HayaPala Relational Database Schema (PostgreSQL / SQLite Compatible)
-- Next-Gen Padel Platform: Courts, Bookings, ELO, Wallet, Tournaments
-- =========================================================================

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  email VARCHAR(128) UNIQUE,
  avatar VARCHAR(255),
  points DECIMAL(10,2) DEFAULT 0.00,
  phone VARCHAR(32),
  level DECIMAL(4,2) DEFAULT 5.00,
  level_reliability DECIMAL(5,2) DEFAULT 50.00,
  matches_played INT DEFAULT 0,
  sport VARCHAR(64) DEFAULT 'Padel',
  role VARCHAR(32) DEFAULT 'player',
  notifications_count INT DEFAULT 0,
  favorites JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS community_players (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  level DECIMAL(4,2) NOT NULL,
  reliability DECIMAL(5,2) DEFAULT 50.0,
  avatar VARCHAR(16),
  club VARCHAR(128),
  city VARCHAR(64),
  phone VARCHAR(32),
  matches INT DEFAULT 0,
  points DECIMAL(10,2) DEFAULT 0.0
);

CREATE TABLE IF NOT EXISTS clubs (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  sport VARCHAR(64) DEFAULT 'Padel',
  address VARCHAR(255),
  schedule VARCHAR(128),
  distance VARCHAR(32),
  logo_badge VARCHAR(16),
  logo_color VARCHAR(32),
  logo_text_color VARCHAR(32),
  is_favorite BOOLEAN DEFAULT FALSE,
  courts_count INT DEFAULT 4,
  indoor_courts INT DEFAULT 2,
  outdoor_courts INT DEFAULT 2,
  price_points DECIMAL(10,2) DEFAULT 25.0,
  phone VARCHAR(32),
  email VARCHAR(128)
);

CREATE TABLE IF NOT EXISTS courts (
  id VARCHAR(64) PRIMARY KEY,
  club_id VARCHAR(64) REFERENCES clubs(id) ON DELETE CASCADE,
  name VARCHAR(128) NOT NULL,
  type VARCHAR(32) CHECK (type IN ('Indoor', 'Outdoor')),
  surface VARCHAR(64),
  status VARCHAR(32) DEFAULT 'active' CHECK (status IN ('active', 'maintenance', 'blocked')),
  price DECIMAL(10,2) DEFAULT 25.0
);

CREATE TABLE IF NOT EXISTS bookings (
  id VARCHAR(64) PRIMARY KEY,
  club_id VARCHAR(64) REFERENCES clubs(id),
  court_id VARCHAR(64) REFERENCES courts(id),
  court_name VARCHAR(128),
  time VARCHAR(64) NOT NULL,
  date VARCHAR(64) NOT NULL,
  client_name VARCHAR(128) NOT NULL,
  phone VARCHAR(32),
  status VARCHAR(32) DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'open_match', 'cancelled')),
  points DECIMAL(10,2) NOT NULL,
  price_per_player DECIMAL(10,2) NOT NULL,
  slots_paid INT DEFAULT 1,
  slots_total INT DEFAULT 4,
  type VARCHAR(32) DEFAULT 'Partie Ouverte',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS matches (
  id VARCHAR(64) PRIMARY KEY,
  club_id VARCHAR(64) REFERENCES clubs(id),
  club_name VARCHAR(128),
  court_id VARCHAR(64),
  court_name VARCHAR(128),
  date VARCHAR(64),
  time VARCHAR(64),
  duration VARCHAR(32) DEFAULT '90 min',
  type VARCHAR(32) DEFAULT 'Match public',
  court_reserved BOOLEAN DEFAULT TRUE,
  level_range VARCHAR(32),
  points_cost DECIMAL(10,2),
  team1 JSON,
  team2 JSON,
  open_slot JSON,
  status VARCHAR(32) DEFAULT 'open',
  booking_id VARCHAR(64),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS official_teams (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  player1 JSON NOT NULL,
  player2 JSON NOT NULL,
  elo_rating INT NOT NULL,
  team_level DECIMAL(4,2),
  matches_played INT DEFAULT 0,
  wins INT DEFAULT 0,
  losses INT DEFAULT 0,
  win_rate INT DEFAULT 100,
  badge VARCHAR(64),
  home_club VARCHAR(128),
  streak VARCHAR(16),
  is_user_team BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS tournaments (
  id VARCHAR(64) PRIMARY KEY,
  title VARCHAR(128) NOT NULL,
  badge VARCHAR(64),
  club_id VARCHAR(64) REFERENCES clubs(id),
  club_name VARCHAR(128),
  date VARCHAR(64),
  format VARCHAR(64),
  max_teams INT DEFAULT 16,
  entry_fee DECIMAL(10,2) DEFAULT 30.0,
  prize_pool DECIMAL(10,2) DEFAULT 1000.0,
  status VARCHAR(32) DEFAULT 'open',
  participants JSON
);

CREATE TABLE IF NOT EXISTS transactions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  user_name VARCHAR(128),
  type VARCHAR(32) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  points DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(64),
  status VARCHAR(32) DEFAULT 'completed',
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_match_history (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64),
  date VARCHAR(32),
  club_name VARCHAR(128),
  level VARCHAR(32),
  team1 VARCHAR(128),
  team1_score INT,
  team2 VARCHAR(128),
  team2_score INT,
  result VARCHAR(16)
);

CREATE TABLE IF NOT EXISTS club_settings (
  club_id VARCHAR(64) PRIMARY KEY REFERENCES clubs(id),
  name VARCHAR(128),
  address VARCHAR(255),
  phone VARCHAR(32),
  email VARCHAR(128),
  open_time VARCHAR(16),
  close_time VARCHAR(16),
  default_slot_minutes INT DEFAULT 90,
  price_per_player DECIMAL(10,2)
);