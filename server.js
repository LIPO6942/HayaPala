import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data.json');

// Initial seed data based on the real YallaPlay screenshots and platform facts
const INITIAL_DATA = {
  user: {
    id: "user_moslem",
    name: "Moslem Gouia",
    email: "moslem.gouia@example.com",
    avatar: "/images/bg_paddle.png",
    points: 10.00,
    phone: "+216 22 227 041",
    level: 5.49,
    levelReliability: 45.74,
    matchesPlayed: 28,
    sport: "Padel Game",
    notificationsCount: 3,
    favorites: ["club_arena", "club_country"]
  },
  communityPlayers: [
    { id: "usr_ahmed", name: "Ahmed Horrigue", level: 5.00, reliability: 62.0, avatar: "👨", club: "Padel Connection", city: "La Soukra", matches: 42 },
    { id: "usr_karim", name: "Karim Arfaoui", level: 5.20, reliability: 55.4, avatar: "🏃", club: "Arena Padel Premium", city: "La Soukra", matches: 31 },
    { id: "usr_dhouib", name: "Dhouib Med Amine", level: 6.90, reliability: 78.5, avatar: "🧔", club: "Padel Connection", city: "Borj Louzir", matches: 89 },
    { id: "usr_ezzedine", name: "Ezzedine Fitouri", level: 6.30, reliability: 71.0, avatar: "🏋️", club: "Padel Connection", city: "La Marsa", matches: 64 },
    { id: "usr_kotrane", name: "Kotrane Oussama", level: 5.80, reliability: 68.2, avatar: "👨", club: "Arena Padel Premium", city: "Gammarth", matches: 53 },
    { id: "usr_krima", name: "krima mohamed Bilel", level: 8.00, reliability: 94.0, avatar: "👨", club: "Arena Padel Premium", city: "Tunis", matches: 120 },
    { id: "usr_ecoincon", name: "Écoinçon Fabian", level: 7.00, reliability: 82.0, avatar: "🧔", club: "Arena Padel Premium", city: "La Marsa", matches: 75 },
    { id: "usr_mariem", name: "snoussi mariem", level: 2.70, reliability: 40.0, avatar: "👩", club: "Padel Country Club", city: "Lac 2", matches: 14 },
    { id: "usr_malek", name: "Malek A", level: 1.60, reliability: 35.0, avatar: "👩", club: "Padel Country Club", city: "Gammarth", matches: 9 },
    { id: "usr_challouf", name: "challouf youssef", level: 3.70, reliability: 48.0, avatar: "👤", club: "Padel Connection", city: "Ariana", matches: 22 },
    { id: "usr_anis", name: "Anis Ben Salah", level: 4.80, reliability: 52.0, avatar: "👨", club: "Arena Padel Premium", city: "La Soukra", matches: 27 },
    { id: "usr_mehdi", name: "mehdi mehdi", level: 6.00, reliability: 65.0, avatar: "👤", club: "Arena Padel Premium", city: "Tunis", matches: 45 }
  ],
  clubs: [
    {
      id: "club_arena",
      name: "Arena Padel Premium",
      sport: "Padel",
      address: "Rue du parc, La Soukra",
      schedule: "Samedi: Du 00:00 h au 00:00 h",
      distance: "4.1 km",
      logoBadge: "APP",
      logoColor: "#111111",
      logoTextColor: "#D4AF37",
      isFavorite: true,
      courtsCount: 4,
      indoorCourts: 2,
      outdoorCourts: 2,
      pricePoints: 25.0,
      courts: [
        { id: "court_app_1", name: "Court 1 - Panoramique Indoor", type: "Indoor", surface: "Gazon WPT" },
        { id: "court_app_2", name: "Court 2 - Central Indoor", type: "Indoor", surface: "Gazon WPT" },
        { id: "court_app_3", name: "Court 3 - Outdoor Pro", type: "Outdoor", surface: "Bleu Pro" },
        { id: "court_app_4", name: "Court 4 - Outdoor", type: "Outdoor", surface: "Bleu Pro" }
      ]
    },
    {
      id: "club_connection",
      name: "Padel Connection",
      sport: "Padel",
      address: "Rue Sanhaja, Borj Louzir",
      schedule: "Samedi: Du 06:30 h au 00:30 h",
      distance: "2.3 km",
      logoBadge: "PC",
      logoColor: "#0E3A60",
      logoTextColor: "#FFFFFF",
      isFavorite: false,
      courtsCount: 3,
      indoorCourts: 2,
      outdoorCourts: 1,
      pricePoints: 20.0,
      courts: [
        { id: "court_pc_1", name: "Court A - Indoor Bleu", type: "Indoor", surface: "Mondo Supercourt" },
        { id: "court_pc_2", name: "Court B - Indoor Rouge", type: "Indoor", surface: "Mondo Supercourt" },
        { id: "court_pc_3", name: "Court C - Outdoor", type: "Outdoor", surface: "Standard" }
      ]
    },
    {
      id: "club_country",
      name: "Padel Country Club",
      sport: "Padel",
      address: "Lac palace",
      schedule: "Samedi: Du 00:00 h au 00:00 h",
      distance: "3.7 km",
      logoBadge: "PCC",
      logoColor: "#1D5F8A",
      logoTextColor: "#E8F4FC",
      isFavorite: true,
      courtsCount: 5,
      indoorCourts: 3,
      outdoorCourts: 2,
      pricePoints: 25.0,
      courts: [
        { id: "court_pcc_1", name: "Court 1 - Club House Indoor", type: "Indoor", surface: "WPT Master" },
        { id: "court_pcc_2", name: "Court 2 - Indoor Panoramique", type: "Indoor", surface: "WPT Master" },
        { id: "court_pcc_3", name: "Court 3 - Indoor Standard", type: "Indoor", surface: "WPT Master" },
        { id: "court_pcc_4", name: "Court 4 - Outdoor Lac", type: "Outdoor", surface: "Gazon Synthétique" },
        { id: "court_pcc_5", name: "Court 5 - Outdoor Lac", type: "Outdoor", surface: "Gazon Synthétique" }
      ]
    }
  ],
  matches: [
    {
      id: "match_101",
      clubId: "club_connection",
      clubName: "Padel Connection",
      distance: "2.3 km",
      date: "Samedi 17 oct.",
      time: "11:00 h - 12:30 h",
      duration: "90 min",
      type: "Match public",
      courtReserved: true,
      levelRange: "1.1-2.1",
      pointsCost: 25.0,
      team1: [
        { name: "Malek A", level: 1.60, avatar: "👩" },
        { name: "challouf youssef", level: 3.70, avatar: "👤" }
      ],
      team2: [
        { name: "krimou malek", level: 2.80, avatar: "🏃" },
        { name: "snoussi mariem", level: 2.70, avatar: "👩" }
      ],
      openSlot: null
    },
    {
      id: "match_102",
      clubId: "club_country",
      clubName: "Padel Country Club",
      distance: "3.7 km",
      date: "Samedi 17 oct.",
      time: "12:00 h - 13:30 h",
      duration: "90 min",
      type: "Match public",
      courtReserved: true,
      levelRange: "6.4-7.4",
      pointsCost: 10.0,
      team1: [
        { name: "Dhouib Med Amine", level: 6.90, avatar: "🧔" },
        null // Open slot for player!
      ],
      team2: [
        { name: "AHMED HORRIGUE", level: 5.00, avatar: "👨" },
        { name: "Ezzedine Fitouri", level: 6.30, avatar: "🏋️" }
      ],
      openSlot: { team: 1, position: 2 }
    },
    {
      id: "match_103",
      clubId: "club_arena",
      clubName: "Arena Padel Premium",
      distance: "4.1 km",
      date: "Dimanche 18 oct.",
      time: "18:00 h - 19:30 h",
      duration: "90 min",
      type: "Match public",
      courtReserved: true,
      levelRange: "5.0-6.0",
      pointsCost: 20.0,
      team1: [
        { name: "Moslem Gouia", level: 5.49, avatar: "🎾" },
        null
      ],
      team2: [
        { name: "Kotrane Oussama", level: 5.80, avatar: "👨" },
        null
      ],
      openSlot: { team: 1, position: 2 }
    }
  ],
  userMatchHistory: [
    {
      id: "hist_1",
      date: "30-06",
      clubName: "Padel Country Club",
      level: "4.1-5.1",
      team1: "Karim Arfaoui x karoui khalil",
      team1Score: 2,
      team2: "Moslem Gouia x khelil hechmi",
      team2Score: 1,
      result: "P" // Perdu
    },
    {
      id: "hist_2",
      date: "19-06",
      clubName: "Arena Padel Premium",
      level: "5.1-6.1",
      team1: "Karim Arfaoui x zoghlami sofiene",
      team1Score: 1,
      team2: "Moslem Gouia x Kotrane Oussama",
      team2Score: 2,
      result: "G" // Gagné
    },
    {
      id: "hist_3",
      date: "10-06",
      clubName: "Padel Connection",
      level: "5.2-6.0",
      team1: "Moslem Gouia x Ahmed Horrigue",
      team1Score: 2,
      team2: "Ezzedine Fitouri x Dhouib Med Amine",
      team2Score: 0,
      result: "G" // Gagné
    }
  ],
  tournament: {
    title: "HayaPala Masters 2026",
    badge: "Join now",
    participants: [
      { name: "krima mohamed Bilel", level: 8.00, avatar: "👨" },
      { name: "Écoinçon Fabian", level: 7.00, avatar: "🧔" },
      { name: "mehdi mehdi", level: 6.00, avatar: "👤" }
    ]
  },
  clubBookings: [
    { id: "bkg_1", clubId: "club_connection", courtId: "court_pc_1", courtName: "Court A - Indoor Bleu", time: "08:30 - 10:00", clientName: "Anis Ben Salah", phone: "+216 98 123 456", status: "confirmed", points: 100, pricePerPlayer: 25, slotsPaid: 4, slotsTotal: 4, type: "Privée" },
    { id: "bkg_2", clubId: "club_connection", courtId: "court_pc_2", courtName: "Court B - Indoor Rouge", time: "11:30 - 13:00", clientName: "Partie Ouverte (Intermédiaires)", phone: "+216 22 227 041", status: "open_match", points: 50, pricePerPlayer: 25, slotsPaid: 2, slotsTotal: 4, type: "Partie Ouverte" },
    { id: "bkg_3", clubId: "club_connection", courtId: "court_pc_1", courtName: "Court A - Indoor Bleu", time: "17:00 - 18:30", clientName: "Moslem Gouia", phone: "+216 22 227 041", status: "confirmed", points: 100, pricePerPlayer: 25, slotsPaid: 4, slotsTotal: 4, type: "Privée" },
    { id: "bkg_4", clubId: "club_connection", courtId: "court_pc_3", courtName: "Court C - Outdoor", time: "18:30 - 20:00", clientName: "Karim Arfaoui", phone: "+216 50 889 900", status: "open_match", points: 75, pricePerPlayer: 25, slotsPaid: 3, slotsTotal: 4, type: "Partie Ouverte" }
  ],
  officialTeams: [
    {
      id: "team_legends",
      name: "Bandeja Masters",
      player1: { name: "krima mohamed Bilel", level: 8.00, avatar: "👨" },
      player2: { name: "Écoinçon Fabian", level: 7.00, avatar: "🧔" },
      eloRating: 1720,
      teamLevel: 7.50,
      matchesPlayed: 24,
      wins: 21,
      losses: 3,
      winRate: 88,
      badge: "⭐ Légendes",
      homeClub: "Arena Padel Premium",
      streak: "W7"
    },
    {
      id: "team_kings",
      name: "Padel Kings La Marsa",
      player1: { name: "Dhouib Med Amine", level: 6.90, avatar: "🧔" },
      player2: { name: "Ezzedine Fitouri", level: 6.30, avatar: "🏋️" },
      eloRating: 1640,
      teamLevel: 6.60,
      matchesPlayed: 19,
      wins: 16,
      losses: 3,
      winRate: 84,
      badge: "👑 Top Gun",
      homeClub: "Padel Connection",
      streak: "W4"
    },
    {
      id: "team_moslem",
      name: "Les Smécheurs du Nord",
      player1: { name: "Moslem Gouia", level: 5.49, avatar: "🎾" },
      player2: { name: "Ahmed Horrigue", level: 5.00, avatar: "👨" },
      eloRating: 1550,
      teamLevel: 5.25,
      matchesPlayed: 15,
      wins: 12,
      losses: 3,
      winRate: 80,
      badge: "🔥 Paire en Feu",
      homeClub: "Padel Country Club",
      streak: "W3",
      isUserTeam: true
    },
    {
      id: "team_vibora",
      name: "Vibora Squad",
      player1: { name: "Kotrane Oussama", level: 5.80, avatar: "👨" },
      player2: { name: "Karim Arfaoui", level: 5.20, avatar: "🏃" },
      eloRating: 1490,
      teamLevel: 5.50,
      matchesPlayed: 12,
      wins: 7,
      losses: 5,
      winRate: 58,
      badge: "⚡ Challengers",
      homeClub: "Arena Padel Premium",
      streak: "L1"
    },
    {
      id: "team_smash",
      name: "Carthage Padel Duo",
      player1: { name: "snoussi mariem", level: 2.70, avatar: "👩" },
      player2: { name: "Malek A", level: 1.60, avatar: "👩" },
      eloRating: 1250,
      teamLevel: 2.15,
      matchesPlayed: 8,
      wins: 4,
      losses: 4,
      winRate: 50,
      badge: "🌱 Espoirs",
      homeClub: "Padel Connection",
      streak: "W1"
    }
  ]
};

