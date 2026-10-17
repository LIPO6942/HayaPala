/**
 * HayaPala Platform - Application Logic
 * Next-Gen Padel: Standalone Player Web App & Club Pro Management Back-Office
 */

// Global Application State
let AppState = {
  user: null,
  clubs: [],
  courts: [],
  matches: [],
  userMatchHistory: [],
  tournaments: [],
  tournament: null,
  clubBookings: [],
  officialTeams: [],
  communityPlayers: [],
  transactions: [],
  activeScreen: 'screen-home',
  activeViewMode: 'player-app', // 'player-app' | 'backoffice-dashboard' | 'backoffice-login'
  activeAdminTab: 'planning', // 'planning' | 'courts' | 'tournaments' | 'players' | 'matches' | 'finances' | 'settings'
  activeMatchTab: 'tab-available',
  selectedClubForBooking: null,
  selectedCourtForBooking: null,
  selectedTimeSlot: '17:00 - 18:30',
  selectedPartnerForDuo: null,
  currentAdminClubId: 'club_connection'
};

// Initialize Application on DOM Ready
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadStateFromServer();

  // Check URL routing / hash to restore admin or app
  const path = window.location.pathname;
  const hash = window.location.hash;
  if (path === '/admin' || hash === '#admin') {
    switchViewMode('backoffice-dashboard');
  } else {
    switchViewMode('player-app');
  }

  renderAllViews();
});

// Fetch unified state from server (persistent database)
async function loadStateFromServer() {
  try {
    const res = await fetch('/api/state');
    if (res.ok) {
      const data = await res.json();
      AppState.user = data.user;
      AppState.clubs = data.clubs || [];
      AppState.matches = data.matches || [];
      AppState.userMatchHistory = data.userMatchHistory || [];
      AppState.tournaments = data.tournaments || [];
      AppState.tournament = data.tournament || (data.tournaments && data.tournaments[0]);
      AppState.clubBookings = data.clubBookings || [];
      AppState.officialTeams = data.officialTeams || [];
      AppState.communityPlayers = data.communityPlayers || [];
      AppState.transactions = data.transactions || [];
      updateHeaderPoints();
    }
  } catch (err) {
    console.error("Failed to load state from server, using local fallback", err);
  }
}

// Update points across all badges
function updateHeaderPoints() {
  if (!AppState.user) return;
  const pts = Number(AppState.user.points).toFixed(2);
  
  const livePill = document.getElementById('topLivePointsValue');
  if (livePill) livePill.textContent = `${pts} Points`;
  
  const homeBadge = document.getElementById('homePointsBadgeValue');
  if (homeBadge) homeBadge.textContent = `${pts} Points`;

  const profileBadge = document.getElementById('profilePointsBadgeValue');
  if (profileBadge) profileBadge.textContent = `${pts} Points`;
}

// Setup Event Listeners
function setupEventListeners() {
  // Top View Mode Switcher
  document.querySelectorAll('.view-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      switchViewMode(mode);
    });
  });

  // Mobile Bottom Navigation
  document.querySelectorAll('.nav-item-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetScreen = btn.dataset.screen;
      if (targetScreen) {
        navigateToScreen(targetScreen);
      }
    });
  });

  // Center Floating Emblem Button
  const centerActionBtn = document.getElementById('navCenterEmblem');
  if (centerActionBtn) {
    centerActionBtn.addEventListener('click', () => {
      openModal('modal-quick-action');
    });
  }

  // Quick action cards on Home
  document.getElementById('quickCardBookCourt')?.addEventListener('click', () => navigateToScreen('screen-book-court'));
  document.getElementById('quickCardJoinMatch')?.addEventListener('click', () => navigateToScreen('screen-join-match'));

  // Back buttons on screens
  document.querySelectorAll('.back-to-home-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateToScreen('screen-home'));
  });

  // Match screen tabs (Disponibles vs Mes matches)
  const tabAvail = document.getElementById('tabMatchesAvailable');
  const tabMy = document.getElementById('tabMatchesMy');
  if (tabAvail && tabMy) {
    tabAvail.addEventListener('click', () => {
      tabAvail.classList.add('active');
      tabMy.classList.remove('active');
      AppState.activeMatchTab = 'tab-available';
      renderMatchesFeed();
    });
    tabMy.addEventListener('click', () => {
      tabMy.classList.add('active');
      tabAvail.classList.remove('active');
      AppState.activeMatchTab = 'tab-my';
      renderMatchesFeed();
    });
  }

  // Launch match button
  document.getElementById('btnLaunchMatchCta')?.addEventListener('click', () => openModal('modal-create-match'));

  // Club Search Filter
  document.getElementById('clubSearchInput')?.addEventListener('input', (e) => {
    renderClubsList(e.target.value);
  });

  // Wallet Recharge Triggers
  const triggerRecharge = () => openModal('modal-recharge-points');
  document.getElementById('topLivePointsPill')?.addEventListener('click', triggerRecharge);
  document.getElementById('homePointsBadge')?.addEventListener('click', triggerRecharge);
  document.getElementById('profilePointsBadge')?.addEventListener('click', triggerRecharge);
  document.getElementById('settingsRechargePoints')?.addEventListener('click', triggerRecharge);

  // Transfer Triggers
  const triggerTransfer = () => openModal('modal-transfer-points');
  document.getElementById('homeQuickTransferBtn')?.addEventListener('click', triggerTransfer);
  document.getElementById('settingsTransferPoints')?.addEventListener('click', triggerTransfer);

  // Reset Demo Button
  document.getElementById('btnResetDemoData')?.addEventListener('click', resetDemoData);

  // Modal Closers
  document.querySelectorAll('.modal-close-btn, .modal-cancel-btn').forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });

  // Click outside modal card to close
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeAllModals();
    });
  });

  // Recharge Pack Selection (Amount)
  document.querySelectorAll('.pack-recharge-grid .pack-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.pack-recharge-grid .pack-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });

  // Payment Method Selection (Flouci, D17, CB)
  document.querySelectorAll('.payment-method-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.payment-method-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      const r = card.querySelector('input[type="radio"]');
      if (r) r.checked = true;
    });
  });

  // Book Court Type Change (Individual share vs full court)
  document.getElementById('bookTypeSelect')?.addEventListener('change', (e) => {
    const isPrivate = e.target.value === 'Privée';
    const shareEl = document.getElementById('bookingShareDue');
    const noteEl = document.getElementById('bookingShareNote');
    const btnEl = document.getElementById('btnSubmitBookCourt');
    if (isPrivate) {
      if (shareEl) shareEl.textContent = '100.0 Points (100 DT)';
      if (noteEl) noteEl.textContent = '🔒 Vous réservez le court complet pour vous et vos amis (terrain privatisé).';
      if (btnEl) btnEl.textContent = 'Régler le court complet (100 Pts)';
    } else {
      if (shareEl) shareEl.textContent = '25.0 Points (25 DT)';
      if (noteEl) noteEl.textContent = '✓ Les 3 autres joueurs régleront chacun 25 DT directement sur HayaPala en rejoignant la partie.';
      if (btnEl) btnEl.textContent = 'Valider et payer ma part (25 Pts)';
    }
  });

  // Confirm Recharge
  document.getElementById('btnConfirmRecharge')?.addEventListener('click', executeRecharge);

  // Confirm Transfer
  document.getElementById('btnConfirmTransfer')?.addEventListener('click', executeTransfer);

  // Form: Create Match
  document.getElementById('formCreateMatch')?.addEventListener('submit', executeCreateMatch);

  // Form: Book Court
  document.getElementById('formConfirmBooking')?.addEventListener('submit', executeBookCourt);

  // Duo & Official Teams Modal Open
  document.getElementById('btnOpenOfficialTeams')?.addEventListener('click', openOfficialTeamsModal);

  // Tab switching in Duo Modal
  document.getElementById('tabDuoRanking')?.addEventListener('click', () => {
    document.getElementById('tabDuoRanking').classList.add('active');
    document.getElementById('tabDuoCreate').classList.remove('active');
    document.getElementById('duoRankingListContainer').style.display = 'block';
    document.getElementById('duoFormContainer').style.display = 'none';
  });

  document.getElementById('tabDuoCreate')?.addEventListener('click', () => {
    document.getElementById('tabDuoCreate').classList.add('active');
    document.getElementById('tabDuoRanking').classList.remove('active');
    document.getElementById('duoRankingListContainer').style.display = 'none';
    document.getElementById('duoFormContainer').style.display = 'block';
    renderCommunityPlayersDirectory();
    updateDuoProjection();
  });

  // Partner Search Query Input
  document.getElementById('partnerSearchQuery')?.addEventListener('input', (e) => {
    renderCommunityPlayersDirectory(e.target.value);
  });

  // Change Partner Button
  document.getElementById('btnChangePartner')?.addEventListener('click', () => {
    AppState.selectedPartnerForDuo = null;
    document.getElementById('selectedPartnerCard').style.display = 'none';
    document.getElementById('registeredPlayersDirectory').style.display = 'flex';
    document.getElementById('selectedPartnerId').value = '';
    renderCommunityPlayersDirectory();
    updateDuoProjection();
  });

  // Form Create Duo
  document.getElementById('formCreateDuo')?.addEventListener('submit', executeCreateDuo);

  // Admin Login Form
  document.getElementById('loginFormAdmin')?.addEventListener('submit', (e) => {
    e.preventDefault();
    showToast("Connexion réussie à HayaPala Club Pro !", "success");
    switchViewMode('backoffice-dashboard');
  });

  // Toggle Password Visibility on Login
  const togglePass = document.getElementById('togglePassword');
  if (togglePass) {
    togglePass.addEventListener('click', () => {
      const pass = document.getElementById('adminPassword');
      const icon = togglePass.querySelector('span');
      if (pass.type === 'password') {
        pass.type = 'text';
        icon.textContent = '🙈';
      } else {
        pass.type = 'password';
        icon.textContent = '👁️';
      }
    });
  }

  // Club selector dropdown in Back-Office
  document.getElementById('adminClubSelect')?.addEventListener('change', (e) => {
    AppState.currentAdminClubId = e.target.value;
    renderAdminAllViews();
  });

  // Admin Sub-Navigation Tabs (Planning, Courts, Tournois, Membres, Finances, Settings)
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.adminTab;
      switchAdminTab(tab);
    });
  });

  // Admin Direct Booking Button
  document.getElementById('btnAdminDirectBooking')?.addEventListener('click', openAdminDirectBookingModal);
  document.getElementById('formAdminDirectBooking')?.addEventListener('submit', executeAdminDirectBooking);

  // Admin Add Court Button
  document.getElementById('btnAdminAddCourt')?.addEventListener('click', () => openModal('modal-admin-add-court'));
  document.getElementById('formAdminAddCourt')?.addEventListener('submit', executeAdminAddCourt);

  // Admin Create Tournament Button
  document.getElementById('btnAdminCreateTournament')?.addEventListener('click', () => openModal('modal-admin-create-tournament'));
  document.getElementById('formAdminCreateTournament')?.addEventListener('submit', executeAdminCreateTournament);

  // Admin Player Search Input
  document.getElementById('adminPlayerSearchInput')?.addEventListener('input', (e) => {
    renderAdminPlayers(e.target.value);
  });

  // Admin Adjust Points Form
  document.getElementById('formAdminAdjustPoints')?.addEventListener('submit', executeAdminAdjustPoints);

  // Admin Manage Booking Modal Buttons
  document.getElementById('btnAdminConfirmBooking')?.addEventListener('click', executeAdminConfirmBooking);
  document.getElementById('btnAdminDeleteBooking')?.addEventListener('click', executeAdminDeleteBooking);

  // Admin Create Club Button
  document.getElementById('btnAdminOpenCreateClub')?.addEventListener('click', () => openModal('modal-admin-create-club'));
  document.getElementById('formAdminCreateClub')?.addEventListener('submit', executeAdminCreateClub);

  // Admin Register Member Button
  document.getElementById('btnAdminOpenRegisterPlayer')?.addEventListener('click', () => openModal('modal-admin-create-player'));
  document.getElementById('formAdminCreatePlayer')?.addEventListener('submit', executeAdminCreatePlayer);

  // Admin Club Settings Form
  document.getElementById('adminClubSettingsForm')?.addEventListener('submit', executeAdminSaveSettings);
}

