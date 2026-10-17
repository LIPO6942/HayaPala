# 🎾 HayaPala - L'Expérience Padel Nouvelle Génération

> **Plateforme Padel 2.0 complète** : Application Joueur (PWA mobile installable) + Portail Back-Office Club Pro + Moteur de Matchmaking avec Classement ELO & Partage de Paiement individuel (Split-Pay).

---

## ✨ Fonctionnalités Clés

### 📱 1. Espace Mobile Joueur (PWA Installable)
* **Design Dark Athletic Premium** : Thème haute performance aux teintes Volt néon (`#CCFF00`), Cyan électrique (`#00F5D4`) et bleu padel avec typographies modernes (*Outfit* & *Plus Jakarta Sans*).
* **Partage de Paiement Individuel (Split-Pay)** : Chaque joueur ne paie que sa part (25 DT / 25 Pts) lors de la création d'une partie ouverte. Les 3 autres places sont ouvertes à la communauté et débitées individuellement.
* **Portefeuille & Recharge 1 DT = 1 Point** :
  * 💳 **Carte Bancaire (CMI / GNT / Visa / Mastercard)**
  * 📲 **Flouci Mobile Pay**
  * 📮 **D17 (La Poste Tunisienne)**
  * Packs avec bonus fidélité offerts (100 DT = 110 pts, 250 DT = 285 pts).
* **Simulateur d'Algorithme ELO / Glicko-2** : Calcul en direct de la variation de niveau (1.0 à 8.0) et de la fiabilité statistique (0 à 100%) selon le résultat du match.
* **🏆 Paires Officielles & Défis Duo** :
  * Annuaire des membres certifiés de la communauté pour rechercher et sélectionner son partenaire.
  * Calcul automatique du niveau moyen et de l'ELO initial du binôme.
  * Leaderboard officiel des duos et bouton d'envoi de défi de match classé (`⚔️ Défier`).

### 💻 2. Portail Club Pro Back-Office (Planning Interactif)
* **Planning dynamique des terrains** : Grille horaire par tranches de 90 minutes.
* **Indicateur de remplissage Split-Pay en temps réel** : Badges de statut (`open_match` vs `confirmed`), jauge de remplissage (`1/4`, `2/4`, `3/4`, `4/4`) et montant encaissé en Dinars.
* **Tableau de bord de gestion** : Vue synthétique des réservations, gestion des courts (Indoor / Outdoor / Gazon WPT) et switch direct entre vue club et vue mobile.

---

## 🚀 Démarrage Rapide

### Prérequis
* [Node.js](https://nodejs.org/) (version 18 ou supérieure)

### Lancer l'application localement
```bash
# 1. Cloner le dépôt
git clone https://github.com/LIPO6942/HayaPala.git
cd HayaPala

# 2. Démarrer le serveur
npm start
```

Ouvrez ensuite votre navigateur sur : **`http://localhost:3000`**

---

## 📲 Installation sur Smartphone (PWA)

HayaPala est une **Progressive Web App** native :
* **Sur iPhone (Safari)** : Ouvrez l'URL -> Partager `⎋` -> **« Sur l'écran d'accueil »**.
* **Sur Android (Chrome)** : Ouvrez l'URL -> **« Ajouter à l'écran d'accueil »** ou `⋮` -> **« Installer l'application »**.

---

## 🌐 Déploiement Cloud 24h/24

### Déploiement sur Render.com (Gratuit)
1. Créez un compte sur [Render.com](https://render.com).
2. Cliquez sur **New +** -> **Web Service** et connectez ce repository GitHub.
3. Configurez :
   * **Environment** : `Node`
   * **Start Command** : `node server.js`
4. Votre application est déployée avec HTTPS gratuit !

---

## 🛠️ Stack Technique
* **Backend** : Node.js (architecture modulaire native haute performance sans dépendances superflues).
* **Frontend** : Vanilla HTML5, CSS3 Glassmorphism & Vanilla JavaScript moderne.
* **PWA** : Service Worker (`sw.js`) & Web App Manifest (`manifest.json`).
* **Base de données** : Stockage persistant JSON avec sauvegardes atomiques.

---

## 📄 Licence
Sous licence MIT. Développé pour la communauté Padel.