// Load or initialize data
let db = { ...INITIAL_DATA };
try {
  if (fs.existsSync(DATA_FILE)) {
    db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } else {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
  }
} catch (e) {
  console.warn("Could not read data.json, using defaults", e);
}

function saveDb() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (e) {
    console.error("Save DB failed:", e);
  }
}

// MIME types dictionary
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS headers for development flexibility
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse JSON Body Helper (robust and safe)
  const parseJsonBody = () => {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (e) {
          console.warn("Failed to parse request JSON, defaulting to empty object", e.message);
          resolve({});
        }
      });
      req.on('error', () => resolve({}));
    });
  };

  // Helper JSON response
  const jsonResponse = (data, statusCode = 200) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  // ----------------------------------------------------------------
  // REST API Routes
  // ----------------------------------------------------------------

  // GET /api/state - Complete initial state
  if (method === 'GET' && pathname === '/api/state') {
    return jsonResponse(db);
  }

  // GET /api/user - User profile
  if (method === 'GET' && pathname === '/api/user') {
    return jsonResponse(db.user);
  }

  // POST /api/user/wallet/recharge - Recharge points (1 DT = 1 Point via CB, Flouci, D17)
  if (method === 'POST' && pathname === '/api/user/wallet/recharge') {
    const body = await parseJsonBody();
    const dtAmount = Number(body.amount) || 25; // 1 DT = 1 Point
    const methodChoice = body.paymentMethod || 'flouci'; // 'cb' | 'flouci' | 'd17'
    
    // Bonus policy: 100 DT gives +10 pts bonus, 250 DT gives +35 pts bonus
    let bonus = 0;
    if (dtAmount >= 250) bonus = 35;
    else if (dtAmount >= 100) bonus = 10;

    const totalPointsAdded = dtAmount + bonus;
    db.user.points = Number((db.user.points + totalPointsAdded).toFixed(2));

    const methodLabels = {
      'cb': 'Carte Bancaire (GNT / CMI)',
      'flouci': 'Flouci Mobile Pay',
      'd17': 'D17 (La Poste Tunisienne)'
    };

    saveDb();
    return jsonResponse({
      success: true,
      points: db.user.points,
      amountDT: dtAmount,
      pointsAdded: totalPointsAdded,
      paymentMethod: methodLabels[methodChoice] || methodChoice,
      message: `Paiement de ${dtAmount} DT validé par ${methodLabels[methodChoice] || 'Mobile'} ! +${totalPointsAdded} Points crédités sur votre compte.`
    });
  }

  // POST /api/user/wallet/transfer - Transfer points
  if (method === 'POST' && pathname === '/api/user/wallet/transfer') {
    const body = await parseJsonBody();
    const amount = Number(body.amount) || 10;
    const recipient = body.recipient || "Ami";
    if (db.user.points < amount) {
      return jsonResponse({ success: false, message: "Solde insuffisant pour ce transfert." }, 400);
    }
    db.user.points = Number((db.user.points - amount).toFixed(2));
    saveDb();
    return jsonResponse({ success: true, points: db.user.points, message: `${amount} points transférés à ${recipient}.` });
  }

  // POST /api/matches/join - Join an open match & pay individual share
  if (method === 'POST' && pathname === '/api/matches/join') {
    const body = await parseJsonBody();
    const match = db.matches.find(m => m.id === body.matchId);
    if (!match) {
      return jsonResponse({ success: false, message: "Match introuvable." }, 404);
    }
    if (db.user.points < match.pointsCost) {
      return jsonResponse({ success: false, message: `Points insuffisants. Il vous faut ${match.pointsCost} points (1 DT = 1 Pt).` }, 400);
    }

    // Deduct player's individual share
    db.user.points = Number((db.user.points - match.pointsCost).toFixed(2));

    // Fill the slot
    if (match.openSlot) {
      if (match.openSlot.team === 1) {
        match.team1[match.openSlot.position - 1] = { name: db.user.name, level: db.user.level, avatar: "🎾" };
      } else {
        match.team2[match.openSlot.position - 1] = { name: db.user.name, level: db.user.level, avatar: "🎾" };
      }
      match.openSlot = null;
    }

    // Update linked club booking slots paid if any
    if (match.bookingId) {
      const bkg = db.clubBookings.find(b => b.id === match.bookingId);
      if (bkg) {
        bkg.slotsPaid = Math.min(4, (bkg.slotsPaid || 1) + 1);
        if (bkg.slotsPaid >= 4) {
          bkg.status = "confirmed";
        }
      }
    }

    // Add to user match history
    db.userMatchHistory.unshift({
      id: "hist_" + Date.now(),
      date: "Aujourd'hui",
      clubName: match.clubName,
      level: match.levelRange,
      team1: match.team1.map(p => p?.name || 'Joueur').join(' x '),
      team1Score: 0,
      team2: match.team2.map(p => p?.name || 'Joueur').join(' x '),
      team2Score: 0,
      result: "En attente"
    });

    saveDb();
    return jsonResponse({ success: true, match, userPoints: db.user.points, message: `Vous avez payé votre part (${match.pointsCost} DT / Pts) et rejoint le match !` });
  }

  // POST /api/matches/create - Create an open match
  if (method === 'POST' && pathname === '/api/matches/create') {
    const body = await parseJsonBody();
    const club = db.clubs.find(c => c.id === body.clubId) || db.clubs[0];
    const newMatch = {
      id: "match_" + Date.now(),
      clubId: club.id,
      clubName: club.name,
      distance: club.distance,
      date: body.date || "Aujourd'hui",
      time: body.time || "18:00 h - 19:30 h",
      duration: "90 min",
      type: "Match public",
      courtReserved: true,
      levelRange: body.levelRange || "4.5-5.5",
      pointsCost: Number(body.pointsCost) || 25.0,
      team1: [
        { name: db.user.name, level: db.user.level, avatar: "🎾" },
        null
      ],
      team2: [
        null,
        null
      ],
      openSlot: { team: 1, position: 2 }
    };
    db.matches.unshift(newMatch);
    saveDb();
    return jsonResponse({ success: true, match: newMatch, message: "Match public créé avec succès !" });
  }

  // POST /api/courts/book - Book a court slot (Individual share vs full private)
  if (method === 'POST' && pathname === '/api/courts/book') {
    const body = await parseJsonBody();
    const club = db.clubs.find(c => c.id === body.clubId) || db.clubs[0];
    const court = club.courts.find(crt => crt.id === body.courtId) || club.courts[0];
    const pricePerPlayer = Number(club.pricePoints) || 25.0; // 25 DT par joueur
    const isPrivateFull = body.type === 'Privée';
    const pointsRequired = isPrivateFull ? pricePerPlayer * 4 : pricePerPlayer;

    if (body.bookedBy === 'user' && db.user.points < pointsRequired) {
      return jsonResponse({
        success: false,
        message: `Points insuffisants. Il vous faut ${pointsRequired} pts (${isPrivateFull ? 'Terrain complet 100 DT' : 'Votre part 25 DT'}). Solde: ${db.user.points} pts.`
      }, 400);
    }

    if (body.bookedBy === 'user') {
      db.user.points = Number((db.user.points - pointsRequired).toFixed(2));
    }

    const bookingId = "bkg_" + Date.now();
    const newBooking = {
      id: bookingId,
      clubId: club.id,
      courtId: court.id,
      courtName: court.name,
      time: body.time || "17:00 - 18:30",
      clientName: body.clientName || db.user.name,
      phone: body.phone || db.user.phone,
      status: isPrivateFull ? "confirmed" : "open_match",
      points: pointsRequired,
      pricePerPlayer: pricePerPlayer,
      totalPrice: pricePerPlayer * 4,
      slotsPaid: isPrivateFull ? 4 : 1,
      slotsTotal: 4,
      type: body.type || "Partie Ouverte"
    };

    db.clubBookings.push(newBooking);

    // If it's an open match, create the public match in the feed so others can join and pay their share!
    if (!isPrivateFull) {
      const openMatch = {
        id: "match_" + Date.now(),
        bookingId: bookingId,
        clubId: club.id,
        clubName: club.name,
        courtId: court.id,
        courtName: court.name,
        distance: club.distance,
        date: "Aujourd'hui",
        time: body.time || "17:00 h - 18:30 h",
        duration: "90 min",
        type: "Match public",
        courtReserved: true,
        levelRange: `${(db.user.level - 0.5).toFixed(1)}-${(db.user.level + 0.5).toFixed(1)}`,
        pointsCost: pricePerPlayer, // Each player only pays their share!
        team1: [
          { name: db.user.name, level: db.user.level, avatar: "🎾" },
          null
        ],
        team2: [
          null,
          null
        ],
        openSlot: { team: 1, position: 2 }
      };
      db.matches.unshift(openMatch);
    }

    saveDb();
    return jsonResponse({
      success: true,
      booking: newBooking,
      userPoints: db.user.points,
      message: isPrivateFull
        ? `Court réservé et réglé en totalité (${pointsRequired} DT / Pts).`
        : `Court réservé ! Vous n'avez payé que votre part individuelle (${pointsRequired} DT / Pts). Les 3 autres places sont ouvertes sur HayaPala.`
    });
  }

  // ----------------------------------------------------------------
  // PADEL RATING ENGINE (Glicko-2 / Elo Model for YallaPlay & Playtomic)
  // ----------------------------------------------------------------
  function calculatePadelRatingUpdate({ playerLevel, playerReliability, partnerLevel, opponent1Level, opponent2Level, setsWon, setsLost }) {
    const teamAverage = (playerLevel + partnerLevel) / 2;
    const opponentAverage = (opponent1Level + opponent2Level) / 2;

    // Expected outcome: logistic probability curve based on level difference
    const exponent = (opponentAverage - teamAverage) / 0.85;
    const expectedTeamWinRate = 1 / (1 + Math.pow(10, exponent));

    // Actual outcome based on match result and sets (2-0, 2-1, 1-2, 0-2)
    let actualOutcome = 0;
    if (setsWon > setsLost) {
      actualOutcome = setsLost === 0 ? 1.0 : 0.85;
    } else {
      actualOutcome = setsWon === 0 ? 0.0 : 0.25;
    }

    // Dynamic K-factor: lower reliability leads to larger adjustments (high volatility)
    const reliabilityFraction = Math.max(0, Math.min(1, playerReliability / 100));
    const kFactor = 0.42 - (0.34 * reliabilityFraction);

    // Delta level change
    let delta = kFactor * (actualOutcome - expectedTeamWinRate);
    delta = Math.max(-0.45, Math.min(0.45, delta));

    const newLevel = Math.max(1.0, Math.min(8.0, Number((playerLevel + delta).toFixed(2))));
    const newReliability = Math.min(99.0, Number((playerReliability + (100 - playerReliability) * 0.035).toFixed(2)));

    return {
      newLevel,
      delta: Number(delta.toFixed(2)),
      newReliability,
      expectedWinRate: Number((expectedTeamWinRate * 100).toFixed(1)),
      teamAverage: Number(teamAverage.toFixed(2)),
      opponentAverage: Number(opponentAverage.toFixed(2))
    };
  }

  // POST /api/rating/simulate - Simulate rating calculation
  if (method === 'POST' && pathname === '/api/rating/simulate') {
    const body = await parseJsonBody();
    const result = calculatePadelRatingUpdate({
      playerLevel: Number(body.playerLevel) || db.user.level,
      playerReliability: Number(body.playerReliability) || db.user.levelReliability,
      partnerLevel: Number(body.partnerLevel) || 5.0,
      opponent1Level: Number(body.opponent1Level) || 5.2,
      opponent2Level: Number(body.opponent2Level) || 5.5,
      setsWon: Number(body.setsWon) || 2,
      setsLost: Number(body.setsLost) || 1
    });
    return jsonResponse({ success: true, simulation: result });
  }

  // POST /api/rating/record-result - Record match result & update player level
  if (method === 'POST' && pathname === '/api/rating/record-result') {
    const body = await parseJsonBody();
    const setsWon = Number(body.setsWon) || 2;
    const setsLost = Number(body.setsLost) || 1;
    const clubName = body.clubName || "Padel Connection";
    const partnerName = body.partnerName || "Ahmed Horrigue";
    const partnerLevel = Number(body.partnerLevel) || 5.00;
    const opp1Name = body.opp1Name || "Karim Arfaoui";
    const opp1Level = Number(body.opp1Level) || 5.20;
    const opp2Name = body.opp2Name || "Dhouib Med Amine";
    const opp2Level = Number(body.opp2Level) || 6.90;

    const calc = calculatePadelRatingUpdate({
      playerLevel: db.user.level,
      playerReliability: db.user.levelReliability,
      partnerLevel,
      opponent1Level: opp1Level,
      opponent2Level: opp2Level,
      setsWon,
      setsLost
    });

    const isWin = setsWon > setsLost;
    const oldLevel = db.user.level;
    const oldReliability = db.user.levelReliability;

    // Apply updates
    db.user.level = calc.newLevel;
    db.user.levelReliability = calc.newReliability;
    db.user.matchesPlayed += 1;

    // Add to history
    db.userMatchHistory.unshift({
      id: "hist_" + Date.now(),
      date: "Aujourd'hui",
      clubName: clubName,
      level: `${opp1Level.toFixed(1)}-${opp2Level.toFixed(1)}`,
      team1: `${opp1Name} x ${opp2Name}`,
      team1Score: setsLost,
      team2: `${db.user.name} x ${partnerName}`,
      team2Score: setsWon,
      result: isWin ? "G" : "P"
    });

    saveDb();

    return jsonResponse({
      success: true,
      calculation: calc,
      user: db.user,
      message: `Match enregistré ! Niveau: ${oldLevel} -> ${calc.newLevel} (${calc.delta >= 0 ? '+' : ''}${calc.delta}), Fiabilité: ${oldReliability}% -> ${calc.newReliability}%`
    });
  }

  // GET /api/players - List registered community players for duo matchmaking
  if (method === 'GET' && pathname === '/api/players') {
    const q = (parsedUrl.searchParams.get('q') || '').toLowerCase().trim();
    let players = (db.communityPlayers || []).slice();
    if (q) {
      players = players.filter(p => p.name.toLowerCase().includes(q) || (p.club && p.club.toLowerCase().includes(q)) || (p.city && p.city.toLowerCase().includes(q)));
    }
    return jsonResponse({ success: true, players });
  }

  // GET /api/teams - List all official duos sorted by ELO
  if (method === 'GET' && pathname === '/api/teams') {
    const teams = (db.officialTeams || []).slice().sort((a, b) => (b.eloRating || 0) - (a.eloRating || 0));
    return jsonResponse({ success: true, teams });
  }

  // POST /api/teams/create - Form official duo pair by selecting an existing registered player
  if (method === 'POST' && pathname === '/api/teams/create') {
    const body = await parseJsonBody();
    
    // Look up registered player in community database
    const partner = (db.communityPlayers || []).find(p => p.id === body.partnerId || p.name.toLowerCase() === (body.partnerName || '').toLowerCase()) 
      || (db.communityPlayers && db.communityPlayers[0])
      || { id: "usr_custom", name: body.partnerName || "Partenaire", level: 5.00, avatar: "👨", club: "Padel Connection" };

    const partnerName = partner.name;
    const partnerLevel = Number(partner.level) || 5.00;
    const partnerAvatar = partner.avatar || "👨";
    const teamName = body.teamName || `Team ${db.user.name} & ${partnerName}`;
    const club = body.homeClub || partner.club || "Padel Country Club";

    const initialElo = Math.round(1000 + ((db.user.level + partnerLevel) / 2) * 100);
    const newTeam = {
      id: "team_" + Date.now(),
      name: teamName,
      player1: { id: db.user.id, name: db.user.name, level: db.user.level, avatar: "🎾" },
      player2: { id: partner.id, name: partnerName, level: partnerLevel, avatar: partnerAvatar, club: partner.club },
      eloRating: initialElo,
      teamLevel: Number(((db.user.level + partnerLevel) / 2).toFixed(2)),
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      winRate: 100,
      badge: "✨ Nouveau Binôme",
      homeClub: club,
      streak: "-",
      isUserTeam: true
    };
    db.officialTeams = db.officialTeams || [];
    db.officialTeams.unshift(newTeam);
    saveDb();
    return jsonResponse({
      success: true,
      team: newTeam,
      partner: partner,
      message: `Paire officielle "${teamName}" construite avec succès avec ${partnerName} (Niveau certifié: ${partnerLevel}) ! ELO Initial: ${initialElo}`
    });
  }

  // POST /api/teams/challenge - Challenge an opposing duo
  if (method === 'POST' && pathname === '/api/teams/challenge') {
    const body = await parseJsonBody();
    const opponentTeam = (db.officialTeams || []).find(t => t.id === body.teamId);
    if (!opponentTeam) {
      return jsonResponse({ success: false, message: "Équipe introuvable." }, 404);
    }
    return jsonResponse({
      success: true,
      opponent: opponentTeam,
      message: `⚔️ Défi Officiel lancé contre "${opponentTeam.name}" ! Les 2 paires ont reçu la notification de confrontation.`
    });
  }

  // POST /api/admin/reset-demo - Reset data to initial state
  if (method === 'POST' && pathname === '/api/admin/reset-demo') {
    db = JSON.parse(JSON.stringify(INITIAL_DATA));
    saveDb();
    return jsonResponse({ success: true, message: "Données réinitialisées avec succès !" });
  }

  // ----------------------------------------------------------------
  // Static File Serving
  // ----------------------------------------------------------------
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') safePath = '/index.html';

  const filePath = path.join(PUBLIC_DIR, safePath);

  // If path exists and is file
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // Fallback to index.html for SPA routes
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(indexPath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
});

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 YallaPlay Platform is live at: http://localhost:${PORT}`);
  console.log(`- 📱 Espace Joueur Mobile (PWA & Web)`);
  console.log(`- 💻 Portail Back-Office Club (yallaplayapp.com replica)`);
  console.log(`======================================================\n`);
});