// Switch between Player App, Back-Office Dashboard, and Back-Office Login
function switchViewMode(mode) {
  // Normalize mode name
  if (mode === 'mobile-app') mode = 'player-app';
  AppState.activeViewMode = mode;

  document.querySelectorAll('.view-tab-btn').forEach(btn => {
    const btnMode = btn.dataset.mode === 'mobile-app' ? 'player-app' : btn.dataset.mode;
    btn.classList.toggle('active', btnMode === mode);
  });

  const playerContainer = document.getElementById('playerAppContainer') || document.getElementById('mobileAppContainer');
  const backofficeDashboard = document.getElementById('backofficeDashboard');
  const backofficeLogin = document.getElementById('backofficeLogin');

  if (mode === 'player-app') {
    if (playerContainer) playerContainer.style.display = 'flex';
    if (backofficeDashboard) backofficeDashboard.style.display = 'none';
    if (backofficeLogin) backofficeLogin.style.display = 'none';
    window.location.hash = '#app';
  } else if (mode === 'backoffice-dashboard') {
    if (playerContainer) playerContainer.style.display = 'none';
    if (backofficeDashboard) backofficeDashboard.style.display = 'flex';
    if (backofficeLogin) backofficeLogin.style.display = 'none';
    window.location.hash = '#admin';
    renderAdminAllViews();
  } else if (mode === 'backoffice-login') {
    if (playerContainer) playerContainer.style.display = 'none';
    if (backofficeDashboard) backofficeDashboard.style.display = 'none';
    if (backofficeLogin) backofficeLogin.style.display = 'flex';
    window.location.hash = '#login';
  }
}

// Switch Admin Subnav Tab
function switchAdminTab(tabName) {
  AppState.activeAdminTab = tabName;
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.adminTab === tabName);
  });

  const tabContentMap = {
    'planning': 'adminContentPlanning',
    'courts': 'adminContentCourts',
    'tournaments': 'adminContentTournaments',
    'players': 'adminContentPlayers',
    'matches': 'adminContentMatches',
    'finances': 'adminContentFinances',
    'settings': 'adminContentSettings'
  };

  document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
  const target = document.getElementById(tabContentMap[tabName]);
  if (target) target.classList.add('active');

  // Trigger content-specific fetch/render
  if (tabName === 'planning') renderAdminSchedule(AppState.currentAdminClubId);
  if (tabName === 'courts') renderAdminCourts(AppState.currentAdminClubId);
  if (tabName === 'tournaments') renderAdminTournaments();
  if (tabName === 'players') renderAdminPlayers();
  if (tabName === 'matches') renderAdminMatches();
  if (tabName === 'finances') renderAdminFinances();
  if (tabName === 'settings') renderAdminSettings(AppState.currentAdminClubId);
}

// Navigate Mobile / Player App Screen
function navigateToScreen(screenId) {
  AppState.activeScreen = screenId;
  document.querySelectorAll('.app-screen').forEach(scr => scr.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-item-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.screen === screenId);
  });

  if (screenId === 'screen-join-match') renderMatchesFeed();
  if (screenId === 'screen-book-court') renderClubsList();
  if (screenId === 'screen-profile') renderProfileData();
}

// Render All Views
function renderAllViews() {
  updateHeaderPoints();
  renderMatchesFeed();
  renderClubsList();
  renderProfileData();
  renderAdminAllViews();
}

// Render all Admin Sub-Views
function renderAdminAllViews() {
  const clubSelect = document.getElementById('adminClubSelect');
  const clubs = AppState.clubs || [];

  if (clubSelect) {
    if (clubs.length === 0) {
      clubSelect.innerHTML = `<option value="">-- Aucun Club Configuré --</option>`;
      AppState.currentAdminClubId = null;
    } else {
      if (!AppState.currentAdminClubId || !clubs.some(c => c.id === AppState.currentAdminClubId)) {
        AppState.currentAdminClubId = clubs[0].id;
      }
      clubSelect.innerHTML = clubs.map(c => `
        <option value="${c.id}" ${c.id === AppState.currentAdminClubId ? 'selected' : ''}>${c.name} (${c.address})</option>
      `).join('');
    }
  }

  const clubId = AppState.currentAdminClubId;
  fetchAndRenderAdminStats(clubId);
  renderAdminSchedule(clubId);
  renderAdminCourts(clubId);
  renderAdminTournaments();
  renderAdminPlayers();
  renderAdminMatches();
  renderAdminFinances();
  if (clubId) renderAdminSettings(clubId);
}

// Execute Admin Create Club
async function executeAdminCreateClub(e) {
  e.preventDefault();
  const name = document.getElementById('adminNewClubName').value;
  const address = document.getElementById('adminNewClubAddress').value;
  const phone = document.getElementById('adminNewClubPhone').value;
  const pricePoints = Number(document.getElementById('adminNewClubPrice').value) || 25;

  try {
    const res = await fetch('/api/admin/clubs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, address, phone, pricePoints })
    });
    const result = await res.json();
    if (result.success) {
      closeAllModals();
      showToast(result.message, "success");
      document.getElementById('formAdminCreateClub').reset();
      await loadStateFromServer();
      AppState.currentAdminClubId = result.club.id;
      renderAllViews();
    } else {
      showToast(result.message, "error");
    }
  } catch (err) {
    showToast("Erreur lors de la création du club.", "error");
  }
}

