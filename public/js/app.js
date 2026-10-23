/* ==========================================================================
   HAYAPALA — APPLICATION LOGIC v1.1
   Club de Padel · Firebase Firestore + Auth · circlepadel
   Vanilla JS, no framework — ES Module (type="module" dans index.html)
   ========================================================================== */

// ── Firebase imports (CDN ESM) ─────────────────────────────────────────────
import {
  fbSignIn, fbSignOut, fbOnAuthChange,
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

function saveDB(data) {
  try {
    data._fromFirestore = true;
    localStorage.setItem(DB_KEY, JSON.stringify(data));
  } catch (e) {}
}

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

function getTomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
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
    DB.players = players;
    saveDB(DB);
    renderAdminPlayersTable();
    updateKPIs();
  });

  fbListenBookings(getTodayStr(), bookings => {
    const other = DB.bookings.filter(b => b.date !== getTodayStr());
    DB.bookings = [...other, ...bookings];
    saveDB(DB);
    renderAdminTimetable();
    renderCourtsPlanningGrid();
    renderHomeOpenMatches();
    updateKPIs();
  });

  fbListenOpenMatches(matches => {
    const other = DB.bookings.filter(b => b.type !== 'open' || b.date !== getTodayStr());
    DB.bookings = [...other, ...matches];
    saveDB(DB);
    renderMatchesList();
    renderHomeOpenMatches();
  });
}

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

function switchViewMode(mode) {
  currentMode = mode;
  document.getElementById('playerAppContainer').style.display = (mode === 'player-app') ? '' : 'none';
  document.getElementById('backofficeDashboard').style.display = (mode === 'backoffice-dashboard') ? '' : 'none';
  document.getElementById('backofficeLogin').style.display = (mode === 'backoffice-login') ? '' : 'none';

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
  const user = DB.players.find(p => p.id === DB.currentUser.id);
  if (!user) return;

  // Greeting
  document.getElementById('homeUserName').textContent = `${user.firstName} ${user.lastName}`;

  // Level badge
  const isActive = user.status === 'active';
  document.getElementById('homeLevelNumber').textContent = user.level || '?';

  if (isActive && user.level) {
    document.getElementById('cvLevel').textContent = user.level;
    document.getElementById('coachValidatedNotice').classList.remove('hidden');
    document.getElementById('pendingLevelBanner').classList.add('hidden');
  } else {
    document.getElementById('coachValidatedNotice').classList.add('hidden');
    document.getElementById('pendingLevelBanner').classList.remove('hidden');
  }

  // Open matches compatible
  renderHomeOpenMatches(user);

  // Next booking
  renderHomeNextMatch(user);

  // Notif dot
  const unread = DB.notifications.filter(n => !n.isRead && n.userId === user.id);
  document.getElementById('notifDot').style.display = unread.length > 0 ? '' : 'none';
}

