/* ==========================================================================
   HAYAPALA — FIREBASE SERVICES
   Initialisation de Firebase App, Auth, Firestore, Analytics
   SDK v10 via CDN ESM — compatible navigateur sans bundler
   ========================================================================== */

import { initializeApp }          from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAnalytics, logEvent } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-analytics.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

import { firebaseConfig } from './firebase-config.js';

// ── Init App ──────────────────────────────────────────────────────────────────
const app       = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth      = getAuth(app);
const db        = getFirestore(app);

// ── Collections Firestore ─────────────────────────────────────────────────────
const COL = {
  players:       'players',
  courts:        'courts',
  bookings:      'bookings',
  openMatches:   'openMatches',
  notifications: 'notifications',
  reviews:       'reviews',
  transactions:  'transactions',
  config:        'config',
};

// ── Auth helpers ──────────────────────────────────────────────────────────────

/** Connexion email / mot de passe */
async function fbSignIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

/** Déconnexion */
async function fbSignOut() {
  return signOut(auth);
}

/** Créer un compte joueur (gérant l'inscrit) */
async function fbCreateUser(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

/** Callback quand l'état d'auth change */
function fbOnAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

// ── Firestore helpers — Players ───────────────────────────────────────────────

async function fbGetPlayers() {
  const snap = await getDocs(collection(db, COL.players));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fbGetPlayer(id) {
  const snap = await getDoc(doc(db, COL.players, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

async function fbSavePlayer(player) {
  const ref = doc(db, COL.players, player.id);
  await setDoc(ref, { ...player, updatedAt: serverTimestamp() }, { merge: true });
}

async function fbUpdatePlayerLevel(playerId, { level, coachComment, coachId }) {
  const ref       = doc(db, COL.players, playerId);
  const snap      = await getDoc(ref);
  if (!snap.exists()) throw new Error('Joueur introuvable');
  const prev      = snap.data().level;
  const histEntry = {
    previousLevel: prev,
    newLevel:      level,
    changedAt:     new Date().toISOString(),
    changedBy:     coachId || 'coach_ali',
    coachComment:  coachComment || '',
  };
  await updateDoc(ref, {
    level,
    status:               'active',
    levelValidatedAt:     new Date().toISOString(),
    levelValidatedBy:     coachId || 'coach_ali',
    levelHistory:         [...(snap.data().levelHistory || []), histEntry],
    updatedAt:            serverTimestamp(),
  });
}

function fbListenPlayers(callback) {
  return onSnapshot(collection(db, COL.players), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ── Firestore helpers — Courts ────────────────────────────────────────────────

async function fbGetCourts() {
  const snap = await getDocs(collection(db, COL.courts));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Firestore helpers — Bookings ──────────────────────────────────────────────

async function fbGetBookings(date) {
  let q = collection(db, COL.bookings);
  if (date) q = query(q, where('date', '==', date));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fbAddBooking(booking) {
  const ref = await addDoc(collection(db, COL.bookings), {
    ...booking,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

async function fbUpdateBooking(id, data) {
  await updateDoc(doc(db, COL.bookings, id), { ...data, updatedAt: serverTimestamp() });
}

async function fbCancelBooking(id) {
  await updateDoc(doc(db, COL.bookings, id), { status: 'cancelled', updatedAt: serverTimestamp() });
}

function fbListenBookings(date, callback) {
  const q = query(collection(db, COL.bookings), where('date', '==', date));
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ── Firestore helpers — Open Matches ─────────────────────────────────────────

async function fbGetOpenMatches() {
  const q    = query(collection(db, COL.openMatches), where('status', '==', 'open'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fbJoinMatch(matchId, player) {
  const ref  = doc(db, COL.openMatches, matchId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Match introuvable');
  const data = snap.data();
  if ((data.players || []).find(p => p.userId === player.userId)) {
    throw new Error('Déjà inscrit à ce match');
  }
  const updated = [...(data.players || []), player];
  const isFull  = updated.length >= 4;
  await updateDoc(ref, {
    players:   updated,
    status:    isFull ? 'full' : 'open',
    updatedAt: serverTimestamp(),
  });
}

async function fbCreateOpenMatch(matchData) {
  const ref = await addDoc(collection(db, COL.openMatches), {
    ...matchData,
    players:   [],
    status:    'open',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

function fbListenOpenMatches(callback) {
  const q = query(collection(db, COL.openMatches), where('status', 'in', ['open', 'full']));
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ── Firestore helpers — Notifications ─────────────────────────────────────────

async function fbGetNotifications(userId) {
  const q    = query(collection(db, COL.notifications), where('userId', '==', userId), orderBy('sentAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function fbMarkNotifRead(id) {
  await updateDoc(doc(db, COL.notifications, id), { isRead: true });
}

async function fbAddNotification(notif) {
  await addDoc(collection(db, COL.notifications), {
    ...notif,
    isRead: false,
    sentAt: serverTimestamp(),
  });
}

// ── Firestore helpers — Config ─────────────────────────────────────────────────

async function fbGetConfig() {
  const snap = await getDoc(doc(db, COL.config, 'appConfig'));
  return snap.exists() ? snap.data() : null;
}

async function fbSaveConfig(cfg) {
  await setDoc(doc(db, COL.config, 'appConfig'), { ...cfg, updatedAt: serverTimestamp() }, { merge: true });
}

// ── Seed Firestore (première utilisation) ────────────────────────────────────

async function fbSeedIfEmpty(seedData) {
  const configSnap = await getDoc(doc(db, COL.config, 'appConfig'));
  if (configSnap.exists()) {
    console.log('🔥 Firestore : données existantes, seed ignoré.');
    return false;
  }

  console.log('🌱 Firestore : premier lancement, seed des données...');

  // Config
  await setDoc(doc(db, COL.config, 'appConfig'), { ...seedData.appConfig, updatedAt: serverTimestamp() });

  // Players
  for (const p of seedData.players) {
    await setDoc(doc(db, COL.players, p.id), { ...p, updatedAt: serverTimestamp() });
  }

  // Courts
  for (const c of seedData.courts) {
    await setDoc(doc(db, COL.courts, c.id), { ...c, updatedAt: serverTimestamp() });
  }

  // Bookings (on retire les fonctions getTodayStr)
  const today = new Date().toISOString().split('T')[0];
  for (const b of seedData.bookings) {
    await setDoc(doc(db, COL.bookings, b.id), {
      ...b,
      date:      today,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // Notifications
  for (const n of seedData.notifications) {
    await setDoc(doc(db, COL.notifications, n.id), {
      ...n,
      sentAt:    serverTimestamp(),
    });
  }

  console.log('✅ Firestore seed terminé.');
  return true;
}

// ── Analytics helpers ─────────────────────────────────────────────────────────

function fbTrack(eventName, params = {}) {
  try { logEvent(analytics, eventName, params); } catch (e) {}
}

// ── Export all ────────────────────────────────────────────────────────────────

export {
  app, auth, db, analytics,
  // Auth
  fbSignIn, fbSignOut, fbCreateUser, fbOnAuthChange,
  // Players
  fbGetPlayers, fbGetPlayer, fbSavePlayer, fbUpdatePlayerLevel, fbListenPlayers,
  // Courts
  fbGetCourts,
  // Bookings
  fbGetBookings, fbAddBooking, fbUpdateBooking, fbCancelBooking, fbListenBookings,
  // Open Matches
  fbGetOpenMatches, fbJoinMatch, fbCreateOpenMatch, fbListenOpenMatches,
  // Notifications
  fbGetNotifications, fbMarkNotifRead, fbAddNotification,
  // Config
  fbGetConfig, fbSaveConfig,
  // Seed
  fbSeedIfEmpty,
  // Analytics
  fbTrack,
  // Firestore primitives (pour usage avancé)
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, onSnapshot,
  query, where, orderBy, serverTimestamp,
};