// Execute Admin Register Player
async function executeAdminCreatePlayer(e) {
  e.preventDefault();
  const name = document.getElementById('adminNewPlayerName').value;
  const phone = document.getElementById('adminNewPlayerPhone').value;
  const city = document.getElementById('adminNewPlayerCity').value;
  const level = Number(document.getElementById('adminNewPlayerLevel').value) || 5.00;
  const points = Number(document.getElementById('adminNewPlayerPoints').value) || 0;

  try {
    const res = await fetch('/api/admin/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, city, level, points })
    });
    const result = await res.json();
    if (result.success) {
      closeAllModals();
      showToast(result.message, "success");
      document.getElementById('formAdminCreatePlayer').reset();
      await loadStateFromServer();
      renderAdminPlayers();
      fetchAndRenderAdminStats(AppState.currentAdminClubId);
    } else {
      showToast(result.message, "error");
    }
  } catch (err) {
    showToast("Erreur lors de l'inscription du joueur.", "error");
  }
}

// --------------------------------------------------------------------------
// PLAYER APP: MATCHES FEED (Screen 2)
// --------------------------------------------------------------------------
function renderMatchesFeed() {
  const container = document.getElementById('matchesListContainer');
  if (!container) return;

  container.innerHTML = '';
  let list = AppState.matches || [];

  if (AppState.activeMatchTab === 'tab-my') {
    list = list.filter(m => 
      (m.team1 && m.team1.some(p => p && p.name === AppState.user?.name)) ||
      (m.team2 && m.team2.some(p => p && p.name === AppState.user?.name))
    );
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 16px; color: var(--text-secondary);">
        <p style="font-size: 32px; margin-bottom: 8px;">🎾</p>
        <p style="font-weight: 700; color: var(--text-white);">Aucun match dans cette section.</p>
        <p style="font-size: 12px; margin-top: 4px;">Cliquez sur <strong>+ Lancer un match</strong> pour créer une partie !</p>
      </div>
    `;
    return;
  }

  list.forEach(match => {
    const card = document.createElement('div');
    card.className = 'match-open-card';

    // Team 1 Slots
    let team1Html = (match.team1 || [null, null]).map((p, idx) => {
      if (p) {
        return `
          <div class="player-slot-card">
            <div class="slot-avatar">${p.avatar || '👤'}</div>
            <div class="slot-name">${p.name}</div>
            <div class="slot-level">⭐ ${Number(p.level).toFixed(2)}</div>
          </div>
        `;
      } else {
        return `
          <div class="player-slot-card empty-slot" onclick="handleJoinSlot('${match.id}', 1, ${idx + 1})">
            <div class="slot-avatar empty-avatar">+</div>
            <div class="slot-name" style="color: var(--hayapala-volt); font-weight: 700;">Rejoindre</div>
            <div class="slot-level">Libre</div>
          </div>
        `;
      }
    }).join('');

    // Team 2 Slots
    let team2Html = (match.team2 || [null, null]).map((p, idx) => {
      if (p) {
        return `
          <div class="player-slot-card">
            <div class="slot-avatar">${p.avatar || '👤'}</div>
            <div class="slot-name">${p.name}</div>
            <div class="slot-level">⭐ ${Number(p.level).toFixed(2)}</div>
          </div>
        `;
      } else {
        return `
          <div class="player-slot-card empty-slot" onclick="handleJoinSlot('${match.id}', 2, ${idx + 1})">
            <div class="slot-avatar empty-avatar">+</div>
            <div class="slot-name" style="color: var(--hayapala-volt); font-weight: 700;">Rejoindre</div>
            <div class="slot-level">Libre</div>
          </div>
        `;
      }
    }).join('');

    card.innerHTML = `
      <div class="match-card-top">
        <div class="club-name-row">
          <span>🎾</span>
          <span>${match.clubName}</span>
        </div>
        <div class="match-time-distance">${match.distance || '2.5 km'}</div>
      </div>
      <div class="match-date-row">${match.date} • ${match.time} • Niveau ${match.levelRange}</div>

      <div class="matchup-2v2-grid">
        <div class="team-box-wrap">${team1Html}</div>
        <div class="vs-badge-icon">VS</div>
        <div class="team-box-wrap">${team2Html}</div>
      </div>

      <div class="match-card-footer">
        <div class="match-info-meta">
          <span class="match-public-tag">${match.type}</span>
          <span class="court-reserved-tag">Court réservé au club</span>
        </div>
        <div class="match-points-cost-badge">
          <span>⚡</span> ${match.pointsCost} Points / joueur
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

// Join slot in match
window.handleJoinSlot = async function(matchId, team, position) {
  try {
    const res = await fetch('/api/matches/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, team, position })
    });
    const result = await res.json();
    if (result.success) {
      showToast(result.message, "success");
      await loadStateFromServer();
      renderAllViews();
    } else {
      showToast(result.message, "error");
      if (result.message.includes('Points insuffisants')) {
        openModal('modal-recharge-points');
      }
    }
  } catch (err) {
    showToast("Erreur lors de la tentative pour rejoindre le match.", "error");
  }
};

// --------------------------------------------------------------------------
// PLAYER APP: CLUBS DIRECTORY & COURT BOOKING (Screen 3)
// --------------------------------------------------------------------------
function renderClubsList(searchQuery = '') {
  const container = document.getElementById('clubsListContainer');
  if (!container) return;

  container.innerHTML = '';
  const q = searchQuery.toLowerCase().trim();
  let list = AppState.clubs || [];

  if (q) {
    list = list.filter(c => 
      c.name.toLowerCase().includes(q) || 
      c.address.toLowerCase().includes(q) ||
      (c.sport && c.sport.toLowerCase().includes(q))
    );
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 48px 16px; color: var(--text-secondary);">
        <p style="font-size: 38px; margin-bottom: 10px;">🎾</p>
        <p style="font-weight: 800; color: var(--text-white); font-size: 16px;">Aucun club de padel disponible pour le moment.</p>
        <p style="font-size: 13px; margin: 8px auto 20px; max-width: 320px;">
          Vous pouvez créer votre club, configurer vos terrains et ouvrir des créneaux dans l'espace Club Pro !
        </p>
        <button class="btn-new-admin-booking" onclick="switchViewMode('backoffice-dashboard')" style="margin: 0 auto;">
          <span>⚡</span> Créer un Club dans l'Espace Club Pro
        </button>
      </div>
    `;
    return;
  }

  list.forEach(club => {
    const card = document.createElement('div');
    card.className = 'club-card';

    const courtsBadges = (club.courts || []).map(crt => `
      <span class="court-pill-badge">${crt.name} (${crt.type})</span>
    `).join('');

    card.innerHTML = `
      <div class="club-card-top">
        <div class="club-logo-box" style="background: ${club.logoColor || '#111'}; color: ${club.logoTextColor || '#FFF'};">
          ${club.logoBadge || 'PADEL'}
        </div>
        <div class="club-info-col">
          <div class="club-name-title">${club.name}</div>
          <div class="club-address-text">📍 ${club.address} • <strong style="color: var(--hayapala-cyan);">${club.distance || '2.0 km'}</strong></div>
          <div class="club-schedule-text">🕒 ${club.schedule || 'Ouvert 7j/7'}</div>
        </div>
      </div>

      <div class="club-courts-pills-row">${courtsBadges}</div>

      <div class="club-card-footer">
        <div class="club-price-tag">
          <span style="font-size: 11px; color: var(--text-secondary);">Tarif créneau 90 min</span>
          <div style="font-size: 16px; font-weight: 900; color: var(--hayapala-volt);">
            ${club.pricePoints} DT / joueur <span style="font-size: 11px; opacity:0.8;">(${club.pricePoints * 4} DT complet)</span>
          </div>
        </div>
        <button class="btn-book-court-action" onclick="openBookingModalForClub('${club.id}')">
          Réserver une piste &gt;
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

// Open Booking Modal for Club
window.openBookingModalForClub = function(clubId) {
  const club = (AppState.clubs || []).find(c => c.id === clubId) || AppState.clubs[0];
  if (!club) return;

  AppState.selectedClubForBooking = club;
  document.getElementById('modalBookClubName').textContent = club.name;
  document.getElementById('modalBookClubAddress').textContent = club.address;
  document.getElementById('modalBookPointsRate').textContent = `${club.pricePoints} Points (DT) / joueur`;

  const courtSelect = document.getElementById('bookCourtSelect');
  if (courtSelect) {
    courtSelect.innerHTML = (club.courts || []).map(crt => `
      <option value="${crt.id}">${crt.name} (${crt.type} - ${crt.surface})</option>
    `).join('');
  }

  // Set default pricing text
  const shareEl = document.getElementById('bookingShareDue');
  if (shareEl) shareEl.textContent = `${club.pricePoints}.0 Points (${club.pricePoints} DT)`;

  openModal('modal-book-court');
};

// --------------------------------------------------------------------------
// PLAYER APP: MON PROFIL (Screen 4)
// --------------------------------------------------------------------------
function renderProfileData() {
  if (!AppState.user) return;
  const u = AppState.user;

  const lvl = document.getElementById('profileLevelNumber');
  if (lvl) lvl.textContent = Number(u.level).toFixed(2);

  const rel = document.getElementById('profileReliabilityNumber');
  if (rel) rel.textContent = `${Number(u.levelReliability).toFixed(1)}%`;

  const matches = document.getElementById('profileMatchesCount');
  if (matches) matches.textContent = `${u.matchesPlayed} Matches officiels`;

  // Render match history
  const container = document.getElementById('profileHistoryContainer');
  if (!container) return;

  container.innerHTML = '';
  const history = AppState.userMatchHistory || [];

  if (history.length === 0) {
    container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-secondary); font-size: 12px;">Aucun match récent enregistré.</div>`;
    return;
  }

  history.forEach(item => {
    const card = document.createElement('div');
    card.className = 'history-item-card';

    const isWin = item.result === 'G';
    const badgeClass = isWin ? 'win-badge' : 'loss-badge';
    const badgeText = isWin ? 'Gagné' : 'Perdu';

    card.innerHTML = `
      <div class="history-item-left">
        <div class="history-result-badge ${badgeClass}">${badgeText}</div>
        <div>
          <div class="history-match-title">${item.clubName} • Niveau ${item.level}</div>
          <div class="history-score-text">${item.team2} (${item.team2Score}) vs ${item.team1} (${item.team1Score})</div>
        </div>
      </div>
      <div class="history-date">${item.date}</div>
    `;

    container.appendChild(card);
  });
}

// --------------------------------------------------------------------------
// ADMIN BACK-OFFICE: DASHBOARD & MANAGEMENT MODULES
// --------------------------------------------------------------------------

// Fetch & Render Admin KPI Stats
async function fetchAndRenderAdminStats(clubId) {
  try {
    const res = await fetch(`/api/admin/stats?clubId=${clubId}`);
    if (res.ok) {
      const data = await res.json();
      const stats = data.stats;
      
      const elBkg = document.getElementById('kpiBookingsValue');
      if (elBkg) elBkg.textContent = `${stats.totalBookings} Créneaux`;

      const elOcc = document.getElementById('kpiOccupancyValue');
      if (elOcc) elOcc.textContent = `${stats.occupancyRate}%`;

      const elHrs = document.getElementById('kpiHoursValue');
      if (elHrs) elHrs.textContent = `${stats.totalHours.toFixed(1)} Heures`;

      const elRev = document.getElementById('kpiRevenueValue');
      if (elRev) elRev.textContent = `${stats.totalRevenueDT} DT`;

      const elPlr = document.getElementById('kpiPlayersValue');
      if (elPlr) elPlr.textContent = `${stats.playersCount} Joueurs`;

      const elTrn = document.getElementById('kpiTournamentsValue');
      if (elTrn) elTrn.textContent = `${stats.activeTournaments} Ouverts`;
    }
  } catch (e) {
    console.warn("Could not fetch admin stats", e);
  }
}

// Render Admin Timetable Schedule (Tab 1)
function renderAdminSchedule(clubId) {
  const theadRow = document.getElementById('adminTimetableHeadRow');
  const tbody = document.getElementById('adminTimetableBody');
  if (!theadRow || !tbody) return;

  const club = (AppState.clubs || []).find(c => c.id === clubId) || AppState.clubs[0];
  if (!club || (AppState.clubs || []).length === 0) {
    theadRow.innerHTML = `<th>Statut</th><th>Gestion</th>`;
    tbody.innerHTML = `
      <tr>
        <td colspan="2" style="text-align: center; padding: 48px 16px; color: var(--text-secondary);">
          <p style="font-size: 38px; margin-bottom: 12px;">🎾</p>
          <p style="font-weight: 800; color: var(--text-white); font-size: 16px;">Aucun club créé pour le moment.</p>
          <p style="font-size: 13px; margin: 8px auto 20px; max-width: 360px;">
            Cliquez sur le bouton ci-dessous pour créer votre premier club et configurer vos terrains !
          </p>
          <button class="btn-new-admin-booking" onclick="openModal('modal-admin-create-club')" style="margin: 0 auto;">
            <span>+</span> Créer mon Premier Club
          </button>
        </td>
      </tr>
    `;
    return;
  }

  if ((club.courts || []).length === 0) {
    theadRow.innerHTML = `<th>Club</th><th>Terrains</th>`;
    tbody.innerHTML = `
      <tr>
        <td colspan="2" style="text-align: center; padding: 40px 16px; color: var(--text-secondary);">
          <p style="font-size: 32px; margin-bottom: 8px;">🎾</p>
          <p style="font-weight: 800; color: var(--text-white); font-size: 15px;">Le club "${club.name}" n'a pas encore de terrain.</p>
          <p style="font-size: 12px; margin: 6px auto 16px;">Ajoutez au moins une piste de padel pour afficher la matrice du planning horaire.</p>
          <button class="btn-new-admin-booking" onclick="openModal('modal-admin-add-court')" style="margin: 0 auto;">
            <span>+</span> Ajouter un Terrain à ce Club
          </button>
        </td>
      </tr>
    `;
    return;
  }

  // Header row
  let theadHtml = `<th>Heures</th>`;
  (club.courts || []).forEach(court => {
    theadHtml += `<th>${court.name}<br /><span style="font-size: 10px; font-weight: 500; opacity: 0.8;">${court.type} • ${court.surface}</span></th>`;
  });
  theadRow.innerHTML = theadHtml;

  // Timetable slots
  const slots = [
    "08:30 - 10:00",
    "10:00 - 11:30",
    "11:30 - 13:00",
    "14:00 - 15:30",
    "15:30 - 17:00",
    "17:00 - 18:30",
    "18:30 - 20:00",
    "20:00 - 21:30",
    "21:30 - 23:00"
  ];

  tbody.innerHTML = '';

  slots.forEach(time => {
    let trHtml = `<tr><td class="time-col">${time}</td>`;

    (club.courts || []).forEach(court => {
      const booking = (AppState.clubBookings || []).find(b => 
        b.clubId === club.id &&
        b.courtId === court.id &&
        b.time === time
      );

      if (booking) {
        const slotsPaid = booking.slotsPaid || (booking.status === 'confirmed' ? 4 : 1);
        const slotsTotal = booking.slotsTotal || 4;
        const isConfirmed = slotsPaid >= slotsTotal || booking.status === 'confirmed';
        const collectedDT = slotsPaid * (booking.pricePerPlayer || 25);
        const progressPct = Math.round((slotsPaid / slotsTotal) * 100);

        trHtml += `
          <td class="slot-cell" onclick="openManageBookingModal('${booking.id}')">
            <div class="booking-badge-block ${isConfirmed ? 'confirmed' : 'open-match'}">
              <div style="flex: 1; min-width: 0;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap: 4px;">
                  <strong style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${booking.clientName}</strong>
                  <span class="slot-counter-pill ${isConfirmed ? 'pill-confirmed' : 'pill-open'}">${slotsPaid}/${slotsTotal}</span>
                </div>
                <div style="font-size: 10px; opacity: 0.9; margin-top: 2px;">
                  ${booking.type} • <strong>${collectedDT} DT</strong>
                </div>
                <div class="booking-progress-mini">
                  <div class="booking-progress-fill ${isConfirmed ? 'fill-confirmed' : ''}" style="width: ${progressPct}%"></div>
                </div>
              </div>
            </div>
          </td>
        `;
      } else {
        trHtml += `
          <td class="slot-cell" onclick="handleAdminSlotClick('${club.id}', '${court.id}', '${time}')">
            <span style="color: #64748B; font-size: 11px;">+ Libre</span>
          </td>
        `;
      }
    });

    trHtml += `</tr>`;
    tbody.innerHTML += trHtml;
  });
}

// Click on empty slot in Admin -> opens direct booking modal
window.handleAdminSlotClick = function(clubId, courtId, time) {
  openAdminDirectBookingModal(courtId, time);
};

// Open Admin Direct Booking Modal
function openAdminDirectBookingModal(preselectedCourtId = null, preselectedTime = null) {
  const clubId = AppState.currentAdminClubId || 'club_connection';
  const club = (AppState.clubs || []).find(c => c.id === clubId) || AppState.clubs[0];

  const courtSelect = document.getElementById('adminDirectCourtSelect');
  if (courtSelect && club) {
    courtSelect.innerHTML = (club.courts || []).map(crt => `
      <option value="${crt.id}" ${crt.id === preselectedCourtId ? 'selected' : ''}>${crt.name} (${crt.type})</option>
    `).join('');
  }

  const timeSelect = document.getElementById('adminDirectTimeSelect');
  if (timeSelect && preselectedTime) {
    timeSelect.value = preselectedTime;
  }

  openModal('modal-admin-direct-booking');
}

// Execute Admin Direct Booking
async function executeAdminDirectBooking(e) {
  e.preventDefault();
  const clubId = AppState.currentAdminClubId || 'club_connection';
  const courtId = document.getElementById('adminDirectCourtSelect').value;
  const time = document.getElementById('adminDirectTimeSelect').value;
  const clientName = document.getElementById('adminDirectClientName').value;
  const phone = document.getElementById('adminDirectClientPhone').value;
  const type = document.getElementById('adminDirectTypeSelect').value;
  const paymentMethod = document.getElementById('adminDirectPaySelect').value;

  try {
    const res = await fetch('/api/admin/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clubId,
        courtId,
        time,
        clientName,
        phone,
        type,
        paymentMethod
      })
    });
    const result = await res.json();
    if (result.success) {
      closeAllModals();
      showToast(result.message, "success");
      await loadStateFromServer();
      renderAdminAllViews();
    } else {
      showToast(result.message, "error");
    }
  } catch (err) {
    showToast("Erreur lors de l'enregistrement de la réservation.", "error");
  }
}

