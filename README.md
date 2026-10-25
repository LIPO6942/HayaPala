# 🎾 HayaPala

Plateforme tout-en-un dédiée aux joueurs et aux clubs de Padel : réservation de terrains, matchmaking communautaire, gestion de club et classements.

---

## 🌟 Fonctionnalités

- **Réservation & Matchmaking** : Réservez des créneaux dans vos clubs favoris ou rejoignez des parties ouvertes selon votre niveau.
- **Portefeuille Intégré** : Paiement en ligne simplifié et gestion des crédits de jeu.
- **Compétition & Paires** : Formez vos binômes officiels, lancez des défis et suivez votre évolution au classement.
- **Espace Club Pro** : Planning interactif pour la gestion des terrains et le suivi des réservations en temps réel.
- **Application Mobile (PWA)** : Utilisable sur le Web et installable directement sur smartphone comme une application native.

---

## 🚀 Lancement Rapide

```bash
# Cloner le projet
git clone https://github.com/LIPO6942/HayaPala.git
cd HayaPala

# Démarrer le serveur
npm start
```

L'application est accessible sur : **`http://localhost:3000`**

---

## 📲 Installer sur Smartphone

- **iPhone (Safari)** : Bouton Partager `⎋` ➔ **« Sur l'écran d'accueil »**.
- **Android (Chrome)** : Menu `⋮` ➔ **« Installer l'application »**.

---

## 📊 Algorithme de Calcul du Niveau des Joueurs (Rating Engine)

L'algorithme de calcul du niveau et des variations de score des joueurs est un **modèle hybride Elo / Glicko-2 adapté au Padel (standard YallaPlay & Playtomic)**. Il mesure précisément le niveau de jeu individuel sur une échelle continue de **1.00** (débutant) à **8.00** (expert/professionnel), combiné à un indice de **Fiabilité (Reliability)** exprimé en pourcentage (0% à 99%).

### 1. Variables et Paramètres d'Entrée

Lorsqu'un match est enregistré, l'algorithme prend en compte :
- **$N_{\text{joueur}}$** (`playerLevel`) : Niveau actuel du joueur (ex: `5.49`).
- **$F_{\text{joueur}}$** (`playerReliability`) : Fiabilité actuelle de son niveau en % (ex: `45.74%`).
- **$N_{\text{partenaire}}$** (`partnerLevel`) : Niveau du coéquipier (ex: `5.00`).
- **$N_{\text{adv1}}$, $N_{\text{adv2}}$** (`opponent1Level`, `opponent2Level`) : Niveaux respectifs des deux adversaires.
- **Sets remportés / concédés** (`setsWon`, `setsLost`) : Résultat en sets (`2-0`, `2-1`, `1-2`, `0-2`).

---

### 2. Étapes Détaillées du Calcul Mathématique

#### Étape A : Calcul des moyennes d'équipe
Le Padel se jouant en double, l'algorithme calcule le niveau moyen de chaque paire :
$$\bar{N}_{\text{équipe}} = \frac{N_{\text{joueur}} + N_{\text{partenaire}}}{2}$$
$$\bar{N}_{\text{adverse}} = \frac{N_{\text{adv1}} + N_{\text{adv2}}}{2}$$

#### Étape B : Probabilité attendue de victoire ($E$) — Courbe logistique
L'espérance de victoire théorique est déterminée selon l'écart de niveau moyen entre les deux paires :
$$\text{exposant} = \frac{\bar{N}_{\text{adverse}} - \bar{N}_{\text{équipe}}}{0.85}$$
$$E = \frac{1}{1 + 10^{\text{exposant}}}$$

