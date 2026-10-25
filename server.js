import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

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

// PADEL RATING ENGINE (Glicko-2 / Elo Model with Peer Confrontation Reliability)
function calculatePadelRatingUpdate({ playerLevel, playerReliability = 50, partnerLevel = 5.0, opponent1Level = 5.0, opponent2Level = 5.0, setsWon = 2, setsLost = 1 }) {
  const teamAverage = (playerLevel + partnerLevel) / 2;
  const opponentAverage = (opponent1Level + opponent2Level) / 2;
  const levelGap = Math.abs(opponentAverage - playerLevel);
  // Une confrontation avec des joueurs de même niveau correspond à un écart <= 1.0 (tolérance Padel)
  const isPeerConfrontation = levelGap <= 1.0;

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

  // Dynamic K-factor: lower reliability leads to larger adjustments
  const currentRel = Math.max(10, Math.min(99, Number(playerReliability) || 50));
  const reliabilityFraction = currentRel / 100;
  const kFactor = 0.42 - (0.34 * reliabilityFraction);

  // Delta level change
  let delta = kFactor * (actualOutcome - expectedTeamWinRate);
  delta = Math.max(-0.45, Math.min(0.45, delta));

  const newLevel = Math.max(1.0, Math.min(10.0, Number((playerLevel + delta).toFixed(2))));

  // Fiabilité : validée et calibrée lors des confrontations avec des joueurs de même niveau (±1.0)
  let reliabilityGain = 0;
  if (isPeerConfrontation) {
    // Confrontation directe face à des pairs : fort étalonnage du niveau réel (+12% à +18%)
    const proximity = 1.0 - (levelGap / 1.0) * 0.35; // 1.0 si même niveau, 0.65 si écart de 1.0
    reliabilityGain = (100 - currentRel) * 0.22 * proximity;
  } else {
    // Écart de niveau trop grand : la confrontation n'étalonne pas le niveau réel du joueur
    reliabilityGain = (100 - currentRel) * 0.02;
  }

  const newReliability = Math.min(99.0, Number((currentRel + reliabilityGain).toFixed(1)));

  return {
    newLevel,
    delta: Number(delta.toFixed(2)),
    newReliability,
    isPeerConfrontation,
    reliabilityGain: Number(reliabilityGain.toFixed(1)),
    expectedWinRate: Number((expectedTeamWinRate * 100).toFixed(1)),
    teamAverage: Number(teamAverage.toFixed(2)),
    opponentAverage: Number(opponentAverage.toFixed(2)),
    levelGap: Number(levelGap.toFixed(2))
  };
}

const CP_DB_FILE = path.join(__dirname, 'data', 'circlepadel_db.json');

// SSE Connected Clients for Real-Time Collaborative Multi-Admin Synchronization
const sseClients = new Set();