// Open Manage Booking Modal
window.openManageBookingModal = function(bookingId) {
  const booking = (AppState.clubBookings || []).find(b => b.id === bookingId);
  if (!booking) return;

  document.getElementById('manageBookingId').value = booking.id;
  document.getElementById('manageBookingCourtName').textContent = booking.courtName;
  document.getElementById('manageBookingTimeSlot').textContent = `${booking.date || "Aujourd'hui"} • ${booking.time}`;
  document.getElementById('manageBookingClient').textContent = booking.clientName;
  document.getElementById('manageBookingPhone').textContent = booking.phone || "-";
  document.getElementById('manageBookingType').textContent = booking.type;
  document.getElementById('manageBookingPaid').textContent = `${booking.slotsPaid || 1} / ${booking.slotsTotal || 4} parts réglées`;

  const statusPill = document.getElementById('manageBookingStatusPill');
  if (statusPill) {
    statusPill.textContent = booking.status === 'confirmed' ? 'Statut : Validé & Réglé' : 'Statut : Partie Ouverte';
  }

  openModal('modal-admin-manage-booking');
};

// Execute Admin Confirm Booking
async function executeAdminConfirmBooking() {
  const bookingId = document.getElementById('manageBookingId').value;
  try {
    const res = await fetch(`/api/admin/bookings/${bookingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'confirmed', slotsPaid: 4 })
    });
    const result = await res.json();
    if (result.success) {
      closeAllModals();
      showToast("Réservation marquée comme confirmée !", "success");
      await loadStateFromServer();
      renderAdminAllViews();
    }
  } catch (err) {
    showToast("Erreur lors de la mise à jour.", "error");
  }
}

// Execute Admin Delete Booking
async function executeAdminDeleteBooking() {
  const bookingId = document.getElementById('manageBookingId').value;
  if (!confirm("Voulez-vous vraiment annuler cette réservation et libérer le terrain ?")) return;

  try {
    const res = await fetch(`/api/admin/bookings/${bookingId}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      closeAllModals();
      showToast("Créneau libéré avec succès.", "info");
      await loadStateFromServer();
      renderAdminAllViews();
    }
  } catch (err) {
    showToast("Erreur lors de l'annulation.", "error");
  }
}

