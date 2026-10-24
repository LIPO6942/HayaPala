/* ==========================================================================
   HAYAPALA — APPLICATION LOGIC v1.1
   Club de Padel · Firebase Firestore + Auth · circlepadel
   Vanilla JS, no framework — ES Module (type="module" dans index.html)
   ========================================================================== */

// ── Firebase imports (CDN ESM) ─────────────────────────────────────────────
import {
  fbSignIn, fbSignOut, fbOnAuthChange, fbCreateUser, fbUpdateUserProfile,
  fbGetPlayers, fbGetPlayer, fbSavePlayer, fbUpdatePlayerLevel, fbListenPlayers,
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

const DB_KEY = 'circlepadel_db_v1';

/** Structure vide initiale — sera peuplée exclusivement par Firestore */
let DB = {
  appConfig:     { ...DEFAULT_CONFIG },
  currentUser:   { id: 'guest', firstName: 'Joueur', lastName: '', role: 'player' },
  players:       [],
  courts:        [...COURTS_SEED],
  bookings:      [],
  notifications: [],
  matchReviews:  [],
  transactions:  [],
};

// Restaurer le cache Firestore uniquement (flag _fromFirestore requis)
try {
  const raw = localStorage.getItem(DB_KEY);
  if (raw) {
    const cached = JSON.parse(raw);
    if (cached._fromFirestore === true) {
      DB = { ...DB, ...cached };
    } else {
      // Ancien cache localStorage (données mock) → on l'efface
      localStorage.removeItem(DB_KEY);
    }
  }
} catch (e) { localStorage.removeItem(DB_KEY); }

let _syncDebounceTimer = null;

function saveDB(data, pushToServer = true) {
  try {
    data._fromFirestore = true;
    localStorage.setItem(DB_KEY, JSON.stringify(data));
  } catch (e) {}

  if (pushToServer) {
    clearTimeout(_syncDebounceTimer);
    _syncDebounceTimer = setTimeout(async () => {
      try {
        await fetch('/api/circlepadel/db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      } catch (e) {}
    }, 150);
  }
}

async function syncFromBackend() {
  try {
    const res = await fetch('/api/circlepadel/db');
    if (!res.ok) return;
    const remote = await res.json();
    if (remote && Array.isArray(remote.players)) {
      DB.players = remote.players;
      if (Array.isArray(remote.courts) && remote.courts.length) DB.courts = remote.courts;
      if (Array.isArray(remote.bookings)) DB.bookings = remote.bookings;
      if (remote.appConfig) DB.appConfig = { ...DEFAULT_CONFIG, ...remote.appConfig };
      if (Array.isArray(remote.notifications)) DB.notifications = remote.notifications;

      // Conserver le rôle de l'utilisateur connecté
      if (DB.currentUser?.id && DB.currentUser.id !== 'guest') {
        const found = DB.players.find(p => p.id === DB.currentUser.id || p.email === DB.currentUser.email);
        if (found) {
          const role = DB.currentUser.role;
          DB.currentUser = { ...found, role: role || found.role || 'player' };
        }
      }

      saveDB(DB, false);
      renderAdminPlayers();
      renderAdminKPIs();
      renderHomeScreen();
      renderMatchesList();
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
    const [courts, config] = await Promise.all([fbGetCourts(), fbGetConfig()]);
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
    const [players, courts, bookings, openMatches, config] = await Promise.all([
      fbGetPlayers(),
      fbGetCourts(),
      fbGetBookings(),
      fbGetOpenMatches(),
      fbGetConfig(),
    ]);
    if (players.length)    DB.players  = players;
    if (courts.length)     DB.courts   = courts;
    // Fusionner réservations + matchs ouverts
    const regularBookings = bookings.filter(b => b.type !== 'open');
    const openAsBookings  = openMatches.map(m => ({ ...m, type: 'open', status: m.status || 'confirmed' }));
    DB.bookings = [...regularBookings, ...openAsBookings];
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
      DB.players = players;
      saveDB(DB);
      renderAdminPlayers();
      renderAdminKPIs();
    } catch (e) {
      console.warn('Realtime players error:', e);
    }
  });

  fbListenBookings(getTodayStr(), bookings => {
    try {
      const other = DB.bookings.filter(b => b.date !== getTodayStr());
      DB.bookings = [...other, ...bookings];
      saveDB(DB);
      renderAdminTimetable();
      renderCourtsPlanningGrid();
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

      let slotClass = '', badgeClass = 'available', badgeText = 'Libre', dotHtml = '';
      if (booking) {
        const spots = (DB.appConfig?.maxPlayersPerMatch || 4) - (booking.players || []).length;
        if (booking.type === 'private') { slotClass = 'booked'; badgeClass = 'private'; badgeText = 'Privée'; }
        else if (booking.type === 'open') { slotClass = 'open-match'; badgeClass = 'open'; badgeText = `Ouvert · ${spots} libre${spots > 1 ? 's' : ''}`; }
        else if (booking.type === 'course') { slotClass = 'booked'; badgeClass = 'course'; badgeText = 'Cours'; }
        else if (booking.type === 'blocked') { slotClass = 'blocked'; badgeClass = 'blocked'; badgeText = 'Bloqué'; }

        if (booking.type !== 'blocked' && booking.type !== 'course') {
          const filled = (booking.players || []).length;
          dotHtml = Array(4).fill(0).map((_, i) =>
            `<div class="slot-dot ${i < filled ? 'filled' : 'empty'}"></div>`
          ).join('');
        }
      }

      const clickHandler = booking
        ? `openModal('modal-slot-detail'); renderSlotDetail('${booking.id}')`
        : `openBookingFromSlot('${court.id}', '${time}')`;

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
  const futRating = document.getElementById('futCardRating');
  if (futRating) {
    if (user.level != null) {
      futRating.textContent = (user.level % 1 === 0 ? `${user.level}.0` : user.level.toFixed(1));
    } else if (user.weightedScore != null) {
      futRating.textContent = user.weightedScore.toFixed(1);
    } else {
      futRating.textContent = '--';
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

  const futVerified = document.getElementById('futCoachVerified');
  const futVerifiedText = document.getElementById('futCoachVerifiedText');
  if (futVerified && futVerifiedText) {
    if (user.level != null) {
      futVerified.style.display = 'block';
      futVerified.style.background = 'rgba(46, 204, 113, 0.18)';
      futVerified.style.borderColor = 'rgba(46, 204, 113, 0.5)';
      futVerified.style.color = '#2ecc71';
      futVerifiedText.textContent = `✓ CERTIFIÉ COACH · NIV ${user.level}/10`;
    } else {
      futVerified.style.display = 'block';
      futVerified.style.background = 'rgba(243, 156, 18, 0.18)';
      futVerified.style.borderColor = 'rgba(243, 156, 18, 0.5)';
      futVerified.style.color = 'var(--gold)';
      futVerifiedText.textContent = '⏳ EN ATTENTE ÉVALUATION COACH';
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
  if (futRel) futRel.textContent = `${user.reliabilityScore || 50}%`;

  const futLvlNum = document.getElementById('futCardLevelNum');
  if (futLvlNum) futLvlNum.textContent = (user.level != null ? user.level : '?');
}

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
  const originalText = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ Connexion en cours...</span>';
  }

  try {
    const norm = email.toLowerCase().trim();
    // 1. Recherche parmi les joueurs locaux
    let localPlayer = (DB.players || []).find(p => 
      (p.email && p.email.toLowerCase() === norm) ||
      (p.phone && p.phone.replace(/[\s\-\+\.]/g, '') === norm.replace(/[\s\-\+\.]/g, '')) ||
      ((p.firstName + ' ' + (p.lastName || '')).toLowerCase().trim() === norm) ||
      (p.firstName && p.firstName.toLowerCase() === norm)
    );

    // 2. Si mot de passe et format email, tenter Firebase
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
      showToast('Aucun joueur trouvé avec cet identifiant.', 'error');
      return;
    }

    saveDB(DB);
    updateAuthUI();
    updateAuthRoleUI();
    renderHomeScreen();
    renderProfileScreen();
    closeAllModals();
    showToast(`Ravi de vous revoir, ${DB.currentUser.firstName} 🎾`, 'success');
  } catch (err) {
    console.error('Login error:', err);
    showToast('Erreur lors de la connexion.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  }
}

async function handlePlayerRegister({ firstName, lastName, phone, email, password, preferredSide, playStyle }) {
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
    phone: cleanPhone,
    email: safeEmail,
    role: 'player',
    status: 'pending', // en attente d'évaluation coach
    level: null,       // Pas encore évalué par le coach
    preferredSide: cleanSide,
    playStyle: cleanStyle,
    reliabilityScore: 50,
    peerConfrontationsCount: 0,
    totalMatchesPlayed: 0,
    skills: {},
    levelHistory: [{
      date: getTodayStr(),
      level: null,
      note: 'Inscription joueur · En attente de passage devant le coach'
    }],
    createdAt: new Date().toISOString(),
  };

  // Enregistrement immédiat dans DB.players et session active
  DB.players = (DB.players || []).filter(p => p.id !== newPlayer.id && p.email !== newPlayer.email);
  DB.players.push(newPlayer);
  DB.currentUser = newPlayer;

  // Sauvegarde locale + sync backend /api/circlepadel/db
  saveDB(DB, true);

  // Sauvegarde Firestore en tâche de fond
  fbSavePlayer(newPlayer).catch(e => console.warn('fbSavePlayer async error:', e));

  // Mise à jour de l'UI
  updateAuthUI();
  updateAuthRoleUI();
  renderHomeScreen();
  renderProfileScreen();
  if (typeof renderAdminPlayers === 'function') renderAdminPlayers();
  if (typeof renderCoachPendingPlayers === 'function') renderCoachPendingPlayers();

  // Fermer la modale et afficher directement la carte joueur FIFA
  closeAllModals();
  navigateToScreen('screen-profile');
  showToast(`Bienvenue ${cleanFirst} ! Votre carte joueur est prête 🎾`, 'success');

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
  const keys = Object.keys(SKILL_LABELS);
  const n = keys.length;
  const cx = 130, cy = 110, R = 90;
  const levels = 5;

  if (!skills || Object.keys(skills).length === 0) {
    svg.innerHTML = `<text x="130" y="110" text-anchor="middle" fill="var(--text-muted)" font-size="13">Pas encore évalué</text>`;
    return;
  }

  let html = '';

  // Grid polygons
  for (let l = 1; l <= levels; l++) {
    const r = (R * l) / levels;
    const pts = keys.map((_, i) => {
      const angle = (2 * Math.PI * i / n) - Math.PI / 2;
      return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
    }).join(' ');
    html += `<polygon points="${pts}" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`;
  }

  // Axes
  keys.forEach((_, i) => {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    const x = cx + R * Math.cos(angle);
    const y = cy + R * Math.sin(angle);
    html += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>`;
  });

  // Data polygon
  const pts = keys.map((k, i) => {
    const val = (skills[k] || 0) / 10;
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    return `${cx + R * val * Math.cos(angle)},${cy + R * val * Math.sin(angle)}`;
  }).join(' ');
  html += `<polygon points="${pts}" fill="rgba(200,169,110,0.2)" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round"/>`;

  // Dots
  keys.forEach((k, i) => {
    const val = (skills[k] || 0) / 10;
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    const x = cx + R * val * Math.cos(angle);
    const y = cy + R * val * Math.sin(angle);
    html += `<circle cx="${x}" cy="${y}" r="4" fill="var(--gold)" stroke="var(--bg-canvas)" stroke-width="2"/>`;
  });

  // Labels
  keys.forEach((k, i) => {
    const angle = (2 * Math.PI * i / n) - Math.PI / 2;
    const lx = cx + (R + 18) * Math.cos(angle);
    const ly = cy + (R + 18) * Math.sin(angle);
    const anchor = lx < cx - 5 ? 'end' : lx > cx + 5 ? 'start' : 'middle';
    html += `<text x="${lx}" y="${ly + 4}" text-anchor="${anchor}" fill="var(--text-secondary)" font-size="10" font-family="Plus Jakarta Sans, sans-serif" font-weight="600">${SKILL_LABELS[k]}</text>`;
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
  const myBookings = DB.bookings.filter(b =>
    b.status === 'confirmed' && b.players.some(p => p.userId === user.id)
  ).slice(0, 8);

  if (myBookings.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:24px 0"><div class="empty-state-icon">🎾</div><div class="empty-state-title">Aucun match joué</div></div>';
    return;
  }

  container.innerHTML = myBookings.map(b => `
    <div class="history-item">
      <div class="history-result-dot neutral"></div>
      <div class="history-info">
        <div class="history-court">${b.courtName} · ${b.type === 'open' ? 'Match ouvert' : b.type === 'private' ? 'Privée' : 'Cours'}</div>
        <div class="history-date-level">${b.date === getTodayStr() ? 'Aujourd\'hui' : formatDate(b.date)} · ${b.startTime} · ${b.players.length} joueurs</div>
      </div>
      <span style="font-size:11px; color:var(--text-muted)">${b.pricePerPlayer} DT</span>
    </div>`
  ).join('');
}

// ============================================================================
// MY BOOKINGS
// ============================================================================

function renderMyBookings() {
  const container = document.getElementById('myBookingsContainer');
  const today = getTodayStr();
  const user = DB.currentUser;
  const myBookings = DB.bookings.filter(b =>
    b.players.some(p => p.userId === user.id)
  ).sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime));

  if (myBookings.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-title">Aucune réservation</div></div>`;
    return;
  }

  container.innerHTML = myBookings.map(b => {
    const isPast = b.date < today;
    const spots = DB.appConfig.maxPlayersPerMatch - b.players.length;
    return `
    <div class="match-list-card" style="${isPast ? 'opacity:0.6' : ''}">
      <div class="match-list-top">
        <div>
          <div class="match-list-court">${b.courtName}</div>
          <div class="match-list-date">${b.date === today ? 'Aujourd\'hui' : formatDate(b.date)} · ${b.startTime} – ${b.endTime}</div>
        </div>
        <span class="match-status-badge ${isPast ? '' : 'open'}">${isPast ? 'Terminé' : 'Confirmé'}</span>
      </div>
      <div class="match-list-info-row">
        <div class="match-info-chip">
          <span class="chip-icon">${b.type === 'open' ? '🎾' : b.type === 'private' ? '🔒' : '🎓'}</span>
          <span>${b.type === 'open' ? `Match ouvert · Niv. ${b.minLevel||'?'}–${b.maxLevel||'?'}` : b.type === 'private' ? 'Privée' : 'Cours coach'}</span>
        </div>
      </div>
      <div class="match-list-bottom">
        <span class="match-price-tag">${b.pricePerPlayer} DT <span>/joueur</span></span>
        ${!isPast && b.players.find(p => p.userId === user.id) ? `
          <button onclick="cancelMyBooking('${b.id}')" style="padding:6px 14px; border-radius:var(--radius-full); border:1px solid rgba(231,76,60,0.3); background:transparent; color:var(--red); font-size:11px; font-weight:700;">
            Annuler
          </button>` : ''}
      </div>
      ${b.type === 'open' && !isPast && spots > 0 ? `
        <div style="font-size:11px; color:var(--amber); margin-top:4px">⚡ ${spots} place${spots>1?'s':''} encore libre${spots>1?'s':''} — partagez le match !</div>` : ''}
    </div>`;
  }).join('');
}

function cancelMyBooking(bookingId) {
  const booking = DB.bookings.find(b => b.id === bookingId);
  if (!booking) return;

  const [h, m] = booking.startTime.split(':').map(Number);
  const matchDate = new Date(booking.date);
  matchDate.setHours(h, m, 0, 0);
  const diffHours = (matchDate - new Date()) / 3600000;

  if (diffHours < DB.appConfig.cancelDeadlineHours) {
    showToast(`Annulation impossible : le délai de ${DB.appConfig.cancelDeadlineHours}h avant match est dépassé.`, 'error');
    return;
  }

  // Remove player
  booking.players = booking.players.filter(p => p.userId !== DB.currentUser.id);

  // If organizer and no players left → cancel
  if (booking.players.length === 0 && booking.type === 'open') {
    booking.status = 'cancelled';
  }

  saveDB(DB);
  showToast('Réservation annulée.', 'info');
  renderMyBookings();
}

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
  const todayBookings = DB.bookings.filter(b => b.date === getTodayStr() && b.status === 'confirmed');
  const totalSlots = DB.courts.length * SLOT_TIMES.length;
  const occupancy = totalSlots > 0 ? Math.round((todayBookings.length / totalSlots) * 100) : 0;
  const revenue = todayBookings.reduce((sum, b) => sum + (b.pricePerPlayer * b.players.length), 0);
  const activePlayers = DB.players.filter(p => p.status === 'active').length;
  const alerts = checkMatchAlerts();
  const noShows = 0; // Phase 2

  document.getElementById('kpiBookingsValue').textContent = `${todayBookings.length} créneaux`;
  document.getElementById('kpiOccupancyValue').textContent = `${occupancy}%`;
  document.getElementById('kpiRevenueValue').textContent = `${revenue} DT`;
  document.getElementById('kpiPlayersValue').textContent = `${activePlayers} actifs`;
  document.getElementById('kpiAlertsValue').textContent = alerts.length;
  document.getElementById('kpiNoShowsValue').textContent = `${noShows}`;
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
      const subLabel = booking.type === 'open'
        ? `${playerCount}/4 joueurs · Niv.${booking.minLevel}–${booking.maxLevel}`
        : booking.type === 'private' ? `${playerCount} joueurs`
        : booking.notes || booking.type;

      const organizer = booking.players.find(p => p.isOrganizer);
      const displayName = organizer ? organizer.name : booking.notes || '—';

      return `<td>
        <div class="cell-booking ${typeClass}" onclick="renderSlotDetail('${booking.id}'); openModal('modal-slot-detail')" style="cursor:pointer" title="Cliquer pour gérer">
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

  // Bannière d'attente d'évaluation coach
  const pendingSection = document.getElementById('adminPendingEvalSection');
  const pendingContainer = document.getElementById('adminPendingPlayersCards');
  const pendingBadge = document.getElementById('adminPendingCountBadge');
  const pendingPlayers = (DB.players || []).filter(p => p.status === 'pending' || !p.level);

  if (pendingBadge) pendingBadge.textContent = pendingPlayers.length;
  if (pendingSection) pendingSection.style.display = pendingPlayers.length > 0 ? 'block' : 'none';
  if (pendingContainer) {
    if (pendingPlayers.length === 0) {
      pendingContainer.innerHTML = `<div style="color:var(--text-muted); font-size:13px; grid-column:1/-1">Tous les membres inscrits ont été évalués par le coach ✓</div>`;
    } else {
      pendingContainer.innerHTML = pendingPlayers.map(p => `
        <div style="background:var(--bg-card); border:1px solid rgba(243,156,18,0.35); border-radius:var(--radius-md); padding:12px 14px; display:flex; justify-content:space-between; align-items:center; gap:10px">
          <div>
            <div style="font-weight:700; color:var(--text-white); font-size:14px">${p.firstName} ${p.lastName || ''}</div>
            <div style="font-size:11px; color:var(--text-secondary); margin-top:2px">📞 ${p.phone || p.email || '—'}</div>
            <div style="font-size:11px; color:var(--amber); font-weight:600; margin-top:3px">⏳ Inscrit · En attente d'évaluation</div>
          </div>
          <button class="btn-table-action success" onclick="openPlayerEvalModal('${p.id}')" style="padding:7px 14px; font-weight:700">
            📋 Évaluer
          </button>
        </div>
      `).join('');
    }
  }

  if (!DB.players || DB.players.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding:32px; color:var(--text-muted)">Aucun joueur inscrit dans la base de données.</td></tr>`;
    return;
  }

  tbody.innerHTML = DB.players.map(p => {
    const statusBadge = p.status === 'active'
      ? '<span class="info-badge green">✔ Actif</span>'
      : p.status === 'pending'
      ? '<span class="info-badge" style="background:var(--amber-bg); border:1px solid rgba(243,156,18,0.2); color:var(--amber)">⏳ En attente</span>'
      : '<span class="info-badge red">⛔ Suspendu</span>';

    const levelCell = p.level
      ? `<span class="level-badge">${p.level} <span class="coach-check">✓</span></span>`
      : `<span class="level-badge pending">À évaluer</span>`;

    return `
    <tr>
      <td>
        <div style="display:flex; align-items:center; gap:10px">
          <div class="player-table-avatar">🎾</div>
          <div>
            <div class="player-table-name">${p.firstName} ${p.lastName}</div>
            <div style="font-size:11px; color:var(--text-muted)">${p.email || '—'}</div>
          </div>
        </div>
      </td>
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
          <span style="font-size:12px; color:var(--text-secondary); font-weight:600">${p.reliabilityScore || 50}%</span>
        </div>
        <div style="font-size:10px; color:var(--text-muted); margin-top:2px" title="Niveau éprouvé lors de confrontations face à des pairs de même niveau (±1.0)">
          ${p.peerConfrontationsCount || 0} match(s) pairs
        </div>
      </td>
      <td style="font-family:'Outfit',sans-serif; font-size:16px; font-weight:900; color:var(--text-secondary)">${p.totalMatchesPlayed || 0}</td>
      <td>${statusBadge}</td>
      <td>
        <button class="btn-table-action success" onclick="openPlayerEvalModal('${p.id}')">📋 Évaluer</button>
        ${p.status === 'pending'
          ? `<button class="btn-table-action" onclick="activatePlayer('${p.id}')">Activer</button>`
          : `<button class="btn-table-action danger" onclick="suspendPlayer('${p.id}')">Suspendre</button>`}
      </td>
    </tr>`;
  }).join('');
}

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
  const alerts = checkMatchAlerts();

  const pendingPlayers = DB.players.filter(p => p.status === 'pending');

  let html = '';

  if (alerts.length === 0 && pendingPlayers.length === 0) {
    html = `<div class="empty-state"><div class="empty-state-icon">✅</div><div class="empty-state-title">Aucune alerte</div><div class="empty-state-desc">Tout est en ordre</div></div>`;
  }

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
  contentEl.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:12px">
      <div style="display:flex; gap:8px; flex-wrap:wrap">
        <span class="slot-type-badge ${b.type}" style="font-size:12px; padding:4px 12px">${b.type === 'open' ? 'Match ouvert' : b.type === 'private' ? 'Privée' : b.type === 'course' ? 'Cours' : 'Bloqué'}</span>
        <span class="match-status-badge ${spots===0?'full':spots===1?'almost-full':'open'}">${b.status === 'cancelled' ? 'Annulé' : spots === 0 ? 'Complet' : `${spots} place${spots>1?'s':''} libre${spots>1?'s':''}`}</span>
      </div>

      <div style="background:var(--bg-card-2); border-radius:var(--radius-md); padding:14px; font-size:13px; display:flex; flex-direction:column; gap:6px">
        <div><span style="color:var(--text-muted)">Terrain :</span> <strong>${b.courtName}</strong></div>
        <div><span style="color:var(--text-muted)">Date :</span> <strong>${b.date === today ? 'Aujourd\'hui' : formatDate(b.date)}</strong></div>
        <div><span style="color:var(--text-muted)">Créneau :</span> <strong>${b.startTime} – ${b.endTime}</strong></div>
        ${b.minLevel ? `<div><span style="color:var(--text-muted)">Niveau requis :</span> <strong>${b.minLevel}–${b.maxLevel}</strong></div>` : ''}
        <div><span style="color:var(--text-muted)">Prix par joueur :</span> <strong style="color:var(--gold)">${b.pricePerPlayer} DT</strong> <span style="font-size:11px; color:var(--text-muted)">(paiement sur place)</span></div>
        ${b.notes ? `<div><span style="color:var(--text-muted)">Notes :</span> ${b.notes}</div>` : ''}
      </div>

      <div>
        <div style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-muted); margin-bottom:8px">
          Joueurs (${b.players.length}/4)
        </div>
        ${b.players.map(p => `
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px">
            <div class="player-avatar-sm filled">🎾</div>
            <div style="flex:1">
              <div style="font-size:13px; font-weight:700; color:var(--text-primary)">${p.name}</div>
              <div style="font-size:11px; color:var(--text-muted)">Niveau ${p.level} ${p.isOrganizer ? '· Organisateur' : ''}</div>
            </div>
            ${currentMode === 'backoffice-dashboard' ? `<button class="btn-table-action danger" onclick="removePlayerFromBooking('${b.id}','${p.userId}')">Retirer</button>` : ''}
          </div>`).join('')}
        ${Array(spots).fill(0).map(() => `
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; opacity:0.4">
            <div class="player-avatar-sm empty">+</div>
            <span style="font-size:12px; color:var(--text-muted)">Place libre</span>
          </div>`).join('')}
      </div>

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
  return { weightedScore, officialLevel };
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

  const { weightedScore, officialLevel } = updateEvalPadelCalculationUI();
  evalLevelValue = player.level || officialLevel;

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
    const { weightedScore } = calculatePadelLevelFromSkills(evalSkillValues);

    player.level = evalLevelValue;
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
      newLevel: evalLevelValue,
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

    saveDB(DB);
    closeAllModals();
    renderAdminPlayers();
    renderAdminKPIs();
    renderAdminAlerts();
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
    skills: {},
    levelHistory: [],
    consentSignedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };

  DB.players.push(newPlayer);
  saveDB(DB);
  showToast(`✓ ${firstName} ${lastName} inscrit(e) · En attente d'évaluation coach.`, 'success');
  closeAllModals();
  renderAdminPlayers();
  renderAdminAlerts();
  renderAdminKPIs();
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
}

// ============================================================================
// MODAL SYSTEM
// ============================================================================

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay.active').forEach(m => m.classList.remove('active'));
  document.body.style.overflow = '';
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

    // Mode démo : admin / admin → accès direct sans Firebase Auth
    if ((email === 'admin' || email === 'admin@hayapala.tn' || email === 'admin@circlepadel.com') && password === 'admin') {
      DB.currentUser = {
        id: 'admin_1',
        firstName: 'Gérant',
        lastName: 'CirclePadel',
        email: email,
        role: 'admin',
        status: 'active'
      };
      saveDB(DB);
      updateAuthRoleUI();
      switchViewMode('backoffice-dashboard');
      showToast('Bienvenue Admin 👋', 'gold');
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

  // ── Admin player filter chips ──
  document.querySelectorAll('[data-player-filter]').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('[data-player-filter]').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const filter = chip.dataset.playerFilter;
      document.querySelectorAll('#adminPlayersTableBody tr').forEach(row => {
        if (filter === 'all') { row.style.display = ''; return; }
        row.style.display = row.textContent.toLowerCase().includes(
          filter === 'active' ? 'actif' : filter === 'pending' ? 'attente' : 'suspendu'
        ) ? '' : 'none';
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
        const newBooking = {
          id: `bk_${Date.now()}`, courtId,
          courtName: court?.name || `Terrain ${courtNum}`,
          date, startTime: time, endTime: addMinutes(time, duration),
          type, status: 'confirmed',
          players: [{ userId: DB.currentUser?.id || 'guest', name: `${user?.firstName || 'Joueur'} ${user?.lastName || ''}`.trim(), level: user?.level || 3, isOrganizer: true }],
          waitlist: [], pricePerPlayer: DB.appConfig?.pricePeak || 25,
          createdAt: new Date().toISOString(),
        };
        DB.bookings.push(newBooking);
        saveDB(DB);
        closeAllModals();
        renderCourtsGrid();
        renderHomeScreen();
        showToast('Réservation confirmée ✓ Paiement sur place.', 'success');
        fbAddBooking(newBooking).catch(err => console.warn('fbAddBooking async error:', err));
        fbTrack('booking_created', { courtId, type });
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
      const name = document.getElementById('regPlayerName')?.value?.trim();
      const phone = document.getElementById('regPlayerPhone')?.value?.trim();
      const email = document.getElementById('regPlayerEmail')?.value?.trim() || '';
      const side = document.getElementById('regPlayerSide')?.value || 'right';
      const style = document.getElementById('regPlayerStyle')?.value || 'offensive';
      if (!name || !phone) { showToast('Nom et téléphone obligatoires.', 'error'); return; }
      const [firstName, ...lastParts] = name.split(' ');
      const newPlayer = {
        id: `player_${Date.now()}`,
        firstName, lastName: lastParts.join(' ') || '', phone, email,
        avatar: null, role: 'player', status: 'pending', level: null,
        preferredSide: side, playStyle: style, reliabilityScore: 50,
        totalMatchesPlayed: 0, skills: {}, levelHistory: [],
        consentSignedAt: new Date().toISOString(), createdAt: new Date().toISOString(),
      };
      DB.players.push(newPlayer);
      saveDB(DB);
      closeAllModals();
      renderAdminPlayers();
      renderAdminKPIs();
      showToast(`${name} inscrit(e) ✓`, 'success');
      fbSavePlayer(newPlayer).catch(() => {});
      fbTrack('player_registered', { playerId: newPlayer.id });
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

    // ── Soumission Formulaire Connexion Joueur ──
    if (id === 'btnAuthSubmitLogin') {
      const email = document.getElementById('authLoginEmail')?.value?.trim();
      const password = document.getElementById('authLoginPassword')?.value;
      await handlePlayerLogin(email, password);
    }

    // ── Mode Écran Terrain (LED Stadium) ──
    if (id === 'btnOpenCourtsideDisplay') {
      openCourtsideDisplay();
    }

    // ── Soumission Formulaire Inscription Joueur ──
    if (id === 'btnAuthSubmitRegister') {
      const firstName = document.getElementById('authRegFirstName')?.value?.trim();
      const lastName = document.getElementById('authRegLastName')?.value?.trim();
      const phone = document.getElementById('authRegPhone')?.value?.trim();
      const email = document.getElementById('authRegEmail')?.value?.trim();
      const password = document.getElementById('authRegPassword')?.value;
      const preferredSide = document.getElementById('authRegSide')?.value || 'right';
      const playStyle = document.getElementById('authRegStyle')?.value || 'all-around';
      await handlePlayerRegister({ firstName, lastName, phone, email, password, preferredSide, playStyle });
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

    // Polling régulier pour synchronisation en direct entre onglets et sessions
    setInterval(syncFromBackend, 5000);
    window.addEventListener('focus', syncFromBackend);

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
window.closeModal              = (modalId) => {
  const m = document.getElementById(modalId);
  if (m) { m.classList.remove('active'); document.body.style.overflow = ''; }
};
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