function broadcastCirclePadelEvent(eventData) {
  const payload = `data: ${JSON.stringify(eventData)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (err) {
      sseClients.delete(client);
    }
  }
}

function getInitialCirclePadelDB() {
  return {
    appConfig: {
      clubName: 'CirclePadel Club',
      phone: '+216 22 227 041',
      email: 'contact@circlepadel.tn',
      address: 'La Marsa, Tunis',
      pricePeak: 25,
      priceOffPeak: 18,
      slotDurationMinutes: 90,
      matchmakingTolerance: 1,
      maxPlayersPerMatch: 4,
      alertBeforeMatchHours: 6
    },
    currentUser: {
      id: "user_moslem",
      firstName: "Moslem",
      lastName: "Gouia",
      email: "moslem.gouia@example.com",
      phone: "+216 22 227 041",
      role: "admin",
      status: "active",
      level: 5.0,
      reliabilityScore: 82,
      totalMatchesPlayed: 24,
      loyaltyPoints: 45
    },
    courts: [
      { id: 'court_1', name: 'Terrain 1', surface: 'Gazon synthétique bleu', isActive: true, amenities: ['Éclairage LED', 'Chauffage'] },
      { id: 'court_2', name: 'Terrain 2', surface: 'Gazon synthétique bleu', isActive: true, amenities: ['Éclairage LED'] },
      { id: 'court_3', name: 'Terrain 3', surface: 'Gazon synthétique vert', isActive: true, amenities: ['Éclairage LED', 'Chauffage'] },
      { id: 'court_4', name: 'Terrain 4', surface: 'Moquette indoor', isActive: true, amenities: ['Éclairage LED', 'Climatisation'] },
    ],
    players: [
      {
        id: "user_moslem",
        firstName: "Moslem",
        lastName: "Gouia",
        email: "moslem.gouia@example.com",
        phone: "+216 22 227 041",
        gender: "male",
        role: "admin",
        status: "active",
        level: 5.0,
        reliabilityScore: 82,
        totalMatchesPlayed: 24,
        peerConfrontationsCount: 24,
        preferredSide: "right",
        playStyle: "offensive",
        loyaltyPoints: 45,
        skills: { "bandeja": 7, "vibora": 5, "salida_cristal": 4, "volee": 7, "placement": 8, "regularite": 7, "mental": 8 }
      },
      {
        id: "T0LZnBNfJaS1pwrzWWOYj9a6Hko1",
        createdAt: "2026-10-24T01:00:36.199Z",
        email: "mounag@gmail.com",
        firstName: "Mouna",
        lastName: "Go",
        gender: "female",
        level: null,
        levelHistory: [],
        peerConfrontationsCount: 0,
        phone: "",
        playStyle: "all-around",
        preferredSide: "right",
        reliabilityScore: 50,
        role: "player",
        skills: {},
        status: "pending",
        totalMatchesPlayed: 0,
        loyaltyPoints: 10.5
      },
      {
        id: "test_player_1",
        level: null,
        firstName: "Karim",
        lastName: "Jlassi",
        gender: "male",
        playStyle: "offensive",
        totalMatchesPlayed: 0,
        peerConfrontationsCount: 0,
        levelHistory: [],
        skills: {},
        status: "pending",
        preferredSide: "right",
        phone: "98123456",
        reliabilityScore: 50,
        loyaltyPoints: 14.5,
        email: "karim.jlassi@circlepadel.tn"
      },
      {
        id: "usr_ahmed",
        level: 5.2,
        firstName: "Ahmed",
        lastName: "Horrigue",
        gender: "male",
        playStyle: "all-around",
        totalMatchesPlayed: 18,
        peerConfrontationsCount: 18,
        levelHistory: [],
        skills: {},
        status: "active",
        preferredSide: "right",
        phone: "97223344",
        reliabilityScore: 68,
        loyaltyPoints: 32,
        email: "ahmed.horrigue@circlepadel.tn"
      },
      {
        id: "usr_mariem",
        level: 4.8,
        firstName: "Mariem",
        lastName: "Snoussi",
        gender: "female",
        playStyle: "defensive",
        totalMatchesPlayed: 8,
        peerConfrontationsCount: 8,
        levelHistory: [],
        skills: {},
        status: "active",
        preferredSide: "right",
        phone: "22334455",
        reliabilityScore: 48,
        loyaltyPoints: 16,
        email: "mariem.snoussi@circlepadel.tn"
      },
      {
        id: "player_test_1792936967842",
        firstName: "Syrine",
        lastName: "Trabelsi",
        gender: "female",
        phone: "22111222",
        email: "syrine@test.com",
        status: "pending",
        loyaltyPoints: 0
      },
      {
        id: "usr_bilel",
        firstName: "Bilel",
        lastName: "Krima",
        gender: "male",
        level: 7.5,
        selfEstimatedLevel: 7,
        reliabilityScore: 84,
        totalMatchesPlayed: 28,
        peerConfrontationsCount: 28,
        status: "active",
        preferredSide: "left",
        playStyle: "offensive"
      }
    ],
    bookings: [],
    notifications: [],
    transactions: [],
    matchReviews: []
  };
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
  }

  // Parse JSON Body Helper
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
  // REST API: CIRCLEPADEL SHARED PERSISTENCE ACROSS SESSIONS
  // ----------------------------------------------------------------

  // GET /api/circlepadel/events - SSE Stream for Instant Real-Time Multi-Admin Collaborative Sync
  if (method === 'GET' && pathname === '/api/circlepadel/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // GET /api/circlepadel/db - Shared persistent database
  if (method === 'GET' && pathname === '/api/circlepadel/db') {
    try {
      if (!fs.existsSync(CP_DB_FILE)) {
        const initialData = getInitialCirclePadelDB();
        fs.writeFileSync(CP_DB_FILE, JSON.stringify(initialData, null, 2), 'utf-8');
        return jsonResponse(initialData);
      }
      const raw = fs.readFileSync(CP_DB_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (!Array.isArray(data.players)) {
        data.players = [];
      }
      return jsonResponse(data);
    } catch (err) {
      console.error('Error reading CP_DB_FILE:', err);
      const fallback = getInitialCirclePadelDB();
      return jsonResponse(fallback);
    }
  }

  // POST /api/circlepadel/db - Update and persist shared database with intelligent collaborative merge
  if (method === 'POST' && pathname === '/api/circlepadel/db') {
    try {
      const body = await parseJsonBody();
      if (body && typeof body === 'object') {
        let existing = getInitialCirclePadelDB();
        if (fs.existsSync(CP_DB_FILE)) {
          try {
            existing = JSON.parse(fs.readFileSync(CP_DB_FILE, 'utf-8'));
          } catch (e) {}
        }

        // 1. Authoritative Players Sync (supports additions, updates, and deletions)
        let mergedPlayers = Array.isArray(body.players) ? body.players : (existing.players || []);
        if (body.lastDeletedPlayerId) {
          mergedPlayers = mergedPlayers.filter(p => p && p.id !== body.lastDeletedPlayerId);
        }

        // 2. Merge Bookings
        const bookingMap = new Map();
        (existing.bookings || []).forEach(b => {
          if (b && b.id) bookingMap.set(b.id, b);
        });
        (body.bookings || []).forEach(b => {
          if (b && b.id) {
            const prev = bookingMap.get(b.id);
            bookingMap.set(b.id, prev ? { ...prev, ...b } : b);
          }
        });
        const mergedBookings = Array.from(bookingMap.values());

        const mergedDB = {
          ...existing,
          ...body,
          players: mergedPlayers,
          bookings: mergedBookings,
          updatedAt: new Date().toISOString()
        };

        fs.writeFileSync(CP_DB_FILE, JSON.stringify(mergedDB, null, 2), 'utf-8');

        // Broadcast real-time event to all connected admin and player sessions immediately
        broadcastCirclePadelEvent({
          type: 'db_updated',
          source: body.clientSource || 'admin',
          timestamp: Date.now(),
          playersCount: mergedPlayers.length
        });

        return jsonResponse({
          success: true,
          timestamp: Date.now(),
          playersCount: mergedPlayers.length
        });
      }
      return jsonResponse({ success: false, error: 'Invalid payload' }, 400);
    } catch (err) {
      console.error('Error writing CP_DB_FILE:', err);
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }

  // GET /api/state - Complete initial state from persistent database
  if (method === 'GET' && pathname === '/api/state') {
    const user = db.getUser();
    const clubs = db.getClubsWithCourts();
    const matches = db.findAll('matches');
    const userMatchHistory = db.findAll('user_match_history', h => h.userId === user.id || !h.userId);
    const tournaments = db.findAll('tournaments');
    const clubBookings = db.findAll('bookings');
    const officialTeams = db.findAll('official_teams');
    const communityPlayers = db.findAll('community_players');
    const transactions = db.findAll('transactions');

    return jsonResponse({
      user,
      clubs,
      matches,
      userMatchHistory,
      tournament: tournaments[0] || null,
      tournaments,
      clubBookings,
      officialTeams,
      communityPlayers,
      transactions
    });
  }

  // GET /api/user - User profile
  if (method === 'GET' && pathname === '/api/user') {
    return jsonResponse(db.getUser());
  }

  // POST /api/user/wallet/recharge - Recharge points (1 DT = 1 Point via CB, Flouci, D17)
  if (method === 'POST' && pathname === '/api/user/wallet/recharge') {
    const body = await parseJsonBody();
    const dtAmount = Number(body.amount) || 25;
    const methodChoice = body.paymentMethod || 'flouci';

    // Bonus policy: 100 DT gives +10 pts bonus, 250 DT gives +35 pts bonus
    let bonus = 0;
    if (dtAmount >= 250) bonus = 35;
    else if (dtAmount >= 100) bonus = 10;

    const totalPointsAdded = dtAmount + bonus;
    const user = db.getUser();
    const newPoints = Number((user.points + totalPointsAdded).toFixed(2));
    db.updateUser(user.id, { points: newPoints });

    const methodLabels = {
      'cb': 'Carte Bancaire (GNT / CMI)',
      'flouci': 'Flouci Mobile Pay',
      'd17': 'D17 (La Poste Tunisienne)',
      'cash': 'Paiement Espèces (Guichet Club)'
    };
    const paymentMethodLabel = methodLabels[methodChoice] || methodChoice;

    // Record persistent transaction
    db.insert('transactions', {
      userId: user.id,
      userName: user.name,
      type: "recharge",
      amount: dtAmount,
      points: totalPointsAdded,
      paymentMethod: paymentMethodLabel,
      status: "completed",
      description: `Recharge portefeuille +${totalPointsAdded} pts via ${paymentMethodLabel}`
    });

    return jsonResponse({
      success: true,
      points: newPoints,
      amountDT: dtAmount,
      pointsAdded: totalPointsAdded,
      paymentMethod: paymentMethodLabel,
      message: `Paiement de ${dtAmount} DT validé par ${paymentMethodLabel} ! +${totalPointsAdded} Points crédités sur votre compte.`
    });
  }

  // POST /api/user/wallet/transfer - Transfer points to a friend
  if (method === 'POST' && pathname === '/api/user/wallet/transfer') {
    const body = await parseJsonBody();
    const amount = Number(body.amount) || 10;
    const recipient = body.recipient || "Ami";
    const user = db.getUser();

    if (user.points < amount) {
      return jsonResponse({ success: false, message: "Solde insuffisant pour ce transfert." }, 400);
    }

    const newPoints = Number((user.points - amount).toFixed(2));
    db.updateUser(user.id, { points: newPoints });

    // Record persistent transaction
    db.insert('transactions', {
      userId: user.id,
      userName: user.name,
      type: "transfer_out",
      amount: amount,
      points: amount,
      paymentMethod: "Solde HayaPala",
      status: "completed",
      description: `Transfert de ${amount} points à ${recipient}`
    });

    return jsonResponse({ success: true, points: newPoints, message: `${amount} points transférés à ${recipient}.` });
  }

  // POST /api/matches/join - Join an open match & pay individual share
  if (method === 'POST' && pathname === '/api/matches/join') {
    const body = await parseJsonBody();
    const match = db.findById('matches', body.matchId);
    if (!match) {
      return jsonResponse({ success: false, message: "Match introuvable." }, 404);
    }

    const user = db.getUser();
    if (user.points < match.pointsCost) {
      return jsonResponse({ success: false, message: `Points insuffisants. Il vous faut ${match.pointsCost} points (1 DT = 1 Pt).` }, 400);
    }

    // Deduct player's individual share
    const newPoints = Number((user.points - match.pointsCost).toFixed(2));
    db.updateUser(user.id, { points: newPoints });

    // Fill the slot
    if (match.openSlot) {
      if (match.openSlot.team === 1) {
        match.team1[match.openSlot.position - 1] = { name: user.name, level: user.level, avatar: "🎾" };
      } else {
        match.team2[match.openSlot.position - 1] = { name: user.name, level: user.level, avatar: "🎾" };
      }
      match.openSlot = null;
    }
    db.update('matches', match.id, { team1: match.team1, team2: match.team2, openSlot: match.openSlot });

    // Update linked club booking slots paid if any
    if (match.bookingId) {
      const bkg = db.findById('bookings', match.bookingId);
      if (bkg) {
        const slotsPaid = Math.min(4, (bkg.slotsPaid || 1) + 1);
        const status = slotsPaid >= 4 ? "confirmed" : bkg.status;
        db.update('bookings', bkg.id, { slotsPaid, status });
      }
    }

    // Record transaction
    db.insert('transactions', {
      userId: user.id,
      userName: user.name,
      type: "match_share",
      amount: match.pointsCost,
      points: match.pointsCost,
      paymentMethod: "Solde HayaPala",
      status: "completed",
      description: `Part individuelle Match Padel - ${match.clubName}`
    });

    // Add to user match history
    db.insert('user_match_history', {
      userId: user.id,
      date: "Aujourd'hui",
      clubName: match.clubName,
      level: match.levelRange,
      team1: match.team1.map(p => p?.name || 'Joueur').join(' x '),
      team1Score: 0,
      team2: match.team2.map(p => p?.name || 'Joueur').join(' x '),
      team2Score: 0,
      result: "En attente"
    });

    return jsonResponse({ success: true, match, userPoints: newPoints, message: `Vous avez payé votre part (${match.pointsCost} DT / Pts) et rejoint le match !` });
  }

  // POST /api/matches/create - Create an open match
  if (method === 'POST' && pathname === '/api/matches/create') {
    const body = await parseJsonBody();
    const clubs = db.findAll('clubs');
    const club = clubs.find(c => c.id === body.clubId) || clubs[0];
    const user = db.getUser();

    const newMatch = db.insert('matches', {
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
        { name: user.name, level: user.level, avatar: "🎾" },
        null
      ],
      team2: [
        null,
        null
      ],
      openSlot: { team: 1, position: 2 },
      status: "open"
    });

    return jsonResponse({ success: true, match: newMatch, message: "Match public créé avec succès !" });
  }

  // POST /api/courts/book - Book a court slot (Individual share vs full private)
  if (method === 'POST' && pathname === '/api/courts/book') {
    const body = await parseJsonBody();
    const clubs = db.findAll('clubs');
    const club = clubs.find(c => c.id === body.clubId) || clubs[0];
    const courts = db.findAll('courts', c => c.clubId === club.id);
    const court = courts.find(crt => crt.id === body.courtId) || courts[0] || { id: "court_gen", name: "Court Central" };

    const pricePerPlayer = Number(club.pricePoints) || 25.0;
    const isPrivateFull = body.type === 'Privée';
    const pointsRequired = isPrivateFull ? pricePerPlayer * 4 : pricePerPlayer;
    const user = db.getUser();

    if (body.bookedBy === 'user' && user.points < pointsRequired) {
      return jsonResponse({
        success: false,
        message: `Points insuffisants. Il vous faut ${pointsRequired} pts (${isPrivateFull ? 'Terrain complet 100 DT' : 'Votre part 25 DT'}). Solde: ${user.points} pts.`
      }, 400);
    }

    if (body.bookedBy === 'user') {
      const newPts = Number((user.points - pointsRequired).toFixed(2));
      db.updateUser(user.id, { points: newPts });

      db.insert('transactions', {
        userId: user.id,
        userName: user.name,
        type: "booking_pay",
        amount: pointsRequired,
        points: pointsRequired,
        paymentMethod: "Solde HayaPala",
        status: "completed",
        description: `Réservation ${court.name} (${body.time || '17:00 - 18:30'})`
      });
    }

    const newBooking = db.insert('bookings', {
      clubId: club.id,
      courtId: court.id,
      courtName: court.name,
      time: body.time || "17:00 - 18:30",
      date: body.date || "Aujourd'hui",
      clientName: body.clientName || user.name,
      phone: body.phone || user.phone,
      status: isPrivateFull ? "confirmed" : "open_match",
      points: pointsRequired,
      pricePerPlayer: pricePerPlayer,
      totalPrice: pricePerPlayer * 4,
      slotsPaid: isPrivateFull ? 4 : 1,
      slotsTotal: 4,
      type: body.type || "Partie Ouverte"
    });

    // If open match, also create public match lobby
    if (!isPrivateFull) {
      db.insert('matches', {
        bookingId: newBooking.id,
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
        levelRange: `${(user.level - 0.5).toFixed(1)}-${(user.level + 0.5).toFixed(1)}`,
        pointsCost: pricePerPlayer,
        team1: [
          { name: user.name, level: user.level, avatar: "🎾" },
          null
        ],
        team2: [
          null,
          null
        ],
        openSlot: { team: 1, position: 2 },
        status: "open"
      });
    }

    return jsonResponse({
      success: true,
      booking: newBooking,
      userPoints: db.getUser().points,
      message: isPrivateFull
        ? `Court réservé et réglé en totalité (${pointsRequired} DT / Pts).`
        : `Court réservé ! Vous n'avez payé que votre part individuelle (${pointsRequired} DT / Pts). Les 3 autres places sont ouvertes sur HayaPala.`
    });
  }

  // POST /api/rating/simulate
  if (method === 'POST' && pathname === '/api/rating/simulate') {
    const body = await parseJsonBody();
    const user = db.getUser();
    const result = calculatePadelRatingUpdate({
      playerLevel: Number(body.playerLevel) || user.level,
      playerReliability: Number(body.playerReliability) || user.levelReliability,
      partnerLevel: Number(body.partnerLevel) || 5.0,
      opponent1Level: Number(body.opponent1Level) || 5.2,
      opponent2Level: Number(body.opponent2Level) || 5.5,
      setsWon: Number(body.setsWon) || 2,
      setsLost: Number(body.setsLost) || 1
    });
    return jsonResponse({ success: true, simulation: result });
  }

  // POST /api/rating/record-result
  if (method === 'POST' && pathname === '/api/rating/record-result') {
    const body = await parseJsonBody();
    const user = db.getUser();
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
      playerLevel: user.level,
      playerReliability: user.levelReliability,
      partnerLevel,
      opponent1Level: opp1Level,
      opponent2Level: opp2Level,
      setsWon,
      setsLost
    });

    const isWin = setsWon > setsLost;
    const oldLevel = user.level;
    const oldReliability = user.levelReliability;

    db.updateUser(user.id, {
      level: calc.newLevel,
      levelReliability: calc.newReliability,
      matchesPlayed: user.matchesPlayed + 1
    });

    db.insert('user_match_history', {
      userId: user.id,
      date: "Aujourd'hui",
      clubName: clubName,
      level: `${opp1Level.toFixed(1)}-${opp2Level.toFixed(1)}`,
      team1: `${opp1Name} x ${opp2Name}`,
      team1Score: setsLost,
      team2: `${user.name} x ${partnerName}`,
      team2Score: setsWon,
      result: isWin ? "G" : "P"
    });

    return jsonResponse({
      success: true,
      calculation: calc,
      user: db.getUser(),
      message: `Match enregistré ! Niveau: ${oldLevel} -> ${calc.newLevel} (${calc.delta >= 0 ? '+' : ''}${calc.delta}), Fiabilité: ${oldReliability}% -> ${calc.newReliability}%`
    });
  }

  // GET /api/players
  if (method === 'GET' && pathname === '/api/players') {
    const q = (parsedUrl.searchParams.get('q') || '').toLowerCase().trim();
    let players = db.findAll('community_players');
    if (q) {
      players = players.filter(p => p.name.toLowerCase().includes(q) || (p.club && p.club.toLowerCase().includes(q)) || (p.city && p.city.toLowerCase().includes(q)));
    }
    return jsonResponse({ success: true, players });
  }

  // GET /api/teams
  if (method === 'GET' && pathname === '/api/teams') {
    const teams = db.findAll('official_teams').sort((a, b) => (b.eloRating || 0) - (a.eloRating || 0));
    return jsonResponse({ success: true, teams });
  }

  // POST /api/teams/create
  if (method === 'POST' && pathname === '/api/teams/create') {
    const body = await parseJsonBody();
    const user = db.getUser();
    const players = db.findAll('community_players');
    const partner = players.find(p => p.id === body.partnerId || p.name.toLowerCase() === (body.partnerName || '').toLowerCase())
      || players[0]
      || { id: "usr_custom", name: body.partnerName || "Partenaire", level: 5.00, avatar: "👨", club: "Padel Connection" };

    const partnerName = partner.name;
    const partnerLevel = Number(partner.level) || 5.00;
    const partnerAvatar = partner.avatar || "👨";
    const teamName = body.teamName || `Team ${user.name} & ${partnerName}`;
    const club = body.homeClub || partner.club || "Padel Country Club";

    const initialElo = Math.round(1000 + ((user.level + partnerLevel) / 2) * 100);
    const newTeam = db.insert('official_teams', {
      name: teamName,
      player1: { id: user.id, name: user.name, level: user.level, avatar: "🎾" },
      player2: { id: partner.id, name: partnerName, level: partnerLevel, avatar: partnerAvatar, club: partner.club },
      eloRating: initialElo,
      teamLevel: Number(((user.level + partnerLevel) / 2).toFixed(2)),
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      winRate: 100,
      badge: "✨ Nouveau Binôme",
      homeClub: club,
      streak: "-",
      isUserTeam: true
    });

    return jsonResponse({
      success: true,
      team: newTeam,
      partner: partner,
      message: `Paire officielle "${teamName}" construite avec succès avec ${partnerName} (Niveau certifié: ${partnerLevel}) ! ELO Initial: ${initialElo}`
    });
  }

  // POST /api/teams/challenge
  if (method === 'POST' && pathname === '/api/teams/challenge') {
    const body = await parseJsonBody();
    const opponentTeam = db.findById('official_teams', body.teamId);
    if (!opponentTeam) {
      return jsonResponse({ success: false, message: "Équipe introuvable." }, 404);
    }
    return jsonResponse({
      success: true,
      opponent: opponentTeam,
      message: `⚔️ Défi Officiel lancé contre "${opponentTeam.name}" ! Les 2 paires ont reçu la notification de confrontation.`
    });
  }

  // POST /api/tournaments/join
  if (method === 'POST' && pathname === '/api/tournaments/join') {
    const body = await parseJsonBody();
    const user = db.getUser();
    const tourn = db.findById('tournaments', body.tournamentId) || db.findAll('tournaments')[0];
    if (!tourn) {
      return jsonResponse({ success: false, message: "Tournoi introuvable." }, 404);
    }
    tourn.participants = tourn.participants || [];
    if (!tourn.participants.some(p => p.name === user.name)) {
      tourn.participants.push({ name: user.name, level: user.level, avatar: "🎾" });
      db.update('tournaments', tourn.id, { participants: tourn.participants });
    }
    return jsonResponse({ success: true, tournament: tourn, message: `Inscription au tournoi "${tourn.title}" confirmée !` });
  }

  // ----------------------------------------------------------------
  // REST API: COMPLETE ADMIN MANAGEMENT & BACK-OFFICE ROUTES
  // ----------------------------------------------------------------

  // GET /api/admin/stats - KPI Metrics for Admin Dashboard
  if (method === 'GET' && pathname === '/api/admin/stats') {
    const clubId = parsedUrl.searchParams.get('clubId');
    const stats = db.getAdminStats(clubId);
    return jsonResponse({ success: true, stats });
  }

  // GET /api/admin/bookings - List bookings with filters
  if (method === 'GET' && pathname === '/api/admin/bookings') {
    const clubId = parsedUrl.searchParams.get('clubId');
    const bookings = clubId ? db.findAll('bookings', b => b.clubId === clubId) : db.findAll('bookings');
    return jsonResponse({ success: true, bookings });
  }

  // POST /api/admin/bookings - Direct admin booking creation (walk-in/phone)
  if (method === 'POST' && pathname === '/api/admin/bookings') {
    const body = await parseJsonBody();
    const clubs = db.findAll('clubs');
    const club = clubs.find(c => c.id === body.clubId) || clubs[0];
    const courts = db.findAll('courts', c => c.clubId === club.id);
    const court = courts.find(crt => crt.id === body.courtId) || courts[0] || { id: "court_1", name: "Court 1" };

    const pricePerPlayer = Number(body.pricePerPlayer) || Number(club.pricePoints) || 25;
    const isPrivate = body.type === 'Privée';
    const slotsPaid = isPrivate ? 4 : (Number(body.slotsPaid) || 1);

    const booking = db.insert('bookings', {
      clubId: club.id,
      courtId: court.id,
      courtName: court.name,
      time: body.time || "17:00 - 18:30",
      date: body.date || "Aujourd'hui",
      clientName: body.clientName || "Client Guichet",
      phone: body.phone || "+216 00 000 000",
      status: slotsPaid >= 4 ? "confirmed" : "open_match",
      points: slotsPaid * pricePerPlayer,
      pricePerPlayer: pricePerPlayer,
      totalPrice: pricePerPlayer * 4,
      slotsPaid: slotsPaid,
      slotsTotal: 4,
      type: body.type || (isPrivate ? "Privée" : "Partie Ouverte")
    });

    db.insert('transactions', {
      userId: "admin_booking",
      userName: booking.clientName,
      type: "admin_booking",
      amount: slotsPaid * pricePerPlayer,
      points: slotsPaid * pricePerPlayer,
      paymentMethod: body.paymentMethod || "Paiement Guichet",
      status: "completed",
      description: `Réservation Directe Admin: ${court.name} (${booking.time})`
    });

    return jsonResponse({ success: true, booking, message: "Réservation enregistrée sur le planning club !" });
  }

  // PUT /api/admin/bookings/:id - Update booking
  if (method === 'PUT' && pathname.startsWith('/api/admin/bookings/')) {
    const bookingId = pathname.replace('/api/admin/bookings/', '');
    const body = await parseJsonBody();
    const updated = db.update('bookings', bookingId, body);
    if (!updated) return jsonResponse({ success: false, message: "Réservation introuvable." }, 404);
    return jsonResponse({ success: true, booking: updated, message: "Réservation mise à jour avec succès." });
  }

  // DELETE /api/admin/bookings/:id - Cancel/Delete booking
  if (method === 'DELETE' && pathname.startsWith('/api/admin/bookings/')) {
    const bookingId = pathname.replace('/api/admin/bookings/', '');
    const deleted = db.delete('bookings', bookingId);
    if (!deleted) return jsonResponse({ success: false, message: "Réservation introuvable." }, 404);
    return jsonResponse({ success: true, message: "Réservation annulée et créneau libéré." });
  }

  // GET /api/admin/clubs - List all clubs
  if (method === 'GET' && pathname === '/api/admin/clubs') {
    return jsonResponse({ success: true, clubs: db.getClubsWithCourts() });
  }

  // POST /api/admin/clubs - Create new club
  if (method === 'POST' && pathname === '/api/admin/clubs') {
    const body = await parseJsonBody();
    const newClub = db.insert('clubs', {
      name: body.name || "Nouveau Club Padel",
      sport: "Padel",
      address: body.address || "Tunis",
      schedule: body.schedule || "07:00 - 00:00",
      distance: body.distance || "1.5 km",
      logoBadge: body.logoBadge || (body.name ? body.name.split(' ').map(w => w[0]).join('').slice(0, 3).toUpperCase() : 'HPC'),
      logoColor: "#111827",
      logoTextColor: "#CCFF00",
      isFavorite: true,
      courtsCount: 0,
      indoorCourts: 0,
      outdoorCourts: 0,
      pricePoints: Number(body.pricePoints) || 25.0,
      phone: body.phone || "+216 22 000 000",
      email: body.email || "contact@club.tn"
    });

    db.insert('club_settings', {
      clubId: newClub.id,
      name: newClub.name,
      address: newClub.address,
      phone: newClub.phone,
      email: newClub.email,
      openTime: "07:00",
      closeTime: "00:00",
      defaultSlotMinutes: 90,
      pricePerPlayer: newClub.pricePoints
    });

    return jsonResponse({ success: true, club: newClub, message: `Club "${newClub.name}" créé avec succès !` });
  }

  // DELETE /api/admin/clubs/:id - Delete club
  if (method === 'DELETE' && pathname.startsWith('/api/admin/clubs/')) {
    const clubId = pathname.replace('/api/admin/clubs/', '');
    db.delete('clubs', clubId);
    const courts = db.findAll('courts', c => c.clubId === clubId);
    courts.forEach(crt => db.delete('courts', crt.id));
    return jsonResponse({ success: true, message: "Club et ses terrains supprimés." });
  }

  // POST /api/admin/players - Register new community member
  if (method === 'POST' && pathname === '/api/admin/players') {
    const body = await parseJsonBody();
    const newPlayer = db.insert('community_players', {
      name: body.name || "Nouveau Joueur",
      level: Number(body.level) || 5.00,
      reliability: Number(body.reliability) || 50.0,
      avatar: body.avatar || "🎾",
      club: body.club || "Club Padel",
      city: body.city || "Tunis",
      phone: body.phone || "+216 00 000 000",
      matches: 0,
      points: Number(body.points) || 0.0
    });
    return jsonResponse({ success: true, player: newPlayer, message: `Membre "${newPlayer.name}" inscrit avec succès !` });
  }

  // GET /api/admin/courts - List courts
  if (method === 'GET' && pathname === '/api/admin/courts') {
    const clubId = parsedUrl.searchParams.get('clubId');
    const courts = clubId ? db.findAll('courts', c => c.clubId === clubId) : db.findAll('courts');
    return jsonResponse({ success: true, courts });
  }

  // POST /api/admin/courts - Add new court
  if (method === 'POST' && pathname === '/api/admin/courts') {
    const body = await parseJsonBody();
    const newCourt = db.insert('courts', {
      clubId: body.clubId || 'club_connection',
      name: body.name || `Court ${Date.now().toString().slice(-3)}`,
      type: body.type || 'Indoor',
      surface: body.surface || 'Mondo Supercourt',
      status: body.status || 'active',
      price: Number(body.price) || 25.0
    });

    // Update club's court counts
    const clubCourts = db.findAll('courts', c => c.clubId === newCourt.clubId);
    db.update('clubs', newCourt.clubId, { courtsCount: clubCourts.length });

    return jsonResponse({ success: true, court: newCourt, message: `Court "${newCourt.name}" ajouté avec succès au club !` });
  }

  // PUT /api/admin/courts/:id - Update court (status, surface, name, price)
  if (method === 'PUT' && pathname.startsWith('/api/admin/courts/')) {
    const courtId = pathname.replace('/api/admin/courts/', '');
    const body = await parseJsonBody();
    const updated = db.update('courts', courtId, body);
    if (!updated) return jsonResponse({ success: false, message: "Court introuvable." }, 404);
    return jsonResponse({ success: true, court: updated, message: `Court "${updated.name}" mis à jour.` });
  }

  // DELETE /api/admin/courts/:id - Delete court
  if (method === 'DELETE' && pathname.startsWith('/api/admin/courts/')) {
    const courtId = pathname.replace('/api/admin/courts/', '');
    const court = db.findById('courts', courtId);
    if (!court) return jsonResponse({ success: false, message: "Court introuvable." }, 404);
    db.delete('courts', courtId);
    return jsonResponse({ success: true, message: "Court supprimé de l'infrastructure." });
  }

  // GET /api/admin/tournaments
  if (method === 'GET' && pathname === '/api/admin/tournaments') {
    return jsonResponse({ success: true, tournaments: db.findAll('tournaments') });
  }

  // POST /api/admin/tournaments - Create tournament
  if (method === 'POST' && pathname === '/api/admin/tournaments') {
    const body = await parseJsonBody();
    const clubs = db.findAll('clubs');
    const club = clubs.find(c => c.id === body.clubId) || clubs[0];

    const newTourn = db.insert('tournaments', {
      title: body.title || "Tournoi Padel Open",
      badge: "Inscriptions Ouvertes",
      clubId: club.id,
      clubName: club.name,
      date: body.date || "Prochainement",
      format: body.format || "P250 Hommes",
      maxTeams: Number(body.maxTeams) || 16,
      entryFee: Number(body.entryFee) || 30.0,
      prizePool: Number(body.prizePool) || 1500,
      status: "open",
      participants: []
    });

    return jsonResponse({ success: true, tournament: newTourn, message: `Tournoi "${newTourn.title}" créé avec succès !` });
  }

  // PUT /api/admin/tournaments/:id - Update tournament status or details
  if (method === 'PUT' && pathname.startsWith('/api/admin/tournaments/')) {
    const tournId = pathname.replace('/api/admin/tournaments/', '');
    const body = await parseJsonBody();
    const updated = db.update('tournaments', tournId, body);
    if (!updated) return jsonResponse({ success: false, message: "Tournoi introuvable." }, 404);
    return jsonResponse({ success: true, tournament: updated, message: "Tournoi mis à jour." });
  }

  // GET /api/admin/players - Complete member directory with balance & stats (unified CirclePadel DB)
  if (method === 'GET' && pathname === '/api/admin/players') {
    let cpPlayers = [];
    try {
      if (fs.existsSync(CP_DB_FILE)) {
        const raw = fs.readFileSync(CP_DB_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.players)) cpPlayers = parsed.players;
      }
    } catch (e) {}

    const all = cpPlayers.map(p => ({
      id: p.id,
      name: `${p.firstName || ''} ${p.lastName || ''}`.trim() || p.name || 'Membre',
      firstName: p.firstName || '',
      lastName: p.lastName || '',
      level: p.level || p.selfEstimatedLevel || 5.0,
      reliability: p.reliabilityScore || 50,
      gender: p.gender || 'male',
      avatar: p.gender === 'female' ? '👩' : '👨',
      phone: p.phone || '',
      email: p.email || '',
      matches: p.totalMatchesPlayed || 0,
      points: p.loyaltyPoints || 0,
      status: p.status || 'active',
      role: p.role || 'player'
    }));
    return jsonResponse({ success: true, players: all });
  }

  // POST /api/admin/players/adjust-points - Credit or debit player points at desk
  if (method === 'POST' && pathname === '/api/admin/players/adjust-points') {
    const body = await parseJsonBody();
    const playerId = body.playerId;
    const amount = Number(body.amount) || 0;
    const reason = body.reason || "Ajustement guichet club";

    if (playerId === "user_moslem") {
      const u = db.getUser();
      const newPts = Math.max(0, Number((u.points + amount).toFixed(2)));
      db.updateUser(u.id, { points: newPts });
      db.insert('transactions', {
        userId: u.id,
        userName: u.name,
        type: amount >= 0 ? "admin_credit" : "admin_debit",
        amount: Math.abs(amount),
        points: Math.abs(amount),
        paymentMethod: "Régie Club",
        status: "completed",
        description: reason
      });
      return jsonResponse({ success: true, newPoints: newPts, message: `Solde mis à jour : ${newPts} pts (${amount >= 0 ? '+' : ''}${amount} pts).` });
    } else {
      const p = db.findById('community_players', playerId);
      if (!p) return jsonResponse({ success: false, message: "Joueur introuvable." }, 404);
      const newPts = Math.max(0, Number(((p.points || 0) + amount).toFixed(2)));
      db.update('community_players', p.id, { points: newPts });
      db.insert('transactions', {
        userId: p.id,
        userName: p.name,
        type: amount >= 0 ? "admin_credit" : "admin_debit",
        amount: Math.abs(amount),
        points: Math.abs(amount),
        paymentMethod: "Régie Club",
        status: "completed",
        description: reason
      });
      return jsonResponse({ success: true, newPoints: newPts, message: `Solde de ${p.name} ajusté : ${newPts} pts.` });
    }
  }

  // POST /api/admin/players/adjust-level - Update player certified rating
  if (method === 'POST' && pathname === '/api/admin/players/adjust-level') {
    const body = await parseJsonBody();
    const playerId = body.playerId;
    const newLevel = Number(body.level);
    if (!newLevel || newLevel < 1 || newLevel > 8) {
      return jsonResponse({ success: false, message: "Niveau invalide (doit être compris entre 1.00 et 8.00)." }, 400);
    }

    if (playerId === "user_moslem") {
      db.updateUser(playerId, { level: newLevel });
      return jsonResponse({ success: true, level: newLevel, message: `Niveau certifié de Moslem Gouia mis à jour à ${newLevel}.` });
    } else {
      const p = db.findById('community_players', playerId);
      if (!p) return jsonResponse({ success: false, message: "Joueur introuvable." }, 404);
      db.update('community_players', p.id, { level: newLevel });
      return jsonResponse({ success: true, level: newLevel, message: `Niveau de ${p.name} certifié à ${newLevel}.` });
    }
  }

  // GET /api/admin/transactions - Transaction audit log
  if (method === 'GET' && pathname === '/api/admin/transactions') {
    const transactions = db.findAll('transactions');
    return jsonResponse({ success: true, transactions });
  }

  // GET /api/admin/settings - Club settings
  if (method === 'GET' && pathname === '/api/admin/settings') {
    const clubId = parsedUrl.searchParams.get('clubId') || 'club_connection';
    const settings = db.findById('club_settings', clubId) || db.findAll('club_settings')[0];
    return jsonResponse({ success: true, settings });
  }

  // PUT /api/admin/settings - Update club settings
  if (method === 'PUT' && pathname === '/api/admin/settings') {
    const body = await parseJsonBody();
    const clubId = body.clubId || 'club_connection';
    const updated = db.update('club_settings', clubId, body);
    return jsonResponse({ success: true, settings: updated, message: "Paramètres du club enregistrés." });
  }

  // POST /api/admin/reset-demo - Reset data to initial seed
  if (method === 'POST' && pathname === '/api/admin/reset-demo') {
    db.reset();
    return jsonResponse({ success: true, message: "Base de données réinitialisée aux données officielles !" });
  }

  // ----------------------------------------------------------------
  // Static File Serving & Clean Routing
  // ----------------------------------------------------------------
  let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  
  // Specific routes mapping to index.html
  if (safePath === '/' || safePath === '\\' || safePath === '/admin' || safePath === '/app' || safePath === '/dashboard') {
    safePath = '/index.html';
  }

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
  console.log(`🚀 HayaPala Platform is live at: http://localhost:${PORT}`);
  console.log(`- 📱 Real Mobile Player Web App: http://localhost:${PORT}/`);
  console.log(`- ⚡ Club Pro Administration Portal: http://localhost:${PORT}/admin`);
  console.log(`- 💾 Persistent Database: ./data/hayapala.json & schema.sql`);
  console.log(`======================================================\n`);
});