// --------------------------------------------------------------------------
// ADMIN: COURTS MANAGEMENT (Tab 2)
// --------------------------------------------------------------------------
async function renderAdminCourts(clubId) {
  const container = document.getElementById('adminCourtsListContainer');
  if (!container) return;

  if (!clubId || !AppState.clubs || AppState.clubs.length === 0) {
    container.innerHTML = `
      <div class="empty-state-notice" style="text-align: center; padding: 48px 20px; background: rgba(255, 255, 255, 0.02); border-radius: 20px; border: 1px dashed rgba(255, 255, 255, 0.1);">
        <div style="font-size: 38px; margin-bottom: 12px;">🏢</div>
        <div style="font-size: 17px; font-weight: 800; color: var(--text-white); margin-bottom: 8px;">Aucun Club Enregistré</div>
        <div style="font-size: 13px; color: var(--text-secondary); max-width: 420px; margin: 0 auto 20px auto; line-height: 1.5;">
          Pour pouvoir configurer et gérer vos terrains de padel, vous devez d'abord créer la fiche de votre club.
        </div>
        <button class="btn-primary-action" onclick="openModal('modal-admin-create-club')" style="max-width: 260px; margin: 0 auto;">
          + Créer mon Premier Club
        </button>
      </div>
    `;
    return;
  }

  try {
    const res = await fetch(`/api/admin/courts?clubId=${clubId}`);
    if (res.ok) {
      const data = await res.json();
      const courts = data.courts || [];
      container.innerHTML = '';

      if (courts.length === 0) {
        container.innerHTML = `
          <div class="empty-state-notice" style="text-align: center; padding: 48px 20px; background: rgba(255, 255, 255, 0.02); border-radius: 20px; border: 1px dashed rgba(255, 255, 255, 0.1); width: 100%;">
            <div style="font-size: 38px; margin-bottom: 12px;">🎾</div>
            <div style="font-size: 17px; font-weight: 800; color: var(--text-white); margin-bottom: 8px;">Aucun Terrain pour ce Club</div>
            <div style="font-size: 13px; color: var(--text-secondary); max-width: 420px; margin: 0 auto 20px auto; line-height: 1.5;">
              Ajoutez votre première piste de padel (Indoor ou Outdoor) pour activer le planning et les réservations.
            </div>
            <button class="btn-primary-action" onclick="openModal('modal-admin-add-court')" style="max-width: 260px; margin: 0 auto;">
              + Ajouter un Nouveau Terrain
            </button>
          </div>
        `;
        return;
      }

      courts.forEach(crt => {
        const card = document.createElement('div');
        card.className = 'court-admin-card';

        const isActive = crt.status === 'active';
        const statusClass = isActive ? 'status-active' : 'status-maintenance';
        const statusLabel = isActive ? '🟢 En service' : '🟡 Maintenance';

        card.innerHTML = `
          <div class="court-admin-top">
            <div>
              <div class="court-admin-name">${crt.name}</div>
              <div class="court-admin-badges">
                <span class="court-badge-pill ${statusClass}">${statusLabel}</span>
                <span class="court-badge-pill">${crt.type}</span>
                <span class="court-badge-pill surface">${crt.surface}</span>
              </div>
            </div>
            <div style="font-size: 16px; font-weight: 900; color: var(--hayapala-volt);">
              ${crt.price} DT
            </div>
          </div>

          <div class="court-admin-actions">
            <button class="btn-court-toggle" onclick="toggleCourtStatus('${crt.id}', '${crt.status}')">
              ${isActive ? 'Passer en Maintenance' : 'Remettre en Service'}
            </button>
            <button class="btn-court-delete" onclick="deleteCourt('${crt.id}')">
              Supprimer
            </button>
          </div>
        `;

        container.appendChild(card);
      });
    }
  } catch (e) {
    console.warn("Could not load admin courts", e);
  }
}

// Toggle court status
window.toggleCourtStatus = async function(courtId, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'maintenance' : 'active';
  try {
    const res = await fetch(`/api/admin/courts/${courtId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });
    const result = await res.json();
    if (result.success) {
      showToast(result.message, "success");
      await loadStateFromServer();
      renderAdminCourts(AppState.currentAdminClubId);
    }
  } catch (e) {
    showToast("Erreur lors de la modification de l'état du terrain.", "error");
  }
};

// Delete court
window.deleteCourt = async function(courtId) {
  if (!confirm("Supprimer définitivement ce terrain de la configuration du club ?")) return;
  try {
    const res = await fetch(`/api/admin/courts/${courtId}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      showToast(result.message, "info");
      await loadStateFromServer();
      renderAdminCourts(AppState.currentAdminClubId);
    }
  } catch (e) {
    showToast("Erreur lors de la suppression.", "error");
  }
};

// Execute Admin Add Court
async function executeAdminAddCourt(e) {
  e.preventDefault();
  
  if (!AppState.clubs || AppState.clubs.length === 0) {
    closeAllModals();
    showToast("Veuillez d'abord créer un club de padel !", "warning");
    openModal('modal-admin-create-club');
    return;
  }

  const name = document.getElementById('adminAddCourtName').value;
  const type = document.getElementById('adminAddCourtType').value;
  const surface = document.getElementById('adminAddCourtSurface').value;
  const price = document.getElementById('adminAddCourtPrice').value;
  const clubId = AppState.currentAdminClubId || AppState.clubs[0].id;

  try {
    const res = await fetch('/api/admin/courts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, surface, price, clubId })
    });
    const result = await res.json();
    if (result.success) {
      closeAllModals();
      showToast(result.message, "success");
      document.getElementById('formAdminAddCourt').reset();
      await loadStateFromServer();
      renderAdminCourts(clubId);
      renderAdminSchedule(clubId);
    }
  } catch (err) {
    showToast("Erreur lors de l'ajout du court.", "error");
  }
}