function renderHomeOpenMatches(user) {
  const container = document.getElementById('homeOpenMatchesScroll');
  const matches = getCompatibleMatches(user.id);

  if (matches.length === 0) {
    container.innerHTML = `
      <div style="padding:16px 0; min-width:260px; color:var(--text-muted); font-size:13px">
        Aucun match ouvert disponible pour votre niveau actuellement.
      </div>`;
    return;
  }

  container.innerHTML = matches.slice(0, 5).map(b => {
    const spots = DB.appConfig.maxPlayersPerMatch - b.players.length;
    const filledSlots = b.players.slice(0, 4).map(p =>
      `<div class="player-slot filled" title="${p.name}">🎾</div>`
    ).join('');
    const emptySlots = Array(spots).fill(0).map(() =>
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
        Rejoindre · ${b.pricePerPlayer} DT
      </button>
    </div>`;
  }).join('');
}

function renderHomeNextMatch(user) {
  const container = document.getElementById('homeNextMatchContainer');
  const today = getTodayStr();
  const myBookings = DB.bookings.filter(b =>
    b.players.some(p => p.userId === user.id) &&
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
  const spotsLeft = DB.appConfig.maxPlayersPerMatch - b.players.length;
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
        ${b.players.map(p => `<div class="player-avatar-sm filled" title="${p.name}">🎾</div>`).join('')}
        ${Array(Math.max(0, 4 - b.players.length)).fill('<div class="player-avatar-sm empty">+</div>').join('')}
      </div>
      <div class="match-list-bottom">
        <span class="match-price-tag">${b.pricePerPlayer} DT <span>/joueur · sur place</span></span>
        <span style="font-size:11px; color:var(--text-muted)">${b.players.length}/4 joueurs</span>
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
  const days = [];
  const now = new Date();
  const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const monthNames = ['jan', 'fév', 'mar', 'avr', 'mai', 'jun', 'jul', 'aoû', 'sep', 'oct', 'nov', 'déc'];

  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    days.push({
      dateStr,
      dayName: i === 0 ? 'Auj.' : dayNames[d.getDay()],
      dayNum: d.getDate(),
      monthName: monthNames[d.getMonth()],
    });
  }

  bar.innerHTML = days.map(d => `
    <button class="date-chip ${d.dateStr === planningSelectedDate ? 'active' : ''}"
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
  const duration = DB.appConfig.slotDurationMinutes;

  grid.innerHTML = DB.courts.filter(c => c.isActive).map(court => {
    const slots = SLOT_TIMES.map(time => {
      const endTime = addMinutes(time, duration);
      const booking = DB.bookings.find(b =>
        b.courtId === court.id && b.date === planningSelectedDate && b.startTime === time && b.status === 'confirmed'
      );

      let slotClass = '', badgeClass = 'available', badgeText = 'Libre', dotHtml = '';
      if (booking) {
        const spots = DB.appConfig.maxPlayersPerMatch - (booking.players || []).length;
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
        <div class="slot-item ${slotClass}" onclick="${clickHandler}">
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

function openBookingFromSlot(courtId, time) {
  const court = DB.courts.find(c => c.id === courtId);
  document.getElementById('bookCourtSelect').value = courtId.replace('court_', '');
  document.getElementById('bookTimeSelect').value = time;
  document.getElementById('bookDate').value = planningSelectedDate;
  openModal('modal-book-court');
}

// ============================================================================
// PROFILE SCREEN
// ============================================================================

const LEVEL_LABELS = { 1:'Débutant', 2:'Débutant+', 3:'Intermédiaire', 4:'Intermédiaire+', 5:'Confirmé', 6:'Avancé', 7:'Élite' };
const SIDE_LABELS = { right:'Droitier', left:'Gaucher', both:'Ambidextre' };
const STYLE_LABELS = { offensive:'Offensif', defensive:'Défensif', 'all-around':'Équilibré' };
const SKILL_LABELS = { bandeja:'Bandeja', vibora:'Víbora', salida_cristal:'Sortie de vitre', volee:'Volée', placement:'Placement', regularite:'Régularité', mental:'Mental' };

function renderProfileScreen() {
  const user = DB.players.find(p => p.id === DB.currentUser.id);
  if (!user) return;

  document.getElementById('profileName').textContent = `${user.firstName} ${user.lastName}`;
  document.getElementById('profilePhone').textContent = user.phone || '—';
  document.getElementById('profileLevelBig').textContent = user.level || '?';
  document.getElementById('profileLevelTitle').textContent = LEVEL_LABELS[user.level] || 'En attente';
  document.getElementById('profileLevelCoach').textContent = user.levelValidatedAt
    ? `Validé le ${formatDate(user.levelValidatedAt.split('T')[0])}`
    : 'Pas encore validé';
  document.getElementById('statMatchesPlayed').textContent = user.totalMatchesPlayed || 0;
  document.getElementById('statReliability').textContent = user.reliabilityScore ? `${user.reliabilityScore}%` : '—';
  document.getElementById('statSide').textContent = user.preferredSide === 'right' ? 'D' : user.preferredSide === 'left' ? 'G' : '±';
  document.getElementById('statStyle').textContent = user.playStyle === 'offensive' ? 'OFF' : user.playStyle === 'defensive' ? 'DEF' : 'EQ';
  document.getElementById('profileSideBadge').textContent = `🖐 ${SIDE_LABELS[user.preferredSide] || '—'}`;
  document.getElementById('profileStyleBadge').textContent = `⚡ ${STYLE_LABELS[user.playStyle] || '—'}`;
  document.getElementById('profileStatusBadge').textContent = user.status === 'active' ? '✔ Actif' : '⏳ En attente';

  // Radar SVG
  renderRadarChart(user.skills);

  // Skills list
  renderSkillsList(user.skills);

  // Level history
  renderLevelHistory(user);

  // Match history (from bookings)
  renderProfileHistory(user);
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
  const history = user.levelHistory || [];
  if (history.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); font-size:13px; padding:8px 0">Aucun changement de niveau enregistré.</div>';
    return;
  }
  container.innerHTML = history.map(h => `
    <div style="display:flex; gap:12px; align-items:flex-start; padding:12px 0; border-bottom:1px solid var(--border-subtle)">
      <div style="width:40px; height:40px; border-radius:50%; background:var(--gold-glow-sm); border:1px solid var(--border-gold-sm); display:flex; align-items:center; justify-content:center; font-family:'Outfit',sans-serif; font-size:16px; font-weight:900; color:var(--gold); flex-shrink:0">
        ${h.newLevel}
      </div>
      <div>
        <div style="font-size:13px; font-weight:700; color:var(--text-white)">
          Niveau ${h.previousLevel} → ${h.newLevel}
          <span style="font-size:11px; color:${h.newLevel > h.previousLevel ? 'var(--green)' : 'var(--red)'}">
            ${h.newLevel > h.previousLevel ? '▲' : '▼'}
          </span>
        </div>
        <div style="font-size:11px; color:var(--text-muted); margin:2px 0">${formatDate(h.changedAt.split('T')[0])}</div>
        ${h.coachComment ? `<div style="font-size:12px; color:var(--text-secondary); font-style:italic; margin-top:4px">"${h.coachComment}"</div>` : ''}
      </div>
    </div>`
  ).join('');
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
          <span style="font-size:12px; color:var(--text-secondary)">${p.reliabilityScore || 50}%</span>
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

  // Occupancy chart (courts)
  const chart = document.getElementById('occupancyChart');
  chart.innerHTML = DB.courts.map(court => {
    const booked = DB.bookings.filter(b => b.courtId === court.id && b.status === 'confirmed').length;
    const pct = Math.min(100, Math.round((booked / (SLOT_TIMES.length * 7)) * 100));
    return `
    <div class="occ-bar-wrap">
      <div class="occ-bar" style="height:${pct}%; min-height:4px" title="${court.name}: ${pct}%"></div>
      <div class="occ-bar-label">${court.name.replace('Terrain ', 'T')}<br>${pct}%</div>
    </div>`;
  }).join('');

  // Transactions table
  const tbody = document.getElementById('adminTransactionsTableBody');
  const recentBookings = DB.bookings.filter(b => b.status === 'confirmed').slice(-10).reverse();
  if (recentBookings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding:20px">Aucune transaction</td></tr>';
    return;
  }
  tbody.innerHTML = recentBookings.map(b => {
    const organizer = b.players.find(p => p.isOrganizer) || b.players[0];
    const amount = b.pricePerPlayer * b.players.length;
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

// ============================================================================
// SLOT DETAIL MODAL
// ============================================================================

function renderSlotDetail(bookingId) {
  const b = DB.bookings.find(b => b.id === bookingId);
  if (!b) return;
  const spots = DB.appConfig.maxPlayersPerMatch - b.players.length;
  const today = getTodayStr();

  document.getElementById('slotDetailTitle').textContent = `${b.courtName} · ${b.startTime}`;
  document.getElementById('slotDetailContent').innerHTML = `
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

function openPlayerEvalModal(playerId) {
  const player = DB.players.find(p => p.id === playerId);
  if (!player) return;

  evalCurrentPlayerId = playerId;
  evalSkillValues = player.skills ? { ...player.skills } : {};
  evalLevelValue = player.level;

  document.getElementById('evalModalTitle').textContent = `Évaluation · ${player.firstName} ${player.lastName}`;
  document.getElementById('evalPlayerAvatar').textContent = '🎾';
  document.getElementById('evalPlayerName').textContent = `${player.firstName} ${player.lastName}`;
  document.getElementById('evalPlayerPhone').textContent = player.phone || '—';
  document.getElementById('evalPlayerCurrentLevel').textContent = player.level ? `Niveau ${player.level}` : 'Non évalué';
  document.getElementById('evalPlayerMatches').textContent = `${player.totalMatchesPlayed || 0} matchs`;

  // Skill dots (1–10)
  Object.keys(SKILL_LABELS).forEach(skill => {
    const container = document.querySelector(`[data-skill="${skill}"]`);
    if (!container) return;
    const current = evalSkillValues[skill] || 0;
    container.innerHTML = Array.from({ length: 10 }, (_, i) => i + 1).map(n => `
      <button type="button" class="skill-dot-btn ${n <= current ? 'active' : ''}"
        data-val="${n}" onclick="setSkillValue('${skill}', ${n})">${n}</button>`
    ).join('');
  });

  // Level selector (1–7)
  const levelSel = document.getElementById('evalLevelSelector');
  levelSel.innerHTML = Array.from({ length: 7 }, (_, i) => i + 1).map(n => `
    <div class="eval-level-btn ${n === evalLevelValue ? 'active' : ''}"
      onclick="setEvalLevel(${n})" title="${LEVEL_LABELS[n]}">${n}</div>`
  ).join('');

  // Comment
  document.getElementById('evalCoachComment').value = '';

  openModal('modal-player-eval');
}

function setSkillValue(skill, val) {
  evalSkillValues[skill] = val;
  const container = document.querySelector(`[data-skill="${skill}"]`);
  if (container) {
    container.querySelectorAll('.skill-dot-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.val) <= val);
    });
  }
}

function setEvalLevel(level) {
  evalLevelValue = level;
  document.querySelectorAll('#evalLevelSelector .eval-level-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.textContent) === level);
  });
}

function saveEvaluation(e) {
  e.preventDefault();
  if (!evalCurrentPlayerId || !evalLevelValue) {
    showToast('Veuillez sélectionner un niveau global (1–7).', 'error');
    return;
  }

  const player = DB.players.find(p => p.id === evalCurrentPlayerId);
  if (!player) return;

  const comment = document.getElementById('evalCoachComment').value.trim();
  const previousLevel = player.level;

  // Update player
  player.skills = { ...evalSkillValues };
  player.level = evalLevelValue;
  player.status = 'active';
  player.levelValidatedAt = new Date().toISOString();
  player.levelValidatedBy = DB.currentUser.id;

  // Level history entry
  if (previousLevel !== evalLevelValue || !previousLevel) {
    player.levelHistory = player.levelHistory || [];
    player.levelHistory.push({
      previousLevel: previousLevel || null,
      newLevel: evalLevelValue,
      changedAt: new Date().toISOString(),
      changedBy: DB.currentUser.id,
      coachComment: comment,
    });

    // Notification to player
    DB.notifications.push({
      id: `notif_${Date.now()}`,
      userId: player.id,
      type: 'level_updated',
      title: `Votre niveau a été mis à jour`,
      body: `Le coach a validé votre niveau à ${evalLevelValue}/7.${comment ? ` "${comment}"` : ''}`,
      isRead: false,
      sentAt: new Date().toISOString(),
    });
  }

  saveDB(DB);
  showToast(`✓ Évaluation enregistrée · Niveau ${evalLevelValue}/7 validé pour ${player.firstName}`, 'success');
  closeAllModals();
  renderAdminPlayers();
  renderAdminKPIs();
  renderAdminAlerts();
}

// ============================================================================
// ADMIN SLOT CREATION
// ============================================================================

function openAdminSlotModal(courtId, time, date) {
  document.getElementById('adminSlotCourt').value = courtId.replace('court_', '');
  document.getElementById('adminSlotTime').value = time;
  document.getElementById('adminSlotDate').value = date;
  openModal('modal-admin-create-slot');
}

function createAdminSlot(e) {
  e.preventDefault();
  const type = document.getElementById('adminSlotType').value;
  const courtNum = document.getElementById('adminSlotCourt').value;
  const courtId = `court_${courtNum}`;
  const court = DB.courts.find(c => c.id === courtId);
  const time = document.getElementById('adminSlotTime').value;
  const date = document.getElementById('adminSlotDate').value;
  const notes = document.getElementById('adminSlotNotes').value;
  const duration = DB.appConfig.slotDurationMinutes;

  if (!date) { showToast('Veuillez sélectionner une date.', 'error'); return; }

  const existing = DB.bookings.find(b => b.courtId === courtId && b.date === date && b.startTime === time && b.status === 'confirmed');
  if (existing) { showToast('Ce créneau est déjà occupé.', 'error'); return; }

  const newBooking = {
    id: `bk_${Date.now()}`,
    courtId, courtName: court ? court.name : `Terrain ${courtNum}`,
    date, startTime: time, endTime: addMinutes(time, duration),
    type, status: 'confirmed',
    players: [],
    waitlist: [],
    notes,
    pricePerPlayer: DB.appConfig.pricePeak,
    createdAt: new Date().toISOString(),
  };

  if (type === 'open') {
    newBooking.minLevel = parseInt(document.getElementById('adminSlotLevelMin').value) || 3;
    newBooking.maxLevel = parseInt(document.getElementById('adminSlotLevelMax').value) || 5;
    // Notify compatible players
    notifyCompatiblePlayersForMatch(newBooking);
  }

  DB.bookings.push(newBooking);
  saveDB(DB);
  showToast(`Créneau créé · ${court?.name} · ${time}`, 'success');
  closeAllModals();
  renderAdminDashboard();
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
    container.innerHTML = Array.from({ length: 7 }, (_, i) => i + 1).map(n => `
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

document.addEventListener('DOMContentLoaded', async () => {

  // ──────────────────────────────────────────────────────────────────────────
  // FIREBASE : Seed (1ère utilisation) + Sync + Listeners temps-réel
  // ──────────────────────────────────────────────────────────────────────────

  // 1. Initialiser Firestore si base vide (terrains + config)
  try {
    await initFirestoreIfEmpty();
  } catch (e) {
    console.warn('⚠️ Init Firestore ignorée :', e.message);
  }

  // 2. Sync initiale depuis Firestore (met à jour le cache local)
  await syncFromFirestore();

  // 3. Listeners temps-réel (Firestore → UI)
  try { startRealtimeListeners(); } catch (e) {}

  // 4. Observer l'état Auth Firebase
  fbOnAuthChange(user => {
    if (user) {
      // Utilisateur connecté → accès dashboard gérant
      DB.currentUser = { ...DB.currentUser, firebaseUid: user.uid, email: user.email };
      console.log('🔐 Connecté :', user.email);
    } else {
      // Pas connecté → mode démo player
      console.log('👤 Mode démo joueur (non authentifié)');
    }
  });

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

    // Mode démo : admin / admin → accès direct sans Firebase Auth
    if ((email === 'admin' || email === 'admin@hayapala.tn') && password === 'admin') {
      switchViewMode('backoffice-dashboard');
      showToast('Bienvenue Admin 👋', 'gold');
      fbTrack('login', { method: 'demo' });
      return;
    }

    // Tentative Firebase Auth (email/password)
    try {
      await fbSignIn(email, password);
      switchViewMode('backoffice-dashboard');
      showToast('Connexion réussie ✓', 'success');
      fbTrack('login', { method: 'firebase_email' });
    } catch (err) {
      showToast('Identifiants incorrects. Essayez admin / admin pour la démo.', 'error');
      console.error('Auth error:', err.code, err.message);
    }
  });

  // ── Admin LOGOUT ──
  document.querySelectorAll('[onclick*="backoffice-login"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try { await fbSignOut(); } catch (e) {}
      switchViewMode('backoffice-login');
    });
  });

  // ── Évaluation coach — bouton Valider ──
  document.getElementById('btnSubmitEvaluation')?.addEventListener('click', async () => {
    const playerId = document.getElementById('btnSubmitEvaluation').dataset.playerId;
    if (!playerId) return;

    const level   = parseInt(document.getElementById('evalLevelSelector')?.querySelector('.eval-level-btn.active')?.textContent) || null;
    const comment = document.getElementById('evalCoachComment')?.value?.trim() || '';

    if (!level) { showToast('Sélectionnez un niveau officiel.', 'error'); return; }

    const skills = {};
    document.querySelectorAll('#skillsEvalGrid .skill-eval-row').forEach(row => {
      const key  = row.dataset.skill;
      const val  = parseInt(row.querySelector('.eval-dot.active')?.dataset.val) || 5;
      skills[key] = val;
    });

    // Sauvegarder en local d'abord (réactivité immédiate)
    const player = DB.players.find(p => p.id === playerId);
    if (player) {
      const prev = player.level;
      player.level              = level;
      player.status             = 'active';
      player.skills             = skills;
      player.levelValidatedAt   = new Date().toISOString();
      player.levelValidatedBy   = 'coach_ali';
      player.levelHistory       = [...(player.levelHistory || []), {
        previousLevel: prev, newLevel: level,
        changedAt: new Date().toISOString(), changedBy: 'coach_ali', coachComment: comment,
      }];
      saveDB(DB);
    }

    // Persister en Firestore en arrière-plan
    try {
      await fbUpdatePlayerLevel(playerId, { level, coachComment: comment, coachId: DB.currentUser?.id || 'coach_ali' });
      await fbSavePlayer({ ...player, skills });
      showToast(`Niveau ${level}/7 validé pour ${player?.firstName} ✓`, 'success');
      fbTrack('player_evaluated', { playerId, level });
    } catch (e) {
      showToast(`Niveau ${level}/7 sauvegardé (Firestore hors-ligne).`, 'gold');
    }

    closeAllModals();
    renderAdminPlayers();
  });

  // ── Inscription nouveau membre (Firestore) ──
  document.getElementById('btnConfirmRegisterPlayer')?.addEventListener('click', async () => {
    const name  = document.getElementById('regPlayerName')?.value?.trim();
    const phone = document.getElementById('regPlayerPhone')?.value?.trim();
    const email = document.getElementById('regPlayerEmail')?.value?.trim();
    const side  = document.getElementById('regPlayerSide')?.value || 'right';
    const style = document.getElementById('regPlayerStyle')?.value || 'offensive';

    if (!name || !phone) { showToast('Nom et téléphone obligatoires.', 'error'); return; }

    const [firstName, ...lastParts] = name.split(' ');
    const lastName  = lastParts.join(' ') || '';
    const newPlayer = {
      id:              `player_${Date.now()}`,
      firstName, lastName, phone, email,
      avatar:          null,
      role:            'player',
      status:          'pending',
      level:           null,
      preferredSide:   side,
      playStyle:       style,
      reliabilityScore: 50,
      totalMatchesPlayed: 0,
      skills:          {},
      levelHistory:    [],
      consentSignedAt: new Date().toISOString(),
      createdAt:       new Date().toISOString(),
    };

    DB.players.push(newPlayer);
    saveDB(DB);

    try {
      await fbSavePlayer(newPlayer);
      showToast(`${name} inscrit(e) ✓ — En attente d'évaluation coach.`, 'success');
      fbTrack('player_registered', { playerId: newPlayer.id });
    } catch (e) {
      showToast(`${name} inscrit(e) (Firestore hors-ligne).`, 'gold');
    }

    closeAllModals();
    renderAdminPlayers();
  });

  // ── Réservation terrain (Firestore) ──
  document.getElementById('btnConfirmBooking')?.addEventListener('click', async () => {
    const courtNum = parseInt(document.getElementById('bookCourtSelect')?.value) || 1;
    const date     = document.getElementById('bookDateInput')?.value || getTodayStr();
    const time     = document.getElementById('bookStartTime')?.value || '10:00';
    const duration = parseInt(document.getElementById('bookDuration')?.value) || 90;
    const type     = document.getElementById('bookType')?.value || 'private';
    const courtId  = `court_${courtNum}`;
    const court    = DB.courts.find(c => c.id === courtId);
    const user     = DB.players.find(p => p.id === DB.currentUser.id);

    const newBooking = {
      id:            `bk_${Date.now()}`,
      courtId,
      courtName:     court?.name || `Terrain ${courtNum}`,
      date, startTime: time,
      endTime:       addMinutes(time, duration),
      type, status:  'confirmed',
      players:       [{ userId: DB.currentUser.id, name: `${user?.firstName} ${user?.lastName}`, level: user?.level, isOrganizer: true }],
      waitlist:      [],
      pricePerPlayer: DB.appConfig.pricePeak,
      createdAt:     new Date().toISOString(),
    };

    DB.bookings.push(newBooking);
    saveDB(DB);

    try {
      const id = await fbAddBooking(newBooking);
      newBooking.id = id;
      showToast('Réservation confirmée ✓ Paiement sur place.', 'success');
      fbTrack('booking_created', { courtId, type });
    } catch (e) {
      showToast('Réservation enregistrée (Firestore hors-ligne).', 'gold');
    }

    closeAllModals();
    renderCourtsPlanningGrid();
    renderHomeScreen();
  });

  // ── Créer un match ouvert (Firestore) ──
  document.getElementById('btnConfirmCreateMatch')?.addEventListener('click', async () => {
    const courtNum = parseInt(document.getElementById('createMatchCourt')?.value) || 1;
    const datetime = document.getElementById('createMatchDateTime')?.value;
    const levelRange = document.getElementById('createMatchLevel')?.value || '4-6';
    const note     = document.getElementById('createMatchNote')?.value?.trim() || '';
    const [minL, maxL] = levelRange.split('-').map(Number);
    const courtId  = `court_${courtNum}`;
    const court    = DB.courts.find(c => c.id === courtId);
    const user     = DB.players.find(p => p.id === DB.currentUser.id);

    if (!datetime) { showToast('Sélectionnez une date et heure.', 'error'); return; }
    const [date, time] = datetime.split('T');

    const newMatch = {
      id:            `bk_${Date.now()}`,
      courtId,
      courtName:     court?.name || `Terrain ${courtNum}`,
      date, startTime: time?.slice(0, 5) || '18:00',
      endTime:       addMinutes(time?.slice(0, 5) || '18:00', 90),
      type:          'open', status: 'open',
      minLevel:      minL || 3, maxLevel: maxL || 5,
      players:       [{ userId: DB.currentUser.id, name: `${user?.firstName} ${user?.lastName}`, level: user?.level, isOrganizer: true }],
      waitlist:      [],
      pricePerPlayer: DB.appConfig.pricePeak,
      notes:         note,
      createdAt:     new Date().toISOString(),
    };

    DB.bookings.push(newMatch);
    saveDB(DB);

    try {
      await fbCreateOpenMatch(newMatch);
      showToast('Match ouvert publié ! 🎾 Joueurs compatibles notifiés.', 'success');
      fbTrack('open_match_created', { courtId, minLevel: minL, maxLevel: maxL });
    } catch (e) {
      showToast('Match créé (Firestore hors-ligne).', 'gold');
    }

    closeAllModals();
    renderMatchesList();
    renderHomeOpenMatches();
  });

  // ── Toggle show/hide admin password ──
  document.getElementById('toggleAdminPassword')?.addEventListener('click', () => {
    const inp = document.getElementById('adminPassword');
    if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  // ── Mark all notifs read ──
  document.getElementById('btnMarkAllRead')?.addEventListener('click', async () => {
    const unread = DB.notifications.filter(n => !n.isRead && n.userId === DB.currentUser.id);
    unread.forEach(n => { n.isRead = true; });
    saveDB(DB);
    renderNotifications();
    document.getElementById('notifDot').style.display = 'none';
    // Sync Firestore
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
    try { await fbSaveConfig(DB.appConfig); } catch (e) {}
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

  // ── Initial UI render ──
  renderHomeScreen();

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
  // EVENT DELEGATION — tous les boutons dynamiques (modales, planning, éval.)
  // Un seul handler capture TOUS les clics, évitant les problèmes d'éléments
  // non encore présents dans le DOM au moment du addEventListener.
  // ============================================================================
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button, [data-action]');
    if (!btn) return;
    const id = btn.id;

    // ── Confirmation réservation terrain ──
    if (id === 'btnConfirmBooking') {
      const courtNum = parseInt(document.getElementById('bookCourtSelect')?.value) || 1;
      const date     = document.getElementById('bookDateInput')?.value || getTodayStr();
      const time     = document.getElementById('bookStartTime')?.value || '10:00';
      const duration = parseInt(document.getElementById('bookDuration')?.value) || 90;
      const type     = document.getElementById('bookType')?.value || 'private';
      const courtId  = `court_${courtNum}`;
      const court    = DB.courts.find(c => c.id === courtId);
      const user     = DB.players.find(p => p.id === DB.currentUser.id);
      const newBooking = {
        id: `bk_${Date.now()}`, courtId,
        courtName: court?.name || `Terrain ${courtNum}`,
        date, startTime: time, endTime: addMinutes(time, duration),
        type, status: 'confirmed',
        players: [{ userId: DB.currentUser.id, name: `${user?.firstName || 'Joueur'} ${user?.lastName || ''}`, level: user?.level, isOrganizer: true }],
        waitlist: [], pricePerPlayer: DB.appConfig.pricePeak,
        createdAt: new Date().toISOString(),
      };
      DB.bookings.push(newBooking); saveDB(DB);
      try {
        const fsId = await fbAddBooking(newBooking); newBooking.id = fsId;
        showToast('Réservation confirmée ✓', 'success');
        fbTrack('booking_created', { courtId, type });
      } catch (err) { showToast('Réservation enregistrée.', 'gold'); }
      closeAllModals(); renderCourtsPlanningGrid(); renderHomeScreen();
    }

    // ── Création match ouvert ──
    if (id === 'btnConfirmCreateMatch') {
      const courtNum = parseInt(document.getElementById('createMatchCourt')?.value) || 1;
      const datetime = document.getElementById('createMatchDateTime')?.value;
      const levelRange = document.getElementById('createMatchLevel')?.value || '3-5';
      const note = document.getElementById('createMatchNote')?.value?.trim() || '';
      if (!datetime) { showToast('Sélectionnez une date et heure.', 'error'); return; }
      const [minL, maxL] = levelRange.split('-').map(Number);
      const [date, time] = datetime.split('T');
      const courtId = `court_${courtNum}`;
      const court = DB.courts.find(c => c.id === courtId);
      const user = DB.players.find(p => p.id === DB.currentUser.id);
      const newMatch = {
        id: `bk_${Date.now()}`, courtId,
        courtName: court?.name || `Terrain ${courtNum}`,
        date, startTime: time?.slice(0,5) || '18:00', endTime: addMinutes(time?.slice(0,5) || '18:00', 90),
        type: 'open', status: 'open',
        minLevel: minL || 3, maxLevel: maxL || 5,
        players: [{ userId: DB.currentUser.id, name: `${user?.firstName || 'Joueur'} ${user?.lastName || ''}`, level: user?.level, isOrganizer: true }],
        waitlist: [], pricePerPlayer: DB.appConfig.pricePeak, notes: note,
        createdAt: new Date().toISOString(),
      };
      DB.bookings.push(newMatch); saveDB(DB);
      try {
        await fbCreateOpenMatch(newMatch);
        showToast('Match ouvert publié ! 🎾', 'success');
        fbTrack('open_match_created', { courtId, minLevel: minL, maxLevel: maxL });
      } catch (err) { showToast('Match créé.', 'gold'); }
      closeAllModals(); renderMatchesList(); renderHomeOpenMatches();
    }

    // ── Validation évaluation coach ──
    if (id === 'btnSubmitEvaluation') {
      const playerId = btn.dataset.playerId;
      if (!playerId) return;
      const level = parseInt(document.getElementById('evalLevelSelector')?.querySelector('.eval-level-btn.active')?.textContent) || null;
      const comment = document.getElementById('evalCoachComment')?.value?.trim() || '';
      if (!level) { showToast('Sélectionnez un niveau officiel.', 'error'); return; }
      const skills = {};
      document.querySelectorAll('#skillsEvalGrid .skill-eval-row').forEach(row => {
        skills[row.dataset.skill] = parseInt(row.querySelector('.eval-dot.active')?.dataset.val) || 5;
      });
      const player = DB.players.find(p => p.id === playerId);
      if (player) {
        const prev = player.level;
        player.level = level; player.status = 'active'; player.skills = skills;
        player.levelValidatedAt = new Date().toISOString(); player.levelValidatedBy = 'coach';
        player.levelHistory = [...(player.levelHistory || []), { previousLevel: prev, newLevel: level, changedAt: new Date().toISOString(), changedBy: 'coach', coachComment: comment }];
        saveDB(DB);
      }
      try {
        await fbUpdatePlayerLevel(playerId, { level, coachComment: comment, coachId: 'coach' });
        await fbSavePlayer({ ...player, skills });
        showToast(`Niveau ${level}/7 validé ✓`, 'success');
        fbTrack('player_evaluated', { playerId, level });
      } catch (err) { showToast(`Niveau ${level}/7 sauvegardé.`, 'gold'); }
      closeAllModals(); renderAdminPlayers();
    }

    // ── Inscription membre ──
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
      DB.players.push(newPlayer); saveDB(DB);
      try {
        await fbSavePlayer(newPlayer);
        showToast(`${name} inscrit(e) ✓`, 'success');
        fbTrack('player_registered', { playerId: newPlayer.id });
      } catch (err) { showToast(`${name} inscrit(e).`, 'gold'); }
      closeAllModals(); renderAdminPlayers();
    }

    // ── Navigation jours planning gérant ──
    if (id === 'btnPrevDay') {
      const d = new Date((window._adminCurrentDate || getTodayStr()) + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      window._adminCurrentDate = d.toISOString().split('T')[0];
      const el = document.getElementById('adminCurrentDate');
      if (el) el.textContent = formatDate(window._adminCurrentDate);
      renderAdminTimetable();
    }
    if (id === 'btnNextDay') {
      const d = new Date((window._adminCurrentDate || getTodayStr()) + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      window._adminCurrentDate = d.toISOString().split('T')[0];
      const el = document.getElementById('adminCurrentDate');
      if (el) el.textContent = formatDate(window._adminCurrentDate);
      renderAdminTimetable();
    }
    if (id === 'btnTodayAdmin') {
      window._adminCurrentDate = getTodayStr();
      const el = document.getElementById('adminCurrentDate');
      if (el) el.textContent = formatDate(window._adminCurrentDate);
      renderAdminTimetable();
    }
    if (id === 'btnAdminOpenRegisterPlayer') openModal('modal-register-player');
    if (id === 'btnAdminDirectBooking') openModal('modal-admin-create-slot');

    // ── Mot de passe admin visible/masqué ──
    if (id === 'toggleAdminPassword') {
      const inp = document.getElementById('adminPassword');
      if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
    }

    // ── Mark all notifs read ──
    if (id === 'btnMarkAllRead') {
      const unreadN = DB.notifications.filter(n => !n.isRead && n.userId === DB.currentUser.id);
      unreadN.forEach(n => { n.isRead = true; });
      saveDB(DB); renderNotifications();
      const dotElN = document.getElementById('notifDot');
      if (dotElN) dotElN.style.display = 'none';
      for (const n of unreadN) { try { await fbMarkNotifRead(n.id); } catch (er) {} }
    }
  });

  console.log('%c🎾 CirclePadel v1.1 — Firebase Firestore + Auth · circlepadel', 'color:#C8A96E; font-weight:bold; font-size:15px');
  console.log('%c🔥 Firestore sync + real-time listeners actifs', 'color:#F39C12');
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

