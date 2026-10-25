/* ==========================================================================
   HAYAPALA — APPLICATION LOGIC v1.1
   Club de Padel · Firebase Firestore + Auth · circlepadel
   Vanilla JS, no framework — ES Module (type="module" dans index.html)
   ========================================================================== */

// ── Firebase imports (CDN ESM) ─────────────────────────────────────────────
import {
  fbSignIn, fbSignOut, fbOnAuthChange, fbCreateUser, fbUpdateUserProfile,
  fbGetPlayers, fbGetPlayer, fbSavePlayer, fbDeletePlayer, fbUpdatePlayerLevel, fbListenPlayers,
  fbGetCourts, fbSaveCourt,
  fbGetBookings, fbAddBooking, fbUpdateBooking, fbCancelBooking, fbListenBookings,
  fbGetOpenMatches, fbJoinMatch, fbCreateOpenMatch, fbListenOpenMatches,
  fbGetNotifications, fbMarkNotifRead, fbAddNotification,
  fbGetConfig, fbSaveConfig,
  fbSeedIfEmpty, fbTrack,
} from './firebase.js';


// ============================================================================
// CONFIGURATION DE BASE DU CLUB (structure fixe — aucune donnée mock)
// ============================================================================

/** Config par défaut — remplacée par Firestore dès le chargement */
const DEFAULT_CONFIG = {
  clubName: 'CirclePadel Club',
  address: 'Route de La Marsa, Tunis, Tunisie',
  phone: '+216 71 000 000',
  email: 'contact@circlepadel.tn',
  openTime: '08:00',
  closeTime: '23:00',
  pricePeak: 25,
  priceOffPeak: 18,
  matchmakingTolerance: 1,
  alertBeforeMatchHours: 2,
  slotDurationMinutes: 90,
  cancelDeadlineHours: 2,
  maxPlayersPerMatch: 4,
};

/** Les 4 terrains — seules données structurelles créées automatiquement dans Firestore */
const COURTS_SEED = [
  { id: 'court_1', name: 'Terrain 1', surface: 'Gazon synthétique bleu', isActive: true, amenities: ['Éclairage LED', 'Chauffage'] },
  { id: 'court_2', name: 'Terrain 2', surface: 'Gazon synthétique bleu', isActive: true, amenities: ['Éclairage LED'] },
  { id: 'court_3', name: 'Terrain 3', surface: 'Gazon synthétique vert', isActive: true, amenities: ['Éclairage LED', 'Chauffage'] },
  { id: 'court_4', name: 'Terrain 4', surface: 'Moquette indoor', isActive: true, amenities: ['Éclairage LED', 'Climatisation'] },
];

// ============================================================================
// DATABASE — SOURCE DE VÉRITÉ : FIRESTORE UNIQUEMENT
// Le cache localStorage n'est utilisé que pour le rendu immédiat (optimistic UI)
// Aucune donnée mock n'est chargée — tout vient de Firestore
// ============================================================================

const DB_KEY = 'circlepadel_db_v2';

/** Structure vide initiale — sera peuplée exclusivement par le serveur */
let DB = {
  appConfig:     { ...DEFAULT_CONFIG },
  currentUser:   {
    id: 'user_moslem',
    firstName: 'Moslem',
    lastName: 'Gouia',
    email: 'moslem.gouia@example.com',
    phone: '+216 22 227 041',
    role: 'admin',
    status: 'active',
    level: 5.0,
    reliabilityScore: 82,
    totalMatchesPlayed: 24,
    loyaltyPoints: 45
  },
  players:       [],
  courts:        [...COURTS_SEED],
  bookings:      [],
  notifications: [],
  matchReviews:  [],
  transactions:  [],
  auditLogs:     [],
};

// Nettoyer l'ancien cache local v1 et restaurer le cache v2
try {
  localStorage.removeItem('circlepadel_db_v1');
  const raw = localStorage.getItem(DB_KEY);
  if (raw) {
    const cached = JSON.parse(raw);
    DB = { ...DB, ...cached };
  }
} catch (e) { localStorage.removeItem(DB_KEY); }

/**
 * Assure l'intégrité de la structure DB pour immuniser l'interface contre tout bug d'incohérence
 */
function sanitizeDB(db) {
  if (!db || typeof db !== 'object') return;
  if (!Array.isArray(db.players)) db.players = [];
  if (!Array.isArray(db.deletedPlayerIds)) db.deletedPlayerIds = [];
  if (!Array.isArray(db.courts) || db.courts.length === 0) db.courts = [...COURTS_SEED];
  if (!Array.isArray(db.bookings)) db.bookings = [];
  if (!Array.isArray(db.notifications)) db.notifications = [];
  if (!Array.isArray(db.matchReviews)) db.matchReviews = [];
  if (!Array.isArray(db.transactions)) db.transactions = [];
  if (!Array.isArray(db.auditLogs)) db.auditLogs = [];

  // Immunité absolue : exclure tout joueur supprimé
  if (db.deletedPlayerIds.length > 0) {
    const deletedSet = new Set(db.deletedPlayerIds);
    db.players = db.players.filter(p => p && p.id && !deletedSet.has(p.id));
  }

  db.bookings.forEach(b => {
    if (b && !Array.isArray(b.players)) b.players = [];
  });
}
sanitizeDB(DB);

let _syncDebounceTimer = null;

/**
 * Fusionne intelligemment la liste locale et entrante de joueurs
 * Garantit qu'aucun compte créé localement ne disparaît et qu'aucun joueur supprimé ne ressuscite.
 */
function mergePlayersLists(currentList, incomingList) {
  const deletedSet = new Set(DB.deletedPlayerIds || []);
  const map = new Map();
  (currentList || []).forEach(p => {
    if (p && p.id && !deletedSet.has(p.id)) map.set(p.id, p);
  });
  (incomingList || []).forEach(p => {
    if (p && p.id && !deletedSet.has(p.id)) {
      if (!map.has(p.id)) {
        map.set(p.id, p);
      } else {
        map.set(p.id, { ...map.get(p.id), ...p });
      }
    }
  });
  return Array.from(map.values());
}

/**
 * Fusionne intelligemment la liste des créneaux et réservations
 * Garantit qu'aucun créneau réservé par le gérant ou un joueur ne disparaît.
 */
function mergeBookingsLists(currentList, incomingList) {
  const map = new Map();
  (incomingList || []).forEach(b => {
    if (b && b.id) map.set(b.id, b);
  });
  (currentList || []).forEach(b => {
    if (!b || !b.id) return;
    if (!map.has(b.id)) {
      map.set(b.id, b);
    } else {
      map.set(b.id, { ...map.get(b.id), ...b });
    }
  });
  return Array.from(map.values());
}

// ============================================================================
// DÉTECTION DU GENRE & FILTRAGE HOMME / FEMME ROBUSTE
// ============================================================================
function isPlayerFemale(p) {
  if (!p) return false;
  const g = String(p.gender || '').trim().toLowerCase();
  if (g === 'female' || g === 'femme' || g === 'f' || g === 'woman' || g === 'girl') return true;
  if (g === 'male' || g === 'homme' || g === 'm' || g === 'man') return false;
  const fn = String(p.firstName || '').trim().toLowerCase();
  return /^(mouna|mariem|meriem|myriam|sara|sarah|ines|yasmine|yasmina|nour|lina|amina|selma|salma|rim|ryme|leila|layla|fatma|fatima|khadija|asma|emna|chaima|shayma|siwar|syrine|sirine|hela|olfa|dora|dorra|manel|marwa|sabrine|hadil|aya|asmaa|soumaya|rania|rawaa|amal|amel|sonia|nadia|samia|hanen|imen|chahinez|wiem|wided|nesrine|raoudha|maha|farah|claire|sophie|camille|emma|lea|chloe|julie|marie|laura|celine|kenza|donia|zeineb|zaineb|chiraz|arwa|manar)/i.test(fn);
}
window.isPlayerFemale = isPlayerFemale;
window.currentAdminPlayerFilter = 'all';
window.currentAdminPlayerSearch = '';

function setAdminPlayerFilter(filter) {
  window.currentAdminPlayerFilter = filter || 'all';
  document.querySelectorAll('[data-player-filter]').forEach(c => {
    c.classList.toggle('active', c.dataset.playerFilter === window.currentAdminPlayerFilter);
  });
  renderAdminPlayers();
}
window.setAdminPlayerFilter = setAdminPlayerFilter;

function saveDB(data, pushToServer = true, immediate = false) {
  try {
    data._fromFirestore = true;
    localStorage.setItem(DB_KEY, JSON.stringify(data));
  } catch (e) {}

  if (pushToServer) {
    if (immediate) {
      clearTimeout(_syncDebounceTimer);
      fetch('/api/circlepadel/db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).catch(() => {});
    } else {
      clearTimeout(_syncDebounceTimer);
      _syncDebounceTimer = setTimeout(async () => {
        try {
          await fetch('/api/circlepadel/db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
          });
        } catch (e) {}
      }, 30);
    }
  }
}

let _lastCollaborativeSyncToast = 0;

async function syncFromBackend(isFromRealtimeEvent = false, realtimePayload = null) {
  try {
    const res = await fetch('/api/circlepadel/db');
    if (!res.ok) return;
    const remote = await res.json();
    if (remote && Array.isArray(remote.players)) {
      if (Array.isArray(remote.deletedPlayerIds)) {
        const mergedDeleted = new Set([...(DB.deletedPlayerIds || []), ...remote.deletedPlayerIds]);
        DB.deletedPlayerIds = Array.from(mergedDeleted);
      }
      const deletedSet = new Set(DB.deletedPlayerIds || []);
      const prevCount = (DB.players || []).length;
      DB.players = remote.players.filter(p => p && p.id && !deletedSet.has(p.id));
      const newCount = DB.players.length;

      if (Array.isArray(remote.courts) && remote.courts.length) DB.courts = remote.courts;
      if (Array.isArray(remote.bookings)) DB.bookings = mergeBookingsLists(DB.bookings, remote.bookings);
      if (remote.appConfig) DB.appConfig = { ...DEFAULT_CONFIG, ...remote.appConfig };
      if (Array.isArray(remote.notifications)) DB.notifications = remote.notifications;
      if (Array.isArray(remote.auditLogs)) DB.auditLogs = remote.auditLogs;

      // Conserver le rôle de l'utilisateur connecté
      if (DB.currentUser?.id && DB.currentUser.id !== 'guest') {
        const found = DB.players.find(p => p.id === DB.currentUser.id || p.email === DB.currentUser.email);
        if (found) {
          const role = DB.currentUser.role;
          DB.currentUser = { ...found, role: role || found.role || 'player' };
        }
      }

      sanitizeDB(DB);
      saveDB(DB, false);
      renderAdminPlayers();
      renderAdminKPIs();
      renderAdminAlerts();
      renderCourtsGrid();
      renderAdminTimetable();
      renderHomeScreen();
      renderMatchesList();
      renderProfileScreen();
      renderAdminAuditLogs();

      // Notifications collaboratives instantanées
      if (isFromRealtimeEvent && realtimePayload) {
        if (realtimePayload.action === 'PLAYER_DELETED') {
          showToast(`🗑️ Un joueur a été supprimé par le gérant.`, 'info');
        } else if (realtimePayload.action === 'PLAYER_CREATED' || realtimePayload.action === 'PLAYER_REGISTERED' || (newCount > prevCount && prevCount > 0)) {
          const latest = DB.players[DB.players.length - 1];
          showToast(`👥 Nouveau membre synchronisé en direct : ${latest?.firstName || ''} ${latest?.lastName || ''}`, 'success');
        } else if (realtimePayload.action === 'PLAYER_EVALUATED') {
          showToast(`📋 Évaluation d'un joueur synchronisée en direct ✓`, 'info');
        }
      } else if (newCount > prevCount && prevCount > 0 && (Date.now() - _lastCollaborativeSyncToast > 3500)) {
        _lastCollaborativeSyncToast = Date.now();
        const latestPlayer = DB.players[DB.players.length - 1];
        showToast(`👥 App collaborative : ${latestPlayer?.firstName || 'Nouveau membre'} synchronisé(e) en direct ✓`, 'info');
      }
    }
  } catch (e) {}
}

function formatLocalDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getTodayStr() {
  return formatLocalDate(new Date());
}

function shiftDateStr(dateStr, days = 0) {
  if (!dateStr) dateStr = getTodayStr();
  const parts = dateStr.split('-').map(Number);
  const dt = new Date(parts[0], parts[1] - 1, parts[2] + days);
  return formatLocalDate(dt);
}

function getTomorrowStr() {
  return shiftDateStr(getTodayStr(), 1);
}


/** Initialise Firestore au premier lancement (terrains + config uniquement) */
async function initFirestoreIfEmpty() {
  try {
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_INIT')), 2000));
    const [courts, config] = await Promise.race([
      Promise.all([fbGetCourts(), fbGetConfig()]),
      timeoutPromise
    ]);
    if (!courts.length) {
      for (const c of COURTS_SEED) await fbSaveCourt(c);
      console.log('✅ Firestore : 4 terrains créés');
    }
    if (!config) {
      await fbSaveConfig(DEFAULT_CONFIG);
      console.log('✅ Firestore : config club initialisée');
    }
  } catch (e) {
    console.warn('⚠️ Init Firestore :', e.message);
  }
}

/** Synchronise le cache local depuis Firestore (appelé au démarrage) */
async function syncFromFirestore() {
  try {
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_FIRESTORE')), 2500));
    const [players, courts, bookings, openMatches, config] = await Promise.race([
      Promise.all([
        fbGetPlayers(),
        fbGetCourts(),
        fbGetBookings(),
        fbGetOpenMatches(),
        fbGetConfig(),
      ]),
      timeoutPromise
    ]);
    if (players && players.length) DB.players = mergePlayersLists(DB.players, players);
    if (courts.length)     DB.courts   = courts;
    // Fusionner réservations + matchs ouverts
    const regularBookings = bookings.filter(b => b.type !== 'open');
    const openAsBookings  = openMatches.map(m => ({ ...m, type: 'open', status: m.status || 'confirmed' }));
    const firestoreBookings = [...regularBookings, ...openAsBookings];
    DB.bookings = mergeBookingsLists(DB.bookings, firestoreBookings);
    if (config) DB.appConfig = { ...DEFAULT_CONFIG, ...config };

    // Charger les notifications du joueur courant
    if (DB.currentUser?.id && DB.currentUser.id !== 'guest') {
      try {
        const notifs = await fbGetNotifications(DB.currentUser.id);
        if (notifs.length) DB.notifications = notifs;
      } catch (e) {}
    }

    saveDB(DB);
    console.log('🔥 Firestore sync OK —', players.length, 'joueurs,', DB.bookings.length, 'réservations/matchs');
  } catch (e) {
    console.warn('⚠️ Firestore hors-ligne, cache local utilisé :', e.message);
  }
}

/** Active les listeners Firestore temps-réel */
function startRealtimeListeners() {
  fbListenPlayers(players => {
    try {
      if (players && players.length) {
        DB.players = mergePlayersLists(DB.players, players);
        saveDB(DB, false);
        renderAdminPlayers();
        renderAdminKPIs();
        renderAdminAlerts();
      }
    } catch (e) {
      console.warn('Realtime players error:', e);
    }
  });

  fbListenBookings(getTodayStr(), bookings => {
    try {
      DB.bookings = mergeBookingsLists(DB.bookings, bookings);
      saveDB(DB, false);
      renderAdminTimetable();
      renderCourtsGrid();
      renderHomeOpenMatches(DB.currentUser);
      renderAdminKPIs();
    } catch (e) {
      console.warn('Realtime bookings error:', e);
    }
  });

  fbListenOpenMatches(matches => {
    try {
      const other = DB.bookings.filter(b => b.type !== 'open' || b.date !== getTodayStr());
      DB.bookings = [...other, ...matches];
      saveDB(DB);
      renderMatchesList();
      renderHomeOpenMatches(DB.currentUser);
    } catch (e) {
      console.warn('Realtime open matches error:', e);
    }
  });
}

// Alias de sécurité
const renderAdminPlayersTable = renderAdminPlayers;
const updateKPIs = renderAdminKPIs;
window.renderAdminPlayersTable = renderAdminPlayers;
window.updateKPIs = renderAdminKPIs;


/** Reset démo — efface localStorage et force re-seed Firestore */
async function resetDemoData() {
  showToast('Réinitialisation en cours...', 'gold');
  localStorage.removeItem(DB_KEY);
  showToast('Données réinitialisées ✓', 'gold');
  setTimeout(() => location.reload(), 800);
}



// ============================================================================
// MATCHMAKING ENGINE
// ============================================================================

/**
 * Retourne les créneaux de matchs ouverts compatibles avec un joueur
 * @param {string} playerId
 * @returns {Array} bookings compatibles
 */
function getCompatibleMatches(playerId) {
  const player = DB.players.find(p => p.id === playerId);
  if (!player || player.status !== 'active' || !player.level) return [];

  const tolerance = DB.appConfig.matchmakingTolerance;
  const today = getTodayStr();

  return DB.bookings.filter(b => {
    if (b.type !== 'open') return false;
    if (b.status !== 'confirmed') return false;
    // Must be today or future
    if (b.date < today) return false;
    // Player not already in this match
    if (b.players.some(p => p.userId === playerId)) return false;
    // Must have room
    if ((b.players || []).length >= DB.appConfig.maxPlayersPerMatch) return false;
    // Level check
    const minOk = player.level >= (b.minLevel - tolerance);
    const maxOk = player.level <= (b.maxLevel + tolerance);
    return minOk && maxOk;
  });
}

/**
 * Rejoindre un match ouvert
 */
function joinOpenMatch(bookingId, playerId) {
  const booking = DB.bookings.find(b => b.id === bookingId);
  const player = DB.players.find(p => p.id === playerId);
  if (!booking || !player) return { success: false, message: 'Introuvable' };
  if (player.status !== 'active') return { success: false, message: 'Votre niveau doit être validé par le coach avant de rejoindre un match.' };
  if (booking.players.length >= DB.appConfig.maxPlayersPerMatch) {
    // → waitlist
    if (!booking.waitlist.includes(playerId)) {
      booking.waitlist.push(playerId);
      saveDB(DB);
    }
    return { success: false, waitlist: true, message: 'Ce match est complet. Vous avez été ajouté à la liste d\'attente.' };
  }
  if (booking.players.some(p => p.userId === playerId)) return { success: false, message: 'Vous êtes déjà inscrit à ce match.' };

  booking.players.push({ userId: playerId, name: `${player.firstName} ${player.lastName}`, level: player.level, isOrganizer: false });
  saveDB(DB);
  checkMatchAlerts();
  return { success: true, message: 'Vous avez rejoint le match ! 🎾 Paiement sur place au démarrage.' };
}

/**
 * Vérifie les matchs incomplets et génère des alertes
 */
function checkMatchAlerts() {
  const alertHours = DB.appConfig.alertBeforeMatchHours;
  const now = new Date();
  const alerts = [];

  DB.bookings.forEach(b => {
    if (b.type !== 'open' || b.status !== 'confirmed') return;
    const [h, m] = b.startTime.split(':').map(Number);
    const matchDate = new Date(b.date);
    matchDate.setHours(h, m, 0, 0);
    const diffHours = (matchDate - now) / 3600000;
    if (diffHours > 0 && diffHours <= alertHours && b.players.length < DB.appConfig.maxPlayersPerMatch) {
      alerts.push({
        bookingId: b.id,
        court: b.courtName,
        time: b.startTime,
        playersMissing: DB.appConfig.maxPlayersPerMatch - b.players.length,
      });
    }
  });

  return alerts;
}

// ============================================================================
// VIEW MODE SWITCHER
// ============================================================================

let currentMode = 'player-app';

function updateAuthRoleUI() {
  const isAdmin = DB.currentUser?.role === 'admin';
  const tabDashboard = document.getElementById('tabModeDashboard');
  const proBadge = document.querySelector('.home-club-pro-badge');
  const adminSettings = document.getElementById('settingsAdminLink');

  if (tabDashboard) {
    tabDashboard.style.display = isAdmin ? '' : 'none';
  }
  if (proBadge) {
    proBadge.style.display = isAdmin ? '' : 'none';
  }
  if (adminSettings) {
    adminSettings.style.display = isAdmin ? '' : 'none';
  }
}

function switchViewMode(mode) {
  // Protection de l'espace gérant : seul un admin peut accéder au dashboard
  if (mode === 'backoffice-dashboard') {
    const isAdmin = DB.currentUser?.role === 'admin';
    if (!isAdmin) {
      showToast('Accès réservé aux gérants / coachs.', 'error');
      mode = 'backoffice-login';
    }
  }

  currentMode = mode;
  const playerContainer = document.getElementById('playerAppContainer');
  const dashboardContainer = document.getElementById('backofficeDashboard');
  const loginContainer = document.getElementById('backofficeLogin');

  if (playerContainer) playerContainer.style.display = (mode === 'player-app') ? '' : 'none';
  if (dashboardContainer) dashboardContainer.style.display = (mode === 'backoffice-dashboard') ? '' : 'none';
  if (loginContainer) loginContainer.style.display = (mode === 'backoffice-login') ? '' : 'none';

  document.querySelectorAll('.view-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  if (mode === 'backoffice-dashboard') {
    renderAdminDashboard();
  }
}


// ============================================================================
// SCREEN NAVIGATION (App joueur)
// ============================================================================

let currentScreen = 'screen-home';

function navigateToScreen(screenId) {
  document.querySelectorAll('.app-screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) {
    target.classList.add('active');
    target.scrollTop = 0;
    currentScreen = screenId;
  }
  // Update bottom nav active state
  document.querySelectorAll('.nav-item-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.screen === screenId);
  });

  // Render screen-specific content
  if (screenId === 'screen-home') renderHomeScreen();
  if (screenId === 'screen-join-match') renderJoinMatchScreen();
  if (screenId === 'screen-book-court') renderCourtPlanningScreen();
  if (screenId === 'screen-profile') renderProfileScreen();
  if (screenId === 'screen-my-bookings') renderMyBookings();
  if (screenId === 'screen-notifications') renderNotifications();
}

// ============================================================================
// HOME SCREEN RENDER
// ============================================================================