// --------------------------------------------------------------------------
// ADMIN: TOURNAMENTS MANAGEMENT (Tab 3)
// --------------------------------------------------------------------------
async function renderAdminTournaments() {
  const container = document.getElementById('adminTournamentsListContainer');
  if (!container) return;

  try {
    const res = await fetch('/api/admin/tournaments');
    if (res.ok) {
      const data = await res.json();
      const tournaments = data.tournaments || [];
      container.innerHTML = '';

      tournaments.forEach(trn => {
        const card = document.createElement('div');
        card.className = 'tournament-admin-card';

        const participantsCount = (trn.participants || []).length;

        card.innerHTML = `
          <div>
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
              <span class="brand-tag">${trn.format}</span>
              <span class="court-badge-pill status-active">${trn.status === 'open' ? 'Inscriptions Ouvertes' : 'En cours'}</span>
            </div>
            <div style="font-size: 18px; font-weight: 900; color: var(--text-white); margin: 8px 0 4px;">${trn.title}</div>
            <div style="font-size: 12px; color: var(--text-secondary);">📅 ${trn.date} • 📍 ${trn.clubName}</div>
            <div style="display:flex; gap: 14px; margin-top: 12px; font-size: 13px;">
              <div>Inscription : <strong style="color: var(--hayapala-volt);">${trn.entryFee} DT</strong></div>
              <div>Dotation : <strong style="color: #34D399;">${trn.prizePool} DT</strong></div>
              <div>Équipes : <strong>${participantsCount} / ${trn.maxTeams}</strong></div>
            </div>
          </div>

          <div style="display:flex; gap: 8px; border-top: 1px solid var(--border-subtle); padding-top: 12px;">
            <button class="btn-court-toggle" onclick="showToast('Inscriptions clôturées pour ce tournoi.', 'info')">
              Clôturer les Inscriptions
            </button>
          </div>
        `;

        container.appendChild(card);
      });
    }
  } catch (e) {
    console.warn("Could not load admin tournaments", e);
  }
}

// Execute Admin Create Tournament
async function executeAdminCreateTournament(e) {
  e.preventDefault();
  const title = document.getElementById('adminTournTitle').value;
  const format = document.getElementById('adminTournFormat').value;
  const date = document.getElementById('adminTournDate').value;
  const maxTeams = document.getElementById('adminTournMaxTeams').value;
  const entryFee = document.getElementById('adminTournFee').value;
  const prizePool = document.getElementById('adminTournPrize').value;
  const clubId = AppState.currentAdminClubId || 'club_connection';

  try {
    const res = await fetch('/api/admin/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, format, date, maxTeams, entryFee, prizePool, clubId })
    });
    const result = await res.json();
    if (result.success) {
      closeAllModals();
      showToast(result.message, "success");
      document.getElementById('formAdminCreateTournament').reset();
      await loadStateFromServer();
      renderAdminTournaments();
    }
  } catch (err) {
    showToast("Erreur lors de la création du tournoi.", "error");
  }
}

// --------------------------------------------------------------------------
// ADMIN: MEMBERS & WALLET CREDITING (Tab 4)
// --------------------------------------------------------------------------
async function renderAdminPlayers(searchQuery = '') {
  const tbody = document.getElementById('adminPlayersTableBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/players');
    if (res.ok) {
      const data = await res.json();
      let players = data.players || [];
      const q = searchQuery.toLowerCase().trim();

      if (q) {
        players = players.filter(p => 
          p.name.toLowerCase().includes(q) || 
          (p.city && p.city.toLowerCase().includes(q)) ||
          (p.phone && p.phone.includes(q))
        );
      }

      tbody.innerHTML = '';
      players.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>
            <div style="display:flex; align-items:center; gap: 8px;">
              <span style="font-size: 20px;">${p.avatar || '👨'}</span>
              <div>
                <strong>${p.name}</strong>
                <div style="font-size: 11px; color: var(--text-secondary);">${p.club || 'Padel'} • ${p.city || 'Tunis'}</div>
              </div>
            </div>
          </td>
          <td>${p.phone || '+216 -- --- ---'}</td>
          <td><strong style="color: var(--hayapala-volt);">⭐ ${Number(p.level).toFixed(2)}</strong></td>
          <td>${Number(p.reliability || 50).toFixed(0)}%</td>
          <td>${p.matches || 0}</td>
          <td><strong style="color: var(--hayapala-cyan);">${Number(p.points || 0).toFixed(2)} pts</strong></td>
          <td>
            <button class="btn-admin-table-action" onclick="openAdjustPointsModal('${p.id}', '${p.name}')">⚡ Créditer Solde</button>
            <button class="btn-admin-table-action" style="border-color: var(--hayapala-cyan); color: var(--hayapala-cyan);" onclick="promptAdjustLevel('${p.id}', ${p.level})">⭐ ELO</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (e) {
    console.warn("Could not load admin players", e);
  }
}

// Open Adjust Points Modal
window.openAdjustPointsModal = function(playerId, playerName) {
  document.getElementById('adminAdjustPlayerId').value = playerId;
  document.getElementById('adminAdjustPlayerName').textContent = playerName;
  openModal('modal-admin-adjust-points');
};

// Execute Adjust Points
async function executeAdminAdjustPoints(e) {
  e.preventDefault();
  const playerId = document.getElementById('adminAdjustPlayerId').value;
  const amount = Number(document.getElementById('adminAdjustAmount').value);
  const reason = document.getElementById('adminAdjustReason').value;

  try {
    const res = await fetch('/api/admin/players/adjust-points', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, amount, reason })
    });
    const result = await res.json();
    if (result.success) {
      closeAllModals();
      showToast(result.message, "success");
      await loadStateFromServer();
      renderAdminPlayers();
      fetchAndRenderAdminStats(AppState.currentAdminClubId);
    } else {
      showToast(result.message, "error");
    }
  } catch (err) {
    showToast("Erreur lors de l'ajustement de solde.", "error");
  }
}

// Prompt Adjust Level ELO
window.promptAdjustLevel = async function(playerId, currentLevel) {
  const newLevelStr = prompt(`Modifier le niveau certifié officiel (Actuel: ${currentLevel}) :`, currentLevel);
  if (!newLevelStr) return;
  const level = Number(newLevelStr);
  if (isNaN(level) || level < 1 || level > 8) {
    alert("Le niveau doit être compris entre 1.00 et 8.00.");
    return;
  }

  try {
    const res = await fetch('/api/admin/players/adjust-level', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, level })
    });
    const result = await res.json();
    if (result.success) {
      showToast(result.message, "success");
      await loadStateFromServer();
      renderAdminPlayers();
      renderProfileData();
    }
  } catch (e) {
    showToast("Erreur lors de la mise à jour du niveau.", "error");
  }
};

// --------------------------------------------------------------------------
// ADMIN: MATCHES SUPERVISION (Tab 5)
// --------------------------------------------------------------------------
function renderAdminMatches() {
  const container = document.getElementById('adminMatchesListContainer');
  if (!container) return;

  container.innerHTML = '';
  const matches = AppState.matches || [];

  if (matches.length === 0) {
    container.innerHTML = `<div style="color: var(--text-secondary); padding: 20px;">Aucune partie ouverte active.</div>`;
    return;
  }

  matches.forEach(m => {
    const card = document.createElement('div');
    card.className = 'match-admin-card';

    const pCount = (m.team1 || []).filter(Boolean).length + (m.team2 || []).filter(Boolean).length;

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="brand-tag">${m.clubName}</span>
        <span class="court-badge-pill status-active">${pCount} / 4 Joueurs</span>
      </div>
      <div style="font-size: 15px; font-weight: 800; color: var(--text-white);">${m.date} • ${m.time}</div>
      <div style="font-size: 12px; color: var(--text-secondary);">Niveau requis : <strong>${m.levelRange}</strong> • Coût part : <strong>${m.pointsCost} DT</strong></div>
      <div style="display:flex; gap: 8px; border-top: 1px solid var(--border-subtle); padding-top: 10px;">
        <button class="btn-court-toggle" onclick="showToast('Partie validée et clôturée par l\\'arbitre.', 'success')">Valider Score</button>
        <button class="btn-court-delete" onclick="showToast('Partie annulée.', 'info')">Annuler Match</button>
      </div>
    `;

    container.appendChild(card);
  });
}

// --------------------------------------------------------------------------
// ADMIN: FINANCES & AUDIT TRAIL (Tab 6)
// --------------------------------------------------------------------------
async function renderAdminFinances() {
  const tbody = document.getElementById('adminTransactionsTableBody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/admin/transactions');
    if (res.ok) {
      const data = await res.json();
      const txs = data.transactions || [];
      tbody.innerHTML = '';

      if (txs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-secondary);">Aucune transaction pour le moment.</td></tr>`;
        return;
      }

      txs.forEach(tx => {
        const tr = document.createElement('tr');
        const isCredit = tx.type.includes('recharge') || tx.type.includes('credit');
        const color = isCredit ? '#10B981' : '#F59E0B';

        tr.innerHTML = `
          <td>${new Date(tx.createdAt || Date.now()).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
          <td><strong>${tx.userName || 'Client'}</strong></td>
          <td><span class="court-badge-pill">${tx.type}</span></td>
          <td><strong style="color: ${color};">${tx.amount} DT</strong></td>
          <td>${tx.paymentMethod || 'Mobile Pay'}</td>
          <td style="font-size: 11px; color: var(--text-secondary);">${tx.description || '-'}</td>
          <td><span class="court-badge-pill status-active">✓ Validé</span></td>
        `;
        tbody.appendChild(tr);
      });
    }
  } catch (e) {
    console.warn("Could not load admin finances", e);
  }
}