- Si les deux équipes sont de même niveau ($\bar{N}_{\text{équipe}} = \bar{N}_{\text{adverse}}$) : $\text{exposant} = 0 \implies E = 50\%$.
- Si l'équipe adverse est plus forte : $\text{exposant} > 0 \implies E < 50\%$ (l'équipe part outsider).
- Si l'équipe adverse est moins forte : $\text{exposant} < 0 \implies E > 50\%$ (l'équipe part favorite).
- Le diviseur `0.85` calibre la dispersion propre au Padel (un écart de 0.85 point de niveau équivaut à un ratio de probabilité de 10:1).

#### Étape C : Résultat réel pondéré par les sets ($S_{\text{réel}}$)
Contrairement à un modèle Elo binaire (1 ou 0), l'algorithme valorise la résistance et l'ampleur du score :

| Score en Sets | Nature du Résultat | Valeur $S_{\text{réel}}$ |
| :--- | :--- | :---: |
| **2 - 0** | Victoire nette (aucun set concédé) | **1.00** |
| **2 - 1** | Victoire disputée (1 set concédé) | **0.85** |
| **1 - 2** | Défaite disputée (1 set remporté) | **0.25** |
| **0 - 2** | Défaite nette (aucun set marqué) | **0.00** |

#### Étape D : Facteur de vitesse dynamique $K$ (Volatilité / Fiabilité)
Inspiré du modèle Glicko, le facteur d'ajustement $K$ est inversement proportionnel à la fiabilité du joueur :
$$\text{fraction} = \min\left(1, \max\left(0, \frac{F_{\text{joueur}}}{100}\right)\right)$$
$$K = 0.42 - (0.34 \times \text{fraction})$$

- **Fiabilité faible (~0% - nouveau joueur)** : $K \approx 0.42$ (forte volatilité : le niveau évolue vite pour converger rapidement vers le niveau réel).
- **Fiabilité élevée (~100% - joueur régulier)** : $K \approx 0.08$ (stabilité : le niveau est étalonné et varie par petits incréments).

#### Étape E : Calcul de la variation nette ($\Delta$) et plafonnement
La variation de niveau est le produit du facteur $K$ et de la différence entre la performance réelle et l'attente statistique :
$$\Delta = K \times (S_{\text{réel}} - E)$$

Un mécanisme de sécurité (clamping) bride la variation maximale par match entre **-0.45** et **+0.45** :
$$\Delta_{\text{borné}} = \max(-0.45, \min(+0.45, \Delta))$$

#### Étape F : Nouveau niveau et bornes absolues
$$N_{\text{nouveau}} = \max\left(1.00, \min\left(8.00, \text{round}(N_{\text{joueur}} + \Delta_{\text{borné}}, 2)\right)\right)$$
Le niveau est garanti d'évoluer strictement dans l'intervalle `[1.00, 8.00]`.

#### Étape G : Progression de la Fiabilité
À chaque match officiel disputé, la fiabilité augmente :
- En formule continue : $F_{\text{nouvelle}} = \min(99.0\%, \text{round}(F_{\text{joueur}} + (100 - F_{\text{joueur}}) \times 0.035, 2))$.
- Lors des confrontations directes entre pairs (écart de niveau $\le 1.0$), l'étalonnage est maximal (+12% à +18%), alors qu'un match très déséquilibré n'apporte qu'un étalonnage marginal (+1% à +2%).

---

### 3. Quand le Joueur Monte-t-il de Niveau ? ($\Delta > 0$)

Le joueur gagne des points de niveau dès que **sa performance réelle dépasse l'espérance théorique ($S_{\text{réel}} > E$)** :

1. **Victoire 2-0 ($S_{\text{réel}} = 1.00$)** :
   - Le joueur monte **à tous les coups**, car $E < 1.00$.
   - Le gain est **maximal** face à une équipe plus forte ($E$ faible, par ex. 20% $\implies 1.00 - 0.20 = +0.80$).
2. **Victoire 2-1 ($S_{\text{réel}} = 0.85$)** :
   - Le joueur monte tant que la probabilité théorique de victoire était inférieure à 85% ($E < 0.85$).
   - Le gain est substantiel contre des équipes de niveau équivalent ou supérieur.