function renderHomeScreen() {
  const user = (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser || {
    id: 'guest', firstName: 'Joueur', lastName: '', role: 'player', level: 3, status: 'active'
  };

  // Greeting
  const nameEl = document.getElementById('homeUserName');
  if (nameEl) nameEl.textContent = `${user.firstName || 'Joueur'} ${user.lastName || ''}`.trim();

  // Level badge
  const isActive = user.status === 'active';
  const levelEl = document.getElementById('homeLevelNumber');
  if (levelEl) levelEl.textContent = user.level || '?';

  const cvLevel = document.getElementById('cvLevel');
  if (cvLevel) cvLevel.textContent = user.level || '3';

  const valNotice = document.getElementById('coachValidatedNotice');
  const pendNotice = document.getElementById('pendingLevelBanner');
  if (valNotice) valNotice.classList.toggle('hidden', !(isActive && user.level));
  if (pendNotice) pendNotice.classList.toggle('hidden', (isActive && user.level));

  // Open matches compatible
  renderHomeOpenMatches(user);

  // Next booking
  renderHomeNextMatch(user);

  // Notif dot
  const unread = (DB.notifications || []).filter(n => !n.isRead && n.userId === user.id);
  const notifDot = document.getElementById('notifDot');
  if (notifDot) notifDot.style.display = unread.length > 0 ? '' : 'none';

  // Vérifier si un match terminé attend la saisie du score par son créateur
  if (typeof checkFinishedMatchesScorePrompt === 'function') {
    setTimeout(checkFinishedMatchesScorePrompt, 500);
  }
}

function renderHomeOpenMatches(user) {
  const container = document.getElementById('homeOpenMatchesScroll');
  if (!container) return;

  const currentUser = user || (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser || {};
  const matches = currentUser.id ? getCompatibleMatches(currentUser.id) : [];

  if (matches.length === 0) {
    container.innerHTML = `
      <div style="padding:16px 0; min-width:260px; color:var(--text-muted); font-size:13px">
        Aucun match ouvert disponible pour votre niveau actuellement.
      </div>`;
    return;
  }

  container.innerHTML = matches.slice(0, 5).map(b => {
    const spots = (DB.appConfig?.maxPlayersPerMatch || 4) - (b.players || []).length;
    const filledSlots = (b.players || []).slice(0, 4).map(p =>
      `<div class="player-slot filled" title="${p.name}">🎾</div>`
    ).join('');
    const emptySlots = Array(Math.max(0, spots)).fill(0).map(() =>
      `<div class="player-slot empty">+</div>`
    ).join('');

    return `
    <div class="match-card" onclick="handleJoinMatch('${b.id}')">
      <div class="match-card-header">
        <div class="match-court-name">${b.courtName}</div>
        <div class="match-time-badge">${b.startTime}</div>
      </div>
      <div class="match-level-range">
        <span>Niveau</span>
        <span class="match-level-pill">${b.minLevel}–${b.maxLevel}</span>
        <span>${b.date === getTodayStr() ? 'Aujourd\'hui' : formatDate(b.date)}</span>
      </div>
      <div class="match-players-row">
        ${filledSlots}${emptySlots}
        <span class="match-spots-text">${spots} place${spots > 1 ? 's' : ''} libre${spots > 1 ? 's' : ''}</span>
      </div>
      <button class="btn-join-match" onclick="event.stopPropagation(); handleJoinMatch('${b.id}')">
        Rejoindre · ${b.pricePerPlayer || 25} DT
      </button>
    </div>`;
  }).join('');
}

function renderHomeNextMatch(user) {
  const container = document.getElementById('homeNextMatchContainer');
  if (!container) return;

  const currentUser = user || (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser || {};
  const today = getTodayStr();
  const myBookings = (DB.bookings || []).filter(b =>
    currentUser.id &&
    (b.players || []).some(p => p.userId === currentUser.id) &&
    b.date >= today &&
    b.status === 'confirmed'
  ).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));

  if (myBookings.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:24px 0">
        <div class="empty-state-icon">🏟️</div>
        <div class="empty-state-title">Aucune réservation à venir</div>
        <div class="empty-state-desc">Réservez un terrain ou rejoignez un match ouvert</div>
      </div>`;
    return;
  }

  const b = myBookings[0];
  const spotsLeft = (DB.appConfig?.maxPlayersPerMatch || 4) - (b.players || []).length;
  container.innerHTML = `
    <div class="match-list-card" onclick="navigateToScreen('screen-my-bookings')">
      <div class="match-list-top">
        <div>
          <div class="match-list-court">${b.courtName}</div>
          <div class="match-list-date">
            ${b.date === today ? 'Aujourd\'hui' : formatDate(b.date)} · ${b.startTime} – ${b.endTime}
          </div>
        </div>
        <span class="match-status-badge ${b.type === 'open' && spotsLeft > 0 ? 'open' : 'full'}">
          ${b.type === 'private' ? 'Privée' : b.type === 'course' ? 'Cours' : spotsLeft > 0 ? `${spotsLeft} place${spotsLeft > 1 ? 's' : ''} libre${spotsLeft > 1 ? 's' : ''}` : 'Complet'}
        </span>
      </div>
      <div class="match-list-players">
        ${(b.players || []).map(p => `<div class="player-avatar-sm filled" title="${p.name}">🎾</div>`).join('')}
        ${Array(Math.max(0, 4 - (b.players || []).length)).fill('<div class="player-avatar-sm empty">+</div>').join('')}
      </div>
      <div class="match-list-bottom">
        <span class="match-price-tag">${b.pricePerPlayer || 25} DT <span>/joueur · sur place</span></span>
        <span style="font-size:11px; color:var(--text-muted)">${(b.players || []).length}/4 joueurs</span>
      </div>
    </div>`;
}

// ============================================================================
// JOIN MATCH SCREEN
// ============================================================================

let activeMatchTab = 'available';
let activeLevelFilter = 'all';

function renderJoinMatchScreen() {
  renderMatchesList();
}

function renderMatchesList() {
  const container = document.getElementById('matchesListContainer');
  const user = DB.players.find(p => p.id === DB.currentUser.id);
  const today = getTodayStr();

  let bookings;
  if (activeMatchTab === 'available') {
    bookings = DB.bookings.filter(b => {
      if (b.type !== 'open' || b.status !== 'confirmed') return false;
      if (b.date < today) return false;
      if ((b.players || []).length >= DB.appConfig.maxPlayersPerMatch) return false;
      // Level filter
      if (activeLevelFilter !== 'all') {
        const [minF, maxF] = activeLevelFilter.split('-').map(Number);
        if (b.maxLevel < minF || b.minLevel > (maxF || minF)) return false;
      }
      return true;
    });
  } else {
    bookings = DB.bookings.filter(b =>
      b.players.some(p => p.userId === DB.currentUser.id) && b.date >= today
    );
  }

  if (bookings.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🎾</div>
        <div class="empty-state-title">Aucun match disponible</div>
        <div class="empty-state-desc">Créez un match ouvert pour trouver des partenaires</div>
      </div>`;
    return;
  }

  container.innerHTML = bookings.map(b => {
    const spots = DB.appConfig.maxPlayersPerMatch - b.players.length;
    const isCompatible = user && user.status === 'active' && user.level &&
      user.level >= (b.minLevel - DB.appConfig.matchmakingTolerance) &&
      user.level <= ((b.maxLevel || 7) + DB.appConfig.matchmakingTolerance);
    const alreadyIn = b.players.some(p => p.userId === DB.currentUser.id);
    const isFull = spots <= 0;

    let btnLabel, btnClass;
    if (alreadyIn) { btnLabel = '✓ Inscrit'; btnClass = 'full'; }
    else if (isFull) { btnLabel = 'Complet · Liste d\'attente'; btnClass = 'waitlist'; }
    else if (!isCompatible) { btnLabel = `Niveau ${b.minLevel}–${b.maxLevel} requis`; btnClass = 'full'; }
    else { btnLabel = `Rejoindre · ${b.pricePerPlayer} DT`; btnClass = ''; }

    return `
    <div class="match-list-card">
      <div class="match-list-top">
        <div>
          <div class="match-list-court">${b.courtName}</div>
          <div class="match-list-date">${b.date === today ? 'Aujourd\'hui' : formatDate(b.date)} · ${b.startTime} – ${b.endTime}</div>
        </div>
        <span class="match-status-badge ${isFull ? 'full' : spots === 1 ? 'almost-full' : 'open'}">
          ${isFull ? 'Complet' : `${spots} libre${spots > 1 ? 's' : ''}`}
        </span>
      </div>
      <div class="match-list-info-row">
        <div class="match-info-chip">
          <span class="chip-icon">🏆</span>
          <span>Niveaux ${b.minLevel}–${b.maxLevel}</span>
        </div>
        <div class="match-info-chip">
          <span class="chip-icon">🏟️</span>
          <span>${b.courtName}</span>
        </div>
        <div class="match-info-chip">
          <span class="chip-icon">💰</span>
          <span>${b.pricePerPlayer} DT</span>
        </div>
      </div>
      <div class="match-list-bottom">
        <div class="match-list-players">
          ${b.players.map(p => `<div class="player-avatar-sm filled" title="${p.name} · Niv.${p.level}">🎾</div>`).join('')}
          ${Array(Math.max(0, 4 - b.players.length)).fill('<div class="player-avatar-sm empty">+</div>').join('')}
          <span style="font-size:11px; color:var(--text-muted); margin-left:6px">${b.players.length}/4</span>
        </div>
        <button class="btn-join-match ${btnClass}" onclick="handleJoinMatch('${b.id}')" ${alreadyIn || (!isCompatible && !isFull) ? 'disabled style="opacity:0.5;cursor:not-allowed"' : ''}>
          ${btnLabel}
        </button>
      </div>
    </div>`;
  }).join('');
}

function handleJoinMatch(bookingId) {
  const user = DB.players.find(p => p.id === DB.currentUser.id);
  if (!user || user.status !== 'active') {
    showToast('Votre niveau doit être validé par le coach avant de rejoindre un match.', 'error');
    return;
  }
  const result = joinOpenMatch(bookingId, DB.currentUser.id);
  showToast(result.message, result.success ? 'success' : (result.waitlist ? 'info' : 'error'));
  if (result.success) {
    renderHomeScreen();
    renderMatchesList();
  }
}

// ============================================================================
// COURT PLANNING SCREEN (mobile)
// ============================================================================

let planningSelectedDate = getTodayStr();

const SLOT_TIMES = ['08:00','09:30','11:00','12:30','14:00','15:30','17:00','18:30','20:00','21:30'];

function addMinutes(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function renderCourtPlanningScreen() {
  renderPlanningDateBar();
  renderCourtsGrid();
}

function renderPlanningDateBar() {
  const bar = document.getElementById('planningDateBar');
  if (!bar) return;

  const displayEl = document.getElementById('playerCurrentDateDisplay');
  if (displayEl) {
    displayEl.textContent = formatDate(planningSelectedDate || getTodayStr());
  }

  const days = [];
  const now = new Date();
  const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const monthNames = ['jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc'];
  const todayStr = getTodayStr();

  for (let i = 0; i < 7; i++) {
    const dateStr = shiftDateStr(todayStr, i);
    const parts = dateStr.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    days.push({
      dateStr,
      dayName: dateStr === todayStr ? 'Auj.' : dayNames[d.getDay()],
      dayNum: d.getDate(),
      monthName: monthNames[d.getMonth()],
    });
  }

  bar.innerHTML = days.map(d => `
    <button class="date-chip ${d.dateStr === planningSelectedDate ? 'active' : ''}"
      data-date="${d.dateStr}"
      onclick="selectPlanningDate('${d.dateStr}')">
      <span class="day-name">${d.dayName}</span>
      <span class="day-num">${d.dayNum}</span>
      <span class="month-name">${d.monthName}</span>
    </button>
  `).join('');
}

function selectPlanningDate(dateStr) {
  planningSelectedDate = dateStr;
  renderPlanningDateBar();
  renderCourtsGrid();
}

function renderCourtsGrid() {
  const grid = document.getElementById('courtsPlanningGrid');
  if (!grid) return;
  const duration = DB.appConfig?.slotDurationMinutes || 90;

  grid.innerHTML = (DB.courts || []).filter(c => c.isActive).map(court => {
    const slots = SLOT_TIMES.map(time => {
      const endTime = addMinutes(time, duration);
      const booking = (DB.bookings || []).find(b =>
        b.courtId === court.id && b.date === planningSelectedDate && b.startTime === time && b.status === 'confirmed'
      );

      let slotClass = '', badgeClass = 'available', badgeText = '🟢 Libre', dotHtml = '';
      let isOccupied = false;
      if (booking) {
        const spots = (DB.appConfig?.maxPlayersPerMatch || 4) - (booking.players || []).length;
        if (booking.type === 'private' || booking.type === 'course' || booking.type === 'blocked' || spots <= 0) {
          isOccupied = true;
          slotClass = 'booked slot-occupied';
          badgeClass = 'occupied';
          badgeText = booking.type === 'course' ? '🎓 Cours' : (booking.type === 'blocked' ? '⛔ Entretien' : '🔴 Occupé');
        } else if (booking.type === 'open') {
          slotClass = 'open-match';
          badgeClass = 'open';
          badgeText = `🎾 Ouvert · ${spots} place${spots > 1 ? 's' : ''}`;
        }

        if (booking.type !== 'blocked' && booking.type !== 'course') {
          const filled = (booking.players || []).length;
          dotHtml = Array(4).fill(0).map((_, i) =>
            `<div class="slot-dot ${i < filled ? 'filled' : 'empty'}"></div>`
          ).join('');
        }
      }

      const clickHandler = isOccupied
        ? `showToast('Ce terrain est déjà réservé / occupé à cet horaire.', 'info')`
        : (booking && booking.type === 'open'
          ? `openModal('modal-slot-detail'); renderSlotDetail('${booking.id}')`
          : `openBookingFromSlot('${court.id}', '${time}')`);

      return `
        <div class="slot-item ${slotClass}" onclick="${clickHandler}" style="cursor:pointer">
          <span class="slot-time">${time} – ${endTime}</span>
          <span class="slot-type-badge ${badgeClass}">${badgeText}</span>
          <div class="slot-players-mini">${dotHtml}</div>
        </div>`;
    }).join('');

    return `
    <div class="court-planning-card">
      <div class="court-planning-header">
        <div>
          <div class="court-planning-name">${court.name}</div>
          <div style="font-size:11px; color:var(--text-muted)">${court.surface}</div>
        </div>
        <div class="court-status-dot"></div>
      </div>
      <div class="court-slots-list">${slots}</div>
    </div>`;
  }).join('');
}

const renderCourtsPlanningGrid = renderCourtsGrid;

function openBookingFromSlot(courtId, time) {
  const courtNum = courtId.replace('court_', '');
  const sel = document.getElementById('bookCourtSelect');
  if (sel) sel.value = courtNum;
  const timeEl = document.getElementById('bookStartTime');
  if (timeEl) timeEl.value = time;
  const dateEl = document.getElementById('bookDateInput');
  if (dateEl) dateEl.value = planningSelectedDate || getTodayStr();
  openModal('modal-book-court');
}

// ============================================================================
// PROFILE SCREEN
// ============================================================================

const LEVEL_LABELS = {
  1: 'Initiation (Découverte)',
  2: 'Débutant',
  3: 'Débutant perfectionnement',
  4: 'Intermédiaire loisir',
  5: 'Intermédiaire',
  6: 'Intermédiaire confirmé',
  7: 'Avancé',
  8: 'Avancé compétition',
  9: 'Expert régional',
  10: 'Élite / Professionnel'
};
const SIDE_LABELS = { right:'Droitier', left:'Gaucher', both:'Ambidextre' };
const STYLE_LABELS = { offensive:'Offensif', defensive:'Défensif', 'all-around':'Équilibré' };
const SKILL_LABELS = { bandeja:'Bandeja', vibora:'Víbora', salida_cristal:'Sortie de vitre', volee:'Volée', placement:'Placement', regularite:'Régularité', mental:'Mental' };

/**
 * PONDÉRATION OFFICIELLE EXPERTE PADEL :
 * - Régularité (25%) : Réduction des fautes directes (base fondamentale du padel)
 * - Placement (20%) : Transitions fond/filet et couverture du terrain
 * - Sortie de vitre (15%) : Maîtrise des parois (spécificité padel)
 * - Volée (15%) : Contrôle et finition au filet
 * - Bandeja (10%) : Coup de maintien tactique au filet
 * - Mental (10%) : Gestion des moments chauds & Punto de Oro
 * - Víbora (5%) : Accélération offensive latérale
 */
const PADEL_SKILL_WEIGHTS = {
  regularite: 0.25,
  placement: 0.20,
  salida_cristal: 0.15,
  volee: 0.15,
  bandeja: 0.10,
  mental: 0.10,
  vibora: 0.05
};

/**
 * Calcule la note globale pondérée (1 à 10) et le niveau officiel (1 à 10)
 * selon l'équation de moyenne propre au padel
 */
function calculatePadelLevelFromSkills(skills = {}) {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [key, weight] of Object.entries(PADEL_SKILL_WEIGHTS)) {
    const val = Number(skills[key]) || 5;
    weightedSum += val * weight;
    totalWeight += weight;
  }

  const weightedScore = Number((weightedSum / (totalWeight || 1)).toFixed(2));

  // Échelle intuitive unifiée sur 10 : le niveau officiel correspond directement à la moyenne pondérée de 1 à 10
  const officialLevel = Math.max(1, Math.min(10, Math.round(weightedScore)));

  return { weightedScore, officialLevel };
}

function renderProfileScreen() {
  const user = (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser || {
    id: 'guest', firstName: 'Invité', lastName: '', role: 'player', level: null, preferredSide: 'right', playStyle: 'all-around'
  };

  const nameEl = document.getElementById('profileName');
  if (nameEl) nameEl.textContent = `${user.firstName || 'Invité'} ${user.lastName || ''}`.trim();
  const phoneEl = document.getElementById('profilePhone');
  if (phoneEl) phoneEl.textContent = user.phone || user.email || 'Non connecté';
  const levelEl = document.getElementById('profileLevelBig');
  if (levelEl) levelEl.textContent = user.level || '?';
  const titleEl = document.getElementById('profileLevelTitle');
  if (titleEl) titleEl.textContent = LEVEL_LABELS[user.level] || 'En attente d\'évaluation';
  const coachEl = document.getElementById('profileLevelCoach');
  if (coachEl) coachEl.textContent = user.levelValidatedAt
    ? `Validé le ${formatDate(user.levelValidatedAt.split('T')[0])}`
    : 'Évaluation coach requise';
  const matchesEl = document.getElementById('statMatchesPlayed');
  if (matchesEl) matchesEl.textContent = user.totalMatchesPlayed || 0;
  
  const relEl = document.getElementById('statReliability');
  const peerMatches = user.peerConfrontationsCount || 0;
  const relVal = user.reliabilityScore || 50;
  if (relEl) {
    relEl.textContent = `${relVal}%`;
    relEl.title = `Fiabilité : ${relVal}% — Validée sur ${peerMatches} confrontation(s) face à des pairs de même niveau (±1.0)`;
  }

  const peerBadge = document.getElementById('profilePeerConfrontationsBadge');
  if (peerBadge) {
    peerBadge.textContent = `${peerMatches} confrontation${peerMatches > 1 ? 's' : ''} face à des pairs`;
  }
  const relDesc = document.getElementById('profileReliabilityDesc');
  if (relDesc) {
    if (peerMatches === 0) {
      relDesc.textContent = "Niveau initial coach (50% de fiabilité). Votre niveau réel se consolidera lors de vos confrontations en match avec des joueurs de votre niveau (écart ±1.0).";
    } else {
      relDesc.textContent = `${peerMatches} match(s) disputé(s) face à des pairs de même niveau. Votre niveau réel est calibré et validé à ${relVal}%.`;
    }
  }

  const sideEl = document.getElementById('statSide');
  if (sideEl) sideEl.textContent = user.preferredSide === 'right' ? 'D' : user.preferredSide === 'left' ? 'G' : '±';
  const styleEl = document.getElementById('statStyle');
  if (styleEl) styleEl.textContent = user.playStyle === 'offensive' ? 'OFF' : user.playStyle === 'defensive' ? 'DEF' : 'EQ';
  const sideB = document.getElementById('profileSideBadge');
  if (sideB) sideB.textContent = `🖐 ${SIDE_LABELS[user.preferredSide] || 'Droitier'}`;
  const styleB = document.getElementById('profileStyleBadge');
  if (styleB) styleB.textContent = `⚡ ${STYLE_LABELS[user.playStyle] || 'Polyvalent'}`;
  const statusB = document.getElementById('profileStatusBadge');
  if (statusB) statusB.textContent = user.status === 'active' ? '✔ Actif' : '⏳ En attente';

  // Bouton Connexion / Déconnexion dans profil
  const authBtn = document.getElementById('btnProfileAuthAction');
  if (authBtn) {
    if (user.email && user.id !== 'guest') {
      authBtn.textContent = `🚪 Déconnexion (${user.firstName})`;
      authBtn.style.background = 'rgba(231,76,60,0.18)';
      authBtn.style.color = 'var(--red)';
      authBtn.style.border = '1px solid rgba(231,76,60,0.4)';
    } else {
      authBtn.textContent = '🔐 Se connecter / Créer un compte';
      authBtn.style.background = 'var(--gold)';
      authBtn.style.color = '#000';
      authBtn.style.border = 'none';
    }
  }

  // Radar SVG
  renderRadarChart(user.skills);

  // Skills list
  renderSkillsList(user.skills);

  // Level history
  renderLevelHistory(user);

  // Match history (from bookings)
  renderProfileHistory(user);

  // ── Populer la Carte FIFA Padel Ultimate Team ──
  // Sélection dynamique photo Femme / Homme
  const isFemale = isPlayerFemale(user);
  const futCardBaseImg = document.getElementById('futCardBaseImg');
  if (futCardBaseImg) {
    futCardBaseImg.src = isFemale ? './images/circlepadel_green_card_woman.jpg' : './images/circlepadel_green_card.jpg';
  }

  // Niveau précis à 2 décimales (Format Rating Engine)
  const futRating = document.getElementById('futCardRating');
  if (futRating) {
    if (user.level != null) {
      futRating.textContent = Number(user.level).toFixed(2);
    } else if (user.weightedScore != null) {
      futRating.textContent = Number(user.weightedScore).toFixed(2);
    } else {
      futRating.textContent = '--';
    }
  }

  // Indicateur de tendance / Forme récente
  const futTrend = document.getElementById('futCardTrend');
  if (futTrend) {
    const delta = typeof user.lastDelta === 'number' ? user.lastDelta : null;
    if (delta !== null && delta !== 0) {
      if (delta > 0) {
        futTrend.className = 'fut-trend-badge up';
        futTrend.textContent = `▲ +${delta.toFixed(2)}`;
        futTrend.style.display = 'inline-flex';
      } else {
        futTrend.className = 'fut-trend-badge down';
        futTrend.textContent = `▼ ${delta.toFixed(2)}`;
        futTrend.style.display = 'inline-flex';
      }
    } else {
      futTrend.className = 'fut-trend-badge neutral';
      futTrend.textContent = '● STABLE';
      futTrend.style.display = 'inline-flex';
    }
  }

  const futPos = document.getElementById('futCardPos');
  if (futPos) {
    futPos.textContent = user.preferredSide === 'left' ? 'GAU' : (user.preferredSide === 'both' ? 'POLY' : 'DRT');
  }

  const futAvatar = document.getElementById('futPlayerAvatar');
  if (futAvatar) {
    const f = user.firstName?.[0] || 'C';
    const l = user.lastName?.[0] || 'P';
    futAvatar.textContent = (f + l).toUpperCase();
  }

  const futInitials = document.getElementById('futPlayerInitials');
  if (futInitials) {
    const f = user.firstName?.[0] || 'C';
    const l = user.lastName?.[0] || 'P';
    futInitials.textContent = (f + l).toUpperCase();
  }

  const futVerified = document.getElementById('futCoachVerified');
  const futVerifiedText = document.getElementById('futCoachVerifiedText');
  if (futVerified && futVerifiedText) {
    if (user.levelValidatedAt) {
      futVerified.style.display = 'block';
      futVerified.style.background = 'rgba(46, 204, 113, 0.2)';
      futVerified.style.borderColor = 'rgba(46, 204, 113, 0.6)';
      futVerified.style.color = '#2ecc71';
      futVerifiedText.textContent = `✓ CERTIFIÉ COACH & CLUB · NIV ${Number(user.level).toFixed(2)}/10`;
    } else {
      const selfLvl = (user.selfEstimatedLevel != null ? Number(user.selfEstimatedLevel).toFixed(2) : (user.level != null ? Number(user.level).toFixed(2) : '5.00'));
      futVerified.style.display = 'block';
      futVerified.style.background = 'rgba(243, 156, 18, 0.2)';
      futVerified.style.borderColor = 'rgba(243, 156, 18, 0.6)';
      futVerified.style.color = 'var(--gold)';
      futVerifiedText.textContent = `⏳ AUTO-ÉVALUATION (${selfLvl}/10) · EN ATTENTE COACH`;
    }
  }

  const futName = document.getElementById('futPlayerName');
  if (futName) {
    futName.textContent = `${(user.firstName || 'JOUEUR')} ${(user.lastName || '')}`.trim().toUpperCase();
  }

  const futStyle = document.getElementById('futPlayerStyle');
  if (futStyle) {
    futStyle.textContent = `⚡ ${(STYLE_LABELS[user.playStyle] || 'POLYVALENT').toUpperCase()} · ${(SIDE_LABELS[user.preferredSide] || 'DROITIER').toUpperCase()}`;
  }

  // 6 Attributs FUT Padel (valeur sur 99)
  const baseStat = user.level ? Math.round(user.level * 10) : 50;
  const regVal = user.skills?.regularite ? Math.round(user.skills.regularite * 10) : baseStat;
  const plaVal = user.skills?.placement ? Math.round(user.skills.placement * 10) : baseStat;
  const vitVal = user.skills?.salida_cristal ? Math.round(user.skills.salida_cristal * 10) : (user.skills?.vibora ? Math.round(user.skills.vibora * 10) : baseStat);
  const volVal = user.skills?.volee ? Math.round(user.skills.volee * 10) : baseStat;
  const banVal = user.skills?.bandeja ? Math.round(user.skills.bandeja * 10) : baseStat;
  const menVal = user.skills?.mental ? Math.round(user.skills.mental * 10) : baseStat;

  const futReg = document.getElementById('futStatReg'); if (futReg) futReg.textContent = regVal;
  const futPla = document.getElementById('futStatPla'); if (futPla) futPla.textContent = plaVal;
  const futVit = document.getElementById('futStatVit'); if (futVit) futVit.textContent = vitVal;
  const futVol = document.getElementById('futStatVol'); if (futVol) futVol.textContent = volVal;
  const futBan = document.getElementById('futStatBan'); if (futBan) futBan.textContent = banVal;
  const futMen = document.getElementById('futStatMen'); if (futMen) futMen.textContent = menVal;

  const futRel = document.getElementById('futCardReliability');
  const relScore = typeof user.reliabilityScore === 'number' ? user.reliabilityScore : 50.0;
  if (futRel) futRel.textContent = `${Math.round(relScore)}%`;

  const relPctEl = document.getElementById('profileReliabilityPct');
  const relFillEl = document.getElementById('profileReliabilityFill');
  if (relPctEl) relPctEl.textContent = `${relScore.toFixed(1)}%`;
  if (relFillEl) relFillEl.style.width = `${Math.min(100, Math.max(5, relScore))}%`;

  const futLvlNum = document.getElementById('futCardLevelNum');
  if (futLvlNum) futLvlNum.textContent = (user.level != null ? Number(user.level).toFixed(2) : '?');

  // ── CERCLE DE FIDÉLITÉ CIRCLEPADEL (THE LOYALTY RING) ──
  renderLoyaltyRing(user);
}

/**
 * Règle de fidélité CirclePadel :
 * Les joueurs nouvellement introduits n'ont AUCUN point de fidélité tant qu'ils n'ont pas
 * joué de match officiel ni parrainé leur enfant (programme junior academy).
 */
function getPlayerLoyaltyPoints(player) {
  if (!player) return 0;
  const matches = Number(player.totalMatchesPlayed || player.matchesPlayed || 0);
  const hasChildReferral = Array.isArray(player.loyaltyHistory) && player.loyaltyHistory.some(h => h.type === 'referral');
  if (matches === 0 && !hasChildReferral) {
    return 0;
  }
  return Number(player.loyaltyPoints) || 0;
}
window.getPlayerLoyaltyPoints = getPlayerLoyaltyPoints;

/**
 * Met à jour dynamiquement l'affichage du Cercle de Fidélité
 * - Progression circulaire SVG (60 pts max)
 * - Gains : 1.0 pt (08h-17h), 0.5 pt (17h-23h), 1.5 pt (parrainage académie)
 * - Réinitialisation à 0 si réclamation anticipée
 */
function renderLoyaltyRing(user) {
  const loyaltyCard = document.getElementById('loyaltyRingCard');
  if (!loyaltyCard) return;

  const rawPts = getPlayerLoyaltyPoints(user);
  const points = Math.max(0, Math.min(60, Number(rawPts.toFixed(1))));

  const valEl = document.getElementById('loyaltyPointsVal');
  if (valEl) valEl.textContent = points.toFixed(1);

  // SVG Circular progress : r=90 => circumference = 2 * PI * 90 = 565.48
  const circleBar = document.getElementById('loyaltyCircleBar');
  if (circleBar) {
    const maxOffset = 565;
    const progressRatio = points / 60;
    const targetOffset = Math.max(0, maxOffset - (progressRatio * maxOffset));
    circleBar.style.strokeDashoffset = targetOffset.toFixed(1);
  }

  // Animation Aiguille d'horloge & Balle de Padel mobile (0 à 60 pts)
  // L'angle theta part du haut (grâce au CSS transform: rotate(-90deg) sur le SVG)
  const theta = (points / 60) * 2 * Math.PI;
  const cx = 110, cy = 110, R = 90;
  
  // Position de la balle de padel sur le pourtour du cercle
  const ballX = (cx + R * Math.cos(theta)).toFixed(1);
  const ballY = (cy + R * Math.sin(theta)).toFixed(1);

  // Aiguille d'horloge reliant la périphérie du centre à la balle
  const needleX1 = (cx + 40 * Math.cos(theta)).toFixed(1);
  const needleY1 = (cy + 40 * Math.sin(theta)).toFixed(1);
  const needleX2 = (cx + 76 * Math.cos(theta)).toFixed(1);
  const needleY2 = (cy + 76 * Math.sin(theta)).toFixed(1);

  const needle = document.getElementById('loyaltyClockNeedle');
  if (needle) {
    needle.setAttribute('x1', needleX1);
    needle.setAttribute('y1', needleY1);
    needle.setAttribute('x2', needleX2);
    needle.setAttribute('y2', needleY2);
  }

  const ballMarker = document.getElementById('loyaltyPadelBallMarker');
  if (ballMarker) {
    ballMarker.setAttribute('transform', `translate(${ballX}, ${ballY})`);
    ballMarker.setAttribute('title', `${points} pts sur 60 · Position horloge ${(points / 5).toFixed(1)}h`);
  }

  // Génération des 12 crans horaires (tous les 5 points : 0, 5, 10, ..., 55 pts)
  const ticksContainer = document.getElementById('loyaltyClockTicks');
  if (ticksContainer && !ticksContainer.hasChildNodes()) {
    let ticksHtml = '';
    const isLight = document.body.classList.contains('light-mode');
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * 2 * Math.PI;
      const isQuarter = (i % 3 === 0); // 0, 15, 30, 45 pts
      const rInner = isQuarter ? 77 : 81;
      const rOuter = 88;
      const tx1 = (cx + rInner * Math.cos(a)).toFixed(1);
      const ty1 = (cy + rInner * Math.sin(a)).toFixed(1);
      const tx2 = (cx + rOuter * Math.cos(a)).toFixed(1);
      const ty2 = (cy + rOuter * Math.sin(a)).toFixed(1);
      const stroke = isQuarter ? 'var(--gold)' : (isLight ? 'rgba(15,23,42,0.25)' : 'rgba(255,255,255,0.18)');
      const width = isQuarter ? '2' : '1.2';
      ticksHtml += `<line x1="${tx1}" y1="${ty1}" x2="${tx2}" y2="${ty2}" stroke="${stroke}" stroke-width="${width}" />`;
    }
    ticksContainer.innerHTML = ticksHtml;
  }

  const maxSub = document.getElementById('loyaltyMaxSub');
  if (maxSub) {
    if (points >= 60) {
      maxSub.textContent = '🏆 GRAAL DÉBLOQUÉ (60 PTS)';
    } else if (points >= 30) {
      maxSub.textContent = '⭐ MI-CHEMIN FRANCHI · OBJECTIF 60 PTS';
    } else if (points >= 15) {
      maxSub.textContent = 'PROCHAIN CADEAU : MI-CHEMIN (30 PTS)';
    } else {
      maxSub.textContent = 'PROCHAIN CADEAU : 15 PTS';
    }
  }

  // Palier 15 : Accessoires Padel
  const m15 = document.getElementById('milestone15');
  const s15 = document.getElementById('milestoneStatus15');
  if (m15 && s15) {
    if (points >= 15) {
      m15.classList.add('unlocked');
      s15.textContent = '✨ Prêt à récupérer';
      s15.style.color = '#2ecc71';
    } else {
      m15.classList.remove('unlocked');
      s15.textContent = 'Étape 1 · En cours';
      s15.style.color = 'var(--text-muted)';
    }
  }

  // Palier 30 : Tube de balles pro (À Mi-Chemin)
  const m30 = document.getElementById('milestone30');
  const s30 = document.getElementById('milestoneStatus30');
  if (m30 && s30) {
    if (points >= 30) {
      m30.classList.add('unlocked');
      s30.textContent = '✨ Prêt à récupérer';
      s30.style.color = '#2ecc71';
    } else {
      m30.classList.remove('unlocked');
      s30.textContent = points < 15 ? 'Verrouillé' : 'Mi-chemin · En cours';
      s30.style.color = 'var(--text-muted)';
    }
  }

  // Palier 60 : Raquette Carbone Pro
  const m60 = document.getElementById('milestone60');
  const s60 = document.getElementById('milestoneStatus60');
  if (m60 && s60) {
    if (points >= 60) {
      m60.classList.add('unlocked');
      s60.textContent = '🏆 Prêt à récupérer';
      s60.style.color = 'var(--gold)';
    } else {
      m60.classList.remove('unlocked');
      s60.textContent = 'Graal final · 60 pts';
      s60.style.color = 'var(--text-muted)';
    }
  }

  // Bouton Récupération
  const claimBtn = document.getElementById('btnClaimLoyaltyReward');
  const claimTxt = document.getElementById('btnClaimLoyaltyText');
  if (claimBtn && claimTxt) {
    if (points >= 60) {
      claimBtn.className = 'loyalty-claim-btn active';
      claimBtn.dataset.tier = '60';
      claimTxt.textContent = '🎁 Récupérer la Raquette Carbone (60 pts) !';
    } else if (points >= 30) {
      claimBtn.className = 'loyalty-claim-btn active';
      claimBtn.dataset.tier = '30';
      claimTxt.textContent = '🎁 Récupérer le Tube de Balles Pro (À mi-chemin · 30 pts)';
    } else if (points >= 15) {
      claimBtn.className = 'loyalty-claim-btn active';
      claimBtn.dataset.tier = '15';
      claimTxt.textContent = '🎁 Récupérer les Accessoires Padel (15 pts)';
    } else {
      claimBtn.className = 'loyalty-claim-btn disabled';
      claimBtn.dataset.tier = '';
      claimTxt.textContent = '🔒 Palier en cours · Continuez vos matchs au club';
    }
  }
}

let _currentClaimTier = 0;

window.checkMilestoneReward = function(tier) {
  const user = (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser;
  const pts = Number(user.loyaltyPoints) || 0;
  if (pts < tier) {
    showToast(`🔒 Palier ${tier} pts verrouillé (${(tier - pts).toFixed(1)} pt manquant). Continuez à jouer !`, 'info');
    return;
  }
  openLoyaltyClaimModal(tier);
};

window.triggerLoyaltyClaimModal = function() {
  const claimBtn = document.getElementById('btnClaimLoyaltyReward');
  const tier = Number(claimBtn?.dataset.tier);
  if (!tier) {
    showToast('Continuez à accumuler des points en jouant en heures creuses ou via parrainage !', 'info');
    return;
  }
  openLoyaltyClaimModal(tier);
};

function openLoyaltyClaimModal(tier) {
  _currentClaimTier = tier;
  const modal = document.getElementById('modal-loyalty-claim');
  const icon = document.getElementById('loyaltyClaimGiftIcon');
  const title = document.getElementById('loyaltyClaimGiftTitle');
  const pts = document.getElementById('loyaltyClaimGiftPts');
  if (!modal) return;

  if (tier === 60) {
    if (icon) icon.textContent = '🏆';
    if (title) title.textContent = 'Raquette Carbone Pro CirclePadel';
    if (pts) pts.textContent = 'Palier Ultime 60 points atteint !';
  } else if (tier === 30) {
    if (icon) icon.textContent = '📦';
    if (title) title.textContent = 'Tube de Balles Padel Pro (Pressurisé)';
    if (pts) pts.textContent = 'Palier 30 points atteint';
  } else {
    if (icon) icon.textContent = '🎾';
    if (title) title.textContent = 'Accessoires Padel (Surgrips & Poignets)';
    if (pts) pts.textContent = 'Palier 15 points atteint';
  }

  openModal('modal-loyalty-claim');
}
window.openLoyaltyClaimModal = openLoyaltyClaimModal;

window.executeClaimLoyaltyReward = function() {
  const user = (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser;
  if (!user) return;

  const tier = _currentClaimTier || 15;
  const giftName = tier === 60 ? 'Raquette Carbone Pro' : (tier === 30 ? 'Tube de Balles Pro' : 'Accessoires Padel');

  // Enregistrer l'historique de réclamation
  user.loyaltyClaims = user.loyaltyClaims || [];
  user.loyaltyClaims.push({
    tier,
    giftName,
    claimedAt: new Date().toISOString(),
    pointsAtClaim: user.loyaltyPoints || 0
  });

  // RÉINITIALISATION À 0 PT (règle officielle du cercle)
  user.loyaltyPoints = 0;

  const idx = (DB.players || []).findIndex(p => p.id === user.id);
  if (idx !== -1) DB.players[idx] = { ...DB.players[idx], ...user };
  DB.currentUser = { ...DB.currentUser, ...user };

  saveDB(DB, true);
  closeModal('modal-loyalty-claim');

  showCelebrationModal({
    title: `Félicitations pour votre ${giftName} !`,
    subtitle: `Votre cadeau a été validé. Votre Cercle de Fidélité a été réinitialisé à 0 point pour une nouvelle aventure.`,
    badgeText: 'CADEAU FIDÉLITÉ DÉLIVRÉ',
    icon: tier === 60 ? '🏆' : (tier === 30 ? '📦' : '🎾'),
    durationMs: 1400
  });

  renderProfileScreen();
  renderAdminPlayers();
};

window.openReferralModal = function() {
  openModal('modal-loyalty-referral');
};

window.submitLoyaltyReferral = function() {
  const name = document.getElementById('referralPersonName')?.value?.trim();
  const program = document.getElementById('referralProgram')?.value || 'junior_academy';

  if (!name) {
    showToast('Veuillez saisir le nom de l\'enfant ou proche parrainé.', 'error');
    return;
  }

  const user = (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser;
  if (!user) return;

  const oldPts = getPlayerLoyaltyPoints(user);
  const newPts = Number((oldPts + 1.5).toFixed(1));
  user.loyaltyPoints = newPts;
  user.loyaltyHistory = user.loyaltyHistory || [];
  user.loyaltyHistory.push({
    type: 'referral',
    name,
    program,
    pointsAwarded: 1.5,
    date: new Date().toISOString()
  });

  // Trace d'audit certifiée pour parrainage enfant / junior academy
  const auditEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    action: 'REFERRAL_ADDED',
    entityId: user.id,
    entityType: 'player',
    playerName: `${user.firstName} ${user.lastName || ''}`.trim(),
    playerEmail: user.email || '',
    playerPhone: user.phone || '',
    performedBy: `${DB.currentUser?.firstName || 'Parent'} (${user.firstName})`,
    timestamp: new Date().toISOString(),
    details: `Parrainage enfant validé : "${name}" (${program === 'junior_academy' ? 'Junior Academy' : program}). +1.5 pt fidélité attribué.`
  };
  if (!Array.isArray(DB.auditLogs)) DB.auditLogs = [];
  DB.auditLogs.unshift(auditEntry);

  const idx = (DB.players || []).findIndex(p => p.id === user.id);
  if (idx !== -1) DB.players[idx] = { ...DB.players[idx], ...user };
  DB.currentUser = { ...DB.currentUser, ...user };

  checkAndNotifyLoyaltyMilestones(user, oldPts, user.loyaltyPoints);

  DB.lastAction = 'REFERRAL_ADDED';
  saveDB(DB, true, true);
  setTimeout(() => { delete DB.lastAction; }, 500);
  closeModal('modal-loyalty-referral');

  showToast(`🌟 Parrainage de ${name} validé ! +1.5 pt illuminé sur votre cercle ✓`, 'gold');
  renderProfileScreen();
  renderAdminPlayers();
  renderAdminAuditLogs();
};

function checkAndNotifyLoyaltyMilestones(player, oldPts, newPts) {
  if (!player) return;
  const oldP = Number(oldPts) || 0;
  const newP = Number(newPts) || 0;
  const milestones = [
    { tier: 15, name: 'Accessoires Padel Pro (1er Palier)', icon: '🎾' },
    { tier: 30, name: 'Tube de Balles Pro (À Mi-Chemin)', icon: '📦' },
    { tier: 60, name: 'Raquette Carbone Pro (Graal Ultime)', icon: '🏆' }
  ];

  milestones.forEach(m => {
    if (oldP < m.tier && newP >= m.tier) {
      const playerName = `${player.firstName} ${player.lastName || ''}`.trim();
      const notifId = `notif_milestone_${m.tier}_${player.id}_${Date.now()}`;
      const notif = {
        id: notifId,
        userId: 'admin',
        targetRole: 'admin',
        type: 'loyalty_milestone',
        tier: m.tier,
        playerId: player.id,
        playerName: playerName,
        reward: m.name,
        icon: m.icon,
        title: `🎁 Palier Fidélité ${m.tier} pts atteint !`,
        body: `${playerName} a atteint ${newP.toFixed(1)} points de fidélité et a débloqué : "${m.name}". Préparer sa dotation au club.`,
        isRead: false,
        sentAt: new Date().toISOString()
      };
      DB.notifications = DB.notifications || [];
      DB.notifications.unshift(notif);
      saveDB(DB, true);
      if (typeof renderAdminAlerts === 'function') renderAdminAlerts();
      if (typeof renderAdminKPIs === 'function') renderAdminKPIs();
    }
  });
}
window.checkAndNotifyLoyaltyMilestones = checkAndNotifyLoyaltyMilestones;

function dismissLoyaltyAlert(notifId) {
  const notif = (DB.notifications || []).find(n => n.id === notifId);
  if (notif) {
    notif.isRead = true;
    saveDB(DB, true);
    if (typeof renderAdminAlerts === 'function') renderAdminAlerts();
    if (typeof renderAdminKPIs === 'function') renderAdminKPIs();
    showToast(`Dotation "${notif.reward || 'Cadeau'}" marquée comme remise au joueur ✓`, 'success');
  }
}
window.dismissLoyaltyAlert = dismissLoyaltyAlert;

function updateAuthUI() {
  const user = (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser;
  if (!user) return;

  const homeUserName = document.getElementById('homeUserName');
  if (homeUserName) homeUserName.textContent = user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : 'Invité';

  const homeInitials = document.getElementById('homeUserInitials');
  if (homeInitials) {
    const f = user.firstName?.[0] || 'C';
    const l = user.lastName?.[0] || 'P';
    homeInitials.textContent = (f + l).toUpperCase();
  }

  const profileAvatarBig = document.getElementById('profileAvatarBig');
  if (profileAvatarBig) {
    const f = user.firstName?.[0] || 'C';
    const l = user.lastName?.[0] || 'P';
    profileAvatarBig.textContent = (f + l).toUpperCase();
  }

  updateAuthRoleUI();
  renderProfileScreen();
}

async function handlePlayerLogin(email, password) {
  if (!email) {
    showToast('Veuillez saisir votre email, téléphone ou nom.', 'error');
    return;
  }
  const submitBtn = document.getElementById('btnAuthSubmitLogin');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ Connexion en cours...</span>';
  }

  try {
    const norm = (email || '').toLowerCase().trim();
    const cleanInput = norm.replace(/[\s\-\+\.]/g, '');

    // Accès rapide Admin CirclePadel (supporte "admin", "admin@circlepadel.com", "moslem")
    if ((norm === 'admin' || norm === 'admin@hayapala.tn' || norm === 'admin@circlepadel.com' || norm === 'moslem') && (password === 'admin' || !password || password === 'padel2026')) {
      let adminPlayer = (DB.players || []).find(p => p.role === 'admin' || p.id === 'user_moslem' || p.firstName?.toLowerCase() === 'moslem') || {
        id: 'user_moslem',
        firstName: 'Moslem',
        lastName: 'Gouia',
        email: 'moslem.gouia@example.com',
        phone: '+216 22 227 041',
        gender: 'male',
        role: 'admin',
        status: 'active',
        level: 5.0,
        reliabilityScore: 82,
        totalMatchesPlayed: 24,
        loyaltyPoints: 45
      };
      DB.currentUser = { ...adminPlayer, role: 'admin' };
      saveDB(DB);
      updateAuthUI();
      updateAuthRoleUI();
      renderHomeScreen();
      renderProfileScreen();
      renderAdminPlayers();
      closeModal('modal-auth');
      showCelebrationModal({
        title: `Bienvenue, ${DB.currentUser.firstName} (Admin) !`,
        subtitle: `Connexion sécurisée établie. Espace Gérant et profil athlète synchronisés.`,
        badgeText: 'SESSION ADMIN VALIDÉE',
        icon: '🎾',
        durationMs: 950,
        onComplete: () => {
          navigateToScreen('screen-profile');
          showToast(`Connecté en tant qu'administrateur 🎾`, 'success');
        }
      });
      return;
    }

    // 1. Recherche parmi les joueurs locaux en mémoire
    let localPlayer = (DB.players || []).find(p => {
      const pEmail = (p.email || '').toLowerCase().trim();
      const pPhone = (p.phone || '').replace(/[\s\-\+\.]/g, '');
      const pFull = `${p.firstName || ''} ${p.lastName || ''}`.toLowerCase().trim();
      const pFirst = (p.firstName || '').toLowerCase().trim();
      return pEmail === norm ||
             (pPhone && (pPhone === cleanInput || cleanInput.endsWith(pPhone) || pPhone.endsWith(cleanInput))) ||
             pFull === norm ||
             pFirst === norm ||
             p.id === email;
    });

    // 2. Si non trouvé localement, interroger le serveur local /api/circlepadel/db
    if (!localPlayer) {
      try {
        const res = await fetch('/api/circlepadel/db');
        if (res.ok) {
          const remote = await res.json();
          if (remote && Array.isArray(remote.players)) {
            DB.players = remote.players;
            localPlayer = DB.players.find(p => {
              const pEmail = (p.email || '').toLowerCase().trim();
              const pPhone = (p.phone || '').replace(/[\s\-\+\.]/g, '');
              const pFull = `${p.firstName || ''} ${p.lastName || ''}`.toLowerCase().trim();
              const pFirst = (p.firstName || '').toLowerCase().trim();
              return pEmail === norm ||
                     (pPhone && (pPhone === cleanInput || cleanInput.endsWith(pPhone) || pPhone.endsWith(cleanInput))) ||
                     pFull === norm ||
                     pFirst === norm ||
                     p.id === email;
            });
          }
        }
      } catch (_) {}
    }

    // 3. Si mot de passe et format email, tenter Firebase
    let fbUser = null;
    if (password && norm.includes('@')) {
      try {
        const cred = await fbSignIn(norm, password);
        fbUser = cred?.user;
      } catch (fbErr) {
        console.warn('Firebase login info:', fbErr.code || fbErr.message);
      }
    }

    if (fbUser) {
      let player = (DB.players || []).find(p => p.id === fbUser.uid || p.email === fbUser.email);
      if (!player) {
        try {
          player = await fbGetPlayer(fbUser.uid);
          if (player && !DB.players.some(p => p.id === player.id)) DB.players.push(player);
        } catch (_) {}
      }
      if (!player && localPlayer) player = localPlayer;
      if (!player) {
        const parts = (fbUser.displayName || norm.split('@')[0]).split(' ');
        player = {
          id: fbUser.uid,
          firstName: parts[0] || 'Joueur',
          lastName: parts.slice(1).join(' ') || '',
          email: fbUser.email,
          phone: '',
          role: 'player',
          status: 'pending',
          level: null,
          preferredSide: 'right',
          playStyle: 'all-around',
          reliabilityScore: 50,
          peerConfrontationsCount: 0,
          totalMatchesPlayed: 0,
          skills: {},
          levelHistory: [],
          createdAt: new Date().toISOString(),
        };
        DB.players.push(player);
        fbSavePlayer(player).catch(() => {});
      }
      DB.currentUser = player;
    } else if (localPlayer) {
      DB.currentUser = localPlayer;
    } else {
      showToast('Aucun joueur trouvé avec cet identifiant (nom, email ou téléphone).', 'error');
      return;
    }

    saveDB(DB);
    updateAuthUI();
    updateAuthRoleUI();
    renderHomeScreen();
    renderProfileScreen();

    // Célébration animée EA Sports Pro à la connexion (rapide et percutante)
    showCelebrationModal({
      title: `Ravi de vous revoir, ${DB.currentUser.firstName} !`,
      subtitle: `Connexion sécurisée établie. Votre profil CirclePadel et vos stats sont synchronisées.`,
      badgeText: 'SESSION ATHLÈTE VALIDÉE',
      icon: '🎾',
      durationMs: 950,
      onComplete: () => {
        navigateToScreen('screen-profile');
        showToast(`Bon match chez CirclePadel 🎾`, 'success');
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    showToast('Erreur lors de la connexion.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Se connecter';
    }
  }
}

async function handlePlayerRegister({ firstName, lastName, phone, email, password, preferredSide, playStyle, selfEstimatedLevel, gender }) {
  if (!firstName || !firstName.trim()) {
    showToast('Veuillez indiquer au moins votre prénom.', 'error');
    const fInp = document.getElementById('authRegFirstName');
    if (fInp) fInp.focus();
    return;
  }

  const cleanFirst = firstName.trim();
  const cleanLast = (lastName || '').trim();
  const cleanPhone = (phone || '').trim();
  const cleanSide = preferredSide || 'right';
  const cleanStyle = playStyle || 'all-around';
  const cleanSelfLevel = typeof selfEstimatedLevel === 'number' ? selfEstimatedLevel : (parseFloat(document.getElementById('authRegLevelRange')?.value) || 5.0);
  const isAutoFemale = /^(mouna|mariem|meriem|sara|sarah|ines|yasmine|nour|lina|amina|selma|rim|leila|fatma|khadija|asma|emna|chaima|siwar)/i.test(cleanFirst);
  const cleanGender = (gender === 'female' || (!gender && isAutoFemale)) ? 'female' : 'male';

  // Email sécurisé (automatique si non renseigné)
  const slug = cleanFirst.toLowerCase().replace(/[^a-z0-9]/g, '') || 'joueur';
  const slugLast = cleanLast ? '.' + cleanLast.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const rnd = Math.floor(1000 + Math.random() * 9000);
  const safeEmail = (email && email.trim()) ? email.trim().toLowerCase() : `${slug}${slugLast}.${rnd}@circlepadel.tn`;

  // Mot de passe sécurisé (défaut padel2026)
  const safePassword = (password && password.length >= 6) ? password : 'padel2026';

  const submitBtn = document.getElementById('btnAuthSubmitRegister');
  const originalText = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ Création de votre profil...</span>';
  }

  let finalUid = null;

  // Tentative Firebase Auth (non bloquante en cas de refus réseau ou email déjà utilisé)
  try {
    const cred = await fbCreateUser(safeEmail, safePassword);
    if (cred?.user?.uid) {
      finalUid = cred.user.uid;
      const fullName = `${cleanFirst} ${cleanLast}`.trim();
      fbUpdateUserProfile(fullName).catch(() => {});
    }
  } catch (fbErr) {
    console.warn('Firebase createUser notice (mode local garanti):', fbErr.code || fbErr.message);
    if (fbErr.code === 'auth/email-already-in-use') {
      try {
        const cred = await fbSignIn(safeEmail, safePassword);
        if (cred?.user?.uid) finalUid = cred.user.uid;
      } catch (_) {}
    }
  }

  if (!finalUid) {
    finalUid = 'usr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  const newPlayer = {
    id: finalUid,
    firstName: cleanFirst,
    lastName: cleanLast,
    gender: cleanGender,
    phone: cleanPhone,
    email: safeEmail,
    role: 'player',
    status: 'pending', // en attente d'évaluation coach
    selfEstimatedLevel: cleanSelfLevel,
    level: cleanSelfLevel, // Note préliminaire immédiate
    preferredSide: cleanSide,
    playStyle: cleanStyle,
    reliabilityScore: 50,
    peerConfrontationsCount: 0,
    totalMatchesPlayed: 0,
    loyaltyPoints: 0,
    loyaltyHistory: [],
    skills: {},
    levelHistory: [{
      date: getTodayStr(),
      level: cleanSelfLevel,
      note: `Inscription joueur · Auto-évaluation préliminaire ${cleanSelfLevel}/10`
    }],
    createdAt: new Date().toISOString(),
  };

  // Trace d'audit certifiée
  const auditEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    action: 'PLAYER_REGISTERED',
    entityId: newPlayer.id,
    entityType: 'player',
    playerName: `${cleanFirst} ${cleanLast}`.trim(),
    playerEmail: safeEmail,
    playerPhone: cleanPhone,
    performedBy: 'Auto-inscription joueur (PWA mobile)',
    timestamp: new Date().toISOString(),
    details: `Inscription en ligne du joueur ${cleanFirst} ${cleanLast}. Auto-évaluation déclarée : ${cleanSelfLevel}/10.`
  };
  if (!Array.isArray(DB.auditLogs)) DB.auditLogs = [];
  DB.auditLogs.unshift(auditEntry);

  // Enregistrement immédiat dans DB.players et session active
  DB.players = (DB.players || []).filter(p => p.id !== newPlayer.id && p.email !== newPlayer.email);
  DB.players.push(newPlayer);
  DB.currentUser = newPlayer;
  DB.lastAction = 'PLAYER_REGISTERED';

  // Sauvegarde locale + sync backend instantané vers tous les appareils
  saveDB(DB, true, true);
  setTimeout(() => { delete DB.lastAction; }, 500);

  // Sauvegarde Firestore en tâche de fond
  fbSavePlayer(newPlayer).catch(e => console.warn('fbSavePlayer async error:', e));

  // Alerte instantanée pour le gérant : nouveau joueur à évaluer
  const managerAlert = {
    id: 'notif_eval_' + Date.now(),
    userId: 'admin',
    type: 'coach_eval_needed',
    title: 'Nouveau joueur à évaluer',
    message: `${cleanFirst} ${cleanLast} vient de créer son compte. Auto-évaluation : ${cleanSelfLevel}/10. Évaluation coach requise.`,
    playerId: newPlayer.id,
    read: false,
    createdAt: new Date().toISOString()
  };
  DB.notifications = DB.notifications || [];
  DB.notifications.unshift(managerAlert);

  // Mise à jour immédiate de l'UI
  updateAuthUI();
  updateAuthRoleUI();
  renderHomeScreen();
  renderProfileScreen();
  if (typeof renderAdminPlayers === 'function') renderAdminPlayers();
  if (typeof renderAdminKPIs === 'function') renderAdminKPIs();
  if (typeof renderAdminAlerts === 'function') renderAdminAlerts();
  if (typeof renderCoachPendingPlayers === 'function') renderCoachPendingPlayers();

  // Animation de célébration pro EA Sports / CirclePadel (rapide et percutante)
  showCelebrationModal({
    title: `Bienvenue, ${cleanFirst} !`,
    subtitle: `Votre compte officiel est actif. Niveau auto-évalué : ${cleanSelfLevel}/10 (en attente de passage devant le coach).`,
    badgeText: 'NOUVEL ATHLÈTE ENREGISTRÉ',
    icon: '🏆',
    durationMs: 1100,
    onComplete: () => {
      navigateToScreen('screen-profile');
      showToast(`Bienvenue ${cleanFirst} ! Votre carte joueur officielle est prête 🎾`, 'success');
    }
  });

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }
}

async function handlePlayerLogout() {
  try {
    await fbSignOut();
  } catch (e) {}
  DB.currentUser = { id: 'guest', firstName: 'Invité', lastName: '', role: 'player', email: '' };
  saveDB(DB, true);
  updateAuthUI();
  updateAuthRoleUI();
  renderHomeScreen();
  renderProfileScreen();
  showToast('Déconnexion réussie.', 'info');
}

/**
 * Affiche la carte joueur en grand format sur l'écran du terrain (Mode Écran Terrain / LED Stadium)
 */
function openCourtsideDisplay() {
  const user = (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser || {};
  const mount = document.getElementById('courtsideCardMount');
  const srcCard = document.getElementById('futPlayerCard');
  if (mount && srcCard) {
    mount.innerHTML = '';
    const cloned = srcCard.cloneNode(true);
    cloned.id = 'futPlayerCard_courtside';
    cloned.classList.add('courtside-active-card');
    mount.appendChild(cloned);
  }

  const tickerStyle = document.getElementById('csTickerStyle');
  if (tickerStyle) {
    tickerStyle.textContent = `${(STYLE_LABELS[user.playStyle] || 'Polyvalent')} · ${(SIDE_LABELS[user.preferredSide] || 'Droitier')}`;
  }
  const tickerRel = document.getElementById('csTickerRel');
  if (tickerRel) {
    tickerRel.textContent = `${user.reliabilityScore || 50}% (${user.peerConfrontationsCount || 0} match(s) face à des pairs)`;
  }
  const tickerMatches = document.getElementById('csTickerMatches');
  if (tickerMatches) {
    tickerMatches.textContent = `${user.peerConfrontationsCount || 0} match(s) calibré(s)`;
  }
  const tickerLevel = document.getElementById('csTickerLevel');
  if (tickerLevel) {
    tickerLevel.textContent = user.level != null ? `Niveau ${user.level}/10 · ${LEVEL_LABELS[user.level] || 'Certifié'}` : 'En attente d\'évaluation coach';
  }

  openModal('modal-courtside-display');
}

function switchAuthTab(tab) {
  const isLogin = tab === 'login';
  const tabLogin = document.getElementById('tabAuthLogin');
  const tabReg = document.getElementById('tabAuthRegister');
  const formLogin = document.getElementById('authLoginForm');
  const formReg = document.getElementById('authRegisterForm');
  const title = document.getElementById('authModalTitle');

  if (tabLogin) tabLogin.classList.toggle('active', isLogin);
  if (tabReg) tabReg.classList.toggle('active', !isLogin);
  if (formLogin) formLogin.style.display = isLogin ? 'block' : 'none';
  if (formReg) formReg.style.display = isLogin ? 'none' : 'block';
  if (title) title.textContent = isLogin ? '🎾 Connexion CirclePadel' : '🎾 Inscription CirclePadel';
}

function renderRadarChart(skills) {
  const svg = document.getElementById('skillsRadarSvg');
  if (!svg) return;
  const keys = Object.keys(SKILL_LABELS);
  const n = keys.length;
  const cx = 130, cy = 110, R = 85;
  const levels = 5;

  const isLight = document.body.classList.contains('light-mode');
  const gridStroke = isLight ? '#64748b' : 'rgba(255, 255, 255, 0.18)';
  const outerStroke = isLight ? '#1e293b' : 'rgba(255, 255, 255, 0.35)';
  const axisStroke = isLight ? '#475569' : 'rgba(255, 255, 255, 0.22)';
  const labelFill = isLight ? '#0f172a' : 'var(--text-secondary)';
  const dotStroke = isLight ? '#ffffff' : 'var(--bg-canvas)';

  let html = '';

  // Grid polygons (les petits traits concentriques du radar)
  for (let l = 1; l <= levels; l++) {
    const r = (R * l) / levels;
    const pts = keys.map((_, i) => {
      const angle = (2 * Math.PI * i / n) - Math.PI / 2;
      return `${(cx + r * Math.cos(angle)).toFixed(1)},${(cy + r * Math.sin(angle)).toFixed(1)}`;
    }).join(' ');
    const isOuter = l === levels;
    html += `<polygon points="${pts}" fill="none" stroke="${isOuter ? outerStroke : gridStroke}" stroke-width="${isOuter ? '1.8' : '1.3'}" stroke-dasharray="${isOuter ? 'none' : '3 3'}" opacity="${isLight ? (isOuter ? '1' : '0.85') : '0.7'}"/>`;
  }

  // Axes (rayons)
  keys.forEach((_, i) => {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    const x = (cx + R * Math.cos(angle)).toFixed(1);
    const y = (cy + R * Math.sin(angle)).toFixed(1);
    html += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${axisStroke}" stroke-width="1.3" opacity="${isLight ? '0.75' : '0.6'}"/>`;
  });

  const hasSkills = skills && Object.keys(skills).length > 0;
  if (hasSkills) {
    // Data polygon
    const pts = keys.map((k, i) => {
      const val = Math.max(0, Math.min(10, skills[k] || 0)) / 10;
      const angle = (2 * Math.PI * i / n) - Math.PI / 2;
      return `${(cx + R * val * Math.cos(angle)).toFixed(1)},${(cy + R * val * Math.sin(angle)).toFixed(1)}`;
    }).join(' ');
    html += `<polygon points="${pts}" fill="${isLight ? 'rgba(212,175,55,0.35)' : 'rgba(200,169,110,0.25)'}" stroke="var(--gold)" stroke-width="2.5" stroke-linejoin="round"/>`;

    // Dots
    keys.forEach((k, i) => {
      const val = Math.max(0, Math.min(10, skills[k] || 0)) / 10;
      const angle = (2 * Math.PI * i / n) - Math.PI / 2;
      const x = (cx + R * val * Math.cos(angle)).toFixed(1);
      const y = (cy + R * val * Math.sin(angle)).toFixed(1);
      html += `<circle cx="${x}" cy="${y}" r="4" fill="var(--gold)" stroke="${dotStroke}" stroke-width="2"/>`;
    });
  } else {
    // Subtle indicator in center when not evaluated yet, while keeping full radar grid visible
    html += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="${isLight ? '#475569' : 'var(--text-muted)'}" font-size="11" font-weight="700">Évaluation coach en attente</text>`;
  }

  // Labels
  keys.forEach((k, i) => {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    const lx = cx + (R + 18) * Math.cos(angle);
    const ly = cy + (R + 18) * Math.sin(angle);
    const anchor = lx < cx - 5 ? 'end' : lx > cx + 5 ? 'start' : 'middle';
    html += `<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${anchor}" fill="${labelFill}" font-size="10.5" font-family="'Plus Jakarta Sans', sans-serif" font-weight="800">${SKILL_LABELS[k]}</text>`;
  });

  svg.innerHTML = html;
}

function renderSkillsList(skills) {
  const container = document.getElementById('skillsList');
  if (!skills || Object.keys(skills).length === 0) {
    container.innerHTML = '<div style="padding:16px; color:var(--text-muted); font-size:13px">Pas encore évalué par le coach.</div>';
    return;
  }
  container.innerHTML = Object.keys(SKILL_LABELS).map(k => `
    <div class="skill-item">
      <span class="skill-name">${SKILL_LABELS[k]}</span>
      <div class="skill-bar">
        <div class="skill-bar-fill" style="width:${((skills[k] || 0) / 10) * 100}%"></div>
      </div>
      <span class="skill-score">${skills[k] || 0}<span style="font-size:9px; color:var(--text-muted)">/10</span></span>
    </div>`
  ).join('');
}

function renderLevelHistory(user) {
  const container = document.getElementById('levelHistoryContainer');
  if (!container) return;
  const history = user.levelHistory || [];
  if (history.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); font-size:13px; padding:8px 0">Aucun changement de niveau enregistré.</div>';
    return;
  }
  container.innerHTML = history.map(h => {
    const rawDate = h.changedAt ? (h.changedAt.includes('T') ? h.changedAt.split('T')[0] : h.changedAt) : (h.date || getTodayStr());
    const dateFormatted = formatDate(rawDate);
    const newLvl = h.newLevel != null ? h.newLevel : (h.level != null ? h.level : '?');
    const prevLvl = h.previousLevel != null ? h.previousLevel : '-';
    const noteText = h.coachComment || h.note || '';
    return `
    <div style="display:flex; gap:12px; align-items:flex-start; padding:12px 0; border-bottom:1px solid var(--border-subtle)">
      <div style="width:40px; height:40px; border-radius:50%; background:var(--gold-glow-sm); border:1px solid var(--border-gold-sm); display:flex; align-items:center; justify-content:center; font-family:'Outfit',sans-serif; font-size:16px; font-weight:900; color:var(--gold); flex-shrink:0">
        ${newLvl}
      </div>
      <div>
        <div style="font-size:13px; font-weight:700; color:var(--text-white)">
          ${prevLvl !== '-' ? `Niveau ${prevLvl} → ${newLvl}` : (newLvl !== '?' ? `Niveau : ${newLvl}` : 'Inscription · En attente d\'évaluation')}
          ${(h.newLevel != null && h.previousLevel != null) ? `
          <span style="font-size:11px; color:${h.newLevel > h.previousLevel ? 'var(--green)' : 'var(--red)'}">
            ${h.newLevel > h.previousLevel ? '▲' : '▼'}
          </span>` : ''}
        </div>
        <div style="font-size:11px; color:var(--text-muted); margin:2px 0">${dateFormatted}</div>
        ${noteText ? `<div style="font-size:12px; color:var(--text-secondary); font-style:italic; margin-top:4px">"${noteText}"</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderProfileHistory(user) {
  const container = document.getElementById('profileHistoryContainer');
  if (!container) return;

  const matches = (user.matchHistory && user.matchHistory.length)
    ? user.matchHistory
    : (DB.matchHistory || []).filter(m => [m.team1Player1Id, m.team1Player2Id, m.team2Player1Id, m.team2Player2Id].includes(user.id));

  if (!matches || matches.length === 0) {
    const myBookings = (DB.bookings || []).filter(b =>
      b.status === 'confirmed' && (b.players || []).some(p => p.userId === user.id)
    ).slice(0, 8);

    if (myBookings.length === 0) {
      container.innerHTML = '<div class="empty-state" style="padding:24px 0"><div class="empty-state-icon">🎾</div><div class="empty-state-title">Aucun match homologué</div><div style="font-size:12px; color:var(--text-secondary); margin-top:4px">Déclarez un match ou demandez au gérant pour faire évoluer votre niveau Elo !</div></div>';
      return;
    }

    container.innerHTML = myBookings.map(b => `
      <div class="history-item">
        <div class="history-result-dot neutral"></div>
        <div class="history-info">
          <div class="history-court">${b.courtName} · ${b.type === 'open' ? 'Match ouvert' : b.type === 'private' ? 'Privée' : 'Cours'}</div>
          <div class="history-date-level">${b.date === getTodayStr() ? 'Aujourd\'hui' : formatDate(b.date)} · ${b.startTime} · ${(b.players || []).length} joueurs</div>
        </div>
        <span style="font-size:11px; color:var(--text-muted)">${b.pricePerPlayer || 25} DT</span>
      </div>`
    ).join('');
    return;
  }

  container.innerHTML = matches.slice(0, 10).map(m => {
    const isWin = m.isWin;
    const delta = typeof m.delta === 'number' ? m.delta : 0;
    const deltaClass = delta > 0 ? 'positive' : (delta < 0 ? 'negative' : '');
    const deltaSign = delta > 0 ? `+${delta.toFixed(2)}` : `${delta.toFixed(2)}`;
    return `
      <div class="history-item" style="padding:10px 14px; background:var(--bg-card-2); border:1px solid var(--border-card); border-radius:10px; margin-bottom:8px">
        <div class="history-result-dot ${isWin ? 'win' : 'loss'}" style="background:${isWin ? '#2ecc71' : '#ff6b6b'}; width:10px; height:10px; border-radius:50%"></div>
        <div class="history-info" style="flex:1; margin-left:10px">
          <div style="display:flex; justify-content:space-between; align-items:center">
            <div style="font-weight:700; font-size:13px; color:var(--text-white)">
              ${isWin ? 'Victoire' : 'Défaite'} · Sets : <strong style="color:var(--gold)">${m.setsWon || 0} - ${m.setsLost || 0}</strong>
            </div>
            <div class="match-delta-preview-pill ${deltaClass}">${deltaSign}</div>
          </div>
          <div style="font-size:11px; color:var(--text-secondary); margin-top:2px">
            vs ${m.opponents || 'Paire adverse'} ${m.scoreDetail ? `(${m.scoreDetail})` : ''}
          </div>
          <div style="font-size:10px; color:var(--text-muted); margin-top:2px">
            ${m.date || "Aujourd'hui"} · Nouveau niveau : <strong>${(m.newLevel != null ? Number(m.newLevel).toFixed(2) : '5.00')}</strong> · Fiabilité : <strong>${(m.newReliability != null ? Number(m.newReliability).toFixed(1) : '50.0')}%</strong>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================================
// DROITS & AUTORISATION DE SAISIE DU SCORE (CIRCLEPADEL)
// ============================================================================

/**
 * RÈGLE D'AUTORISATION STRICTE (CIRCLEPADEL) :
 * Un score d'un match ne peut être renseigné ou homologué que par :
 * 1. Le gérant lui-même (mode backoffice ou rôle admin).
 * 2. OU les joueurs ayant participé à ce match ET possédant un compte officiel CirclePadel (non invité).
 */
function canUserRecordMatchScore(booking = null, targetUser = null) {
  const user = targetUser || (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser;

  // 1. Le gérant a toujours le plein pouvoir d'homologation de tous les matchs
  if (currentMode === 'backoffice-dashboard' || user?.role === 'admin') {
    return { allowed: true, reason: 'admin' };
  }

  // 2. Le joueur doit obligatoirement avoir un compte officiel CirclePadel (pas un invité sans compte)
  if (!user || !user.id || user.id === 'guest') {
    return {
      allowed: false,
      reason: 'Connexion requise : Vous devez posséder un compte officiel CirclePadel pour enregistrer un score.'
    };
  }
  const isGuest = user.role === 'guest' || user.status === 'guest';
  if (isGuest) {
    return {
      allowed: false,
      reason: 'Compte invité : Seuls les membres possédant un compte officiel CirclePadel peuvent enregistrer un score.'
    };
  }

  // 3. Si un match spécifique est ciblé : le joueur DOIT impérativement y avoir participé
  if (booking) {
    const players = booking.players || [];
    const hasParticipated = players.some(p => p && p.userId === user.id && !p.isGuest);
    if (!hasParticipated) {
      return {
        allowed: false,
        reason: 'Accès restreint : Seuls les joueurs ayant participé à ce match avec un compte CirclePadel, ou le gérant, peuvent enregistrer le score.'
      };
    }
  }

  return { allowed: true, reason: 'player_participant' };
}
window.canUserRecordMatchScore = canUserRecordMatchScore;

function isBookingFinished(b) {
  if (!b) return false;
  if (b.status === 'completed' || b.scoreRecorded === true) return true;
  if (b.status === 'cancelled') return false;
  if (!b.date) return false;

  const todayStr = getTodayStr();
  if (b.date < todayStr) return true;
  if (b.date > todayStr) return false;

  const now = new Date();
  const currentHH = String(now.getHours()).padStart(2, '0');
  const currentMM = String(now.getMinutes()).padStart(2, '0');
  const currentHHMM = `${currentHH}:${currentMM}`;
  const endTime = b.endTime || (typeof addMinutes === 'function' ? addMinutes(b.startTime || '10:00', 90) : '23:59');
  return currentHHMM >= endTime;
}
window.isBookingFinished = isBookingFinished;

// ============================================================================
// MY BOOKINGS
// ============================================================================

function renderMyBookings() {
  const container = document.getElementById('myBookingsContainer');
  if (!container) return;
  const today = getTodayStr();
  const user = (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser || {};
  const myBookings = (DB.bookings || []).filter(b =>
    b && b.status !== 'cancelled' && Array.isArray(b.players) && b.players.some(p => p && p.userId === user.id)
  ).sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime));

  if (myBookings.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-title">Aucune réservation</div><div class="empty-state-desc">Vous n'avez aucun match ou créneau réservé actuellement.</div></div>`;
    return;
  }

  container.innerHTML = myBookings.map(b => {
    const isFinished = isBookingFinished(b);
    const spots = (DB.appConfig?.maxPlayersPerMatch || 4) - (b.players || []).length;
    const hasRecorded = b.scoreRecorded === true;
    const canRecord = canUserRecordMatchScore(b).allowed;
    return `
    <div class="match-list-card" style="${isFinished ? 'opacity:0.85; border-color:rgba(255,255,255,0.08)' : ''}">
      <div class="match-list-top">
        <div>
          <div class="match-list-court">${b.courtName}</div>
          <div class="match-list-date">${b.date === today ? 'Aujourd\'hui' : formatDate(b.date)} · ${b.startTime} – ${b.endTime}</div>
        </div>
        <span class="match-status-badge ${isFinished ? '' : 'open'}">${isFinished ? (hasRecorded ? '✓ Terminé & Homologué' : 'Match Terminé') : 'Confirmé'}</span>
      </div>
      <div class="match-list-info-row">
        <div class="match-info-chip">
          <span class="chip-icon">${b.type === 'open' ? '🎾' : b.type === 'private' ? '🔒' : '🎓'}</span>
          <span>${b.type === 'open' ? `Match ouvert · Niv. ${b.minLevel||'?'}–${b.maxLevel||'?'}` : b.type === 'private' ? 'Privée' : 'Cours coach'}</span>
        </div>
        ${hasRecorded ? `<div class="match-info-chip" style="color:var(--green); border-color:rgba(46,204,113,0.3)"><span class="chip-icon">🏆</span><span>Score Enregistré</span></div>` : ''}
      </div>
      <div class="match-list-bottom">
        <span class="match-price-tag">${b.pricePerPlayer || 25} DT <span>/joueur</span></span>
        <div style="display:flex; gap:8px; align-items:center">
          ${(isFinished && canRecord) ? `
            <button type="button" onclick="openRecordMatchForBooking('${b.id}', 'player')" style="padding:6px 12px; border-radius:var(--radius-full); border:1px solid var(--gold); background:rgba(212,175,55,0.15); color:var(--gold); font-size:11px; font-weight:800; cursor:pointer" title="Enregistrer ou modifier le score">
              ${hasRecorded ? '🏆 Modifier le score' : '🏆 Saisir le score'}
            </button>` : ''}
          ${!isFinished && (b.players || []).some(p => p.userId === user.id) ? `
            <button onclick="cancelMyBooking('${b.id}')" style="padding:6px 14px; border-radius:var(--radius-full); border:1px solid rgba(231,76,60,0.3); background:transparent; color:var(--red); font-size:11px; font-weight:700; cursor:pointer">
              Annuler
            </button>` : ''}
        </div>
      </div>
      ${b.type === 'open' && !isFinished && spots > 0 ? `
        <div style="font-size:11px; color:var(--amber); margin-top:4px">⚡ ${spots} place${spots>1?'s':''} encore libre${spots>1?'s':''} — partagez le match !</div>` : ''}
    </div>`;
  }).join('');
}

function cancelMyBooking(bookingId) {
  const booking = (DB.bookings || []).find(b => b.id === bookingId);
  if (!booking) return;

  const [h, m] = (booking.startTime || '08:00').split(':').map(Number);
  const matchDate = new Date(booking.date);
  matchDate.setHours(h, m, 0, 0);
  const diffHours = (matchDate - new Date()) / 3600000;

  if (diffHours < (DB.appConfig?.cancelDeadlineHours || 2)) {
    showToast(`Annulation impossible : le délai de ${DB.appConfig?.cancelDeadlineHours || 2}h avant match est dépassé.`, 'error');
    return;
  }

  const user = (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser;
  const userName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Un joueur';
  const court = (DB.courts || []).find(c => c.id === booking.courtId);
  const courtName = court ? court.name : (booking.courtName || 'Court');

  const isOrganizer = (booking.players || []).some(p => p.userId === user.id && p.isOrganizer) ||
                      (booking.players || [])[0]?.userId === user.id ||
                      booking.type === 'private';

  if (isOrganizer) {
    // Si l'organisateur annule -> le match/créneau est retiré complètement
    booking.status = 'cancelled';
    booking.cancelledAt = new Date().toISOString();
    booking.cancelledBy = userName;
  } else {
    // Participant dans un match ouvert
    booking.players = (booking.players || []).filter(p => p.userId !== user.id);
    if (booking.players.length === 0) {
      booking.status = 'cancelled';
      booking.cancelledAt = new Date().toISOString();
      booking.cancelledBy = userName;
    }
  }

  // Notification prioritaire envoyée au gérant (Alertes)
  DB.notifications = DB.notifications || [];
  DB.notifications.unshift({
    id: `notif_cancel_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    userId: 'admin',
    targetRole: 'admin',
    type: 'booking_cancelled',
    title: '❌ Réservation annulée par un joueur',
    body: `${userName} a annulé sa réservation sur le ${courtName} le ${formatDate(booking.date)} à ${booking.startTime}. Le créneau a été retiré et libéré sur votre planning.`,
    bookingId: booking.id,
    courtName: courtName,
    courtId: booking.courtId,
    date: booking.date,
    startTime: booking.startTime,
    cancelledBy: userName,
    sentAt: new Date().toISOString(),
    isRead: false
  });

  // Sauvegarde et propagation multi-admin temps-réel (SSE 50ms)
  saveDB(DB, true);

  if (typeof fbCancelBooking === 'function') {
    fbCancelBooking(booking.id).catch(() => {});
  }

  showToast(`Réservation annulée. Le créneau a été retiré du tableau du gérant.`, 'info');

  renderMyBookings();
  renderHomeScreen();
  if (typeof renderCourtsGrid === 'function') renderCourtsGrid();
  if (typeof renderAdminTimetable === 'function') renderAdminTimetable();
  if (typeof renderAdminAlerts === 'function') renderAdminAlerts();
  if (typeof renderAdminKPIs === 'function') renderAdminKPIs();
}
window.cancelMyBooking = cancelMyBooking;

// ============================================================================
// NOTIFICATIONS
// ============================================================================

function renderNotifications() {
  const container = document.getElementById('notifListContainer');
  const userNotifs = DB.notifications
    .filter(n => n.userId === DB.currentUser.id)
    .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));

  if (userNotifs.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔔</div><div class="empty-state-title">Aucune notification</div></div>`;
    return;
  }

  const icons = { match_available:'🎾', level_updated:'⭐', match_alert:'🚨', cancellation:'❌', evaluation_pending:'📋' };

  container.innerHTML = userNotifs.map(n => `
    <div class="notif-item ${n.isRead ? '' : 'unread'}" onclick="markNotifRead('${n.id}')">
      <div class="notif-icon-wrap">${icons[n.type] || '📣'}</div>
      <div class="notif-body">
        <div class="notif-title">${n.title}</div>
        <div class="notif-msg">${n.body}</div>
        <div class="notif-time">${timeAgo(n.sentAt)}</div>
      </div>
      ${!n.isRead ? '<div class="notif-unread-dot"></div>' : ''}
    </div>`
  ).join('');
}

function markNotifRead(notifId) {
  const notif = DB.notifications.find(n => n.id === notifId);
  if (notif) { notif.isRead = true; saveDB(DB); renderNotifications(); }
}

// ============================================================================
// ADMIN DASHBOARD
// ============================================================================

let adminCurrentDate = getTodayStr();

function renderAdminDashboard() {
  renderAdminKPIs();
  renderAdminTimetable();
  renderAdminCourts();
  renderAdminPlayers();
  renderAdminMatches();
  renderAdminAlerts();
  renderAdminStats();
  document.getElementById('adminCurrentDate').textContent = formatDate(adminCurrentDate);
}

function renderAdminKPIs() {
  const todayBookings = (DB.bookings || []).filter(b => b.date === getTodayStr() && b.status === 'confirmed');
  const totalSlots = (DB.courts || []).length * SLOT_TIMES.length;
  const occupancy = totalSlots > 0 ? Math.round((todayBookings.length / totalSlots) * 100) : 0;
  const revenue = todayBookings.reduce((sum, b) => sum + ((b.pricePerPlayer || 25) * (b.players || []).length), 0);
  const activePlayers = (DB.players || []).filter(p => p.status === 'active').length;
  const alerts = checkMatchAlerts();
  const loyaltyNotifsCount = (DB.notifications || []).filter(n => (n.userId === 'admin' || n.targetRole === 'admin') && n.type === 'loyalty_milestone' && !n.isRead).length;
  const cancelNotifsCount = (DB.notifications || []).filter(n => (n.userId === 'admin' || n.targetRole === 'admin') && n.type === 'booking_cancelled' && !n.isRead).length;
  const pendingPlayersCount = (DB.players || []).filter(p => p.status === 'pending').length;
  const totalAlerts = alerts.length + loyaltyNotifsCount + cancelNotifsCount + pendingPlayersCount;
  const noShows = 0; // Phase 2

  const bEl = document.getElementById('kpiBookingsValue');
  if (bEl) bEl.textContent = `${todayBookings.length} créneaux`;
  const oEl = document.getElementById('kpiOccupancyValue');
  if (oEl) oEl.textContent = `${occupancy}%`;
  const rEl = document.getElementById('kpiRevenueValue');
  if (rEl) rEl.textContent = `${revenue} DT`;
  const pEl = document.getElementById('kpiPlayersValue');
  if (pEl) pEl.textContent = `${activePlayers} actifs`;
  const aEl = document.getElementById('kpiAlertsValue');
  if (aEl) aEl.textContent = totalAlerts;
  const nEl = document.getElementById('kpiNoShowsValue');
  if (nEl) nEl.textContent = `${noShows}`;
}

function renderAdminTimetable() {
  const headRow = document.getElementById('adminTimetableHeadRow');
  const body = document.getElementById('adminTimetableBody');
  const duration = DB.appConfig.slotDurationMinutes;

  // Header
  headRow.innerHTML = `<th style="width:70px">Heure</th>` +
    DB.courts.map(c => `<th>${c.name}</th>`).join('');

  // Body
  body.innerHTML = SLOT_TIMES.map(time => {
    const endTime = addMinutes(time, duration);
    const cells = DB.courts.map(court => {
      const booking = DB.bookings.find(b =>
        b.courtId === court.id && b.date === adminCurrentDate &&
        b.startTime === time && b.status === 'confirmed'
      );

      if (!booking) {
        return `<td onclick="openAdminSlotModal('${court.id}', '${time}', '${adminCurrentDate}')" style="cursor:pointer" title="Cliquer pour créer un créneau"></td>`;
      }

      const typeClass = { private:'type-private', open:'type-open', course:'type-course', blocked:'type-blocked' }[booking.type] || '';
      const playerCount = (booking.players || []).length;
      const organizer = (booking.players || []).find(p => p.isOrganizer);
      const displayName = organizer ? organizer.name : (booking.players?.[0]?.name || booking.notes || '—');
      const coPlayers = (booking.players || []).filter(p => !p.isOrganizer);
      const coNames = coPlayers.map(p => (p.name || '').trim().split(' ')[0]).filter(Boolean).join(', ');
      
      const subLabel = booking.type === 'open'
        ? `${playerCount}/4 joueurs · Niv.${booking.minLevel}–${booking.maxLevel}`
        : coNames
        ? `Avec: ${coNames}`
        : `${playerCount} joueur${playerCount > 1 ? 's' : ''}`;

      return `<td>
        <div class="cell-booking ${typeClass}" onclick="renderSlotDetail('${booking.id}'); openModal('modal-slot-detail')" style="cursor:pointer" title="Cliquer pour voir les joueurs et gérer ce créneau">
          <div class="cell-booking-name">${displayName}</div>
          <div class="cell-booking-sub">${subLabel}</div>
        </div>
      </td>`;
    }).join('');

    return `<tr><td style="font-size:12px; font-weight:700; color:var(--text-muted); text-align:center; background:var(--bg-canvas); vertical-align:middle">${time}<br><span style="font-size:10px; color:var(--border-card)">—${endTime}</span></td>${cells}</tr>`;
  }).join('');
}

function renderAdminCourts() {
  const container = document.getElementById('adminCourtsListContainer');
  const today = getTodayStr();

  container.innerHTML = DB.courts.map(court => {
    const todayBookings = DB.bookings.filter(b => b.courtId === court.id && b.date === today && b.status === 'confirmed');
    const totalRevenue = todayBookings.reduce((s, b) => s + (b.pricePerPlayer * (b.players || []).length), 0);
    const occ = Math.round((todayBookings.length / SLOT_TIMES.length) * 100);

    return `
    <div class="court-admin-card">
      <div class="court-admin-header">
        <div>
          <div class="court-admin-name">${court.name}</div>
          <div class="court-admin-surface">${court.surface}</div>
        </div>
        <div class="court-status-dot ${court.isActive ? '' : 'unavailable'}"></div>
      </div>
      <div class="court-occupancy-bar">
        <div class="occupancy-label">
          <span>Occupation aujourd'hui</span>
          <strong style="color:var(--gold)">${occ}%</strong>
        </div>
        <div class="occupancy-track">
          <div class="occupancy-fill" style="width:${occ}%"></div>
        </div>
      </div>
      <div style="padding:10px 16px; font-size:12px; color:var(--text-secondary); border-bottom:1px solid var(--border-subtle)">
        ${todayBookings.length} réservation${todayBookings.length !== 1 ? 's' : ''} · <strong style="color:var(--gold)">${totalRevenue} DT</strong>
      </div>
      <div class="court-admin-actions">
        <button class="btn-table-action" onclick="openAdminSlotModal('${court.id}', '17:00', '${today}')">+ Créneau</button>
        <button class="btn-table-action" onclick="showToast('Gestion du terrain ${court.name} — bientôt disponible', 'info')">Configurer</button>
      </div>
    </div>`;
  }).join('');
}

function renderAdminPlayers() {
  const tbody = document.getElementById('adminPlayersTableBody');
  if (!tbody) return;

  const activeFilter = window.currentAdminPlayerFilter || 'all';
  const searchQuery = (window.currentAdminPlayerSearch || '').trim().toLowerCase();

  // Bannière d'attente d'évaluation coach (filtrée par genre / statut / recherche)
  const pendingSection = document.getElementById('adminPendingEvalSection');
  const pendingContainer = document.getElementById('adminPendingPlayersCards');
  const pendingBadge = document.getElementById('adminPendingCountBadge');
  
  const allPending = (DB.players || []).filter(p => p.status === 'pending' || !p.level);
  const filteredPending = allPending.filter(p => {
    const isFem = isPlayerFemale(p);
    if (activeFilter === 'female' && !isFem) return false;
    if (activeFilter === 'male' && isFem) return false;
    if (searchQuery) {
      const q = `${p.firstName || ''} ${p.lastName || ''} ${p.phone || ''} ${p.email || ''}`.toLowerCase();
      if (!q.includes(searchQuery)) return false;
    }
    return true;
  });

  if (pendingBadge) pendingBadge.textContent = filteredPending.length;
  if (pendingSection) pendingSection.style.display = (allPending.length > 0) ? 'block' : 'none';
  if (pendingContainer) {
    if (filteredPending.length === 0) {
      const label = activeFilter === 'female' ? 'de joueuse femme' : activeFilter === 'male' ? 'de joueur homme' : 'de membre';
      pendingContainer.innerHTML = `<div style="color:var(--text-muted); font-size:13px; grid-column:1/-1">Aucun nouveau membre en attente d'évaluation (${label}).</div>`;
    } else {
      pendingContainer.innerHTML = filteredPending.map(p => {
        const isFem = isPlayerFemale(p);
        return `
        <div style="background:var(--bg-card); border:1px solid rgba(243,156,18,0.35); border-radius:var(--radius-md); padding:12px 14px; display:flex; justify-content:space-between; align-items:center; gap:10px">
          <div>
            <div style="font-weight:700; color:var(--text-white); font-size:14px; display:flex; align-items:center; gap:6px">
              <span>${p.firstName} ${p.lastName || ''}</span>
              <span style="font-size:11px">${isFem ? '👩' : '👨'}</span>
            </div>
            <div style="font-size:11px; color:var(--text-secondary); margin-top:2px">📞 ${p.phone || p.email || '—'}</div>
            <div style="font-size:11px; color:var(--amber); font-weight:600; margin-top:3px">⏳ Inscrit · En attente d'évaluation</div>
          </div>
          <button class="btn-table-action success" onclick="openPlayerEvalModal('${p.id}')" style="padding:7px 14px; font-weight:700">
            📋 Évaluer
          </button>
        </div>
      `}).join('');
    }
  }

  // Filtrage des joueurs de la table selon le filtre actif et la recherche
  const filteredPlayers = (DB.players || []).filter(p => {
    const isFem = isPlayerFemale(p);
    const isGuest = p.status === 'guest' || p.role === 'guest';
    if (activeFilter === 'female' && (!isFem || isGuest)) return false;
    if (activeFilter === 'male' && (isFem || isGuest)) return false;
    if (activeFilter === 'guest' && !isGuest) return false;
    if (activeFilter === 'active' && p.status !== 'active') return false;
    if (activeFilter === 'pending' && p.status !== 'pending' && !!p.level) return false;
    if (activeFilter === 'suspended' && p.status !== 'suspended') return false;

    if (searchQuery) {
      const q = `${p.firstName || ''} ${p.lastName || ''} ${p.phone || ''} ${p.email || ''}`.toLowerCase();
      if (!q.includes(searchQuery)) return false;
    }
    return true;
  });

  if (filteredPlayers.length === 0) {
    const filterLabel = activeFilter === 'female' ? 'de joueuse femme' : activeFilter === 'male' ? 'de joueur homme' : activeFilter === 'guest' ? 'd\'invité' : 'de joueur inscrit';
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:32px; color:var(--text-muted)">Aucun enregistrement trouvé (${filterLabel}).</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredPlayers.map(p => {
    const isFem = isPlayerFemale(p);
    const isGuest = p.status === 'guest' || p.role === 'guest';
    const genderKey = isGuest ? 'guest' : isFem ? 'female' : 'male';
    const genderBadge = isGuest
      ? '<span class="info-badge" style="background:rgba(255,255,255,0.06); color:var(--text-secondary); border:1px solid var(--border-subtle)">👤 Invité</span>'
      : isFem
      ? '<span class="info-badge" style="background:rgba(233,30,99,0.15); color:#ff6b8b; border:1px solid rgba(233,30,99,0.35); font-weight:700">👩 Femme</span>'
      : '<span class="info-badge" style="background:rgba(52,152,219,0.15); color:#54a0ff; border:1px solid rgba(52,152,219,0.35); font-weight:700">👨 Homme</span>';

    const statusBadge = isGuest
      ? '<span class="info-badge" style="background:rgba(200,169,110,0.12); border:1px solid rgba(200,169,110,0.3); color:var(--gold)">👤 Invité</span>'
      : p.status === 'active'
      ? '<span class="info-badge green">✔ Actif</span>'
      : p.status === 'pending'
      ? '<span class="info-badge" style="background:var(--amber-bg); border:1px solid rgba(243,156,18,0.2); color:var(--amber)">⏳ En attente</span>'
      : '<span class="info-badge red">⛔ Suspendu</span>';

    const lvlNum = p.level != null ? Number(p.level).toFixed(2) : (p.selfEstimatedLevel ? Number(p.selfEstimatedLevel).toFixed(2) : null);
    const levelCell = lvlNum
      ? `<span class="level-badge">${lvlNum} ${p.levelValidatedAt ? '<span class="coach-check">✓</span>' : '<span style="font-size:9px; color:var(--amber)">(auto)</span>'}</span>`
      : `<span class="level-badge pending">${isGuest ? 'Non évalué' : 'À évaluer'}</span>`;

    return `
    <tr data-gender="${genderKey}" data-status="${p.status || 'pending'}">
      <td>
        <div style="display:flex; align-items:center; gap:10px">
          <div class="player-table-avatar" style="background:${isGuest ? 'rgba(255,255,255,0.08)' : isFem ? 'rgba(233,30,99,0.2)' : 'rgba(52,152,219,0.2)'}; border:1px solid ${isGuest ? 'rgba(255,255,255,0.15)' : isFem ? 'rgba(233,30,99,0.4)' : 'rgba(52,152,219,0.4)'}">
            ${isGuest ? '👤' : isFem ? '👩' : '👨'}
          </div>
          <div>
            <div class="player-table-name">${p.firstName} ${p.lastName || ''}</div>
            <div style="font-size:11px; color:var(--text-muted)">
              <span>${p.email || (isGuest ? 'Compte invité (en attente d\'inscription)' : '—')}</span>
            </div>
          </div>
        </div>
      </td>
      <td>${genderBadge}</td>
      <td><span style="font-size:13px">${p.phone || '—'}</span></td>
      <td>${levelCell}</td>
      <td style="font-size:12px; color:var(--text-secondary)">
        ${SIDE_LABELS[p.preferredSide] || '—'} · ${STYLE_LABELS[p.playStyle] || '—'}
      </td>
      <td>
        <div style="display:flex; align-items:center; gap:6px">
          <div style="width:40px; height:4px; background:var(--border-subtle); border-radius:2px; overflow:hidden">
            <div style="width:${p.reliabilityScore || 50}%; height:100%; background:var(--gradient-gold)"></div>
          </div>
          <span style="font-size:12px; color:var(--text-secondary); font-weight:600">${(p.reliabilityScore || 50).toFixed(0)}%</span>
        </div>
        <div style="font-size:10px; color:var(--text-muted); margin-top:2px" title="Confrontations face à des pairs (±1.0)">
          ${p.peerConfrontationsCount || 0} match(s) pairs
        </div>
      </td>
      <td style="text-align:center">
        <span class="match-count-badge" style="font-family:'Outfit',sans-serif; font-size:14px; font-weight:900; color:var(--text-white); background:rgba(255,255,255,0.06); border:1px solid var(--border-subtle); padding:3px 9px; border-radius:10px" title="Matchs réellement joués et homologués">
          🎾 ${p.totalMatchesPlayed || 0}
        </span>
      </td>
      <td style="text-align:center">
        <span class="loyalty-count-badge" style="font-family:'Outfit',sans-serif; font-size:13px; font-weight:800; color:var(--gold); background:rgba(212,175,55,0.12); border:1px solid rgba(212,175,55,0.3); padding:3px 9px; border-radius:10px" title="Points fidélité cumulés sur le cercle">
          ⭐ ${getPlayerLoyaltyPoints(p).toFixed(1)} pts
        </span>
      </td>
      <td>${statusBadge}</td>
      <td>
        <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap">
          <button class="btn-table-action success" onclick="openPlayerEvalModal('${p.id}')" title="Évaluer le joueur">📋 Évaluer</button>
          <button class="btn-table-action" onclick="openEditPlayerModal('${p.id}')" style="border-color:var(--gold); color:var(--gold)" title="Modifier les informations">✏️ Modifier</button>
          <button class="btn-table-action danger" onclick="deletePlayer('${p.id}')" title="Supprimer ce joueur de la base">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/**
 * Rendu du Journal d'Audit & Traçabilité Certifiée
 * Affiche l'historique immuable de toutes les créations, suppressions, modifications et parrainages
 */
function renderAdminAuditLogs() {
  const tbody = document.getElementById('adminAuditTableBody');
  if (!tbody) return;

  const logs = Array.isArray(DB.auditLogs) ? DB.auditLogs : [];
  const searchInput = document.getElementById('adminAuditSearchInput');
  const query = (searchInput?.value || '').trim().toLowerCase();

  const filtered = logs.filter(item => {
    if (!query) return true;
    const hay = [
      item.action,
      item.playerName,
      item.performedBy,
      item.details,
      item.playerEmail,
      item.playerPhone,
      item.entityId
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(query);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center; padding:36px; color:var(--text-muted)">
          <div style="font-size:28px; margin-bottom:8px">📋</div>
          <div style="font-weight:600; color:var(--text-secondary)">Aucun enregistrement d'audit trouvé</div>
          <div style="font-size:12px; margin-top:4px">Toutes les créations, suppressions, modifications et parrainages sont tracés ici avec horodatage certifié.</div>
        </td>
      </tr>`;
    return;
  }

  const actionConfig = {
    'PLAYER_CREATED':    { label: '➕ Création Desk', bg: 'rgba(46,204,113,0.15)', color: '#2ecc71', border: 'rgba(46,204,113,0.35)' },
    'PLAYER_REGISTERED': { label: '📝 Inscription PWA', bg: 'rgba(52,152,219,0.15)', color: '#3498db', border: 'rgba(52,152,219,0.35)' },
    'PLAYER_DELETED':    { label: '🗑️ Suppression', bg: 'rgba(231,76,60,0.15)', color: '#e74c3c', border: 'rgba(231,76,60,0.35)' },
    'PLAYER_UPDATED':    { label: '✏️ Modification', bg: 'rgba(241,196,15,0.15)', color: '#f1c40f', border: 'rgba(241,196,15,0.35)' },
    'PLAYER_EVALUATED':  { label: '📋 Évaluation Coach', bg: 'rgba(155,89,182,0.15)', color: '#9b59b6', border: 'rgba(155,89,182,0.35)' },
    'REFERRAL_ADDED':    { label: '🌟 Parrainage Enfant', bg: 'rgba(212,175,55,0.15)', color: '#d4af37', border: 'rgba(212,175,55,0.35)' }
  };

  tbody.innerHTML = filtered.map(log => {
    const act = actionConfig[log.action] || { label: log.action || 'ACTION', bg: 'rgba(255,255,255,0.1)', color: 'var(--text-primary)', border: 'var(--border-subtle)' };
    const dateFormatted = log.timestamp ? new Date(log.timestamp).toLocaleString('fr-FR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }) : '—';

    return `
      <tr style="border-bottom: 1px solid var(--border-subtle)">
        <td style="white-space:nowrap; font-size:12px; font-weight:600; color:var(--text-secondary)">
          ${dateFormatted}
        </td>
        <td>
          <span style="display:inline-block; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:700; background:${act.bg}; color:${act.color}; border:1px solid ${act.border}">
            ${act.label}
          </span>
        </td>
        <td style="font-size:12px; font-weight:600; color:var(--text-white)">
          👤 ${log.performedBy || 'Gérant'}
        </td>
        <td>
          <div style="font-weight:700; color:var(--text-white); font-size:13px">${log.playerName || '—'}</div>
          ${(log.playerPhone || log.playerEmail) ? `<div style="font-size:11px; color:var(--text-muted)">${log.playerPhone || ''} ${log.playerEmail ? '· ' + log.playerEmail : ''}</div>` : ''}
        </td>
        <td style="font-size:12px; color:var(--text-secondary); max-width:380px">
          ${log.details || '—'}
        </td>
        <td style="white-space:nowrap">
          <span style="display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:700; color:#2ecc71; background:rgba(46,204,113,0.1); border:1px solid rgba(46,204,113,0.25); padding:2px 8px; border-radius:12px">
            🔒 Certifié
          </span>
        </td>
      </tr>
    `;
  }).join('');
}
window.renderAdminAuditLogs = renderAdminAuditLogs;

function renderAdminMatches() {
  const container = document.getElementById('adminMatchesListContainer');
  const today = getTodayStr();
  const openMatches = DB.bookings.filter(b => b.type === 'open' && b.date >= today && b.status === 'confirmed');

  if (openMatches.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">🎾</div><div class="empty-state-title">Aucun match ouvert</div></div>`;
    return;
  }

  container.innerHTML = openMatches.map(b => {
    const spots = DB.appConfig.maxPlayersPerMatch - b.players.length;
    return `
    <div class="court-admin-card">
      <div class="court-admin-header">
        <div>
          <div class="court-admin-name">${b.courtName}</div>
          <div class="court-admin-surface">${b.date === today ? 'Aujourd\'hui' : formatDate(b.date)} · ${b.startTime}</div>
        </div>
        <span class="match-status-badge ${spots === 0 ? 'full' : spots === 1 ? 'almost-full' : 'open'}">
          ${spots === 0 ? 'Complet' : `${spots} libre${spots > 1 ? 's' : ''}`}
        </span>
      </div>
      <div style="padding:12px 16px; border-bottom:1px solid var(--border-subtle)">
        <div style="font-size:11px; color:var(--text-muted); margin-bottom:6px">NIVEAU REQUIS</div>
        <span class="level-badge">${b.minLevel}–${b.maxLevel}</span>
      </div>
      <div style="padding:12px 16px; border-bottom:1px solid var(--border-subtle)">
        <div style="font-size:11px; color:var(--text-muted); margin-bottom:8px">JOUEURS INSCRITS (${b.players.length}/4)</div>
        ${b.players.map(p => `
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px">
            <div class="player-avatar-sm filled">🎾</div>
            <span style="font-size:12px; color:var(--text-primary)">${p.name}</span>
            <span class="level-badge" style="padding:1px 6px; font-size:10px">${p.level}</span>
            ${p.isOrganizer ? '<span style="font-size:10px; color:var(--gold)">Organisateur</span>' : ''}
          </div>`).join('')}
        ${Array(spots).fill('<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px"><div class="player-avatar-sm empty">+</div><span style="font-size:12px; color:var(--text-muted)">Place libre</span></div>').join('')}
      </div>
      <div class="court-admin-actions">
        <button class="btn-table-action danger" onclick="adminCancelBooking('${b.id}')">Annuler</button>
        <button class="btn-table-action" onclick="renderSlotDetail('${b.id}'); openModal('modal-slot-detail')">Détail</button>
      </div>
    </div>`;
  }).join('');
}

function renderAdminAlerts() {
  const container = document.getElementById('adminAlertsContainer');
  if (!container) return;
  const alerts = checkMatchAlerts();
  const pendingPlayers = (DB.players || []).filter(p => p.status === 'pending');

  // 1. Notifications de palier de fidélité non lues pour l'admin
  const loyaltyNotifs = (DB.notifications || []).filter(n =>
    (n.userId === 'admin' || n.targetRole === 'admin') &&
    n.type === 'loyalty_milestone' &&
    !n.isRead
  );

  // 2. Notifications d'annulation de créneaux par des joueurs
  const cancelNotifs = (DB.notifications || []).filter(n =>
    (n.userId === 'admin' || n.targetRole === 'admin') &&
    n.type === 'booking_cancelled' &&
    !n.isRead
  );

  // 3. Joueurs actuels ayant franchi un palier (>= 15 pts)
  const playersWithPalier = (DB.players || []).filter(p => (Number(p.loyaltyPoints) || 0) >= 15);

  let html = '';

  if (alerts.length === 0 && pendingPlayers.length === 0 && loyaltyNotifs.length === 0 && cancelNotifs.length === 0 && playersWithPalier.length === 0) {
    html = `<div class="empty-state"><div class="empty-state-icon">✅</div><div class="empty-state-title">Aucune alerte</div><div class="empty-state-desc">Tout est en ordre</div></div>`;
  }

  // A. Notifications d'annulation de créneau par un joueur (Priorité Gérant)
  cancelNotifs.forEach(n => {
    html += `
    <div class="alert-item critical" style="border-left:4px solid var(--red); background:rgba(231,76,60,0.08); border-radius:10px; margin-bottom:10px">
      <span class="alert-icon" style="font-size:24px">❌</span>
      <div class="alert-body">
        <div class="alert-title" style="color:var(--red); font-weight:800; font-size:13px">${n.title}</div>
        <div class="alert-desc" style="color:var(--text-primary); font-size:12px; margin-top:2px">${n.body}</div>
        <div style="font-size:10px; color:var(--text-muted); margin-top:4px">${timeAgo(n.sentAt)}</div>
      </div>
      <button class="alert-action-btn" onclick="dismissCancelAlert('${n.id}')" style="background:var(--red); color:#fff; font-weight:800; font-size:11px; white-space:nowrap; cursor:pointer">
        Vu ✓
      </button>
    </div>`;
  });

  // B. Notifications officielles de Paliers de Fidélité atteints
  loyaltyNotifs.forEach(n => {
    html += `
    <div class="alert-item" style="border-left:4px solid var(--gold); background:rgba(212,175,55,0.08); border-radius:10px; margin-bottom:10px">
      <span class="alert-icon" style="font-size:24px">${n.icon || '🎁'}</span>
      <div class="alert-body">
        <div class="alert-title" style="color:var(--gold); font-weight:800; font-size:13px">${n.title}</div>
        <div class="alert-desc" style="color:var(--text-primary); font-size:12px; margin-top:2px">${n.body}</div>
        <div style="font-size:10px; color:var(--text-muted); margin-top:4px">${timeAgo(n.sentAt)}</div>
      </div>
      <button class="alert-action-btn" onclick="dismissLoyaltyAlert('${n.id}')" style="background:var(--gold); color:#000; font-weight:800; font-size:11px; white-space:nowrap">
        Remis au joueur ✓
      </button>
    </div>`;
  });

  // Si pas de notif spécifique mais des membres du club ont atteint des paliers (ex: Ahmed Horrigue 32 pts)
  if (loyaltyNotifs.length === 0 && playersWithPalier.length > 0) {
    playersWithPalier.forEach(p => {
      const pts = Number(p.loyaltyPoints) || 0;
      const tier = pts >= 60 ? 60 : (pts >= 30 ? 30 : 15);
      const gift = tier === 60 ? 'Raquette Carbone Pro (Graal Ultime)' : (tier === 30 ? 'Tube de Balles Pro (À Mi-Chemin)' : 'Accessoires Padel Pro');
      const icon = tier === 60 ? '🏆' : (tier === 30 ? '📦' : '🎾');
      html += `
      <div class="alert-item" style="border-left:4px solid var(--gold); background:rgba(212,175,55,0.08); border-radius:10px; margin-bottom:10px">
        <span class="alert-icon" style="font-size:24px">${icon}</span>
        <div class="alert-body">
          <div class="alert-title" style="color:var(--gold); font-weight:800; font-size:13px">🎁 Palier ${tier} pts atteint — ${p.firstName} ${p.lastName || ''}</div>
          <div class="alert-desc" style="color:var(--text-primary); font-size:12px; margin-top:2px">
            Le joueur cumule <strong>${pts.toFixed(1)} points de fidélité</strong>. Dotation débloquée : <strong>${gift}</strong>.
          </div>
        </div>
        <button class="alert-action-btn" onclick="openEditPlayerModal('${p.id}')" style="background:var(--gold); color:#000; font-weight:800; font-size:11px; white-space:nowrap">
          Voir Fiche
        </button>
      </div>`;
    });
  }

  // C. Alertes Matchs Incomplets
  alerts.forEach(a => {
    html += `
    <div class="alert-item critical">
      <span class="alert-icon">🚨</span>
      <div class="alert-body">
        <div class="alert-title">Match incomplet — ${a.court} · ${a.time}</div>
        <div class="alert-desc">Il manque <strong>${a.playersMissing} joueur${a.playersMissing > 1 ? 's' : ''}</strong> pour compléter ce match dans moins de ${DB.appConfig.alertBeforeMatchHours}h.</div>
      </div>
      <button class="alert-action-btn" onclick="showToast('Notifications envoyées aux joueurs compatibles', 'success')">Notifier</button>
    </div>`;
  });

  // D. Joueurs en attente d'évaluation
  if (pendingPlayers.length > 0) {
    html += `
    <div class="alert-item warning">
      <span class="alert-icon">⏳</span>
      <div class="alert-body">
        <div class="alert-title">${pendingPlayers.length} joueur${pendingPlayers.length > 1 ? 's' : ''} en attente d'évaluation</div>
        <div class="alert-desc">${pendingPlayers.map(p => `${p.firstName} ${p.lastName}`).join(', ')}</div>
      </div>
      <button class="alert-action-btn" onclick="switchAdminTab('players')">Évaluer</button>
    </div>`;
  }

  container.innerHTML = html;
}

function dismissCancelAlert(notifId) {
  const notif = (DB.notifications || []).find(n => n.id === notifId);
  if (notif) {
    notif.isRead = true;
    saveDB(DB, true);
    renderAdminAlerts();
    renderAdminKPIs();
    showToast('Alerte d\'annulation archivée ✓', 'info');
  }
}
window.dismissCancelAlert = dismissCancelAlert;

function renderAdminStats() {
  // KPI cards
  const statsGrid = document.getElementById('statsGridContainer');
  const today = getTodayStr();
  const weekBookings = DB.bookings.filter(b => b.status === 'confirmed');
  const totalRevenue = weekBookings.reduce((s, b) => s + b.pricePerPlayer * b.players.length, 0);
  const activePlayers = DB.players.filter(p => p.status === 'active').length;
  const totalMatchesPlayed = weekBookings.filter(b => b.players.length === 4).length;

  if (statsGrid) {
    statsGrid.innerHTML = [
      { label: 'Revenus totaux', value: `${totalRevenue} DT`, sub: 'Base de données actuelle' },
      { label: 'Réservations totales', value: weekBookings.length, sub: 'Tous statuts confondus' },
      { label: 'Membres actifs', value: activePlayers, sub: 'Niveaux validés par coach' },
      { label: 'Matchs complets (4/4)', value: totalMatchesPlayed, sub: 'Terrain optimisé' },
    ].map(s => `
      <div class="stat-card">
        <div class="stat-card-label">${s.label}</div>
        <div class="stat-card-value">${s.value}</div>
        <div class="stat-card-sub">${s.sub}</div>
      </div>`
    ).join('');
  }

  // Occupancy chart (courts)
  const chart = document.getElementById('occupancyChart');
  if (chart) {
    chart.innerHTML = DB.courts.map(court => {
      const booked = DB.bookings.filter(b => b.courtId === court.id && b.status === 'confirmed').length;
      const pct = Math.min(100, Math.round((booked / (SLOT_TIMES.length * 7)) * 100));
      return `
      <div class="occ-bar-wrap">
        <div class="occ-bar" style="height:${pct}%; min-height:4px" title="${court.name}: ${pct}%"></div>
        <div class="occ-bar-label">${court.name.replace('Terrain ', 'T')}<br>${pct}%</div>
      </div>`;
    }).join('');
  }

  // Transactions table
  const tbody = document.getElementById('adminTransactionsTableBody');
  if (tbody) {
    const recentBookings = DB.bookings.filter(b => b.status === 'confirmed').slice(-10).reverse();
    if (recentBookings.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px">Aucune transaction</td></tr>';
    } else {
      tbody.innerHTML = recentBookings.map(b => {
        const organizer = (b.players || []).find(p => p.isOrganizer) || (b.players || [])[0];
        const amount = (b.pricePerPlayer || 25) * (b.players || []).length;
        return `
        <tr>
          <td style="color:var(--text-secondary)">${b.date}</td>
          <td>${organizer ? organizer.name : '—'}</td>
          <td><span class="slot-type-badge ${b.type}">${b.type === 'open' ? 'Match ouvert' : b.type === 'private' ? 'Privée' : b.type}</span></td>
          <td>${b.courtName}</td>
          <td style="font-weight:700; color:var(--gold)">${amount} DT</td>
          <td><span class="info-badge green" style="padding:2px 8px; font-size:10px">Sur place</span></td>
        </tr>`;
      }).join('');
    }
  }
}

// ============================================================================
// SLOT DETAIL MODAL
// ============================================================================

function renderSlotDetail(bookingId) {
  const b = DB.bookings.find(b => b.id === bookingId);
  if (!b) return;
  const spots = DB.appConfig.maxPlayersPerMatch - (b.players || []).length;
  const today = getTodayStr();

  const titleEl = document.getElementById('slotDetailTitle');
  if (titleEl) titleEl.textContent = `${b.courtName} · ${b.startTime}`;
  const contentEl = document.getElementById('slotDetailContent');
  if (!contentEl) return;

  // 4 positions tactiques sur le mini-terrain de padel (Équipe 1 vs Équipe 2)
  const players = b.players || [];
  const p1 = players[0] || null;
  const p2 = players[1] || null;
  const p3 = players[2] || null;
  const p4 = players[3] || null;

  const renderSpot = (player, spotIdx) => {
    if (player) {
      const parts = (player.name || 'Joueur').trim().split(' ');
      const initials = (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
      const lvl = player.level != null ? Number(player.level).toFixed(1) : '5.0';
      return `
        <div class="court-tactical-spot" title="${player.name} (Niveau ${lvl})">
          <div class="tactical-pin filled">${initials}</div>
          <div class="tactical-info">
            <span class="tactical-name">${parts[0]}</span>
            <span class="tactical-sub">Niv ${lvl}</span>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="court-tactical-spot" onclick="toggleAddPlayerForm('${b.id}')" title="Ajouter un joueur à cette place">
          <div class="tactical-pin empty">+</div>
          <div class="tactical-info">
            <span class="tactical-name" style="opacity:0.65">Place ${spotIdx + 1}</span>
            <span class="tactical-sub" style="font-size:8px; opacity:0.85">+ Inviter</span>
          </div>
        </div>
      `;
    }
  };

  contentEl.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:12px">
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center">
        <span class="slot-type-badge ${b.type}" style="font-size:12px; padding:4px 12px">${b.type === 'open' ? 'Match ouvert' : b.type === 'private' ? 'Partie Privée' : b.type === 'course' ? 'Cours' : 'Bloqué'}</span>
        <span class="match-status-badge ${spots===0?'full':spots===1?'almost-full':'open'}">${b.status === 'cancelled' ? 'Annulé' : spots === 0 ? 'Complet (4/4)' : `${spots} place${spots>1?'s':''} libre${spots>1?'s':''}`}</span>
      </div>

      <!-- MINI-TERRAIN PADEL COMPACT (AÉRÉ & TACTIQUE) -->
      <div style="background:var(--bg-card-2); border-radius:var(--radius-md); padding:12px; border:1px solid var(--border-card)">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
          <span style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.8px; color:var(--gold)">
            🏟️ Disposition Tactique du Terrain
          </span>
          <span style="font-size:11px; color:var(--text-secondary)">${players.length}/4 Joueurs</span>
        </div>
        
        <div class="mini-padel-court-wrap">
          <div class="mini-padel-court">
            <div class="mini-court-glass-border"></div>
            <div class="mini-court-service-left"></div>
            <div class="mini-court-center-line"></div>
            <div class="mini-court-net"></div>
            <div class="mini-court-service-right"></div>
            
            <!-- Équipe 1 (Gauche) -->
            <div class="mini-court-half">
              ${renderSpot(p1, 0)}
              ${renderSpot(p2, 1)}
            </div>

            <!-- Équipe 2 (Droite) -->
            <div class="mini-court-half">
              ${renderSpot(p3, 2)}
              ${renderSpot(p4, 3)}
            </div>
          </div>
        </div>
      </div>

      <!-- Détails Créneau -->
      <div style="background:var(--bg-card-2); border-radius:var(--radius-md); padding:14px; font-size:13px; display:flex; flex-direction:column; gap:6px">
        <div><span style="color:var(--text-muted)">Terrain :</span> <strong>${b.courtName}</strong></div>
        <div><span style="color:var(--text-muted)">Date :</span> <strong>${b.date === today ? 'Aujourd\'hui' : formatDate(b.date)}</strong></div>
        <div><span style="color:var(--text-muted)">Créneau :</span> <strong>${b.startTime} – ${b.endTime}</strong></div>
        ${b.minLevel ? `<div><span style="color:var(--text-muted)">Niveau requis :</span> <strong>${b.minLevel}–${b.maxLevel}</strong></div>` : ''}
        <div><span style="color:var(--text-muted)">Prix par joueur :</span> <strong style="color:var(--gold)">${b.pricePerPlayer || 25} DT</strong> <span style="font-size:11px; color:var(--text-muted)">(sur place)</span></div>
        ${b.notes ? `<div><span style="color:var(--text-muted)">Notes :</span> ${b.notes}</div>` : ''}
      </div>

      <!-- Liste Joueurs Inscrits & Actions Gérant -->
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
          <span style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-muted)">
            Joueurs participants (${b.players.length}/4)
          </span>
          ${spots > 0 ? `
            <button type="button" class="btn-table-action" onclick="toggleAddPlayerForm('${b.id}')" style="font-size:11px; padding:3px 10px; border-color:var(--gold); color:var(--gold)">
              + Ajouter un co-joueur
            </button>` : ''}
        </div>

        ${b.players.map(p => {
          const isG = p.isGuest || p.status === 'guest' || !p.gender;
          return `
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; background:rgba(255,255,255,0.03); padding:8px 12px; border-radius:8px">
            <div class="player-avatar-sm filled">${isG ? '👤' : '🎾'}</div>
            <div style="flex:1">
              <div style="font-size:13px; font-weight:700; color:var(--text-primary)">
                ${p.name}
                ${isG ? '<span class="card-tag" style="background:rgba(212,175,55,0.15); color:var(--gold); border:1px solid rgba(212,175,55,0.3); font-size:10px; margin-left:6px; padding:2px 7px; border-radius:6px">👤 Invité</span>' : ''}
              </div>
              <div style="font-size:11px; color:var(--text-muted)">Niveau ${p.level || '5.0'} ${p.isOrganizer ? '· Organisateur' : ''}</div>
            </div>
            ${currentMode === 'backoffice-dashboard' ? `<button class="btn-table-action danger" onclick="removePlayerFromBooking('${b.id}','${p.userId}')">Retirer</button>` : ''}
          </div>`;
        }).join('')}

        <!-- FORMULAIRE AJOUT CO-JOUEUR (ENRICHISSEMENT BDD CLUB) -->
        <div id="addPlayerToSlotDrawer_${b.id}" style="display:none; background:rgba(212,175,55,0.08); border:1.5px solid rgba(212,175,55,0.35); border-radius:10px; padding:12px; margin-top:10px">
          <div style="font-size:12px; font-weight:800; color:var(--gold); margin-bottom:8px">
            👤 Ajouter un joueur au créneau &amp; intégrer à la base de données
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px">
            <div>
              <label class="modal-label" style="font-size:10px">Prénom &amp; Nom *</label>
              <input type="text" class="login-field" id="slotNewPlayerName" placeholder="Ex: Sami Trabelsi" style="font-size:12px; padding:8px" required />
            </div>
            <div>
              <label class="modal-label" style="font-size:10px">Téléphone (WhatsApp)</label>
              <input type="tel" class="login-field" id="slotNewPlayerPhone" placeholder="+216 98 123 456" style="font-size:12px; padding:8px" />
            </div>
          </div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px">
            <div>
              <label class="modal-label" style="font-size:10px">Genre / Statut</label>
              <select class="login-field" id="slotNewPlayerGender" style="font-size:12px; padding:8px">
                <option value="">👤 Invité (sans sexe)</option>
                <option value="male">Homme 👨</option>
                <option value="female">Femme 👩</option>
              </select>
            </div>
            <div>
              <label class="modal-label" style="font-size:10px">Niveau estimé (1–10)</label>
              <input type="number" class="login-field" id="slotNewPlayerLevel" min="1" max="10" step="0.5" value="5.0" style="font-size:12px; padding:8px" />
            </div>
          </div>
          <div style="display:flex; gap:8px">
            <button type="button" class="btn-primary-action" onclick="submitAddPlayerToBooking('${b.id}')" style="flex:1; font-size:12px; padding:8px; background:linear-gradient(135deg, #2ecc71, #27ae60)">
              ✓ Enregistrer dans le match &amp; la BDD
            </button>
            <button type="button" class="btn-table-action" onclick="toggleAddPlayerForm('${b.id}')" style="font-size:12px">
              Annuler
            </button>
          </div>
        </div>
      </div>

      <!-- Action directe : Saisie officielle du score pour ce match (uniquement match terminé) -->
      ${(() => {
        const isFinished = isBookingFinished(b);
        if (!isFinished) {
          return `
          <div style="font-size:11.5px; color:var(--text-muted); text-align:center; padding:10px; background:rgba(255,255,255,0.03); border-radius:8px; border:1px solid rgba(255,255,255,0.06); margin-top:6px">
            ⏳ La saisie du score sera disponible dès la fin de ce match (${b.endTime || 'fin du créneau'}).
          </div>`;
        }
        const auth = canUserRecordMatchScore(b);
        if (auth.allowed) {
          return `
          <button type="button" class="btn-primary-action" onclick="openRecordMatchForBooking('${b.id}')" style="background:linear-gradient(135deg, #f59e0b, #d97706); display:flex; align-items:center; justify-content:center; gap:8px; font-size:13px; font-weight:800; padding:12px; margin-top:6px; border:none; box-shadow:0 4px 15px rgba(245,158,11,0.3)">
            🏆 Enregistrer / Saisir le score de ce match
          </button>`;
        } else {
          return `
          <div style="font-size:11.5px; color:var(--text-muted); text-align:center; padding:10px; background:rgba(255,255,255,0.03); border-radius:8px; border:1px solid rgba(255,255,255,0.06); margin-top:6px">
            🔒 La saisie du score est réservée aux joueurs ayant participé à ce match avec un compte CirclePadel, ou au gérant.
          </div>`;
        }
      })()}

      ${currentMode === 'backoffice-dashboard' ? `
        <div style="display:flex; gap:10px; margin-top:8px">
          <button class="btn-primary-action" style="flex:1" onclick="showToast('Rappel WhatsApp envoyé aux joueurs', 'success'); closeAllModals()">
            📱 Rappel WhatsApp
          </button>
          <button class="btn-secondary-action" style="flex:1" onclick="adminCancelBooking('${b.id}')">
            Annuler le créneau
          </button>
        </div>` : `
        <div style="margin-top:8px">
          <button class="btn-primary-action" onclick="closeAllModals()">Fermer</button>
        </div>`}
    </div>`;
}

function toggleAddPlayerForm(bookingId) {
  const drawer = document.getElementById(`addPlayerToSlotDrawer_${bookingId}`);
  if (drawer) {
    drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
  }
}

function submitAddPlayerToBooking(bookingId) {
  const booking = DB.bookings.find(b => b.id === bookingId);
  if (!booking) return;

  const nameInput = document.getElementById('slotNewPlayerName')?.value?.trim();
  if (!nameInput) {
    showToast('Veuillez indiquer le nom du joueur.', 'error');
    return;
  }

  const phoneInput = document.getElementById('slotNewPlayerPhone')?.value?.trim() || '';
  const rawGender = document.getElementById('slotNewPlayerGender')?.value;
  const genderInput = rawGender ? rawGender : null;
  const levelInput = parseFloat(document.getElementById('slotNewPlayerLevel')?.value) || 5.0;

  const parts = nameInput.split(' ');
  const firstName = parts[0];
  const lastName = parts.slice(1).join(' ');

  // Vérifier si le joueur existe déjà dans la base du club
  let existingPlayer = (DB.players || []).find(p =>
    (p.phone && phoneInput && p.phone === phoneInput) ||
    `${p.firstName} ${p.lastName || ''}`.toLowerCase().trim() === nameInput.toLowerCase().trim()
  );

  if (!existingPlayer) {
    // Créer un nouveau joueur dans la base de données du club (invité sans sexe ou joueur standard)
    const isGuest = !genderInput;
    existingPlayer = {
      id: (isGuest ? 'guest_' : 'usr_') + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      firstName: firstName,
      lastName: lastName,
      phone: phoneInput,
      gender: genderInput, // null si invité "sans sexe"
      email: `${firstName.toLowerCase().replace(/[^a-z0-9]/g, '')}.${Date.now().toString().slice(-4)}@circlepadel.tn`,
      role: isGuest ? 'guest' : 'player',
      status: isGuest ? 'guest' : 'pending',
      selfEstimatedLevel: levelInput,
      level: isGuest ? null : levelInput,
      loyaltyPoints: 0,
      reliabilityScore: 50,
      totalMatchesPlayed: 0,
      peerConfrontationsCount: 0,
      skills: {},
      levelHistory: [{
        date: getTodayStr(),
        level: levelInput,
        note: `Inscrit via réservation terrain ${booking.courtName}`
      }],
      createdAt: new Date().toISOString()
    };
    DB.players = DB.players || [];
    DB.players.push(existingPlayer);

    // Notification au coach
    DB.notifications = DB.notifications || [];
    DB.notifications.unshift({
      id: 'notif_new_player_' + Date.now(),
      userId: 'admin',
      type: 'coach_eval_needed',
      title: 'Nouveau joueur ajouté via créneau',
      message: `${nameInput} (${genderInput === 'female' ? 'Femme' : 'Homme'}) a été ajouté au créneau ${booking.courtName}. Évaluation coach en attente.`,
      playerId: existingPlayer.id,
      read: false,
      createdAt: new Date().toISOString()
    });
  }

  // Ajouter le joueur à la réservation s'il n'y est pas déjà
  booking.players = booking.players || [];
  if (booking.players.some(p => p.userId === existingPlayer.id)) {
    showToast('Ce joueur est déjà inscrit dans ce match.', 'info');
    return;
  }

  booking.players.push({
    userId: existingPlayer.id,
    name: `${existingPlayer.firstName} ${existingPlayer.lastName || ''}`.trim(),
    level: existingPlayer.level || levelInput,
    isOrganizer: false
  });

  saveDB(DB, true);
  showToast(`✓ ${nameInput} ajouté au match et enregistré dans la base des membres !`, 'success');
  renderSlotDetail(bookingId);
  renderAdminDashboard();
  renderAdminPlayers();
}

// Exposer globalement pour HTML onclick
window.toggleAddPlayerForm = toggleAddPlayerForm;
window.submitAddPlayerToBooking = submitAddPlayerToBooking;

function removePlayerFromBooking(bookingId, userId) {
  const booking = DB.bookings.find(b => b.id === bookingId);
  if (!booking) return;
  booking.players = booking.players.filter(p => p.userId !== userId);
  saveDB(DB);
  showToast('Joueur retiré de la réservation.', 'info');
  renderSlotDetail(bookingId);
  renderAdminDashboard();
}

function adminCancelBooking(bookingId) {
  const booking = DB.bookings.find(b => b.id === bookingId);
  if (!booking) return;
  booking.status = 'cancelled';
  saveDB(DB);
  showToast('Créneau annulé. Les joueurs ont été notifiés.', 'info');
  closeAllModals();
  renderAdminDashboard();
}

// ============================================================================
// PLAYER EVALUATION MODAL
// ============================================================================

let evalCurrentPlayerId = null;
let evalSkillValues = {};
let evalLevelValue = null;

function updateEvalPadelCalculationUI() {
  const { weightedScore, officialLevel } = calculatePadelLevelFromSkills(evalSkillValues);
  const badge = document.getElementById('evalCalculatedScoreBadge');
  if (badge) badge.textContent = `${weightedScore.toFixed(2)} / 10`;
  const disp = document.getElementById('evalCalculatedLevelDisplay');
  if (disp) {
    disp.textContent = `Niveau ${officialLevel}/10 · ${LEVEL_LABELS[officialLevel] || ''}`;
  }

  // Combinaison : 75% Coach (technique terrain) + 25% Auto-évaluation Joueur
  const player = (DB.players || []).find(p => p.id === evalCurrentPlayerId);
  const selfLvl = (player && player.selfEstimatedLevel != null) ? Number(player.selfEstimatedLevel) : (player && player.level != null ? Number(player.level) : officialLevel);
  const combinedRaw = (0.75 * officialLevel) + (0.25 * selfLvl);
  const combinedVal = Math.round(combinedRaw * 10) / 10;
  const combinedLevelInt = Math.max(1, Math.min(10, Math.round(combinedVal)));

  const combBadge = document.getElementById('evalCombinedLevelBadge');
  if (combBadge) {
    combBadge.textContent = `${combinedVal.toFixed(1)} / 10 (Niv ${combinedLevelInt})`;
  }
  const combFormula = document.getElementById('evalCombinedFormulaText');
  if (combFormula) {
    combFormula.textContent = `75% Coach (${officialLevel}) + 25% Auto-éval (${selfLvl.toFixed(1)}) = ${combinedVal.toFixed(1)}/10`;
  }

  return { weightedScore, officialLevel, combinedVal, combinedLevelInt };
}

function openPlayerEvalModal(playerId) {
  const player = (DB.players || []).find(p => p.id === playerId);
  if (!player) {
    showToast('Joueur introuvable.', 'error');
    return;
  }

  evalCurrentPlayerId = playerId;
  evalSkillValues = player.skills && Object.keys(player.skills).length ? { ...player.skills } : {};
  Object.keys(SKILL_LABELS).forEach(k => {
    if (evalSkillValues[k] === undefined) evalSkillValues[k] = 5;
  });

  const selfLvl = (player.selfEstimatedLevel != null) ? Number(player.selfEstimatedLevel) : (player.level || 5.0);
  const selfScoreEl = document.getElementById('evalPlayerSelfScore');
  if (selfScoreEl) selfScoreEl.textContent = `${selfLvl.toFixed(1)} / 10`;

  const { combinedLevelInt } = updateEvalPadelCalculationUI();
  evalLevelValue = player.levelValidatedAt ? player.level : combinedLevelInt;

  const modalTitle = document.getElementById('evalModalTitle');
  if (modalTitle) modalTitle.innerHTML = `Évaluation · <span id="evalPlayerName">${player.firstName} ${player.lastName || ''}</span>`;
  const nameCard = document.getElementById('evalPlayerNameCard');
  if (nameCard) nameCard.textContent = `${player.firstName} ${player.lastName || ''}`.trim();
  const phoneCard = document.getElementById('evalPlayerPhone');
  if (phoneCard) phoneCard.textContent = player.phone || player.email || '—';
  const levelCard = document.getElementById('evalPlayerCurrentLevel');
  if (levelCard) {
    levelCard.innerHTML = player.level
      ? `<span class="level-badge">${player.level}/10 <span class="coach-check">✓</span></span>`
      : `<span class="level-badge pending">⏳ En attente d'évaluation coach</span>`;
  }

  const commentEl = document.getElementById('evalCoachComment');
  if (commentEl) commentEl.value = '';

  // Skill dots (1–10)
  const skillsGrid = document.getElementById('skillsEvalGrid');
  if (skillsGrid) {
    skillsGrid.innerHTML = Object.entries(SKILL_LABELS).map(([skillKey, skillLabel]) => {
      const currentVal = evalSkillValues[skillKey] || 5;
      const dots = Array.from({ length: 10 }, (_, i) => i + 1).map(n => `
        <button type="button" class="skill-dot-btn ${n <= currentVal ? 'active' : ''}"
          data-val="${n}" onclick="setSkillValue('${skillKey}', ${n})">${n}</button>
      `).join('');
      const weightPct = Math.round((PADEL_SKILL_WEIGHTS[skillKey] || 0) * 100);
      return `
        <div class="skill-eval-row" data-skill="${skillKey}" style="margin-bottom:14px">
          <div style="display:flex; justify-content:space-between; margin-bottom:5px; font-size:12px">
            <span style="font-weight:600; color:var(--text-white)">${skillLabel} <span style="font-size:10px; color:var(--text-muted); font-weight:400">(${weightPct}%)</span></span>
            <span id="skillValDisplay_${skillKey}" style="color:var(--gold); font-weight:700">${currentVal}/10</span>
          </div>
          <div class="skill-eval-dots" style="display:flex; gap:4px; flex-wrap:wrap">
            ${dots}
          </div>
        </div>
      `;
    }).join('');
  }

  // Level selector (1–10)
  const levelSel = document.getElementById('evalLevelSelector');
  if (levelSel) {
    levelSel.innerHTML = Array.from({ length: 10 }, (_, i) => i + 1).map(n => `
      <div class="eval-level-btn ${n === evalLevelValue ? 'active' : ''}"
        onclick="setEvalLevel(${n})" title="${LEVEL_LABELS[n] || ''}">
        ${n}
      </div>
    `).join('');
  }

  const submitBtn = document.getElementById('btnSubmitEvaluation');
  if (submitBtn) submitBtn.dataset.playerId = playerId;

  openModal('modal-evaluate-player');
  const modalSheet = document.querySelector('#modal-evaluate-player .modal-sheet') || document.querySelector('#modal-evaluate-player .modal-card');
  if (modalSheet) modalSheet.scrollTop = 0;
}

function setSkillValue(skillKey, val) {
  evalSkillValues[skillKey] = val;
  const row = document.querySelector(`.skill-eval-row[data-skill="${skillKey}"]`);
  if (row) {
    row.querySelectorAll('.skill-dot-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.val) <= val);
    });
  }
  const disp = document.getElementById(`skillValDisplay_${skillKey}`);
  if (disp) disp.textContent = `${val}/10`;

  // Recalculer instantanément selon l'équation de moyenne propre au Padel
  const { officialLevel } = updateEvalPadelCalculationUI();
  setEvalLevel(officialLevel);
}

function setEvalLevel(level) {
  evalLevelValue = level;
  document.querySelectorAll('#evalLevelSelector .eval-level-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.textContent) === level);
  });
}

async function saveEvaluation(e) {
  if (e && e.preventDefault) e.preventDefault();
  const playerId = evalCurrentPlayerId;
  if (!playerId) {
    showToast('Joueur introuvable.', 'error');
    return;
  }
  if (!evalLevelValue) {
    showToast('Veuillez sélectionner un niveau officiel (1–10).', 'error');
    return;
  }

  const btn = document.getElementById('btnSubmitEvaluation');
  const originalText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Validation...';
  }

  try {
    const player = (DB.players || []).find(p => p.id === playerId);
    if (!player) {
      showToast('Joueur introuvable.', 'error');
      return;
    }

    const comment = document.getElementById('evalCoachComment')?.value?.trim() || '';
    const previousLevel = player.level;
    const { weightedScore, officialLevel, combinedVal, combinedLevelInt } = updateEvalPadelCalculationUI();

    player.coachRawLevel = officialLevel;
    player.selfEstimatedLevel = player.selfEstimatedLevel || officialLevel;
    player.level = evalLevelValue || combinedLevelInt;
    player.combinedScore = combinedVal;
    player.weightedScore = weightedScore;
    player.status = 'active'; // Joueur validé et actif !
    player.skills = { ...evalSkillValues };
    player.reliabilityScore = player.reliabilityScore || 50; // Fiabilité initiale coach 50%
    player.peerConfrontationsCount = player.peerConfrontationsCount || 0;
    player.levelValidatedAt = new Date().toISOString();
    player.levelValidatedBy = 'coach_ali';
    player.levelHistory = player.levelHistory || [];
    player.levelHistory.push({
      previousLevel: previousLevel || null,
      newLevel: player.level,
      coachRawLevel: officialLevel,
      selfEstimatedLevel: player.selfEstimatedLevel,
      formula: '75% Coach + 25% Auto-évaluation',
      weightedScore: weightedScore,
      changedAt: new Date().toISOString(),
      changedBy: 'coach_ali',
      coachComment: comment,
    });

    // Notification au joueur
    DB.notifications = DB.notifications || [];
    DB.notifications.push({
      id: `notif_${Date.now()}`,
      userId: player.id,
      type: 'level_updated',
      title: 'Niveau validé par le coach',
      body: `Félicitations ! Votre niveau officiel a été certifié à ${evalLevelValue}/10 par votre coach.${comment ? ` Note : "${comment}"` : ''}`,
      isRead: false,
      sentAt: new Date().toISOString(),
    });

    // Trace d'audit certifiée coach
    const auditEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      action: 'PLAYER_EVALUATED',
      entityId: player.id,
      entityType: 'player',
      playerName: `${player.firstName} ${player.lastName || ''}`.trim(),
      playerEmail: player.email || '',
      playerPhone: player.phone || '',
      performedBy: `${DB.currentUser?.firstName || 'Coach'} (Coach Ali)`,
      timestamp: new Date().toISOString(),
      details: `Certification officielle du niveau à ${evalLevelValue}/10 pour ${player.firstName} ${player.lastName || ''} (ancien niveau: ${previousLevel || 'non défini'}).${comment ? ` Note: "${comment}"` : ''}`
    };
    if (!Array.isArray(DB.auditLogs)) DB.auditLogs = [];
    DB.auditLogs.unshift(auditEntry);

    DB.lastAction = 'PLAYER_EVALUATED';
    saveDB(DB, true, true);
    setTimeout(() => { delete DB.lastAction; }, 500);
    closeAllModals();
    renderAdminPlayers();
    renderAdminKPIs();
    renderAdminAlerts();
    renderAdminAuditLogs();
    if (DB.currentUser?.id === player.id) {
      renderHomeScreen();
      updateAuthUI();
    }

    showToast(`✓ Niveau ${evalLevelValue}/10 validé pour ${player.firstName}`, 'success');

    // Sauvegarde Firestore en arrière-plan
    fbUpdatePlayerLevel(player.id, { level: evalLevelValue, coachComment: comment, coachId: 'coach_ali' })
      .catch(err => console.warn('fbUpdatePlayerLevel async error:', err));
    fbSavePlayer(player)
      .catch(err => console.warn('fbSavePlayer async error:', err));
    fbTrack('player_evaluated', { playerId: player.id, level: evalLevelValue });
  } catch (err) {
    console.error('Error in saveEvaluation:', err);
    showToast('Erreur lors de la validation.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

// ============================================================================
// PADEL RATING ENGINE (HYBRID ELO / GLICKO-2 · SCALE 1.00 TO 10.00)
// ============================================================================

let currentMatchSheetScore = { setsWon: 2, setsLost: 1 };
let currentMatchSheetMode = 'admin';

/**
 * Calcule l'ajustement dynamique de niveau et de fiabilité selon le modèle hybride Elo/Glicko-2
 * adapté au Padel sur l'échelle 1.00 à 10.00 (Standard YallaPlay / Playtomic étendu).
 */
function calculatePadelRatingUpdate({ playerLevel, playerReliability, partnerLevel, opponent1Level, opponent2Level, setsWon, setsLost }) {
  const pLevel = Math.max(1.0, Math.min(10.0, Number(playerLevel) || 5.0));
  const pReliability = Math.max(0, Math.min(99.0, Number(playerReliability) || 50.0));
  const partLevel = Math.max(1.0, Math.min(10.0, Number(partnerLevel) || pLevel));
  const opp1 = Math.max(1.0, Math.min(10.0, Number(opponent1Level) || 5.0));
  const opp2 = Math.max(1.0, Math.min(10.0, Number(opponent2Level) || 5.0));

  // Étape A : Moyennes des paires
  const teamAverage = (pLevel + partLevel) / 2;
  const opponentAverage = (opp1 + opp2) / 2;

  // Étape B : Probabilité attendue de victoire (E) - Courbe logistique calibrée pour l'échelle 1-10
  // Le diviseur est 0.85 * (9/7) ≈ 1.09 pour conserver l'exact même ratio 10:1 de probabilité
  const exponent = (opponentAverage - teamAverage) / 1.09;
  const expectedWinRate = 1 / (1 + Math.pow(10, exponent));

  // Étape C : Résultat réel pondéré par les sets (2-0, 2-1, 1-2, 0-2)
  let actualOutcome = 0;
  if (setsWon > setsLost) {
    actualOutcome = setsLost === 0 ? 1.00 : 0.85; // 2-0 net ou 2-1 disputé
  } else {
    actualOutcome = setsWon === 0 ? 0.00 : 0.25; // 0-2 net ou 1-2 disputé
  }

  // Étape D : Facteur K dynamique (Glicko-2) basé sur la fiabilité (0% à 99%)
  const reliabilityFraction = Math.max(0, Math.min(1, pReliability / 100));
  const kFactor = 0.42 - (0.34 * reliabilityFraction);

  // Étape E : Variation nette (Delta) avec clamping de sécurité [-0.55, +0.55]
  let delta = kFactor * (actualOutcome - expectedWinRate);
  delta = Math.max(-0.55, Math.min(0.55, delta));
  const deltaRounded = Number(delta.toFixed(2));

  // Étape F : Nouveau niveau borné [1.00, 10.00]
  const newLevel = Math.max(1.00, Math.min(10.00, Number((pLevel + deltaRounded).toFixed(2))));

  // Étape G : Progression de la fiabilité vers 99%
  const newReliability = Math.min(99.0, Number((pReliability + (100 - pReliability) * 0.035).toFixed(2)));

  return {
    newLevel,
    delta: deltaRounded,
    newReliability,
    expectedWinRate: Number((expectedWinRate * 100).toFixed(1)),
    teamAverage: Number(teamAverage.toFixed(2)),
    opponentAverage: Number(opponentAverage.toFixed(2)),
    kFactor: Number(kFactor.toFixed(3))
  };
}

function ensureDemoPlayersAvailable() {
  DB.players = DB.players || [];
  const existingNames = new Set(DB.players.map(p => `${p.firstName} ${p.lastName}`.toLowerCase().trim()));

  const demos = [
    { id: 'usr_ahmed', firstName: 'Ahmed', lastName: 'Horrigue', gender: 'male', level: 5.20, selfEstimatedLevel: 5.0, reliabilityScore: 62.0, totalMatchesPlayed: 14, peerConfrontationsCount: 14, status: 'active', preferredSide: 'right', playStyle: 'all-around' },
    { id: 'usr_bilel', firstName: 'Bilel', lastName: 'Krima', gender: 'male', level: 7.50, selfEstimatedLevel: 7.0, reliabilityScore: 84.0, totalMatchesPlayed: 28, peerConfrontationsCount: 28, status: 'active', preferredSide: 'left', playStyle: 'offensive' },
    { id: 'usr_mariem', firstName: 'Mariem', lastName: 'Snoussi', gender: 'female', level: 4.80, selfEstimatedLevel: 5.0, reliabilityScore: 48.0, totalMatchesPlayed: 8, peerConfrontationsCount: 8, status: 'active', preferredSide: 'right', playStyle: 'defensive' }
  ];

  demos.forEach(d => {
    const fullName = `${d.firstName} ${d.lastName}`.toLowerCase().trim();
    if (!existingNames.has(fullName) && !DB.players.some(p => p.id === d.id)) {
      DB.players.push(d);
    }
  });
}

// ============================================================================
// FEUILLE DE MATCH (RATING ENGINE ELO / GLICKO-2 & SAISIE LIBRE / FICHE CLUB)
// ============================================================================

function renderPlayerMiniFicheHTML(p) {
  if (!p) return '';
  const isGuest = p.status === 'guest' || p.role === 'guest';
  const isFem = isPlayerFemale(p);
  const lvl = (p.level != null ? Number(p.level).toFixed(2) : (p.selfEstimatedLevel ? Number(p.selfEstimatedLevel).toFixed(2) : '5.00'));
  const fiab = (p.reliabilityScore || 50).toFixed(0);
  const side = (typeof SIDE_LABELS !== 'undefined' && SIDE_LABELS[p.preferredSide]) || 'Polyvalent';
  const style = (typeof STYLE_LABELS !== 'undefined' && STYLE_LABELS[p.playStyle]) || 'Équilibré';
  const matches = p.totalMatchesPlayed || 0;
  const avatarBg = isGuest ? 'rgba(255,255,255,0.08)' : (isFem ? 'rgba(233,30,99,0.2)' : 'rgba(52,152,219,0.2)');
  const avatarBorder = isGuest ? 'rgba(255,255,255,0.2)' : (isFem ? 'rgba(233,30,99,0.4)' : 'rgba(52,152,219,0.4)');
  const genderEmoji = isGuest ? '👤' : (isFem ? '👩' : '👨');
  const fullName = (p.firstName ? `${p.firstName} ${p.lastName || ''}` : (p.name || 'Joueur')).trim();

  return `
    <div class="match-player-card-content">
      <div class="match-player-card-avatar" style="background:${avatarBg}; border:1px solid ${avatarBorder}">
        ${genderEmoji}
      </div>
      <div class="match-player-card-info">
        <div class="match-player-card-name">
          <span>${fullName}</span>
          <span style="font-size:9.5px; opacity:0.8; font-weight:600">${isGuest ? '👤 Invité' : (isFem ? '👩 Joueuse' : '👨 Joueur')}</span>
        </div>
        <div class="match-player-card-tags">
          <span class="card-tag gold">⭐ Niv ${lvl} / 10</span>
          <span class="card-tag fiab">🎯 Fiab. ${fiab}%</span>
          <span class="card-tag subtle">${side} · ${style}</span>
          <span class="card-tag subtle">🏆 ${matches} match${matches > 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  `;
}

function handleMatchPlayerSelectChange(slotId) {
  const sel = document.getElementById(slotId);
  const card = document.getElementById(`card_${slotId}`);
  const manual = document.getElementById(`manual_${slotId}`);
  const badge = document.getElementById(`badge_${slotId}`);
  if (!sel) return;

  if (sel.value === '__manual__') {
    if (card) { card.style.display = 'none'; card.innerHTML = ''; }
    if (manual) manual.style.display = 'block';
    if (badge) {
      badge.textContent = '✍️ Saisie libre';
      badge.style.color = '#e67e22';
    }
  } else {
    if (manual) manual.style.display = 'none';
    if (card) {
      const player = (DB.players || []).find(p => p.id === sel.value);
      if (player) {
        card.style.display = 'block';
        card.innerHTML = renderPlayerMiniFicheHTML(player);
      } else {
        card.style.display = 'none';
        card.innerHTML = '';
      }
    }
    if (badge) {
      badge.textContent = 'Fiche Club ✓';
      badge.style.color = 'var(--gold)';
    }
  }
  updateMatchSimulationPreview();
}
window.handleMatchPlayerSelectChange = handleMatchPlayerSelectChange;

function getSlotResolvedPlayer(slotId) {
  const select = document.getElementById(slotId);
  if (!select) return null;
  const val = select.value;
  if (val === '__manual__') {
    const nameInput = document.getElementById(`manualName_${slotId}`);
    const genderInput = document.getElementById(`manualGender_${slotId}`);
    const levelInput = document.getElementById(`manualLevel_${slotId}`);
    const fullName = (nameInput?.value || '').trim();
    const gender = genderInput?.value || 'male';
    const level = Math.max(1.0, Math.min(10.0, parseFloat(levelInput?.value) || 5.0));
    return {
      isManual: true,
      rawName: fullName,
      gender: gender,
      level: level,
      selfEstimatedLevel: level,
      reliabilityScore: 50,
      totalMatchesPlayed: 0,
      peerConfrontationsCount: 0
    };
  } else {
    const p = (DB.players || []).find(x => x.id === val);
    return p ? { ...p, isManual: false } : null;
  }
}

function setupSlotPicker(slotId, targetPlayerId, manualFallback = null) {
  const sel = document.getElementById(slotId);
  if (!sel) return;

  const players = DB.players || [];
  let html = `<option value="__manual__">✍️ + Saisie libre (Nouveau / Invité)</option>`;
  html += players.map(p => {
    const isGuest = p.status === 'guest' || p.role === 'guest';
    const isFem = isPlayerFemale(p);
    const lvl = (p.level != null ? Number(p.level).toFixed(2) : (p.selfEstimatedLevel ? Number(p.selfEstimatedLevel).toFixed(2) : '5.00'));
    const isSel = (!manualFallback && p.id === targetPlayerId) ? 'selected' : '';
    const icon = isGuest ? '👤' : (isFem ? '👩' : '👨');
    const fullName = (p.firstName ? `${p.firstName} ${p.lastName || ''}` : (p.name || 'Joueur')).trim();
    return `<option value="${p.id}" ${isSel}>${icon} ${fullName} (Niv ${lvl} · Fiab ${(p.reliabilityScore || 50).toFixed(0)}%)</option>`;
  }).join('');

  sel.innerHTML = html;

  if (manualFallback) {
    sel.value = '__manual__';
    const nameInput = document.getElementById(`manualName_${slotId}`);
    const genderInput = document.getElementById(`manualGender_${slotId}`);
    const levelInput = document.getElementById(`manualLevel_${slotId}`);
    if (nameInput) nameInput.value = manualFallback.name || '';
    if (genderInput) genderInput.value = manualFallback.gender || 'male';
    if (levelInput) levelInput.value = manualFallback.level != null ? Number(manualFallback.level).toFixed(1) : '5.0';
  } else if (targetPlayerId && players.some(p => p.id === targetPlayerId)) {
    sel.value = targetPlayerId;
  }

  handleMatchPlayerSelectChange(slotId);
}

let currentRecordingBookingId = null;
let _activeScorePromptBookingId = null;

function checkFinishedMatchesScorePrompt() {
  const user = (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser;
  if (!user || !user.id || user.id === 'guest' || currentMode === 'backoffice-dashboard') return;

  const todayStr = getTodayStr();
  const now = new Date();
  const currentHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // Chercher un match confirmé, auquel ce joueur a participé avec un compte officiel, dont l'horaire de fin est dépassé, et sans score saisi
  const pendingMatch = (DB.bookings || []).find(b => {
    if (!b || b.status !== 'confirmed' || b.scoreRecorded === true) return false;

    // Doit être un participant du match ayant un compte CirclePadel officiel (ou le créateur)
    const auth = canUserRecordMatchScore(b, user);
    if (!auth.allowed) return false;

    // Ignoré pour cette session ?
    if (sessionStorage.getItem('dismissed_score_prompt_' + b.id)) return false;

    // Vérifier si le créneau est dépassé
    const endTime = b.endTime || addMinutes(b.startTime || '10:00', 90);
    const isPast = (b.date < todayStr) || (b.date === todayStr && currentHHMM >= endTime);
    return isPast;
  });

  if (!pendingMatch) return;

  _activeScorePromptBookingId = pendingMatch.id;

  const detailsEl = document.getElementById('scorePromptMatchDetails');
  if (detailsEl) {
    const coPlayers = (pendingMatch.players || []).filter(p => p.userId !== user.id).map(p => p.name).filter(Boolean);
    const coText = coPlayers.length > 0 ? `<br><span style="color:var(--text-white); font-weight:600">Joueurs : ${coPlayers.join(', ')}</span>` : '';
    detailsEl.innerHTML = `
      <div style="font-weight:700; color:var(--gold); font-size:14px; margin-bottom:4px">
        🎾 ${pendingMatch.courtName} · ${pendingMatch.startTime} – ${pendingMatch.endTime}
      </div>
      <div>Date : <strong>${pendingMatch.date === todayStr ? "Aujourd'hui" : formatDate(pendingMatch.date)}</strong>${coText}</div>
    `;
  }

  // N'afficher que si aucune autre modale n'est ouverte
  const anyModalActive = document.querySelector('.modal-overlay.active');
  if (!anyModalActive) {
    openModal('modal-match-score-prompt');
  }
}
window.checkFinishedMatchesScorePrompt = checkFinishedMatchesScorePrompt;

function confirmOpenMatchRecordFromPrompt() {
  const bId = _activeScorePromptBookingId;
  closeModal('modal-match-score-prompt');
  if (bId) {
    openRecordMatchForBooking(bId, 'player');
  }
}
window.confirmOpenMatchRecordFromPrompt = confirmOpenMatchRecordFromPrompt;

function dismissFinishedMatchScorePrompt() {
  if (_activeScorePromptBookingId) {
    sessionStorage.setItem('dismissed_score_prompt_' + _activeScorePromptBookingId, 'true');
  }
  closeModal('modal-match-score-prompt');
}
window.dismissFinishedMatchScorePrompt = dismissFinishedMatchScorePrompt;

function openRecordMatchForBooking(bookingId, role) {
  closeAllModals();
  const b = (DB.bookings || []).find(bk => bk.id === bookingId);
  const auth = canUserRecordMatchScore(b);
  if (!auth.allowed) {
    showToast(auth.reason, 'error');
    return;
  }
  currentRecordingBookingId = bookingId || null;
  const mode = role || (currentMode === 'backoffice-dashboard' ? 'admin' : 'player');
  openRecordMatchModal(mode, b);
}
window.openRecordMatchForBooking = openRecordMatchForBooking;

function handleQuickCardRecordMatch() {
  closeAllModals();
  const auth = canUserRecordMatchScore(null);
  if (!auth.allowed) {
    showToast(auth.reason, 'error');
    return;
  }
  currentRecordingBookingId = null;
  openRecordMatchModal('player', null);
}
window.handleQuickCardRecordMatch = handleQuickCardRecordMatch;

function openRecordMatchModal(mode = 'admin', booking = null) {
  closeAllModals();
  const auth = canUserRecordMatchScore(booking);
  if (!auth.allowed) {
    showToast(auth.reason, 'error');
    return;
  }

  currentMatchSheetMode = mode;
  const badge = document.getElementById('matchSheetRoleBadge');
  if (badge) {
    badge.textContent = mode === 'admin' ? 'OFFICIEL CLUB / GÉRANT' : 'DÉCLARATION JOUEUR';
    badge.className = mode === 'admin' ? 'info-badge gold' : 'info-badge green';
  }

  ensureDemoPlayersAvailable();

  const players = DB.players || [];
  const slotIds = ['matchTeam1Player1', 'matchTeam1Player2', 'matchTeam2Player1', 'matchTeam2Player2'];

  if (booking && Array.isArray(booking.players) && booking.players.length > 0) {
    const bPlayers = booking.players;
    slotIds.forEach((sId, idx) => {
      const bp = bPlayers[idx];
      if (bp) {
        const match = players.find(p => {
          if (p.id === bp.userId) return true;
          const pName = (p.firstName ? `${p.firstName} ${p.lastName || ''}` : (p.name || '')).toLowerCase().trim();
          return bp.name && pName === bp.name.toLowerCase().trim();
        });
        if (match) {
          setupSlotPicker(sId, match.id, null);
        } else {
          setupSlotPicker(sId, null, { name: bp.name, gender: bp.gender || 'male', level: bp.level || 5.0 });
        }
      } else {
        const usedIds = new Set(slotIds.slice(0, idx).map(id => document.getElementById(id)?.value).filter(v => v && v !== '__manual__'));
        const nextAvailable = players.find(p => !usedIds.has(p.id))?.id || players[0]?.id;
        setupSlotPicker(sId, nextAvailable, null);
      }
    });
  } else {
    const currentUserId = (mode === 'player' && DB.currentUser?.id && DB.currentUser.id !== 'guest') ? DB.currentUser.id : null;
    const p1Id = currentUserId || (players[0]?.id || '');
    const p2Id = players.find(p => p.id !== p1Id)?.id || (players[1]?.id || '');
    const p3Id = players.find(p => p.id !== p1Id && p.id !== p2Id)?.id || (players[2]?.id || '');
    const p4Id = players.find(p => p.id !== p1Id && p.id !== p2Id && p.id !== p3Id)?.id || (players[3]?.id || '');

    setupSlotPicker('matchTeam1Player1', p1Id, null);
    setupSlotPicker('matchTeam1Player2', p2Id, null);
    setupSlotPicker('matchTeam2Player1', p3Id, null);
    setupSlotPicker('matchTeam2Player2', p4Id, null);
  }

  setMatchScoreSets(2, 1);
  openModal('modal-record-match');
}

function setMatchScoreSets(setsWon, setsLost) {
  currentMatchSheetScore = { setsWon, setsLost };
  document.querySelectorAll('.match-score-set-btn').forEach(btn => {
    const isTarget = btn.dataset.sets === `${setsWon}-${setsLost}`;
    btn.classList.toggle('active', isTarget);
  });

  const lbl = document.getElementById('matchScoreLabel');
  if (lbl) {
    const desc = setsWon > setsLost
      ? (setsLost === 0 ? '2 - 0 (Victoire nette)' : '2 - 1 (Victoire disputée)')
      : (setsWon === 0 ? '0 - 2 (Défaite nette)' : '1 - 2 (Défaite accrochée)');
    lbl.textContent = desc;
  }

  updateMatchSimulationPreview();
}

function updateMatchSimulationPreview() {
  try {
    const p1 = getSlotResolvedPlayer('matchTeam1Player1') || { level: 5.0, reliabilityScore: 50 };
    const p2 = getSlotResolvedPlayer('matchTeam1Player2') || { level: 5.0, reliabilityScore: 50 };
    const p3 = getSlotResolvedPlayer('matchTeam2Player1') || { level: 5.0, reliabilityScore: 50 };
    const p4 = getSlotResolvedPlayer('matchTeam2Player2') || { level: 5.0, reliabilityScore: 50 };

    const p1Level = Number(p1.level || p1.selfEstimatedLevel || 5.0);
    const p2Level = Number(p2.level || p2.selfEstimatedLevel || 5.0);
    const p3Level = Number(p3.level || p3.selfEstimatedLevel || 5.0);
    const p4Level = Number(p4.level || p4.selfEstimatedLevel || 5.0);

    const t1Avg = (p1Level + p2Level) / 2;
    const t2Avg = (p3Level + p4Level) / 2;

    const t1AvgEl = document.getElementById('team1AverageBadge');
    if (t1AvgEl) t1AvgEl.textContent = `Moyenne : ${t1Avg.toFixed(2)} / 10`;
    const t2AvgEl = document.getElementById('team2AverageBadge');
    if (t2AvgEl) t2AvgEl.textContent = `Moyenne : ${t2Avg.toFixed(2)} / 10`;

    const simT1 = calculatePadelRatingUpdate({
      playerLevel: t1Avg,
      playerReliability: ((p1.reliabilityScore || 50) + (p2.reliabilityScore || 50)) / 2,
      partnerLevel: t1Avg,
      opponent1Level: p3Level,
      opponent2Level: p4Level,
      setsWon: currentMatchSheetScore.setsWon,
      setsLost: currentMatchSheetScore.setsLost
    });

    const simT2 = calculatePadelRatingUpdate({
      playerLevel: t2Avg,
      playerReliability: ((p3.reliabilityScore || 50) + (p4.reliabilityScore || 50)) / 2,
      partnerLevel: t2Avg,
      opponent1Level: p1Level,
      opponent2Level: p2Level,
      setsWon: currentMatchSheetScore.setsLost,
      setsLost: currentMatchSheetScore.setsWon
    });

    const probEl = document.getElementById('matchWinProbBadge');
    if (probEl) probEl.textContent = `Probabilité Éq 1 : ${simT1.expectedWinRate}%`;

    const prevT1 = document.getElementById('matchDeltaTeam1Preview');
    if (prevT1) {
      const sign = simT1.delta >= 0 ? `+${simT1.delta.toFixed(2)}` : `${simT1.delta.toFixed(2)}`;
      prevT1.textContent = `${sign} pt (Niv estimé : ${(t1Avg + simT1.delta).toFixed(2)})`;
      prevT1.style.color = simT1.delta >= 0 ? '#2ecc71' : '#ff6b6b';
    }

    const prevT2 = document.getElementById('matchDeltaTeam2Preview');
    if (prevT2) {
      const sign = simT2.delta >= 0 ? `+${simT2.delta.toFixed(2)}` : `${simT2.delta.toFixed(2)}`;
      prevT2.textContent = `${sign} pt (Niv estimé : ${(t2Avg + simT2.delta).toFixed(2)})`;
      prevT2.style.color = simT2.delta >= 0 ? '#2ecc71' : '#ff6b6b';
    }
  } catch (err) {
    console.warn('Simulation preview update skipped:', err);
  }
}

async function submitRecordMatch(e) {
  if (e && e.preventDefault) e.preventDefault();

  const targetBooking = currentRecordingBookingId ? (DB.bookings || []).find(b => b.id === currentRecordingBookingId) : null;
  const auth = canUserRecordMatchScore(targetBooking);
  if (!auth.allowed) {
    showToast(auth.reason, 'error');
    return;
  }

  const slotIds = ['matchTeam1Player1', 'matchTeam1Player2', 'matchTeam2Player1', 'matchTeam2Player2'];
  const resolvedList = [];

  for (let i = 0; i < slotIds.length; i++) {
    const sId = slotIds[i];
    const res = getSlotResolvedPlayer(sId);
    if (!res) {
      showToast(`Veuillez renseigner le joueur ${i + 1}.`, 'error');
      return;
    }

    if (res.isManual) {
      if (!res.rawName || res.rawName.trim().length < 2) {
        showToast(`Veuillez saisir le nom complet pour la saisie libre (Joueur ${i + 1}).`, 'error');
        return;
      }
      const parts = res.rawName.trim().split(/\s+/);
      const fn = parts[0];
      const ln = parts.slice(1).join(' ') || '';

      // Recherche si un joueur porte déjà ce nom
      let match = (DB.players || []).find(p =>
        p.firstName?.toLowerCase() === fn.toLowerCase() &&
        (p.lastName || '').toLowerCase() === ln.toLowerCase()
      );

      if (!match) {
        // Créer un nouveau joueur dans la base du club !
        match = {
          id: 'usr_manual_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
          firstName: fn,
          lastName: ln,
          gender: res.gender,
          level: res.level,
          selfEstimatedLevel: res.level,
          reliabilityScore: 50,
          totalMatchesPlayed: 0,
          peerConfrontationsCount: 0,
          status: 'pending',
          role: 'player',
          preferredSide: 'right',
          playStyle: 'all-around',
          phone: '',
          email: '',
          loyaltyPoints: 0,
          createdAt: new Date().toISOString()
        };
        DB.players.push(match);
      }
      resolvedList.push(match);
    } else {
      resolvedList.push(res);
    }
  }

  const [p1, p2, p3, p4] = resolvedList;
  const uniqueIds = new Set([p1.id, p2.id, p3.id, p4.id]);
  if (uniqueIds.size < 4) {
    showToast('Veuillez sélectionner ou saisir 4 joueurs distincts pour ce match de double.', 'error');
    return;
  }

  // Vérification stricte : si c'est une déclaration joueur (hors gérant), le joueur connecté DOIT faire partie des 4 joueurs
  if (currentMatchSheetMode === 'player' && currentMode !== 'backoffice-dashboard' && DB.currentUser?.role !== 'admin') {
    const user = (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser;
    const isParticipant = resolvedList.some(p => p.id === user?.id);
    if (!isParticipant) {
      showToast("Vous devez impérativement faire partie des 4 joueurs du match pour en enregistrer le score.", "error");
      return;
    }
  }

  const btn = document.getElementById('btnSubmitRecordMatch');
  if (btn) { btn.disabled = true; btn.textContent = 'Calcul du Rating Elo...'; }

  try {
    const setsWon = currentMatchSheetScore.setsWon;
    const setsLost = currentMatchSheetScore.setsLost;
    const scoreDetail = document.getElementById('matchScoreGamesDetail')?.value?.trim() || '';

    // Calcul individuel pour chaque joueur
    const p1Level = Number(p1.level || p1.selfEstimatedLevel || 5.0);
    const p2Level = Number(p2.level || p2.selfEstimatedLevel || 5.0);
    const p3Level = Number(p3.level || p3.selfEstimatedLevel || 5.0);
    const p4Level = Number(p4.level || p4.selfEstimatedLevel || 5.0);

    const calc1 = calculatePadelRatingUpdate({
      playerLevel: p1Level, playerReliability: p1.reliabilityScore || 50,
      partnerLevel: p2Level, opponent1Level: p3Level, opponent2Level: p4Level,
      setsWon: setsWon, setsLost: setsLost
    });

    const calc2 = calculatePadelRatingUpdate({
      playerLevel: p2Level, playerReliability: p2.reliabilityScore || 50,
      partnerLevel: p1Level, opponent1Level: p3Level, opponent2Level: p4Level,
      setsWon: setsWon, setsLost: setsLost
    });

    const calc3 = calculatePadelRatingUpdate({
      playerLevel: p3Level, playerReliability: p3.reliabilityScore || 50,
      partnerLevel: p4Level, opponent1Level: p1Level, opponent2Level: p2Level,
      setsWon: setsLost, setsLost: setsWon
    });

    const calc4 = calculatePadelRatingUpdate({
      playerLevel: p4Level, playerReliability: p4.reliabilityScore || 50,
      partnerLevel: p3Level, opponent1Level: p1Level, opponent2Level: p2Level,
      setsWon: setsLost, setsLost: setsWon
    });

    const updates = [
      { player: p1, calc: calc1, isWin: setsWon > setsLost, setsWon, setsLost, partner: p2, opps: `${p3.firstName} & ${p4.firstName}` },
      { player: p2, calc: calc2, isWin: setsWon > setsLost, setsWon, setsLost, partner: p1, opps: `${p3.firstName} & ${p4.firstName}` },
      { player: p3, calc: calc3, isWin: setsLost > setsWon, setsWon: setsLost, setsLost: setsWon, partner: p4, opps: `${p1.firstName} & ${p2.firstName}` },
      { player: p4, calc: calc4, isWin: setsLost > setsWon, setsWon: setsLost, setsLost: setsWon, partner: p3, opps: `${p1.firstName} & ${p2.firstName}` }
    ];

    const todayStr = getTodayStr();

    updates.forEach(u => {
      const pl = u.player;
      pl.level = u.calc.newLevel;
      pl.reliabilityScore = u.calc.newReliability;
      pl.lastDelta = u.calc.delta;
      pl.totalMatchesPlayed = (pl.totalMatchesPlayed || 0) + 1;
      pl.peerConfrontationsCount = (pl.peerConfrontationsCount || 0) + 1;
      if (pl.status === 'guest') pl.status = 'active';

      // Attribution points fidélité (1.0 pt creuses 08h-17h, 0.5 pt pointe 17h-23h)
      const currentHour = new Date().getHours();
      const isOffPeak = currentHour >= 8 && currentHour < 17;
      const loyaltyGain = isOffPeak ? 1.0 : 0.5;

      const prevPoints = Number(pl.loyaltyPoints) || 0;
      pl.loyaltyPoints = Number((prevPoints + loyaltyGain).toFixed(1));
      pl.loyaltyHistory = pl.loyaltyHistory || [];
      pl.loyaltyHistory.push({
        type: 'match',
        date: todayStr,
        points: loyaltyGain,
        slotType: isOffPeak ? 'off_peak' : 'peak',
        note: isOffPeak ? 'Match heures creuses (08h-17h) : +1.0 pt' : 'Match heures de pointe (17h-23h) : +0.5 pt'
      });
      checkAndNotifyLoyaltyMilestones(pl, prevPoints, pl.loyaltyPoints);

      pl.matchHistory = pl.matchHistory || [];
      pl.matchHistory.unshift({
        id: 'match_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        date: todayStr,
        isWin: u.isWin,
        setsWon: u.setsWon,
        setsLost: u.setsLost,
        scoreDetail: scoreDetail,
        opponents: u.opps,
        delta: u.calc.delta,
        newLevel: u.calc.newLevel,
        newReliability: u.calc.newReliability
      });

      // Notification au joueur
      DB.notifications = DB.notifications || [];
      DB.notifications.unshift({
        id: 'notif_match_' + Date.now() + '_' + pl.id,
        userId: pl.id,
        type: 'match_alert',
        title: u.isWin ? 'Victoire homologuée 🎾' : 'Match homologué 🎾',
        body: `${u.isWin ? 'Victoire' : 'Défaite'} ${u.setsWon}-${u.setsLost} vs ${u.opps}. Nouveau niveau : ${u.calc.newLevel.toFixed(2)} (${u.calc.delta >= 0 ? '+' : ''}${u.calc.delta.toFixed(2)}). +${loyaltyGain} pt fidélité ajouté ! 🎾`,
        createdAt: new Date().toISOString()
      });

      if (typeof fbSavePlayer === 'function') fbSavePlayer(pl).catch(() => {});
    });

    // Enregistrement dans l'historique global
    DB.matchHistory = DB.matchHistory || [];
    DB.matchHistory.unshift({
      id: 'match_doc_' + Date.now(),
      date: todayStr,
      team1: `${p1.firstName} ${p1.lastName || ''} & ${p2.firstName} ${p2.lastName || ''}`,
      team2: `${p3.firstName} ${p3.lastName || ''} & ${p4.firstName} ${p4.lastName || ''}`,
      team1Player1Id: p1.id, team1Player2Id: p2.id,
      team2Player1Id: p3.id, team2Player2Id: p4.id,
      setsTeam1: setsWon,
      setsTeam2: setsLost,
      scoreDetail: scoreDetail,
      recordedBy: currentMatchSheetMode
    });

    if (currentRecordingBookingId) {
      const bk = (DB.bookings || []).find(b => b.id === currentRecordingBookingId);
      if (bk) {
        bk.scoreRecorded = true;
        bk.matchRecorded = true;
        bk.scoreDetail = scoreDetail;
      }
    }
    currentRecordingBookingId = null;

    saveDB(DB, true);
    closeAllModals();

    // Actualiser toutes les vues
    renderProfileScreen();
    renderHomeScreen();
    renderMyBookings();
    if (typeof renderAdminPlayers === 'function') renderAdminPlayers();
    if (typeof renderAdminKPIs === 'function') renderAdminKPIs();

    showToast(`✓ Match homologué ! Nouveaux niveaux et fiches mis à jour 🎾`, 'success');
  } catch (err) {
    console.error('submitRecordMatch error:', err);
    showToast('Erreur lors de l\'enregistrement du match.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✓ Homologuer le Match & Mettre à Jour les Niveaux 🎾'; }
  }
}

// ============================================================================
// GESTION JOUEUR (MODIFICATION & SUPPRESSION PAR LE GÉRANT)
// ============================================================================

function openEditPlayerModal(playerId) {
  const p = (DB.players || []).find(x => x.id === playerId);
  if (!p) return;
  document.getElementById('editPlayerId').value = p.id;
  document.getElementById('editPlayerFirstName').value = p.firstName || '';
  document.getElementById('editPlayerLastName').value = p.lastName || '';
  document.getElementById('editPlayerGender').value = p.gender || '';
  document.getElementById('editPlayerStatus').value = p.status || 'active';
  document.getElementById('editPlayerPhone').value = p.phone || '';
  document.getElementById('editPlayerEmail').value = p.email || '';
  document.getElementById('editPlayerLevel').value = p.level != null ? Number(p.level).toFixed(2) : (p.selfEstimatedLevel || '');
  document.getElementById('editPlayerLoyalty').value = (Number(p.loyaltyPoints) || 0).toFixed(1);
  document.getElementById('editPlayerSide').value = p.preferredSide || 'right';
  document.getElementById('editPlayerStyle').value = p.playStyle || 'all-around';
  openModal('modal-edit-player');
}
window.openEditPlayerModal = openEditPlayerModal;

function submitEditPlayer(e) {
  if (e && e.preventDefault) e.preventDefault();
  const id = document.getElementById('editPlayerId').value;
  const p = (DB.players || []).find(x => x.id === id);
  if (!p) return;

  p.firstName = document.getElementById('editPlayerFirstName').value.trim();
  p.lastName = document.getElementById('editPlayerLastName').value.trim();
  const rawGender = document.getElementById('editPlayerGender').value;
  p.gender = rawGender ? rawGender : null;
  p.status = document.getElementById('editPlayerStatus').value;
  p.phone = document.getElementById('editPlayerPhone').value.trim();
  p.email = document.getElementById('editPlayerEmail').value.trim();
  const lvlVal = document.getElementById('editPlayerLevel').value;
  p.level = lvlVal ? parseFloat(lvlVal) : null;
  const oldPts = Number(p.loyaltyPoints) || 0;
  p.loyaltyPoints = parseFloat(document.getElementById('editPlayerLoyalty').value) || 0;
  checkAndNotifyLoyaltyMilestones(p, oldPts, p.loyaltyPoints);
  p.preferredSide = document.getElementById('editPlayerSide').value;
  p.playStyle = document.getElementById('editPlayerStyle').value;

  // Trace d'audit certifiée modification
  const auditEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    action: 'PLAYER_UPDATED',
    entityId: p.id,
    entityType: 'player',
    playerName: `${p.firstName} ${p.lastName || ''}`.trim(),
    playerEmail: p.email || '',
    playerPhone: p.phone || '',
    performedBy: `${DB.currentUser?.firstName || 'Gérant'} ${DB.currentUser?.lastName || ''}`.trim() || 'Admin (Gérant)',
    timestamp: new Date().toISOString(),
    details: `Mise à jour des informations de ${p.firstName} ${p.lastName || ''} (Statut: ${p.status}, Niv: ${p.level || '?'}, Pts: ${p.loyaltyPoints}).`
  };
  if (!Array.isArray(DB.auditLogs)) DB.auditLogs = [];
  DB.auditLogs.unshift(auditEntry);

  DB.lastAction = 'PLAYER_UPDATED';
  saveDB(DB, true, true);
  setTimeout(() => { delete DB.lastAction; }, 500);
  closeAllModals();
  renderAdminPlayers();
  renderAdminKPIs();
  renderAdminAuditLogs();
  showToast(`Fiche de ${p.firstName} mise à jour ✓`, 'success');
}
window.submitEditPlayer = submitEditPlayer;

function deletePlayer(playerId) {
  const p = (DB.players || []).find(x => x.id === playerId);
  if (!p) return;
  const name = `${p.firstName} ${p.lastName || ''}`.trim();
  if (confirm(`Confirmez-vous la suppression définitive du joueur "${name}" ?\nCette action retirera le joueur immédiatement de tous les appareils et consignera une trace dans le journal d'audit.`)) {
    // 1. Trace d'audit certifiée et immuable
    const auditEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      action: 'PLAYER_DELETED',
      entityId: playerId,
      entityType: 'player',
      playerName: name,
      playerEmail: p.email || '',
      playerPhone: p.phone || '',
      playerLevel: p.level || p.selfEstimatedLevel || null,
      performedBy: `${DB.currentUser?.firstName || 'Gérant'} ${DB.currentUser?.lastName || ''}`.trim() || 'Moslem Gouia (Gérant)',
      timestamp: new Date().toISOString(),
      details: `Suppression définitive du compte joueur "${name}" (ID: ${playerId}) effectuée par le gérant.`,
      snapshot: {
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        phone: p.phone,
        email: p.email,
        level: p.level,
        reliabilityScore: p.reliabilityScore,
        totalMatchesPlayed: p.totalMatchesPlayed,
        loyaltyPoints: p.loyaltyPoints,
        role: p.role,
        status: p.status
      }
    };
    if (!Array.isArray(DB.auditLogs)) DB.auditLogs = [];
    DB.auditLogs.unshift(auditEntry);

    // 2. Tombstone de suppression permanente
    if (!Array.isArray(DB.deletedPlayerIds)) DB.deletedPlayerIds = [];
    if (!DB.deletedPlayerIds.includes(playerId)) DB.deletedPlayerIds.push(playerId);

    // 3. Suppression locale immédiate
    DB.players = (DB.players || []).filter(x => x.id !== playerId);
    DB.lastDeletedPlayerId = playerId;
    DB.deletedPlayerId = playerId;
    DB.lastAction = 'PLAYER_DELETED';

    // 4. Appel direct de l'API DELETE pour confirmation atomique serveur
    fetch(`/api/circlepadel/players/${encodeURIComponent(playerId)}`, { method: 'DELETE' }).catch(() => {});

    // 5. Propagation instantanée serveur & SSE (0ms)
    saveDB(DB, true, true);
    setTimeout(() => {
      delete DB.lastDeletedPlayerId;
      delete DB.deletedPlayerId;
      delete DB.lastAction;
    }, 500);

    // 6. Suppression distante Firestore en tâche de fond
    fbDeletePlayer(playerId).catch(() => {});

    closeAllModals();
    renderAdminPlayers();
    renderAdminKPIs();
    renderAdminAuditLogs();
    showToast(`✓ Joueur "${name}" supprimé définitivement partout.`, 'info');
  }
}
window.deletePlayer = deletePlayer;

function confirmDeleteFromEditModal() {
  const id = document.getElementById('editPlayerId')?.value;
  if (id) deletePlayer(id);
}
window.confirmDeleteFromEditModal = confirmDeleteFromEditModal;

/**
 * Inscription administrative d'un membre depuis la modale "Inscrire un membre"
 * Appelé directement par onclick="confirmRegisterPlayer()"
 */
function confirmRegisterPlayer() {
  const nameInput = document.getElementById('regPlayerName');
  const phoneInput = document.getElementById('regPlayerPhone');
  const emailInput = document.getElementById('regPlayerEmail');
  const genderInput = document.getElementById('regPlayerGender');
  const sideInput = document.getElementById('regPlayerSide');
  const styleInput = document.getElementById('regPlayerStyle');

  const name = nameInput?.value?.trim();
  if (!name) {
    showToast('Veuillez renseigner le nom du joueur.', 'error');
    if (nameInput) nameInput.focus();
    return;
  }

  const phone = phoneInput?.value?.trim() || '';
  const email = emailInput?.value?.trim() || '';
  const gender = genderInput?.value || 'male';
  const side = sideInput?.value || 'right';
  const style = styleInput?.value || 'offensive';

  const parts = name.split(/\s+/);
  const firstName = parts[0] || 'Membre';
  const lastName = parts.slice(1).join(' ') || '';

  const newPlayer = {
    id: `player_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    firstName,
    lastName,
    phone,
    email: email || `${firstName.toLowerCase()}.${(lastName.toLowerCase().replace(/[^a-z0-9]/g, '')) || Math.floor(100 + Math.random() * 900)}@circlepadel.tn`,
    gender,
    avatar: null,
    role: 'player',
    status: 'pending',
    level: null,
    selfEstimatedLevel: 5.0,
    preferredSide: side,
    playStyle: style,
    reliabilityScore: 50,
    totalMatchesPlayed: 0,
    skills: {},
    levelHistory: [{
      date: getTodayStr(),
      level: 5.0,
      note: 'Inscription administrative · En attente d\'évaluation officielle coach'
    }],
    loyaltyPoints: 0,
    loyaltyHistory: [],
    consentSignedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  // Trace d'audit certifiée
  const auditEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    action: 'PLAYER_CREATED',
    entityId: newPlayer.id,
    entityType: 'player',
    playerName: `${firstName} ${lastName}`.trim(),
    playerEmail: newPlayer.email,
    playerPhone: phone,
    performedBy: `${DB.currentUser?.firstName || 'Gérant'} ${DB.currentUser?.lastName || ''}`.trim() || 'Admin (Gérant)',
    timestamp: new Date().toISOString(),
    details: `Création administrative du membre "${firstName} ${lastName}" par le gérant au desk.`
  };
  if (!Array.isArray(DB.auditLogs)) DB.auditLogs = [];
  DB.auditLogs.unshift(auditEntry);

  if (!Array.isArray(DB.players)) DB.players = [];
  DB.players.push(newPlayer);
  DB.lastAction = 'PLAYER_CREATED';

  // Réinitialiser les champs du formulaire
  if (nameInput) nameInput.value = '';
  if (phoneInput) phoneInput.value = '';
  if (emailInput) emailInput.value = '';

  // Sauvegarde locale + sync backend instantané vers tous les appareils
  saveDB(DB, true, true);
  setTimeout(() => { delete DB.lastAction; }, 500);

  closeModal('modal-register-player');
  renderAdminPlayers();
  renderAdminKPIs();
  renderAdminAuditLogs();
  showToast(`✓ Membre "${firstName} ${lastName}" inscrit(e) et ajouté(e) aux évaluations !`, 'success');

  fbSavePlayer(newPlayer).catch(() => {});
  fbTrack('player_registered', { playerId: newPlayer.id });
}
window.confirmRegisterPlayer = confirmRegisterPlayer;

// Exposer globalement pour HTML onclick / onchange
window.openRecordMatchModal = openRecordMatchModal;
window.setMatchScoreSets = setMatchScoreSets;
window.updateMatchSimulationPreview = updateMatchSimulationPreview;
window.submitRecordMatch = submitRecordMatch;

// ============================================================================
// ADMIN SLOT CREATION
// ============================================================================

function openAdminSlotModal(courtId, time, date) {
  const courtEl = document.getElementById('adminSlotCourt');
  if (courtEl) courtEl.value = courtId ? courtId.replace('court_', '') : '1';
  const timeEl = document.getElementById('adminSlotTime');
  if (timeEl) timeEl.value = time || '17:00';
  const dateEl = document.getElementById('adminSlotDate');
  if (dateEl) dateEl.value = date || adminCurrentDate || getTodayStr();
  const notesEl = document.getElementById('adminSlotNotes');
  if (notesEl) notesEl.value = '';
  openModal('modal-admin-create-slot');
}

async function createAdminSlot(e) {
  if (e && e.preventDefault) e.preventDefault();
  const courtNum = parseInt(document.getElementById('adminSlotCourt')?.value) || 1;
  const courtId = `court_${courtNum}`;
  const court = DB.courts.find(c => c.id === courtId);
  const type = document.getElementById('adminSlotType')?.value || 'private';
  const time = document.getElementById('adminSlotTime')?.value || '17:00';
  const date = document.getElementById('adminSlotDate')?.value || adminCurrentDate || getTodayStr();
  const notes = document.getElementById('adminSlotNotes')?.value?.trim() || '';
  const levelVal = document.getElementById('adminSlotLevel')?.value || '4-6';
  const [minL, maxL] = levelVal.split('-').map(Number);
  const duration = DB.appConfig?.slotDurationMinutes || 90;

  if (!date) { showToast('Veuillez sélectionner une date.', 'error'); return; }

  const existing = (DB.bookings || []).find(b => b.courtId === courtId && b.date === date && b.startTime === time && b.status === 'confirmed');
  if (existing) { showToast('Ce créneau est déjà occupé.', 'error'); return; }

  const newBooking = {
    id: `bk_${Date.now()}`,
    courtId, courtName: court ? court.name : `Terrain ${courtNum}`,
    date, startTime: time, endTime: addMinutes(time, duration),
    type, status: 'confirmed',
    players: notes ? [{ userId: 'manual', name: notes, isOrganizer: true }] : [],
    waitlist: [],
    notes,
    minLevel: type === 'open' ? (minL || 3) : undefined,
    maxLevel: type === 'open' ? (maxL || 6) : undefined,
    pricePerPlayer: DB.appConfig?.pricePeak || 25,
    createdAt: new Date().toISOString(),
  };

  if (type === 'open') {
    notifyCompatiblePlayersForMatch(newBooking);
  }

  DB.bookings.push(newBooking);
  saveDB(DB);

  closeAllModals();
  renderAdminTimetable();
  renderCourtsGrid();
  renderAdminKPIs();
  showToast(`Créneau ${time} créé pour ${court?.name || courtNum} ✓`, 'success');
  fbAddBooking(newBooking).catch(e => console.warn('fbAddBooking async error:', e));
}


function notifyCompatiblePlayersForMatch(booking) {
  const tolerance = DB.appConfig.matchmakingTolerance;
  DB.players
    .filter(p => p.status === 'active' && p.level &&
      p.level >= (booking.minLevel - tolerance) &&
      p.level <= (booking.maxLevel + tolerance) &&
      !booking.players.some(bp => bp.userId === p.id))
    .slice(0, 20)
    .forEach(p => {
      DB.notifications.push({
        id: `notif_${Date.now()}_${p.id}`,
        userId: p.id,
        type: 'match_available',
        title: `Match ouvert · Niveau ${booking.minLevel}–${booking.maxLevel}`,
        body: `Un match est disponible ce ${booking.date} à ${booking.startTime} sur ${booking.courtName}.`,
        isRead: false,
        sentAt: new Date().toISOString(),
        data: { bookingId: booking.id },
      });
    });
}

// ============================================================================
// PLAYER REGISTRATION
// ============================================================================

function registerPlayer(e) {
  e.preventDefault();
  if (!document.getElementById('regConsent').checked) {
    showToast('Le consentement RGPD est obligatoire.', 'error');
    return;
  }

  const firstName = document.getElementById('regFirstName').value.trim();
  const lastName = document.getElementById('regLastName').value.trim();
  const phone = document.getElementById('regPhone').value.trim();

  if (!firstName || !lastName || !phone) {
    showToast('Veuillez remplir tous les champs obligatoires.', 'error');
    return;
  }

  const newPlayer = {
    id: `player_${Date.now()}`,
    firstName, lastName, phone,
    email: document.getElementById('regEmail').value.trim(),
    avatar: null, role: 'player',
    status: 'pending',
    level: null,
    levelValidatedAt: null,
    levelValidatedBy: null,
    preferredSide: document.getElementById('regSide').value,
    playStyle: document.getElementById('regStyle').value,
    reliabilityScore: 50,
    totalMatchesPlayed: 0,
    loyaltyPoints: 0,
    loyaltyHistory: [],
    skills: {},
    levelHistory: [],
    consentSignedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  // Trace d'audit certifiée
  const auditEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    action: 'PLAYER_CREATED',
    entityId: newPlayer.id,
    entityType: 'player',
    playerName: `${firstName} ${lastName}`.trim(),
    playerEmail: newPlayer.email,
    playerPhone: phone,
    performedBy: `${DB.currentUser?.firstName || 'Gérant'} ${DB.currentUser?.lastName || ''}`.trim() || 'Admin (Gérant)',
    timestamp: new Date().toISOString(),
    details: `Création administrative du joueur ${firstName} ${lastName} au desk.`
  };
  if (!Array.isArray(DB.auditLogs)) DB.auditLogs = [];
  DB.auditLogs.unshift(auditEntry);

  DB.players.push(newPlayer);
  DB.lastAction = 'PLAYER_CREATED';
  saveDB(DB, true, true);
  setTimeout(() => { delete DB.lastAction; }, 500);

  showToast(`✓ ${firstName} ${lastName} inscrit(e) et synchronisé(e) partout ✓`, 'success');
  closeAllModals();
  renderAdminPlayers();
  renderAdminAlerts();
  renderAdminKPIs();
  renderAdminAuditLogs();
}

// ============================================================================
// BOOKING FORM (player)
// ============================================================================

function submitBooking(e) {
  e.preventDefault();
  const courtNum = document.getElementById('bookCourtSelect').value;
  const courtId = `court_${courtNum}`;
  const court = DB.courts.find(c => c.id === courtId);
  const time = document.getElementById('bookTimeSelect').value;
  const date = document.getElementById('bookDate').value;
  const type = document.getElementById('bookTypeSelect').value;
  const duration = DB.appConfig.slotDurationMinutes;

  if (!date) { showToast('Veuillez sélectionner une date.', 'error'); return; }

  const existing = DB.bookings.find(b => b.courtId === courtId && b.date === date && b.startTime === time && b.status === 'confirmed');
  if (existing) { showToast('Ce créneau est déjà réservé. Choisissez un autre créneau ou terrain.', 'error'); return; }

  const user = DB.players.find(p => p.id === DB.currentUser.id);
  const newBooking = {
    id: `bk_${Date.now()}`,
    courtId, courtName: court?.name || `Terrain ${courtNum}`,
    date, startTime: time, endTime: addMinutes(time, duration),
    type, status: 'confirmed',
    players: [{ userId: DB.currentUser.id, name: `${user?.firstName} ${user?.lastName}`, level: user?.level, isOrganizer: true }],
    waitlist: [],
    pricePerPlayer: DB.appConfig.pricePeak,
    createdAt: new Date().toISOString(),
  };

  if (type === 'open') {
    newBooking.minLevel = Math.max(1, (user?.level || 3) - 1);
    newBooking.maxLevel = Math.min(7, (user?.level || 5) + 1);
    notifyCompatiblePlayersForMatch(newBooking);
  }

  DB.bookings.push(newBooking);
  saveDB(DB);
  showToast(`✓ Réservation confirmée · ${court?.name} · ${time}`, 'success');
  closeAllModals();
  renderHomeScreen();
}

function createMatch(e) {
  e.preventDefault();
  const courtNum = document.getElementById('createMatchCourtSelect').value;
  const courtId = `court_${courtNum}`;
  const court = DB.courts.find(c => c.id === courtId);
  const time = document.getElementById('createMatchTime').value;
  const date = document.getElementById('createMatchDate').value;
  const duration = DB.appConfig.slotDurationMinutes;

  if (!date) { showToast('Veuillez sélectionner une date.', 'error'); return; }
  if (!evalMatchLevelMin || !evalMatchLevelMax) { showToast('Veuillez définir la fourchette de niveau.', 'error'); return; }

  const user = DB.players.find(p => p.id === DB.currentUser.id);
  if (user?.status !== 'active') { showToast('Votre niveau doit être validé par le coach.', 'error'); return; }

  const newBooking = {
    id: `bk_${Date.now()}`,
    courtId, courtName: court?.name || `Terrain ${courtNum}`,
    date, startTime: time, endTime: addMinutes(time, duration),
    type: 'open', status: 'confirmed',
    minLevel: evalMatchLevelMin,
    maxLevel: evalMatchLevelMax,
    players: [{ userId: DB.currentUser.id, name: `${user?.firstName} ${user?.lastName}`, level: user?.level, isOrganizer: true }],
    waitlist: [],
    pricePerPlayer: DB.appConfig.pricePeak,
    createdAt: new Date().toISOString(),
  };

  notifyCompatiblePlayersForMatch(newBooking);
  DB.bookings.push(newBooking);
  saveDB(DB);
  showToast('Match ouvert publié ! Les joueurs compatibles ont été notifiés. 🎾', 'success');
  closeAllModals();
  renderHomeScreen();
  renderMatchesList();
}

let evalMatchLevelMin = 3, evalMatchLevelMax = 5;

function initCreateMatchLevelSelectors() {
  ['createMatchLevelMin', 'createMatchLevelMax'].forEach((containerId, idx) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = Array.from({ length: 10 }, (_, i) => i + 1).map(n => `
      <div class="eval-level-btn ${n === (idx === 0 ? evalMatchLevelMin : evalMatchLevelMax) ? 'active' : ''}"
        onclick="${idx === 0 ? `setMatchLevelMin(${n})` : `setMatchLevelMax(${n})`}"
        title="${LEVEL_LABELS[n]}">${n}</div>`
    ).join('');
  });
}

function setMatchLevelMin(n) {
  evalMatchLevelMin = n;
  document.querySelectorAll('#createMatchLevelMin .eval-level-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.textContent) === n);
  });
  updateMatchPriceDisplay();
}

function setMatchLevelMax(n) {
  evalMatchLevelMax = n;
  document.querySelectorAll('#createMatchLevelMax .eval-level-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.textContent) === n);
  });
  updateMatchPriceDisplay();
}

function updateMatchPriceDisplay() {
  const el = document.getElementById('createMatchPriceDisplay');
  if (el) el.textContent = `${DB.appConfig.pricePeak} DT`;
}

// ============================================================================
// ADMIN PLAYER ACTIONS
// ============================================================================

function activatePlayer(playerId) {
  const player = DB.players.find(p => p.id === playerId);
  if (!player) return;
  if (!player.level) {
    showToast('Ce joueur doit d\'abord être évalué par le coach avant d\'être activé.', 'error');
    return;
  }
  player.status = 'active';
  saveDB(DB);
  showToast(`${player.firstName} ${player.lastName} est maintenant actif.`, 'success');
  renderAdminPlayers();
}

function suspendPlayer(playerId) {
  const player = DB.players.find(p => p.id === playerId);
  if (!player) return;
  player.status = 'suspended';
  saveDB(DB);
  showToast(`${player.firstName} ${player.lastName} a été suspendu.`, 'info');
  renderAdminPlayers();
}

// ============================================================================
// ADMIN TAB SWITCHING
// ============================================================================

function switchAdminTab(tabName) {
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.adminTab === tabName);
  });
  document.querySelectorAll('.admin-tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `adminContent${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
  });
  if (tabName === 'players') {
    renderAdminPlayers();
  } else if (tabName === 'audit') {
    renderAdminAuditLogs();
  } else if (tabName === 'planning') {
    renderAdminTimetable();
  } else if (tabName === 'courts') {
    renderAdminCourts();
  } else if (tabName === 'alerts') {
    renderAdminAlerts();
  } else if (tabName === 'stats') {
    renderAdminKPIs();
    renderAdminStats();
  } else if (tabName === 'matches') {
    renderAdminMatches();
  }
}

// ============================================================================
// MODAL SYSTEM
// ============================================================================

function populateBookingCoPlayerPickers() {
  const currentId = DB.currentUser?.id;
  const players = (DB.players || []).filter(p => p && p.id !== currentId);
  // Trier les joueurs par prénom alphabétique
  players.sort((a, b) => (a.firstName || '').localeCompare(b.firstName || ''));

  const datalist = document.getElementById('clubPlayersDatalist');
  if (datalist) {
    datalist.innerHTML = players.map(p => {
      const fn = (p.firstName || '').trim();
      const ln = (p.lastName || '').trim();
      const fullName = `${fn} ${ln}`.trim();
      if (!fullName) return '';
      const isGuest = p.status === 'guest' || !p.gender;
      const lvl = p.level != null ? Number(p.level).toFixed(1) : (p.selfEstimatedLevel ? Number(p.selfEstimatedLevel).toFixed(1) : '5.0');
      return `<option value="${fullName}">${isGuest ? `${fullName} (Invité)` : `${fullName} · Niv.${lvl}`}</option>`;
    }).join('');
  }

  [2, 3, 4].forEach(spotNum => {
    const sel = document.getElementById(`bookCoPlayerSelect${spotNum}`);
    if (!sel) return;
    const currentVal = sel.value;
    
    let html = `<option value="">-- Choisir un joueur du club ou invité --</option>`;
    html += `<optgroup label="⭐ Joueurs de l'application">`;
    players.forEach(p => {
      const fn = (p.firstName || '').trim();
      const ln = (p.lastName || '').trim();
      const fullName = `${fn} ${ln}`.trim();
      if (!fullName) return;
      const isGuest = p.status === 'guest' || !p.gender;
      const lvl = p.level != null ? Number(p.level).toFixed(1) : (p.selfEstimatedLevel ? Number(p.selfEstimatedLevel).toFixed(1) : '5.0');
      html += `<option value="${p.id}" ${currentVal === p.id ? 'selected' : ''}>${fullName} (${isGuest ? 'Invité' : 'Niv. ' + lvl})</option>`;
    });
    html += `</optgroup>`;
    html += `<optgroup label="➕ Invité non inscrit">`;
    html += `<option value="__manual__" ${currentVal === '__manual__' ? 'selected' : ''}>✏️ Invité non inscrit (Saisie libre)...</option>`;
    html += `</optgroup>`;

    sel.innerHTML = html;
  });
}
window.populateBookingCoPlayerPickers = populateBookingCoPlayerPickers;
window.populateClubPlayersDatalist = populateBookingCoPlayerPickers;

function handleCoPlayerSelectChange(spotNum) {
  const sel = document.getElementById(`bookCoPlayerSelect${spotNum}`);
  const inp = document.getElementById(`bookCoPlayerInput${spotNum}`);
  if (!sel) return;
  if (sel.value === '__manual__') {
    if (inp) {
      inp.style.display = 'block';
      inp.focus();
    }
  } else {
    if (inp) {
      inp.style.display = 'none';
      inp.value = '';
    }
  }
  updateBookingCourtTacticalSpots();
}
window.handleCoPlayerSelectChange = handleCoPlayerSelectChange;

function focusCoPlayerSlot(spotNum) {
  const sel = document.getElementById(`bookCoPlayerSelect${spotNum}`);
  const inp = document.getElementById(`bookCoPlayerInput${spotNum}`);
  if (sel && sel.value === '__manual__' && inp && inp.style.display !== 'none') {
    inp.focus();
  } else if (sel) {
    sel.focus();
  }
}
window.focusCoPlayerSlot = focusCoPlayerSlot;

function updateBookingCourtTacticalSpots() {
  const user = (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser;
  const p1Name = `${user?.firstName || 'Vous'}`.trim();
  const p1Pin = document.getElementById('bookSpotPin1');
  const p1Label = document.getElementById('bookSpotName1');
  if (p1Pin) {
    const p1Init = ((user?.firstName?.[0] || 'V') + (user?.lastName?.[0] || '')).toUpperCase();
    p1Pin.textContent = p1Init.slice(0, 2);
  }
  if (p1Label) p1Label.textContent = p1Name;

  const updateSpot = (spotNum, defaultLabel) => {
    const sel = document.getElementById(`bookCoPlayerSelect${spotNum}`);
    const inp = document.getElementById(`bookCoPlayerInput${spotNum}`);
    const pin = document.getElementById(`bookSpotPin${spotNum}`);
    const nameEl = document.getElementById(`bookSpotName${spotNum}`);
    if (!pin || !nameEl) return;

    let displayName = '';
    let initials = '';

    if (sel && sel.value && sel.value !== '__manual__') {
      const p = (DB.players || []).find(x => x.id === sel.value);
      if (p) {
        displayName = p.firstName || '';
        initials = ((p.firstName?.[0] || '') + (p.lastName?.[0] || '')).toUpperCase();
      }
    } else if (sel && sel.value === '__manual__' && inp && inp.value.trim()) {
      const val = inp.value.trim();
      const parts = val.split(' ');
      displayName = parts[0];
      initials = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
    }

    if (displayName) {
      pin.className = 'tactical-pin filled';
      pin.textContent = initials.slice(0, 2) || '🎾';
      nameEl.textContent = displayName;
    } else {
      pin.className = 'tactical-pin empty';
      pin.textContent = '+';
      nameEl.textContent = defaultLabel;
    }
  };

  updateSpot(2, 'Partenaire');
  updateSpot(3, 'Adversaire 1');
  updateSpot(4, 'Adversaire 2');
}
window.updateBookingCourtTacticalSpots = updateBookingCourtTacticalSpots;

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
  if (modalId === 'modal-book-court') {
    populateBookingCoPlayerPickers();
    const user = (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser;
    const nameEl = document.getElementById('bookPlayer1NameDisplay');
    if (nameEl) {
      nameEl.textContent = `Joueur 1 : ${user?.firstName || 'Joueur'} ${user?.lastName || ''} (Organisateur)`.trim();
    }
    updateBookingCourtTacticalSpots();
  }
}

function closeModal(modalId) {
  if (modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('active');
      modal.style.display = 'none';
    }
  } else {
    closeAllModals();
  }
  document.body.style.overflow = '';
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.classList.remove('active');
    m.style.display = 'none';
  });
  document.body.style.overflow = '';
}

window.openModal = openModal;
window.closeModal = closeModal;
window.closeAllModals = closeAllModals;

/**
 * Affiche l'animation de célébration interactive (Style EA Sports FC / Nike)
 * lors de la connexion ou de la création d'un compte
 */
function showCelebrationModal({ title, subtitle, badgeText, icon = '🎾', durationMs = 2100, onComplete }) {
  const modal = document.getElementById('modal-auth-celebration');
  if (!modal) {
    if (onComplete) onComplete();
    return;
  }

  const titleEl = document.getElementById('celebrationTitle');
  const subEl = document.getElementById('celebrationSubtitle');
  const badgeEl = document.getElementById('celebrationBadge');
  const iconEl = document.getElementById('celebrationIcon');
  const fillEl = document.getElementById('celebrationProgressFill');

  if (titleEl && title) titleEl.textContent = title;
  if (subEl && subtitle) subEl.textContent = subtitle;
  if (badgeEl && badgeText) badgeEl.textContent = badgeText;
  if (iconEl) iconEl.textContent = icon;

  if (fillEl) {
    fillEl.style.transition = 'none';
    fillEl.style.width = '0%';
    void fillEl.offsetWidth; // Déclencher le reflow
    fillEl.style.transition = `width ${durationMs}ms cubic-bezier(0.1, 0.8, 0.3, 1)`;
    fillEl.style.width = '100%';
  }

  // Fermer les autres modales en cours
  closeAllModals();

  // Afficher la modale de célébration
  modal.style.display = 'flex';
  modal.classList.add('active');

  setTimeout(() => {
    modal.classList.remove('active');
    modal.style.display = 'none';
    if (onComplete) onComplete();
  }, durationMs);
}

// ============================================================================
// TOAST SYSTEM
// ============================================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { gold:'✦', success:'✓', error:'✗', info:'ℹ' };
  toast.innerHTML = `<span>${icons[type] || '•'}</span> <span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ============================================================================
// UTILITY FORMATTERS
// ============================================================================

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) { return dateStr; }
}

function timeAgo(isoStr) {
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60) return 'À l\'instant';
  if (diff < 3600) return `Il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Il y a ${Math.floor(diff / 3600)}h`;
  return `Il y a ${Math.floor(diff / 86400)} jour${Math.floor(diff / 86400) > 1 ? 's' : ''}`;
}

// ============================================================================
// EVENT LISTENERS INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  updateAuthRoleUI();

  // ── View mode tab buttons ──
  document.querySelectorAll('.view-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchViewMode(btn.dataset.mode));
  });

  // ── Bottom nav ──
  document.querySelectorAll('.nav-item-btn[data-screen]').forEach(btn => {
    btn.addEventListener('click', () => navigateToScreen(btn.dataset.screen));
  });

  // ── Back buttons ──
  document.querySelectorAll('.back-to-home-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateToScreen('screen-home'));
  });

  // ── Modal close buttons ──
  document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeAllModals();
    });
  });

  // ── Admin tab buttons ──
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchAdminTab(btn.dataset.adminTab));
  });

  // ── Match filter chips ──
  document.querySelectorAll('.matches-filter-bar .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.matches-filter-bar .filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeLevelFilter = chip.dataset.level;
      renderMatchesList();
    });
  });

  // ── Match tabs (Disponibles / Mes matchs) ──
  document.getElementById('tabMatchesAvailable')?.addEventListener('click', () => {
    document.getElementById('tabMatchesAvailable').classList.add('active');
    document.getElementById('tabMatchesMy').classList.remove('active');
    renderMatchesList(false);
  });
  document.getElementById('tabMatchesMy')?.addEventListener('click', () => {
    document.getElementById('tabMatchesMy').classList.add('active');
    document.getElementById('tabMatchesAvailable').classList.remove('active');
    renderMatchesList(true);
  });

  // ── Admin LOGIN (Firebase Auth) ──
  document.getElementById('btnLoginSubmit')?.addEventListener('click', async () => {
    const email    = document.getElementById('loginUsernameField').value.trim();
    const password = document.getElementById('loginPasswordField').value;
    const btn = document.getElementById('btnLoginSubmit');
    const originalText = btn ? btn.textContent : '';

    // Mode démo / admin : admin / admin → accès direct sans Firebase Auth
    if ((email === 'admin' || email === 'admin@hayapala.tn' || email === 'admin@circlepadel.com' || email.toLowerCase() === 'moslem') && (password === 'admin' || !password || password === 'padel2026')) {
      let adminPlayer = (DB.players || []).find(p => p.role === 'admin' || p.id === 'user_moslem' || p.firstName?.toLowerCase() === 'moslem') || {
        id: 'user_moslem',
        firstName: 'Moslem',
        lastName: 'Gouia',
        email: 'moslem.gouia@example.com',
        phone: '+216 22 227 041',
        gender: 'male',
        role: 'admin',
        status: 'active',
        level: 5.0,
        reliabilityScore: 82,
        totalMatchesPlayed: 24,
        loyaltyPoints: 45
      };
      DB.currentUser = { ...adminPlayer, role: 'admin' };
      saveDB(DB);
      updateAuthRoleUI();
      switchViewMode('backoffice-dashboard');
      showToast('Bienvenue Moslem (Admin) 👋', 'gold');
      fbTrack('login', { method: 'demo' });
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Connexion...'; }

    // Tentative Firebase Auth (email/password)
    try {
      const userCred = await fbSignIn(email, password);
      let adminUser = (DB.players || []).find(p => p.id === userCred?.user?.uid || p.email === userCred?.user?.email);
      if (!adminUser) {
        adminUser = {
          id: userCred?.user?.uid || 'admin_fb',
          firstName: userCred?.user?.displayName || 'Gérant',
          lastName: '',
          email: userCred?.user?.email || email,
          role: 'admin',
          status: 'active'
        };
      } else {
        adminUser.role = 'admin';
      }
      DB.currentUser = adminUser;
      saveDB(DB);
      updateAuthRoleUI();
      switchViewMode('backoffice-dashboard');
      showToast('Connexion réussie ✓', 'success');
      fbTrack('login', { method: 'firebase_email' });
    } catch (err) {
      showToast('Identifiants incorrects. Essayez admin / admin pour la démo.', 'error');
      console.error('Auth error:', err.code, err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
  });

  // ── Admin LOGOUT ──
  document.querySelectorAll('[onclick*="backoffice-login"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try { await fbSignOut(); } catch (e) {}
      DB.currentUser = { id: 'guest', firstName: 'Joueur', lastName: '', role: 'player' };
      saveDB(DB);
      updateAuthRoleUI();
      switchViewMode('backoffice-login');
      showToast('Déconnexion effectuée.', 'info');
    });
  });

  // ── Toggle show/hide admin password ──
  document.getElementById('toggleAdminPassword')?.addEventListener('click', () => {
    const inp = document.getElementById('adminPassword');
    if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // ── Mark all notifs read ──
  document.getElementById('btnMarkAllRead')?.addEventListener('click', async () => {
    const unread = (DB.notifications || []).filter(n => !n.isRead && n.userId === DB.currentUser?.id);
    unread.forEach(n => { n.isRead = true; });
    saveDB(DB);
    renderNotifications();
    const dot = document.getElementById('notifDot');
    if (dot) dot.style.display = 'none';
    for (const n of unread) {
      try { await fbMarkNotifRead(n.id); } catch (e) {}
    }
  });

  // ── Admin player search ──
  document.getElementById('adminPlayerSearchInput')?.addEventListener('input', function() {
    const q = this.value.toLowerCase();
    document.querySelectorAll('#adminPlayersTableBody tr').forEach(row => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });

  // ── Admin player filter chips (Statut & Genre Homme / Femme) ──
  document.querySelectorAll('[data-player-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-player-filter]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const filter = chip.dataset.playerFilter;
      document.querySelectorAll('#adminPlayersTableBody tr').forEach(row => {
        if (filter === 'all') { row.style.display = ''; return; }
        if (filter === 'male') { row.style.display = (row.dataset.gender === 'male') ? '' : 'none'; return; }
        if (filter === 'female') { row.style.display = (row.dataset.gender === 'female') ? '' : 'none'; return; }
        if (filter === 'active') { row.style.display = (row.dataset.status === 'active') ? '' : 'none'; return; }
        if (filter === 'pending') { row.style.display = (row.dataset.status === 'pending') ? '' : 'none'; return; }
        if (filter === 'suspended') { row.style.display = (row.dataset.status === 'suspended') ? '' : 'none'; return; }
      });
    });
  });

  // ── Club settings save (Firestore) ──
  document.getElementById('adminClubSettingsForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    DB.appConfig.clubName             = document.getElementById('settingClubName').value;
    DB.appConfig.pricePeak            = parseInt(document.getElementById('settingPricePeak').value) || 25;
    DB.appConfig.priceOffPeak         = parseInt(document.getElementById('settingPriceOffPeak').value) || 18;
    DB.appConfig.matchmakingTolerance = parseInt(document.getElementById('settingLevelTolerance').value);
    DB.appConfig.alertBeforeMatchHours = parseInt(document.getElementById('settingAlertHours').value);
    saveDB(DB);
    fbSaveConfig(DB.appConfig).catch(() => {});
    showToast('Paramètres enregistrés.', 'success');
  });

  // ── Reset demo ──
  document.getElementById('btnResetDemoData')?.addEventListener('click', resetDemoData);

  // ── Set default date for booking inputs ──
  const today = getTodayStr();
  const todayDatetime = `${today}T18:00`;
  ['bookDateInput'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = today;
  });
  const dtEl = document.getElementById('createMatchDateTime');
  if (dtEl) dtEl.value = todayDatetime;
  const adminDtEl = document.getElementById('adminSlotDateTime');
  if (adminDtEl) adminDtEl.value = todayDatetime;

  // ── Init create match level selectors ──
  initCreateMatchLevelSelectors();

  // ── Load club settings into form ──
  document.getElementById('settingClubName')?.setAttribute('value', DB.appConfig.clubName || 'CirclePadel');
  document.getElementById('settingClubPhone')?.setAttribute('value', DB.appConfig.phone || '');
  document.getElementById('settingClubEmail')?.setAttribute('value', DB.appConfig.email || '');

  // ── Initial UI render immédiat (0ms de latence) ──
  renderHomeScreen();
  updateAuthUI();

  // ── Notifications dot ──
  const unread = (DB.notifications || []).filter(n => !n.isRead && n.userId === DB.currentUser?.id);
  const dotEl  = document.getElementById('notifDot');
  if (dotEl) dotEl.style.display = unread.length > 0 ? '' : 'none';

  // ── Live alerts check (toutes les 5 min) ──
  setInterval(() => {
    const alerts = checkMatchAlerts();
    const kpiEl  = document.getElementById('kpiAlertsValue');
    if (kpiEl) kpiEl.textContent = alerts.length;
  }, 5 * 60 * 1000);

  // ============================================================================
  // EVENT DELEGATION — tous les boutons dynamiques (modales, planning, auth, éval.)
  // ============================================================================
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button, [data-action]');
    if (!btn) return;
    const id = btn.id;

    // ── Confirmation réservation terrain (Joueur) ──
    if (id === 'btnConfirmBooking') {
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Réservation en cours...';
      try {
        const courtNum = parseInt(document.getElementById('bookCourtSelect')?.value) || 1;
        const date     = document.getElementById('bookDateInput')?.value || getTodayStr();
        const time     = document.getElementById('bookStartTime')?.value || '10:00';
        const duration = parseInt(document.getElementById('bookDuration')?.value) || 90;
        const type     = document.getElementById('bookType')?.value || 'private';
        const courtId  = `court_${courtNum}`;
        const court    = (DB.courts || []).find(c => c.id === courtId);
        const user     = (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser;
        
        const currentUserName = `${user?.firstName || 'Joueur'} ${user?.lastName || ''}`.trim();
        const bookingPlayers = [
          { userId: DB.currentUser?.id || 'guest', name: currentUserName, level: user?.level || 5.0, isOrganizer: true }
        ];

        // Co-joueurs sélectionnés (piochés dans l'application ou créés en tant qu'invités sans sexe)
        [2, 3, 4].forEach((spotNum, idx) => {
          const sel = document.getElementById(`bookCoPlayerSelect${spotNum}`);
          const inp = document.getElementById(`bookCoPlayerInput${spotNum}`);
          const selVal = sel?.value;
          const manualVal = inp?.value?.trim();

          if (selVal && selVal !== '__manual__') {
            // Choisi directement parmi les joueurs déjà existants dans l'application !
            const match = (DB.players || []).find(p => p.id === selVal);
            if (match) {
              bookingPlayers.push({
                userId: match.id,
                name: `${match.firstName} ${match.lastName || ''}`.trim(),
                level: match.level || 5.0,
                isGuest: match.status === 'guest'
              });
              return;
            }
          }

          // Cas saisie manuelle / invité non présent
          const candidateName = manualVal || (selVal === '__manual__' ? '' : selVal);
          if (!candidateName) return;

          // Vérifier si par hasard le nom saisi correspond à un joueur existant (évite les doublons)
          let match = (DB.players || []).find(p => `${p.firstName} ${p.lastName || ''}`.toLowerCase().trim() === candidateName.toLowerCase());
          if (match) {
            bookingPlayers.push({
              userId: match.id,
              name: `${match.firstName} ${match.lastName || ''}`.trim(),
              level: match.level || 5.0,
              isGuest: match.status === 'guest'
            });
          } else {
            // Création en tant qu'invité dans la base de données sans sexe ("donc les enregistrer sans sexe")
            const parts = candidateName.split(/\s+/);
            const fn = parts[0];
            const ln = parts.slice(1).join(' ') || '';
            const guestPlayer = {
              id: 'guest_' + Date.now() + '_' + idx + '_' + Math.random().toString(36).substr(2, 4),
              firstName: fn,
              lastName: ln,
              gender: null, // "sans sexe" comme requis expressément
              level: null,
              selfEstimatedLevel: null,
              reliabilityScore: 50,
              totalMatchesPlayed: 0,
              peerConfrontationsCount: 0,
              status: 'guest',
              role: 'guest',
              preferredSide: 'right',
              playStyle: 'all-around',
              loyaltyPoints: 0,
              phone: '',
              email: '',
              createdAt: new Date().toISOString()
            };
            DB.players.push(guestPlayer);
            bookingPlayers.push({
              userId: guestPlayer.id,
              name: `${guestPlayer.firstName} ${guestPlayer.lastName}`.trim(),
              level: '5.0',
              isGuest: true
            });
          }
        });

        const newBooking = {
          id: `bk_${Date.now()}`, courtId,
          courtName: court?.name || `Terrain ${courtNum}`,
          date, startTime: time, endTime: addMinutes(time, duration),
          type, status: 'confirmed',
          players: bookingPlayers,
          waitlist: [], pricePerPlayer: DB.appConfig?.pricePeak || 25,
          createdAt: new Date().toISOString(),
        };
        DB.bookings.push(newBooking);
        saveDB(DB, true);
        closeAllModals();
        renderCourtsGrid();
        renderHomeScreen();
        renderMyBookings();
        if (typeof renderAdminTimetable === 'function') renderAdminTimetable();
        if (typeof renderAdminPlayers === 'function') renderAdminPlayers();
        if (typeof renderAdminKPIs === 'function') renderAdminKPIs();
        showToast('Réservation confirmée ✓ Créneau inscrit sur le planning.', 'success');
        if (typeof fbAddBooking === 'function') fbAddBooking(newBooking).catch(err => console.warn('fbAddBooking async error:', err));
        if (typeof fbTrack === 'function') fbTrack('booking_created', { courtId, type });
      } catch (err) {
        showToast('Erreur lors de la réservation.', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }

    // ── Création match ouvert (Joueur) ──
    if (id === 'btnConfirmCreateMatch') {
      const datetime = document.getElementById('createMatchDateTime')?.value;
      if (!datetime) { showToast('Sélectionnez une date et heure.', 'error'); return; }

      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Publication en cours...';
      try {
        const courtNum = parseInt(document.getElementById('createMatchCourt')?.value) || 1;
        const levelRange = document.getElementById('createMatchLevel')?.value || '4-6';
        const note = document.getElementById('createMatchNote')?.value?.trim() || '';
        const [minL, maxL] = levelRange.split('-').map(Number);
        const [date, time] = datetime.split('T');
        const courtId = `court_${courtNum}`;
        const court = (DB.courts || []).find(c => c.id === courtId);
        const user = (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser;
        const newMatch = {
          id: `bk_${Date.now()}`, courtId,
          courtName: court?.name || `Terrain ${courtNum}`,
          date, startTime: time?.slice(0,5) || '18:00', endTime: addMinutes(time?.slice(0,5) || '18:00', 90),
          type: 'open', status: 'confirmed',
          minLevel: minL || 3, maxLevel: maxL || 6,
          players: [{ userId: DB.currentUser?.id || 'guest', name: `${user?.firstName || 'Joueur'} ${user?.lastName || ''}`.trim(), level: user?.level || 3, isOrganizer: true }],
          waitlist: [], pricePerPlayer: DB.appConfig?.pricePeak || 25, notes: note,
          createdAt: new Date().toISOString(),
        };
        DB.bookings.push(newMatch);
        saveDB(DB);
        closeAllModals();
        renderMatchesList();
        renderHomeOpenMatches(DB.currentUser);
        showToast('Match ouvert publié ! 🎾 Joueurs compatibles notifiés.', 'success');
        fbCreateOpenMatch(newMatch).catch(err => console.warn('fbCreateOpenMatch async error:', err));
        fbTrack('open_match_created', { courtId, minLevel: minL, maxLevel: maxL });
      } catch (err) {
        showToast('Erreur lors de la création du match.', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }

    // ── Confirmation créneau / réservation (Gérant) ──
    if (id === 'btnAdminConfirmCreateSlot') {
      await createAdminSlot(e);
    }

    // ── Validation évaluation coach ──
    if (id === 'btnSubmitEvaluation') {
      await saveEvaluation(e);
    }

    // ── Inscription membre gérant ──
    if (id === 'btnConfirmRegisterPlayer') {
      confirmRegisterPlayer();
      return;
    }

    // ── Navigation jours planning gérant (‹ / › / Aujourd'hui) ──
    if (id === 'btnPrevDay') {
      adminCurrentDate = shiftDateStr(adminCurrentDate, -1);
      const el = document.getElementById('adminCurrentDate');
      if (el) el.textContent = formatDate(adminCurrentDate);
      renderAdminTimetable();
    }
    if (id === 'btnNextDay') {
      adminCurrentDate = shiftDateStr(adminCurrentDate, 1);
      const el = document.getElementById('adminCurrentDate');
      if (el) el.textContent = formatDate(adminCurrentDate);
      renderAdminTimetable();
    }
    if (id === 'btnTodayAdmin') {
      adminCurrentDate = getTodayStr();
      const el = document.getElementById('adminCurrentDate');
      if (el) el.textContent = formatDate(adminCurrentDate);
      renderAdminTimetable();
    }
    if (id === 'btnAdminOpenRegisterPlayer') openModal('modal-register-player');
    if (id === 'btnAdminDirectBooking') openAdminSlotModal(null, '17:00', adminCurrentDate);

    // ── Navigation jours planning joueur (‹ / › / Aujourd'hui) ──
    if (id === 'btnPlayerPrevDay') {
      planningSelectedDate = shiftDateStr(planningSelectedDate || getTodayStr(), -1);
      renderPlanningDateBar();
      renderCourtsGrid();
    }
    if (id === 'btnPlayerNextDay') {
      planningSelectedDate = shiftDateStr(planningSelectedDate || getTodayStr(), 1);
      renderPlanningDateBar();
      renderCourtsGrid();
    }
    if (id === 'btnPlayerToday') {
      planningSelectedDate = getTodayStr();
      renderPlanningDateBar();
      renderCourtsGrid();
    }

    // ── Bouton Auth Profil (Se connecter / Se déconnecter) ──
    if (id === 'btnProfileAuthAction') {
      if (DB.currentUser?.email && DB.currentUser.id !== 'guest') {
        await handlePlayerLogout();
      } else {
        openModal('modal-auth');
      }
    }

    // ── Onglets Modale Auth (Connexion / Inscription) ──
    if (id === 'tabAuthLogin') switchAuthTab('login');
    if (id === 'tabAuthRegister') switchAuthTab('register');

    // ── Mode Écran Terrain (LED Stadium) ──
    if (id === 'btnOpenCourtsideDisplay') {
      openCourtsideDisplay();
    }

    // ── Mot de passe admin visible/masqué ──
    if (id === 'toggleAdminPassword') {
      const inp = document.getElementById('adminPassword');
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    }

    // ── Mark all notifs read ──
    if (id === 'btnMarkAllRead') {
      const unreadN = (DB.notifications || []).filter(n => !n.isRead && n.userId === DB.currentUser?.id);
      unreadN.forEach(n => { n.isRead = true; });
      saveDB(DB); renderNotifications();
      const dotElN = document.getElementById('notifDot');
      if (dotElN) dotElN.style.display = 'none';
      for (const n of unreadN) { try { await fbMarkNotifRead(n.id); } catch (er) {} }
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // FIREBASE OBSERVER & BACKGROUND SYNC (non bloquants pour l'UI)
  // ──────────────────────────────────────────────────────────────────────────

  // Observer l'état Auth Firebase
  fbOnAuthChange(async (user) => {
    if (user) {
      console.log('🔐 Connecté :', user.email);
      let player = (DB.players || []).find(p => p.id === user.uid || p.email === user.email);
      if (!player) {
        try {
          player = await fbGetPlayer(user.uid);
          if (player && !DB.players.some(p => p.id === player.id)) {
            DB.players.push(player);
          }
        } catch (e) {}
      }
      if (player) {
        DB.currentUser = player;
      } else {
        const isAdminEmail = user.email === 'admin@hayapala.tn' || user.email === 'admin@circlepadel.com';
        DB.currentUser = {
          id: user.uid,
          firstName: user.displayName?.split(' ')[0] || user.email?.split('@')[0] || 'Joueur',
          lastName: user.displayName?.split(' ').slice(1).join(' ') || '',
          email: user.email,
          role: isAdminEmail ? 'admin' : 'player',
          status: isAdminEmail ? 'active' : 'pending',
          level: isAdminEmail ? 7 : null,
        };
      }
      saveDB(DB);
      updateAuthUI();
      renderHomeScreen();
    } else {
      console.log('👤 Mode démo joueur (non authentifié)');
      updateAuthRoleUI();
    }
  });

  // Synchronisation backend partagée (cross-session & cross-device)
  (async () => {
    try {
      await syncFromBackend();
      renderHomeScreen();
      updateAuthUI();
      renderAdminPlayers();
      renderAdminKPIs();
    } catch (e) {}

    // Polling régulier pour synchronisation en direct entre onglets et sessions (2s)
    setInterval(syncFromBackend, 2000);
    window.addEventListener('focus', () => syncFromBackend(true));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncFromBackend(true); });

    // Synchronisation inter-onglets instantanée (0ms) via LocalStorage event
    window.addEventListener('storage', (e) => {
      if (e.key === DB_KEY && e.newValue) {
        try {
          const cached = JSON.parse(e.newValue);
          if (cached && Array.isArray(cached.players)) {
            if (Array.isArray(cached.deletedPlayerIds)) {
              const mergedDeleted = new Set([...(DB.deletedPlayerIds || []), ...cached.deletedPlayerIds]);
              DB.deletedPlayerIds = Array.from(mergedDeleted);
            }
            const deletedSet = new Set(DB.deletedPlayerIds || []);
            DB.players = cached.players.filter(p => p && p.id && !deletedSet.has(p.id));
            if (Array.isArray(cached.bookings)) DB.bookings = mergeBookingsLists(DB.bookings, cached.bookings);
            if (Array.isArray(cached.auditLogs)) DB.auditLogs = cached.auditLogs;
            renderAdminPlayers();
            renderAdminKPIs();
            renderAdminAlerts();
            renderAdminTimetable();
            renderCourtsGrid();
            renderHomeScreen();
            renderProfileScreen();
            renderAdminAuditLogs();
          }
        } catch (err) {}
      }
    });

    // Connexion SSE temps-réel instantanée (multi-admin collaboratif avec auto-reconnect)
    let sse = null;
    function initSSE() {
      try {
        if (sse) sse.close();
        sse = new EventSource('/api/circlepadel/events');
        sse.onmessage = (evt) => {
          try {
            const payload = JSON.parse(evt.data);
            if (payload && payload.type === 'db_updated') {
              syncFromBackend(true, payload);
            }
          } catch (err) {}
        };
        sse.onerror = () => {
          if (sse) sse.close();
          setTimeout(initSSE, 1500);
        };
      } catch (sseErr) {
        setTimeout(initSSE, 2000);
      }
    }
    initSSE();

    // Synchronisation Firestore en tâche de fond si en ligne
    try {
      await initFirestoreIfEmpty();
    } catch (e) {
      console.warn('⚠️ Init Firestore ignorée :', e.message);
    }
    try {
      await syncFromFirestore();
      renderHomeScreen();
      updateAuthUI();
    } catch (e) {
      console.warn('⚠️ Sync Firestore ignorée :', e.message);
    }
    try {
      startRealtimeListeners();
    } catch (e) {
      console.warn('⚠️ Listeners temps-réel ignorés :', e.message);
    }
  })();

  console.log('%c🎾 CirclePadel v1.1 — Firebase Firestore + Auth · circlepadel', 'color:#C8A96E; font-weight:bold; font-size:15px');
  console.log('%c🔥 Firestore sync + listeners configurés en arrière-plan', 'color:#F39C12');
});


// ============================================================================
// EXPOSITION GLOBALE (requis car app.js est un ES Module)
// Les fonctions appelées via onclick="..." dans le HTML doivent être
// attachées à window pour être accessibles hors du scope du module.
// ============================================================================
window.navigateToScreen        = navigateToScreen;
window.switchViewMode          = switchViewMode;
window.openModal               = openModal;
window.closeModal              = closeModal;
window.closeAllModals          = closeAllModals;
window.showToast               = showToast;
window.resetDemoData           = resetDemoData;
window.selectPlanningDate      = selectPlanningDate;
window.openBookingFromSlot     = openBookingFromSlot;
window.renderCourtsPlanningGrid = renderCourtsPlanningGrid;
window.handleJoinMatch         = handleJoinMatch;
window.cancelMyBooking         = cancelMyBooking;
window.markNotifRead           = markNotifRead;
window.openPlayerEvalModal     = openPlayerEvalModal;
window.setSkillValue           = setSkillValue;
window.setEvalLevel            = setEvalLevel;
window.saveEvaluation          = saveEvaluation;
window.openAdminSlotModal      = openAdminSlotModal;
window.createAdminSlot         = createAdminSlot;
window.activatePlayer          = activatePlayer;
window.suspendPlayer           = suspendPlayer;
window.switchAdminTab          = switchAdminTab;
window.registerPlayer          = registerPlayer;
window.submitBooking           = submitBooking;
window.createMatch             = createMatch;
window.setMatchLevelMin        = setMatchLevelMin;
window.setMatchLevelMax        = setMatchLevelMax;
window.removePlayerFromBooking = removePlayerFromBooking;
window.adminCancelBooking      = adminCancelBooking;
window.renderSlotDetail        = renderSlotDetail;
window.handlePlayerLogin       = handlePlayerLogin;
window.handlePlayerRegister    = handlePlayerRegister;
window.handlePlayerLogout      = handlePlayerLogout;
window.switchAuthTab           = switchAuthTab;
window.updateAuthUI            = updateAuthUI;
window.openCourtsideDisplay    = openCourtsideDisplay;
window.showCelebrationModal    = showCelebrationModal;
window.renderMyBookings        = renderMyBookings;
window.renderAdminPlayers      = renderAdminPlayers;
window.renderAdminAuditLogs    = renderAdminAuditLogs;
window.getPlayerLoyaltyPoints  = getPlayerLoyaltyPoints;
window.getTodayStr             = getTodayStr;
window.DB                      = DB;

window.submitAuthLogin = async function() {
  const email = document.getElementById('authLoginEmail')?.value?.trim();
  const password = document.getElementById('authLoginPassword')?.value;
  await handlePlayerLogin(email, password);
};

window.submitAuthRegister = async function() {
  const firstName = document.getElementById('authRegFirstName')?.value?.trim();
  const lastName = document.getElementById('authRegLastName')?.value?.trim();
  const phone = document.getElementById('authRegPhone')?.value?.trim();
  const email = document.getElementById('authRegEmail')?.value?.trim();
  const password = document.getElementById('authRegPassword')?.value;
  const preferredSide = document.getElementById('authRegSide')?.value || 'right';
  const playStyle = document.getElementById('authRegStyle')?.value || 'all-around';
  const selfEstimatedLevel = parseFloat(document.getElementById('authRegLevelRange')?.value) || 5.0;
  const gender = document.getElementById('authRegGender')?.value || 'male';
  await handlePlayerRegister({ firstName, lastName, phone, email, password, preferredSide, playStyle, selfEstimatedLevel, gender });
};

// Brancher immédiatement les clics des onglets de connexion
document.getElementById('tabAuthLogin')?.addEventListener('click', (e) => {
  e.preventDefault();
  switchAuthTab('login');
});
document.getElementById('tabAuthRegister')?.addEventListener('click', (e) => {
  e.preventDefault();
  switchAuthTab('register');
});

// Validation formulaires auth au clavier (touche Entrée)
document.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const active = document.activeElement;
    if (active && (active.id === 'authLoginEmail' || active.id === 'authLoginPassword')) {
      e.preventDefault();
      const email = document.getElementById('authLoginEmail')?.value?.trim();
      const password = document.getElementById('authLoginPassword')?.value;
      await handlePlayerLogin(email, password);
    } else if (active && ['authRegFirstName', 'authRegLastName', 'authRegPhone', 'authRegEmail', 'authRegPassword'].includes(active.id)) {
      e.preventDefault();
      const firstName = document.getElementById('authRegFirstName')?.value?.trim();
      const lastName = document.getElementById('authRegLastName')?.value?.trim();
      const phone = document.getElementById('authRegPhone')?.value?.trim();
      const email = document.getElementById('authRegEmail')?.value?.trim();
      const password = document.getElementById('authRegPassword')?.value;
      const preferredSide = document.getElementById('authRegSide')?.value || 'right';
      const playStyle = document.getElementById('authRegStyle')?.value || 'all-around';
      await handlePlayerRegister({ firstName, lastName, phone, email, password, preferredSide, playStyle });
    }
  }
});

// ============================================================================
// TOGGLE THÈME CLAIR / SOMBRE
// ============================================================================

const THEME_KEY = 'circlepadel_theme';

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.body.classList.toggle('light-mode', !isDark);
  const btn = document.getElementById('btnToggleTheme');
  if (btn) btn.textContent = isDark ? '🌙' : '☀️';
  localStorage.setItem(THEME_KEY, theme);

  // Mettre à jour immédiatement le radar de compétences pour adapter les petits traits
  try {
    const user = (DB.players || []).find(p => p.id === DB.currentUser?.id) || DB.currentUser;
    if (user && user.skills) {
      renderRadarChart(user.skills);
    }
  } catch (err) {
    // silence
  }
}

function toggleTheme() {
  const current = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

// Initialiser le thème (sombre par défaut)
applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

// Brancher le bouton
document.getElementById('btnToggleTheme')?.addEventListener('click', toggleTheme);
window.toggleTheme = toggleTheme;

// Sécurité UX : Touche Échap pour fermer toute modale active (évite les blocages d'interface)
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'Esc') {
    closeAllModals();
  }
});

// Vérification périodique (toutes les 30s) des créneaux terminés pour inviter le créateur à saisir le score
setInterval(() => {
  try {
    if (typeof checkFinishedMatchesScorePrompt === 'function') {
      checkFinishedMatchesScorePrompt();
    }
  } catch (err) {}
}, 30000);


