/**
 * YallaPlay Web Platform - Application Logic
 * Interactive state, mobile screens & club management
 */

// Global State
let AppState = {
  user: null,
  clubs: [],
  matches: [],
  userMatchHistory: [],
  tournament: null,
  clubBookings: [],
  activeScreen: 'screen-home',
  activeViewMode: 'mobile-app', // 'mobile-app' | 'backoffice-dashboard' | 'backoffice-login'
  activeMatchTab: 'tab-available',
  selectedClubForBooking: null,
  selectedCourtForBooking: null,
  selectedTimeSlot: '17:00 - 18:30',
  communityPlayers: [],
  selectedPartnerForDuo: null
};

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await loadStateFromServer();
  renderAllViews();
});

// Fetch state from server
async function loadStateFromServer() {
  try {
    const res = await fetch('/api/state');
    if (res.ok) {
      const data = await res.json();
      AppState.user = data.user;
      AppState.clubs = data.clubs;
      AppState.matches = data.matches;
      AppState.userMatchHistory = data.userMatchHistory;
      AppState.tournament = data.tournament;
      AppState.clubBookings = data.clubBookings;
      AppState.officialTeams = data.officialTeams || [];
      AppState.communityPlayers = data.communityPlayers || [];
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
  
  // Top control bar
  const livePill = document.getElementById('topLivePointsValue');
  if (livePill) livePill.textContent = `${pts} Points`;
  
  // Mobile home screen badge
  const homeBadge = document.getElementById('homePointsBadgeValue');
  if (homeBadge) homeBadge.textContent = `${pts} Points`;

  // Profile screen badge
  const profileBadge = document.getElementById('profilePointsBadgeValue');
  if (profileBadge) profileBadge.textContent = `${pts} Points`;
}

// Setup Event Listeners
function setupEventListeners() {
  // Top View Mode Switcher
  document.querySelectorAll('.view-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const mode = btn.dataset.mode;
      switchViewMode(mode);
    });
  });

  // Mobile Frame Toggle (frameless vs phone)
  const toggleFrameBtn = document.getElementById('toggleFrameStyleBtn');
  if (toggleFrameBtn) {
    toggleFrameBtn.addEventListener('click', () => {
      const frame = document.getElementById('smartphoneFrame');
      frame.classList.toggle('frameless');
      toggleFrameBtn.textContent = frame.classList.contains('frameless') ? '📱 Mode Smartphone' : '🔲 Mode Plein Écran';
    });
  }

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
  const btnGoBook = document.getElementById('quickCardBookCourt');
  if (btnGoBook) {
    btnGoBook.addEventListener('click', () => navigateToScreen('screen-book-court'));
  }

  const btnGoJoin = document.getElementById('quickCardJoinMatch');
  if (btnGoJoin) {
    btnGoJoin.addEventListener('click', () => navigateToScreen('screen-join-match'));
  }

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
  const btnLaunch = document.getElementById('btnLaunchMatchCta');
  if (btnLaunch) {
    btnLaunch.addEventListener('click', () => openModal('modal-create-match'));
  }

  // Club Search Filter
  const searchInput = document.getElementById('clubSearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      renderClubsList(e.target.value);
    });
  }

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
    btn.addEventListener('click', () => {
      closeAllModals();
    });
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

  // Admin Login Simulation
  document.getElementById('loginFormAdmin')?.addEventListener('submit', (e) => {
    e.preventDefault();
    showToast("Connexion réussie au club !", "success");
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
    renderAdminSchedule(e.target.value);
  });
}