// --------------------------------------------------------------------------
// ADMIN: CLUB SETTINGS (Tab 7)
// --------------------------------------------------------------------------
async function renderAdminSettings(clubId) {
  try {
    const res = await fetch(`/api/admin/settings?clubId=${clubId}`);
    if (res.ok) {
      const data = await res.json();
      const s = data.settings;
      if (s) {
        const nameEl = document.getElementById('settingClubName');
        if (nameEl) nameEl.value = s.name || '';

        const addrEl = document.getElementById('settingClubAddress');
        if (addrEl) addrEl.value = s.address || '';

        const phoneEl = document.getElementById('settingClubPhone');
        if (phoneEl) phoneEl.value = s.phone || '';

        const emailEl = document.getElementById('settingClubEmail');
        if (emailEl) emailEl.value = s.email || '';

        const openEl = document.getElementById('settingClubOpen');
        if (openEl) openEl.value = s.openTime || '06:30';

        const closeEl = document.getElementById('settingClubClose');
        if (closeEl) closeEl.value = s.closeTime || '00:30';

        const priceEl = document.getElementById('settingClubPrice');
        if (priceEl) priceEl.value = s.pricePerPlayer || 25;
      }
    }
  } catch (e) {
    console.warn("Could not load club settings", e);
  }
}

// Save Club Settings Form
async function executeAdminSaveSettings(e) {
  e.preventDefault();
  const clubId = AppState.currentAdminClubId || 'club_connection';
  const name = document.getElementById('settingClubName').value;
  const address = document.getElementById('settingClubAddress').value;
  const phone = document.getElementById('settingClubPhone').value;
  const email = document.getElementById('settingClubEmail').value;
  const openTime = document.getElementById('settingClubOpen').value;
  const closeTime = document.getElementById('settingClubClose').value;
  const pricePerPlayer = Number(document.getElementById('settingClubPrice').value);

  try {
    const res = await fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clubId, name, address, phone, email, openTime, closeTime, pricePerPlayer })
    });
    const result = await res.json();
    if (result.success) {
      showToast(result.message, "success");
      await loadStateFromServer();
    }
  } catch (err) {
    showToast("Erreur lors de l'enregistrement des paramètres.", "error");
  }
}

// --------------------------------------------------------------------------
// COMMON ACTIONS & MODALS
// --------------------------------------------------------------------------

// Join Featured Tournament
window.joinFeaturedTournament = async function() {
  try {
    const res = await fetch('/api/tournaments/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournamentId: 'tourn_masters_2026' })
    });
    const result = await res.json();
    if (result.success) {
      showToast(result.message, "success");
    }
  } catch (e) {
    showToast("Erreur lors de l'inscription.", "error");
  }
};

// Execute Book Court Submission
async function executeBookCourt(e) {
  e.preventDefault();
  const courtId = document.getElementById('bookCourtSelect').value;
  const time = document.getElementById('bookTimeSelect').value;
  const type = document.getElementById('bookTypeSelect').value;
  const clientName = document.getElementById('bookClientName').value || AppState.user.name;
  const phone = document.getElementById('bookClientPhone').value || AppState.user.phone;

  try {
    const res = await fetch('/api/courts/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clubId: AppState.selectedClubForBooking.id,
        courtId,
        time,
        type,
        clientName,
        phone,
        bookedBy: 'user'
      })
    });
    const result = await res.json();
    if (result.success) {
      closeAllModals();
      showToast(result.message, "success");
      await loadStateFromServer();
      renderAllViews();
    } else {
      showToast(result.message, "error");
      if (result.message.includes('Points insuffisants')) {
        openModal('modal-recharge-points');
      }
    }
  } catch (err) {
    showToast("Erreur lors de la réservation du terrain.", "error");
  }
}

// Execute Create Match
async function executeCreateMatch(e) {
  e.preventDefault();
  const clubId = document.getElementById('createMatchClubSelect').value;
  const time = document.getElementById('createMatchTime').value;
  const levelRange = document.getElementById('createMatchLevelRange').value;
  const pointsCost = document.getElementById('createMatchPointsCost').value;

  try {
    const res = await fetch('/api/matches/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clubId, time, levelRange, pointsCost })
    });
    const result = await res.json();
    if (result.success) {
      closeAllModals();
      showToast(result.message, "success");
      await loadStateFromServer();
      navigateToScreen('screen-join-match');
      renderMatchesFeed();
    }
  } catch (err) {
    showToast("Erreur lors de la création du match.", "error");
  }
}

// Execute Points Recharge
async function executeRecharge() {
  const selectedPack = document.querySelector('.pack-card.selected');
  const amount = Number(selectedPack ? selectedPack.dataset.points : 50);
  const selectedMethod = document.querySelector('.payment-method-card.selected')?.dataset.method || 'flouci';

  try {
    const res = await fetch('/api/user/wallet/recharge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, paymentMethod: selectedMethod })
    });
    const result = await res.json();
    if (result.success) {
      closeAllModals();
      AppState.user.points = result.points;
      updateHeaderPoints();
      showToast(result.message, "success");
      fetchAndRenderAdminStats(AppState.currentAdminClubId);
    }
  } catch (err) {
    showToast("Erreur lors de la recharge de points.", "error");
  }
}

// Execute Points Transfer
async function executeTransfer() {
  const amount = Number(document.getElementById('transferAmountInput').value) || 10;
  const recipient = document.getElementById('transferRecipientInput').value || "+216 98 000 000";

  try {
    const res = await fetch('/api/user/wallet/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, recipient })
    });
    const result = await res.json();
    if (result.success) {
      closeAllModals();
      AppState.user.points = result.points;
      updateHeaderPoints();
      showToast(result.message, "success");
    } else {
      showToast(result.message, "error");
    }
  } catch (err) {
    showToast("Erreur lors du transfert de points.", "error");
  }
}

// Reset Demo Data
async function resetDemoData() {
  if (confirm("Réinitialiser toutes les données de test à leur état officiel d'origine ?")) {
    try {
      const res = await fetch('/api/admin/reset-demo', { method: 'POST' });
      const result = await res.json();
      showToast(result.message, "info");
      await loadStateFromServer();
      renderAllViews();
    } catch (err) {
      showToast("Erreur lors de la réinitialisation.", "error");
    }
  }
}

// Modal Helpers
window.openModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
  } else {
    console.warn("Modal not found:", modalId);
  }
};

window.closeAllModals = function() {
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.classList.remove('active');
  });
};

// Toast Notice Helper
function showToast(message, type = 'info') {
  const toast = document.getElementById('globalToastNotice');
  if (!toast) return;

  const icon = type === 'success' ? '✅' : (type === 'error' ? '⚠️' : 'ℹ️');
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  toast.className = 'toast-notice show';

  setTimeout(() => {
    toast.className = 'toast-notice';
  }, 3400);
}

// --------------------------------------------------------------------------
// PAIRES OFFICIELLES & DÉFIS DUO (ELO RANKING)
// --------------------------------------------------------------------------
window.openOfficialTeamsModal = async function() {
  await fetchAndRenderTeams();
  openModal('modal-official-teams');
};