3. **Défaite accrochée 1-2 ($S_{\text{réel}} = 0.25$) face à des adversaires très forts** :
   - Si les adversaires étaient largement favoris avec une espérance de gain pour le joueur inférieure à 25% ($E < 0.25$), marquer 1 set surpasse les attentes statistiques. Le niveau peut être **maintenu ou même légèrement valorisé à la hausse** malgré la défaite !

---

### 4. Quand le Joueur Descend-il de Niveau ? ($\Delta < 0$)

Le joueur perd des points de niveau dès que **sa performance réelle est inférieure à l'attente théorique ($S_{\text{réel}} < E$)** :

1. **Défaite 0-2 ($S_{\text{réel}} = 0.00$)** :
   - Le joueur descend **systématiquement** ($\Delta = -K \times E$).
   - La chute est **très lourde** en cas de défaite face à des adversaires moins bien classés ($E$ élevé $\implies -K \times E$ atteint des valeurs négatives fortes).
   - La chute est **très légère** en cas de défaite contre des cadors ($E$ très faible, perte minime).
2. **Défaite 1-2 ($S_{\text{réel}} = 0.25$)** :
   - Le joueur descend si $E > 0.25$.
   - Le set remporté amortit significativement la perte de points par rapport à un 0-2 (gain relatif de 0.25 point de performance).
3. **Victoire poussive contre des adversaires beaucoup plus faibles ("Contre-performance")** :
   - Si l'équipe est ultra-favorite ($E > 85\%$, par ex. 92%) et ne gagne que **2-1** ($S_{\text{réel}} = 0.85$) :
   - $(S_{\text{réel}} - E) = 0.85 - 0.92 = -0.07$.
   - Le joueur peut stagner ou accuser une légère baisse de niveau, l'algorithme estimant que le score n'a pas confirmé la domination attendue.

---

### 5. Tableau Comparatif des Scénarios de Match

*Exemple avec un joueur niveau **5.49** (Fiabilité **45.74%**, $K \approx 0.265$) et partenaire niveau **5.00** (Moyenne Équipe = **5.25**) :*

| Adversaires | Moyenne Adverse | Espérance $E$ | Score | Résultat Réel $S_{\text{réel}}$ | Variation $\Delta$ | Nouveau Niveau |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Plus forts** | 5.75 | 20.5% | **2 - 1** | 0.85 | **+0.17** | **5.66** |
| **Plus forts** | 5.75 | 20.5% | **2 - 0** | 1.00 | **+0.21** | **5.70** |
| **Plus forts** | 5.75 | 20.5% | **0 - 2** | 0.00 | **-0.05** | **5.44** |
| **Équilibrés** | 5.25 | 50.0% | **2 - 0** | 1.00 | **+0.13** | **5.62** |
| **Équilibrés** | 5.25 | 50.0% | **2 - 1** | 0.85 | **+0.09** | **5.58** |
| **Équilibrés** | 5.25 | 50.0% | **1 - 2** | 0.25 | **-0.07** | **5.42** |
| **Équilibrés** | 5.25 | 50.0% | **0 - 2** | 0.00 | **-0.13** | **5.36** |
| **Plus faibles** | 4.75 | 79.5% | **0 - 2** | 0.00 | **-0.21** | **5.28** |
| **Plus faibles** | 4.75 | 79.5% | **2 - 0** | 1.00 | **+0.05** | **5.54** |

---

### 6. Classement Duo & Paires Officielles (ELO Padel)

Pour les tournois et les confrontations de binômes officiels, un indice **ELO d'équipe** est généré :
$$ELO_{\text{initial}} = 1000 + (\bar{N}_{\text{équipe}} \times 100)$$

*(Exemple : une paire avec une moyenne d'équipe de 5.25 débute à **1525 points ELO**).*

---

## 📄 Licence
Distribué sous licence MIT.