// Switch between Mobile App, Back-Office Dashboard, and Back-Office Login
function switchViewMode(mode) {
  AppState.activeViewMode = mode;
  document.querySelectorAll('.view-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const mobileContainer = document.getElementById('mobileAppContainer');
  const backofficeDashboard = document.getElementById('backofficeDashboard');
  const backofficeLogin = document.getElementById('backofficeLogin');

  if (mode === 'mobile-app') {
    mobileContainer.style.display = 'flex';
    backofficeDashboard.style.display = 'none';
    backofficeLogin.style.display = 'none';
  } else if (mode === 'backoffice-dashboard') {
    mobileContainer.style.display = 'none';
    backofficeDashboard.style.display = 'flex';
    backofficeLogin.style.display = 'none';
    renderAdminSchedule(document.getElementById('adminClubSelect')?.value || 'club_connection');
  } else if (mode === 'backoffice-login') {
    mobileContainer.style.display = 'none';
    backofficeDashboard.style.display = 'none';
    backofficeLogin.style.display = 'flex';
  }
}

// Navigate Mobile App Screen
function navigateToScreen(screenId) {
  AppState.activeScreen = screenId;
  document.querySelectorAll('.app-screen').forEach(scr => {
    scr.classList.remove('active');
  });
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');

  // Update Bottom Nav active states
  document.querySelectorAll('.nav-item-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.screen === screenId);
  });

  // Render content if needed
  if (screenId === 'screen-join-match') renderMatchesFeed();
  if (screenId === 'screen-book-court') renderClubsList();
  if (screenId === 'screen-profile') renderProfileData();
}

// Render All Components
function renderAllViews() {
  updateHeaderPoints();
  renderMatchesFeed();
  renderClubsList();
  renderProfileData();
  renderAdminSchedule('club_connection');
}