async function fetchAndRenderTeams() {
  try {
    const res = await fetch('/api/teams');
    if (res.ok) {
      const data = await res.json();
      AppState.officialTeams = data.teams;
    }
  } catch (e) {
    console.warn("Could not fetch teams", e);
  }

  const container = document.getElementById('officialTeamsListWrapper');
  if (!container) return;

  const teams = AppState.officialTeams || [];
  const userTeam = teams.find(t => t.isUserTeam) || teams[2];
  const userHero = document.getElementById('userDuoHeroCard');

  if (userHero && userTeam) {
    const userRank = teams.findIndex(t => t.id === userTeam.id) + 1;
    userHero.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <span class="user-duo-rank-pill">#${userRank} au Classement National</span>
          <div class="user-duo-name">${userTeam.name}</div>
          <div class="user-duo-players">${userTeam.player1?.avatar || '🎾'} ${userTeam.player1?.name} (${Number(userTeam.player1?.level).toFixed(2)}) & ${userTeam.player2?.avatar || '👨'} ${userTeam.player2?.name} (${Number(userTeam.player2?.level).toFixed(2)})</div>
        </div>
        <div class="user-duo-elo-badge">
          <div style="font-size: 10px; opacity:0.8;">ELO DUO</div>
          <div style="font-size: 20px; font-weight:900; color:var(--hayapala-volt);">${userTeam.eloRating}</div>
        </div>
      </div>
      <div class="user-duo-stats-row">
        <div><span>Victoires :</span> <strong>${userTeam.wins}V - ${userTeam.losses}D</strong></div>
        <div><span>Taux :</span> <strong style="color:#10B981;">${userTeam.winRate}%</strong></div>
        <div><span>Série :</span> <strong style="color:var(--hayapala-volt);">${userTeam.streak}</strong></div>
      </div>
    `;
  }

  let html = '<div class="duo-leaderboard-list">';
  teams.forEach((team, idx) => {
    const rank = idx + 1;
    const isUser = team.isUserTeam;
    html += `
      <div class="duo-item-card ${isUser ? 'is-user' : ''}">
        <div class="duo-rank-num">#${rank}</div>
        <div class="duo-item-details">
          <div class="duo-item-top">
            <span class="duo-team-name-text">${team.name}</span>
            <span class="duo-badge-tag">${team.badge}</span>
          </div>
          <div class="duo-players-names">${team.player1?.name} & ${team.player2?.name} (${team.homeClub})</div>
        </div>
        <div class="duo-elo-stats">
          <div class="duo-elo-val">${team.eloRating} ELO</div>
          <div class="duo-winrate-val">${team.winRate}% victoires</div>
        </div>
        ${!isUser ? `<button class="btn-challenge-duo" onclick="challengeDuoTeam('${team.id}')">⚔️ Défier</button>` : `<span style="font-size:10px; color:var(--hayapala-volt); font-weight:800; padding:4px 6px;">VOUS</span>`}
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

window.challengeDuoTeam = async function(teamId) {
  try {
    const res = await fetch('/api/teams/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamId })
    });
    const result = await res.json();
    if (result.success) {
      showToast(result.message, "success");
    } else {
      showToast(result.message, "error");
    }
  } catch (err) {
    showToast("Erreur lors de l'envoi du défi.", "error");
  }
};

window.renderCommunityPlayersDirectory = function(query = '') {
  const container = document.getElementById('registeredPlayersDirectory');
  if (!container) return;

  const q = query.toLowerCase().trim();
  let players = AppState.communityPlayers || [];
  if (q) {
    players = players.filter(p => p.name.toLowerCase().includes(q) || (p.club && p.club.toLowerCase().includes(q)) || (p.city && p.city.toLowerCase().includes(q)));
  }

  if (players.length === 0) {
    container.innerHTML = `<div style="text-align:center; padding: 12px; font-size:12px; color:var(--text-secondary);">Aucun joueur trouvé pour "${query}".</div>`;
    return;
  }

  let html = '';
  players.forEach(p => {
    html += `
      <div class="directory-player-row" onclick="selectDuoPartner('${p.id}')">
        <div class="directory-player-left">
          <span class="directory-player-avatar">${p.avatar || '👤'}</span>
          <div>
            <div class="directory-player-name">${p.name}</div>
            <div class="directory-player-meta">${p.club || 'Padel'} • ${p.matches || 0} matches (${p.reliability || 50}% fiabilité)</div>
          </div>
        </div>
        <div class="directory-player-level">⭐ ${Number(p.level).toFixed(2)}</div>
      </div>
    `;
  });
  container.innerHTML = html;
};

window.selectDuoPartner = function(playerId) {
  const partner = (AppState.communityPlayers || []).find(p => p.id === playerId);
  if (!partner) return;

  AppState.selectedPartnerForDuo = partner;

  document.getElementById('selectedPartnerId').value = partner.id;
  document.getElementById('selectedPartnerAvatar').textContent = partner.avatar || '👨';
  document.getElementById('selectedPartnerName').textContent = partner.name;
  document.getElementById('selectedPartnerLevel').textContent = `⭐ ${Number(partner.level).toFixed(2)}`;
  document.getElementById('selectedPartnerClub').textContent = partner.club || 'Padel Club';

  document.getElementById('selectedPartnerCard').style.display = 'flex';
  document.getElementById('registeredPlayersDirectory').style.display = 'none';

  const teamNameInput = document.getElementById('duoTeamNameInput');
  if (!teamNameInput.value) {
    teamNameInput.value = `Team Moslem & ${partner.name.split(' ')[0]}`;
  }

  updateDuoProjection();
};

window.updateDuoProjection = function() {
  const userLevel = AppState.user ? Number(AppState.user.level) : 5.49;
  const partner = AppState.selectedPartnerForDuo;
  const partnerLevel = partner ? Number(partner.level) : 5.00;
  const partnerName = partner ? partner.name : "Ahmed Horrigue";

  const teamLevel = Number(((userLevel + partnerLevel) / 2).toFixed(2));
  const elo = Math.round(1000 + teamLevel * 100);

  const projPartnerEl = document.getElementById('duoProjPartner');
  const projLevelEl = document.getElementById('duoProjLevel');
  const projEloEl = document.getElementById('duoProjElo');

  if (projPartnerEl) projPartnerEl.textContent = `${partnerName} (⭐ ${partnerLevel.toFixed(2)})`;
  if (projLevelEl) projLevelEl.textContent = teamLevel.toFixed(2);
  if (projEloEl) projEloEl.textContent = `${elo} ELO`;
};

async function executeCreateDuo(e) {
  e.preventDefault();
  const partner = AppState.selectedPartnerForDuo;
  const partnerId = partner?.id || document.getElementById('selectedPartnerId').value || 'usr_ahmed';
  const partnerName = partner?.name || "Ahmed Horrigue";
  const teamName = document.getElementById('duoTeamNameInput').value;
  const homeClub = document.getElementById('duoHomeClubSelect').value;

  try {
    const res = await fetch('/api/teams/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partnerId, partnerName, teamName, homeClub })
    });
    const result = await res.json();
    if (result.success) {
      showToast(result.message, "success");
      document.getElementById('formCreateDuo').reset();
      AppState.selectedPartnerForDuo = null;
      document.getElementById('selectedPartnerCard').style.display = 'none';
      document.getElementById('registeredPlayersDirectory').style.display = 'flex';
      document.getElementById('tabDuoRanking').click();
      await fetchAndRenderTeams();
    } else {
      showToast(result.message, "error");
    }
  } catch (err) {
    showToast("Erreur lors de la création de la paire.", "error");
  }
}

// --------------------------------------------------------------------------
// RATING SIMULATOR (Glicko-2 / Elo)
// --------------------------------------------------------------------------
document.getElementById('btnOpenRatingSimulator')?.addEventListener('click', () => {
  if (AppState.user) {
    document.getElementById('simPlayerCurrentLevel').textContent = AppState.user.level.toFixed(2);
    document.getElementById('simPlayerCurrentRel').textContent = `${AppState.user.levelReliability.toFixed(2)}%`;
  }
  openModal('modal-rating-simulator');
  updateSimulatorPreview();
});

['simTeamLevelSelect', 'simOpponentLevelSelect', 'simScoreSelect'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', updateSimulatorPreview);
});

async function updateSimulatorPreview() {
  const teamLevel = Number(document.getElementById('simTeamLevelSelect')?.value || 5.25);
  const oppLevel = Number(document.getElementById('simOpponentLevelSelect')?.value || 6.20);
  const scoreVal = document.getElementById('simScoreSelect')?.value || "2-1";
  const [setsWon, setsLost] = scoreVal.split('-').map(Number);

  try {
    const res = await fetch('/api/rating/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerLevel: AppState.user.level,
        playerReliability: AppState.user.levelReliability,
        partnerLevel: Number((teamLevel * 2 - AppState.user.level).toFixed(2)),
        opponent1Level: oppLevel,
        opponent2Level: oppLevel,
        setsWon,
        setsLost
      })
    });
    const data = await res.json();
    if (data.success) {
      const sim = data.simulation;
      document.getElementById('simExpectedWinRate').textContent = `${sim.expectedWinRate}%`;
      const deltaSign = sim.delta >= 0 ? '+' : '';
      const color = sim.delta >= 0 ? '#27AE60' : '#D32F2F';
      const levelEl = document.getElementById('simNewLevelResult');
      levelEl.textContent = `${sim.newLevel.toFixed(2)} (${deltaSign}${sim.delta.toFixed(2)})`;
      levelEl.style.color = color;
      document.getElementById('simNewRelResult').textContent = `${sim.newReliability.toFixed(2)}% (+${(sim.newReliability - AppState.user.levelReliability).toFixed(1)}%)`;
    }
  } catch (err) {
    console.error("Simulation error", err);
  }
}

document.getElementById('btnApplySimulatedResult')?.addEventListener('click', async () => {
  const teamLevel = Number(document.getElementById('simTeamLevelSelect')?.value || 5.25);
  const oppLevel = Number(document.getElementById('simOpponentLevelSelect')?.value || 6.20);
  const scoreVal = document.getElementById('simScoreSelect')?.value || "2-1";
  const [setsWon, setsLost] = scoreVal.split('-').map(Number);

  try {
    const res = await fetch('/api/rating/record-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setsWon,
        setsLost,
        clubName: "Padel Connection",
        partnerName: "Ahmed Horrigue",
        partnerLevel: Number((teamLevel * 2 - AppState.user.level).toFixed(2)),
        opp1Name: "Karim Arfaoui",
        opp1Level: oppLevel,
        opp2Name: "Dhouib Med Amine",
        opp2Level: oppLevel
      })
    });
    const result = await res.json();
    if (result.success) {
      closeAllModals();
      await loadStateFromServer();
      renderAllViews();
      showToast(result.message, "success");
    }
  } catch (err) {
    showToast("Erreur lors de l'enregistrement du match.", "error");
  }
});
