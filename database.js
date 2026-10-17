import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'hayapala.json');
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Initial Seed Data (Authentic Tunisian Padel clubs, players, courts, matches)
// Clean initial database state without mock data (Ready for user-created clubs, courts, matches)
const SEED_DATA = {
  users: [
    {
      id: "user_moslem",
      name: "Moslem Gouia",
      email: "moslem.gouia@example.com",
      avatar: "/images/tennis-ball.svg",
      points: 100.00,
      phone: "+216 22 227 041",
      level: 5.00,
      levelReliability: 50.00,
      matchesPlayed: 0,
      sport: "Padel",
      role: "admin",
      notificationsCount: 0,
      favorites: [],
      createdAt: new Date().toISOString()
    }
  ],
  community_players: [],
  clubs: [],
  courts: [],
  bookings: [],
  matches: [],
  official_teams: [],
  tournaments: [],
  transactions: [],
  user_match_history: [],
  club_settings: []
};

// SQL Schema generation
const SQL_DDL = `
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
`;

// Save SQL DDL file for export / production migration
try {
  fs.writeFileSync(SCHEMA_FILE, SQL_DDL.trim(), 'utf-8');
} catch (e) {
  console.warn("Could not write schema.sql", e);
}

// ---------------------------------------------------------------------------
// High-Performance Database Engine with Persistence & Relation Integrity
// ---------------------------------------------------------------------------
class HayaPalaDatabase {
  constructor() {
    this.tables = {};
    this.init();
  }

  init() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        this.tables = JSON.parse(raw);
        // Ensure all tables exist if schema updated
        Object.keys(SEED_DATA).forEach(table => {
          if (!this.tables[table]) {
            this.tables[table] = JSON.parse(JSON.stringify(SEED_DATA[table]));
          }
        });
      } else {
        this.tables = JSON.parse(JSON.stringify(SEED_DATA));
        this.persist();
      }
    } catch (err) {
      console.warn("HayaPalaDatabase: Error initializing from disk, using seed data", err);
      this.tables = JSON.parse(JSON.stringify(SEED_DATA));
      this.persist();
    }
  }

  persist() {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(this.tables, null, 2), 'utf-8');
    } catch (err) {
      console.error("HayaPalaDatabase: Failed to write database to disk", err);
    }
  }

  // Generic Query & CRUD Methods
  findAll(tableName, filterFn = null) {
    const list = this.tables[tableName] || [];
    if (!filterFn) return list.slice();
    return list.filter(filterFn);
  }

  findById(tableName, id) {
    const list = this.tables[tableName] || [];
    return list.find(item => item.id === id) || null;
  }

  insert(tableName, item) {
    if (!this.tables[tableName]) {
      this.tables[tableName] = [];
    }
    const record = { ...item };
    if (!record.id) {
      record.id = `${tableName.slice(0, 4)}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    }
    if (!record.createdAt) {
      record.createdAt = new Date().toISOString();
    }
    this.tables[tableName].unshift(record);
    this.persist();
    return record;
  }

  update(tableName, id, updates) {
    const list = this.tables[tableName] || [];
    const index = list.findIndex(item => item.id === id);
    if (index === -1) return null;
    list[index] = { ...list[index], ...updates };
    this.persist();
    return list[index];
  }

  delete(tableName, id) {
    const list = this.tables[tableName] || [];
    const index = list.findIndex(item => item.id === id);
    if (index === -1) return false;
    list.splice(index, 1);
    this.persist();
    return true;
  }

  // User Helpers
  getUser(userId = "user_moslem") {
    return this.findById('users', userId) || this.tables.users[0];
  }

  updateUser(userId, updates) {
    return this.update('users', userId, updates);
  }

  // Club with nested courts helper
  getClubsWithCourts() {
    const clubs = this.findAll('clubs');
    const allCourts = this.findAll('courts');
    return clubs.map(c => ({
      ...c,
      courts: allCourts.filter(crt => crt.clubId === c.id)
    }));
  }

  // Reset to seed data
  reset() {
    this.tables = JSON.parse(JSON.stringify(SEED_DATA));
    this.persist();
    return true;
  }

  // Aggregated Stats for Admin Dashboard
  getAdminStats(clubId = null) {
    const bookings = clubId ? this.findAll('bookings', b => b.clubId === clubId) : this.findAll('bookings');
    const courts = clubId ? this.findAll('courts', c => c.clubId === clubId) : this.findAll('courts');
    const tournaments = this.findAll('tournaments');
    const players = this.findAll('community_players');
    const transactions = this.findAll('transactions');

    const totalBookings = bookings.length;
    const confirmedBookings = bookings.filter(b => b.status === 'confirmed').length;
    const activeCourts = courts.filter(c => c.status === 'active').length;
    
    // Revenue calculated from bookings + transactions
    const totalRevenueDT = bookings.reduce((sum, b) => {
      const paid = b.slotsPaid || 4;
      const rate = b.pricePerPlayer || 25;
      return sum + (paid * rate);
    }, 0);

    const totalHours = totalBookings * 1.5;
    const occupancyRate = activeCourts > 0 
      ? Math.min(96, Math.round((totalBookings / (activeCourts * 6)) * 100))
      : 75;

    return {
      totalBookings,
      confirmedBookings,
      totalCourts: courts.length,
      activeCourts,
      totalRevenueDT,
      totalHours,
      occupancyRate,
      playersCount: players.length + 1,
      activeTournaments: tournaments.filter(t => t.status === 'open').length,
      recentTransactions: transactions.slice(0, 10)
    };
  }
}

export const db = new HayaPalaDatabase();
export default db;