// Render Matches Feed (Screen 2)
function renderMatchesFeed() {
  const container = document.getElementById('matchesListContainer');
  if (!container) return;

  container.innerHTML = '';

  let list = AppState.matches;
  if (AppState.activeMatchTab === 'tab-my') {
    list = AppState.matches.filter(m => 
      m.team1.some(p => p && p.name === AppState.user.name) ||
      m.team2.some(p => p && p.name === AppState.user.name)
    );
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 16px; color: var(--text-secondary);">
        <p style="font-size: 32px; margin-bottom: 8px;">🎾</p>
        <p style="font-weight: 700;">Aucun match dans cette section.</p>
        <p style="font-size: 12px; margin-top: 4px;">Cliquez sur <strong>+ Lancer un match</strong> pour créer une partie !</p>
      </div>
    `;
    return;
  }

  list.forEach(match => {
    const card = document.createElement('div');
    card.className = 'match-open-card';

    // Build Team 1 Slots
    let team1Html = match.team1.map((p, idx) => {
      if (p) {
        return `
          <div class="player-slot-card">
            <div class="slot-avatar">${p.avatar || '👤'}</div>
            <div class="slot-name">${p.name}</div>
            <div class="slot-level">⭐ ${p.level.toFixed(2)}</div>
          </div>
        `;
      } else {
        return `
          <div class="player-slot-card empty-slot" onclick="handleJoinSlot('${match.id}', 1, ${idx + 1})">
            <div class="slot-avatar empty-avatar">+</div>
            <div class="slot-name" style="color: var(--primary-gold); font-weight: 700;">En attente</div>
            <div class="slot-level">⭐ -</div>
          </div>
        `;
      }
    }).join('');

    // Build Team 2 Slots
    let team2Html = match.team2.map((p, idx) => {
      if (p) {
        return `
          <div class="player-slot-card">
            <div class="slot-avatar">${p.avatar || '👤'}</div>
            <div class="slot-name">${p.name}</div>
            <div class="slot-level">⭐ ${p.level.toFixed(2)}</div>
          </div>
        `;
      } else {
        return `
          <div class="player-slot-card empty-slot" onclick="handleJoinSlot('${match.id}', 2, ${idx + 1})">
            <div class="slot-avatar empty-avatar">+</div>
            <div class="slot-name" style="color: var(--primary-gold); font-weight: 700;">En attente</div>
            <div class="slot-level">⭐ -</div>
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
        <div class="match-time-distance">- ${match.distance} - <strong>${match.time}</strong></div>
      </div>
      <div class="match-date-row">📅 ${match.date}</div>

      <div class="matchup-2v2-grid">
        <div class="team-box-wrap">${team1Html}</div>
        <div class="vs-badge-icon">VS</div>
        <div class="team-box-wrap">${team2Html}</div>
      </div>

      <div class="match-card-footer">
        <div class="match-info-meta">
          <div class="match-public-tag">${match.type} - ${match.duration}</div>
          <div class="court-reserved-tag">Court réservé | Niveau : ${match.levelRange}</div>
        </div>
        <div class="match-points-cost-badge">
          <span>🏅</span>
          <span>${match.pointsCost.toFixed(1)} Points</span>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

// Join slot handler
window.handleJoinSlot = function(matchId, team, position) {
  const match = AppState.matches.find(m => m.id === matchId);
  if (!match) return;

  if (AppState.user.points < match.pointsCost) {
    showToast(`Points insuffisants. Il vous faut ${match.pointsCost} pts (Solde: ${AppState.user.points} pts)`, "error");
    openModal('modal-recharge-points');
    return;
  }

  const modal = document.getElementById('modal-confirm-join');
  if (modal) {
    document.getElementById('confirmJoinClubName').textContent = match.clubName;
    document.getElementById('confirmJoinCost').textContent = `${match.pointsCost.toFixed(1)} Points`;
    document.getElementById('confirmJoinTime').textContent = `${match.date} (${match.time})`;

    const confirmBtn = document.getElementById('btnExecuteJoinMatch');
    confirmBtn.onclick = async () => {
      closeAllModals();
      try {
        const res = await fetch('/api/matches/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ matchId })
        });
        const result = await res.json();
        if (result.success) {
          AppState.user.points = result.userPoints;
          updateHeaderPoints();
          await loadStateFromServer();
          renderMatchesFeed();
          renderProfileData();
          showToast(result.message, "success");
        } else {
          showToast(result.message, "error");
        }
      } catch (err) {
        showToast("Erreur lors de la réservation du match.", "error");
      }
    };

    openModal('modal-confirm-join');
  }
};

// Render Clubs List (Screen 3)
function renderClubsList(filterQuery = '') {
  const container = document.getElementById('clubsListContainer');
  if (!container) return;

  container.innerHTML = '';
  const query = filterQuery.toLowerCase().trim();

  const filtered = AppState.clubs.filter(c => 
    c.name.toLowerCase().includes(query) ||
    c.address.toLowerCase().includes(query)
  );

  filtered.forEach(club => {
    const card = document.createElement('div');
    card.className = 'club-listing-card';

    card.innerHTML = `
      <div class="club-card-header">
        <div class="club-brand-left">
          <div class="club-badge-logo" style="background: ${club.logoColor}; color: ${club.logoTextColor};">
            ${club.logoBadge}
          </div>
          <div>
            <div class="club-name-text">${club.name}</div>
            <div class="club-sport-tag">${club.sport}</div>
          </div>
        </div>
        <button class="favorite-heart-btn ${club.isFavorite ? 'active' : ''}" onclick="toggleFavoriteClub('${club.id}')">
          ${club.isFavorite ? '❤️' : '🤍'}
        </button>
      </div>

      <div class="club-info-line">
        <span>📍</span>
        <span>${club.address}</span>
      </div>

      <div class="club-info-line">
        <span>🕒</span>
        <span>${club.schedule}</span>
      </div>

      <div class="club-actions-row">
        <button class="btn-itinerary" onclick="openClubItinerary('${club.name}', '${club.address}')">
          <span>🧭</span> Itinéraire
        </button>
        <button class="btn-book-court" onclick="openBookingModalForClub('${club.id}')">
          <span>📅</span> Réserver
        </button>
      </div>
    `;

    container.appendChild(card);
  });
}

// Toggle Favorite Club
window.toggleFavoriteClub = function(clubId) {
  const club = AppState.clubs.find(c => c.id === clubId);
  if (club) {
    club.isFavorite = !club.isFavorite;
    renderClubsList(document.getElementById('clubSearchInput')?.value || '');
    showToast(club.isFavorite ? `${club.name} ajouté aux favoris !` : `${club.name} retiré des favoris.`, "info");
  }
};

// Open Itinerary
window.openClubItinerary = function(name, address) {
  window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name + ' ' + address)}`, '_blank');
};

// Open Booking Modal for Club
window.openBookingModalForClub = function(clubId) {
  const club = AppState.clubs.find(c => c.id === clubId);
  if (!club) return;

  AppState.selectedClubForBooking = club;
  document.getElementById('modalBookClubName').textContent = club.name;
  document.getElementById('modalBookClubAddress').textContent = club.address;
  document.getElementById('modalBookPointsRate').textContent = `${club.pricePoints} Points / 90 min`;

  // Populate court choices
  const courtSelect = document.getElementById('bookCourtSelect');
  courtSelect.innerHTML = club.courts.map(crt => `
    <option value="${crt.id}">${crt.name} (${crt.type} - ${crt.surface})</option>
  `).join('');

  openModal('modal-book-court');
};

// Render Player Profile Data (Screen 4)
function renderProfileData() {
  if (!AppState.user) return;
  document.getElementById('profileUserName').textContent = AppState.user.name;
  document.getElementById('profileMatchesCount').textContent = AppState.user.matchesPlayed;
  document.getElementById('profileLevel').textContent = AppState.user.level.toFixed(2);
  document.getElementById('profileReliability').textContent = `${AppState.user.levelReliability}% Fiabilité du niveau`;

  const historyContainer = document.getElementById('profileHistoryContainer');
  if (historyContainer && AppState.userMatchHistory) {
    historyContainer.innerHTML = '';
    AppState.userMatchHistory.forEach(item => {
      const row = document.createElement('div');
      row.className = 'history-match-item';
      const isWin = item.result === 'G';
      const isLoss = item.result === 'P';

      row.innerHTML = `
        <div class="history-left">
          <div class="history-club-bold">${item.date} - ${item.clubName}</div>
          <div>Niveau : ${item.level}</div>
          <div class="history-teams">
            <div>Equipe 1 (${item.team1}) : <strong>${item.team1Score}</strong></div>
            <div>Equipe 2 (${item.team2}) : <strong>${item.team2Score}</strong></div>
          </div>
        </div>
        <div class="history-badge ${isWin ? 'win' : (isLoss ? 'loss' : '')}">
          ${item.result}
        </div>
      `;
      historyContainer.appendChild(row);
    });
  }
}

// Render Admin Timetable Schedule (Back-Office Dashboard)
function renderAdminSchedule(clubId = 'club_connection') {
  const club = AppState.clubs.find(c => c.id === clubId) || AppState.clubs[0];
  const tbody = document.getElementById('adminTimetableBody');
  const theadRow = document.getElementById('adminTimetableHeadRow');
  if (!tbody || !theadRow) return;

  // Build Table Headers (Courts)
  theadRow.innerHTML = `<th class="time-col">Heure</th>`;
  club.courts.forEach(court => {
    theadRow.innerHTML += `<th>${court.name}</th>`;
  });

  // Time slots: 08:00 to 22:30 (every 1.5h padel session)
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

    club.courts.forEach(court => {
      // Find matching booking
      const booking = AppState.clubBookings.find(b => 
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
          <td class="slot-cell">
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

// Admin click slot to reserve
window.handleAdminSlotClick = function(clubId, courtId, time) {
  const club = AppState.clubs.find(c => c.id === clubId);
  const court = club?.courts.find(crt => crt.id === courtId);

  AppState.selectedClubForBooking = club;
  document.getElementById('modalBookClubName').textContent = club.name;
  document.getElementById('modalBookClubAddress').textContent = court ? court.name : club.address;
  document.getElementById('modalBookPointsRate').textContent = `${club.pricePoints} Points`;

  const courtSelect = document.getElementById('bookCourtSelect');
  courtSelect.innerHTML = `<option value="${court.id}" selected>${court.name}</option>`;

  openModal('modal-book-court');
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
  if (confirm("Réinitialiser toutes les données de test à leur état d'origine ?")) {
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
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.classList.remove('active');
  });
}

// Open Rating Simulator
document.getElementById('btnOpenRatingSimulator')?.addEventListener('click', () => {
  if (AppState.user) {
    document.getElementById('simPlayerCurrentLevel').textContent = AppState.user.level.toFixed(2);
    document.getElementById('simPlayerCurrentRel').textContent = `${AppState.user.levelReliability.toFixed(2)}%`;
  }
  openModal('modal-rating-simulator');
  updateSimulatorPreview();
});

// Simulator select change listeners
['simTeamLevelSelect', 'simOpponentLevelSelect', 'simScoreSelect'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', updateSimulatorPreview);
});

// Update Simulator Calculation Preview
async function updateSimulatorPreview() {
  const teamLevel = Number(document.getElementById('simTeamLevelSelect')?.value || 5.25);
  const oppLevel = Number(document.getElementById('simOpponentLevelSelect')?.value || 5.75);
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

// Apply Simulated Result to Moslem Gouia's profile
document.getElementById('btnApplySimulatedResult')?.addEventListener('click', async () => {
  const teamLevel = Number(document.getElementById('simTeamLevelSelect')?.value || 5.25);
  const oppLevel = Number(document.getElementById('simOpponentLevelSelect')?.value || 5.75);
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
    showToast("Erreur lors de l'application du match", "error");
  }
});

// Toast Notification
function showToast(message, type = 'info') {
  const toast = document.getElementById('globalToastNotice');
  if (!toast) return;

  const icon = type === 'success' ? '✅' : (type === 'error' ? '⚠️' : 'ℹ️');
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  toast.className = 'toast-notice show';

  setTimeout(() => {
    toast.className = 'toast-notice';
  }, 3200);
}

// --------------------------------------------------------------------------
// PAIRES OFFICIELLES & DÉFIS DUO (ELO RANKING)
// --------------------------------------------------------------------------

// Open Official Teams Modal
window.openOfficialTeamsModal = async function() {
  await fetchAndRenderTeams();
  openModal('modal-official-teams');
};

// Fetch and Render Teams Leaderboard
async function fetchAndRenderTeams() {
  try {
    const res = await fetch('/api/teams');
    if (res.ok) {
      const data = await res.json();
      AppState.officialTeams = data.teams;
    }
  } catch (e) {
    console.warn("Could not fetch teams, using local fallback", e);
  }

  const container = document.getElementById('duoRankingListContainer');
  if (!container) return;

  const teams = AppState.officialTeams || [];

  // Update Hero Card for User's Team
  const userTeam = teams.find(t => t.isUserTeam) || teams[2];
  const userHero = document.getElementById('userDuoHeroCard');
  if (userHero && userTeam) {
    const userRank = teams.findIndex(t => t.id === userTeam.id) + 1;
    userHero.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <span class="user-duo-rank-pill">#${userRank} au Classement Général</span>
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

  // Render Leaderboard list
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

// Challenge Duo Team
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

// Render Directory of Registered Community Players for Duo Formation
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

// Select a Registered Player as Partner
window.selectDuoPartner = function(playerId) {
  const partner = (AppState.communityPlayers || []).find(p => p.id === playerId);
  if (!partner) return;

  AppState.selectedPartnerForDuo = partner;

  document.getElementById('selectedPartnerId').value = partner.id;
  document.getElementById('selectedPartnerAvatar').textContent = partner.avatar || '👨';
  document.getElementById('selectedPartnerName').textContent = partner.name;
  document.getElementById('selectedPartnerLevel').textContent = `⭐ ${Number(partner.level).toFixed(2)}`;
  document.getElementById('selectedPartnerClub').textContent = partner.club || 'Padel Club';

  // Toggle boxes
  document.getElementById('selectedPartnerCard').style.display = 'flex';
  document.getElementById('registeredPlayersDirectory').style.display = 'none';

  // Auto-suggest team name if input is empty
  const teamNameInput = document.getElementById('duoTeamNameInput');
  if (!teamNameInput.value) {
    teamNameInput.value = `Team Moslem & ${partner.name.split(' ')[0]}`;
  }

  updateDuoProjection();
};

// Update Duo Live Projection Calculation
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

// Execute Create Duo Form Submission
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
      body: JSON.stringify({ 
        partnerId,
        partnerName,
        teamName, 
        homeClub 
      })
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
