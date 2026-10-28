const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const cssPath = path.join(projectRoot, 'public', 'css', 'app.css');
const htmlPath = path.join(projectRoot, 'public', 'index.html');
const manifestPath = path.join(projectRoot, 'public', 'manifest.json');

// 1. Backups
fs.copyFileSync(cssPath, cssPath + '.bak');
fs.copyFileSync(htmlPath, htmlPath + '.bak');
fs.copyFileSync(manifestPath, manifestPath + '.bak');
console.log('Backups created.');

// 2. Read CSS
let css = fs.readFileSync(cssPath, 'utf8');

// Replace Google Font import with Playfair Display added
css = css.replace(
  /@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=Outfit[^\n]+'\);/,
  `@import url('https://fonts.googleapis.com/css2?family=Outfit:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,700&family=Playfair+Display:ital,wght@0,500;0,600;0,700;0,800;1,600;1,700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');`
);

// Replace :root tokens
const oldRootRegex = /:root\s*\{[\s\S]*?\n\}/;
const newRoot = `:root {
  /* ── Couleurs signature The Circle Padel Club ── */
  --gold: #C5E641;                     /* Vert Lime électrique signature */
  --gold-bright: #D8FA55;              /* Lime lumineux */
  --gold-muted: #8FA828;               /* Olive lime atténué */
  --gold-glow: rgba(197, 230, 65, 0.35);
  --gold-glow-sm: rgba(197, 230, 65, 0.18);

  /* ── Fonds / Surfaces (Vert forêt profond) ── */
  --bg-canvas: #092B1D;                /* Vert forêt impérial profond */
  --bg-frame: #061E14;                 /* Vert très sombre pour barres de navigation */
  --bg-card: #0D3724;                  /* Surfaces des cartes et conteneurs */
  --bg-card-2: #12432C;                /* Cartes secondaires / surélevées */
  --bg-card-hover: #174E34;            /* Cartes au survol */
  --bg-input: #072619;                 /* Champs de saisie */
  --bg-overlay: rgba(6, 30, 20, 0.94); /* Modales, tiroirs & backdrops */
  --bg-cream: #F6F0E2;                 /* Section crème / écru doux */

  /* ── Borders ── */
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-card: rgba(197, 230, 65, 0.14);
  --border-gold: rgba(197, 230, 65, 0.45);
  --border-gold-sm: rgba(197, 230, 65, 0.22);

  /* ── Textes ── */
  --text-white: #FFFFFF;
  --text-primary: #F3F8F3;
  --text-secondary: #9EB7A7;           /* Vert sauge doux */
  --text-muted: #658171;
  --text-dark: #08331E;                /* Vert forêt très foncé pour texte sur boutons Lime */
  --text-serif: 'Playfair Display', Georgia, serif;

  /* ── Statuts ── */
  --green: #2ECC71;
  --green-bg: rgba(46, 204, 113, 0.13);
  --red: #E74C3C;
  --red-bg: rgba(231, 76, 60, 0.13);
  --amber: #F39C12;
  --amber-bg: rgba(243, 156, 18, 0.13);
  --blue: #3498DB;
  --blue-bg: rgba(52, 152, 219, 0.13);

  /* ── Gradients signature The Circle ── */
  --gradient-gold: linear-gradient(135deg, #C5E641 0%, #DCFF66 50%, #B0D72E 100%);
  --gradient-card: linear-gradient(160deg, rgba(13, 55, 36, 0.94) 0%, rgba(9, 43, 29, 0.98) 100%);
  --gradient-hero: linear-gradient(180deg, rgba(9, 43, 29, 0) 0%, rgba(9, 43, 29, 0.98) 100%);
  --gradient-btn: linear-gradient(135deg, #C5E641 0%, #B2D82D 100%);
  --gradient-btn-hover: linear-gradient(135deg, #D5F858 0%, #C5E641 100%);

  /* ── Ombres ── */
  --shadow-sm: 0 2px 12px rgba(0, 0, 0, 0.35);
  --shadow-md: 0 8px 28px rgba(0, 0, 0, 0.50);
  --shadow-lg: 0 20px 60px rgba(0, 0, 0, 0.70);
  --shadow-gold: 0 4px 20px rgba(197, 230, 65, 0.30);
  --shadow-gold-lg: 0 8px 36px rgba(197, 230, 65, 0.45);

  /* ── Transitions ── */
  --ease-fast: 0.15s ease;
  --ease-smooth: 0.28s cubic-bezier(0.4, 0, 0.2, 1);
  --ease-spring: 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);

  /* ── Rayons ── */
  --radius-sm: 8px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-xl: 28px;
  --radius-full: 9999px;
}`;
css = css.replace(oldRootRegex, newRoot);

// Replace body.light-mode tokens
const oldLightRegex = /body\.light-mode\s*\{[\s\S]*?\n\}/;
const newLight = `body.light-mode {
  --bg-canvas: #F6F0E2;                /* Crème / Écru The Circle */
  --bg-frame: #ECE4D3;
  --bg-card: #FFFFFF;
  --bg-card-2: #FBF8F2;
  --bg-card-hover: #EFE8DA;
  --bg-input: #F0E8D9;
  --bg-overlay: rgba(9, 43, 29, 0.45);

  --border-subtle: rgba(9, 43, 29, 0.08);
  --border-card: rgba(9, 43, 29, 0.10);
  --border-gold: rgba(140, 175, 30, 0.45);
  --border-gold-sm: rgba(140, 175, 30, 0.25);

  --text-white: #092B1D;
  --text-primary: #0C3423;
  --text-secondary: #4A6354;
  --text-muted: #6C8275;
  --text-dark: #FFFFFF;

  --green-bg: rgba(46, 204, 113, 0.12);
  --red-bg: rgba(231, 76, 60, 0.10);
  --amber-bg: rgba(243, 156, 18, 0.12);
  --blue-bg: rgba(52, 152, 219, 0.10);

  --gradient-card: linear-gradient(160deg, #FFFFFF 0%, #F8F4EB 100%);
  --gradient-hero: linear-gradient(180deg, rgba(246, 240, 226, 0) 0%, rgba(246, 240, 226, 0.98) 100%);
  --gradient-btn: linear-gradient(135deg, #0D3E27 0%, #072517 100%);
  --gradient-btn-hover: linear-gradient(135deg, #155234 0%, #0D3E27 100%);

  --shadow-sm: 0 2px 10px rgba(9, 43, 29, 0.04);
  --shadow-md: 0 8px 24px rgba(9, 43, 29, 0.08);
  --shadow-lg: 0 16px 40px rgba(9, 43, 29, 0.12);
  --shadow-gold: 0 4px 20px rgba(140, 175, 30, 0.20);
}`;
css = css.replace(oldLightRegex, newLight);

// Update .pala-icon-symbol & brand styles
const oldPalaIconRegex = /\.pala-icon-symbol\s*\{[\s\S]*?\}/;
const newPalaIcon = `.pala-icon-symbol {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-full);
  overflow: hidden;
  border: 1.5px solid rgba(197, 230, 65, 0.40);
  background: #0B3D24;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}`;
css = css.replace(oldPalaIconRegex, newPalaIcon);

// Append brand wrap styles & serif typography
const brandAdditions = `
/* ─── THE CIRCLE BRAND TYPOGRAPHY & HEADER ─── */
.the-circle-brand-wrap {
  display: flex;
  flex-direction: column;
  justify-content: center;
  line-height: 1.05;
}

.the-circle-title {
  font-family: 'Playfair Display', Georgia, serif;
  font-size: 19px;
  font-weight: 700;
  color: #FFFFFF;
  letter-spacing: -0.01em;
}

.the-circle-sub {
  font-family: 'Outfit', sans-serif;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.26em;
  color: var(--text-secondary);
  text-transform: uppercase;
  margin-top: 2px;
}

/* Headings with Playfair Display Serif Elegance */
.user-display-name,
.screen-title,
.login-brand-title,
.celebration-title {
  font-family: 'Playfair Display', Georgia, serif !important;
  font-weight: 700 !important;
  letter-spacing: -0.01em !important;
}
`;

css += '\n' + brandAdditions;

// Update BUTTONS:
// 1. .btn-primary-action
css = css.replace(
  /\.btn-primary-action\s*\{[\s\S]*?\n\}/,
  `.btn-primary-action {
  width: 100%;
  padding: 14px 24px;
  border-radius: var(--radius-full);
  border: none;
  background: var(--gradient-btn);
  color: #08331E;
  font-family: 'Outfit', sans-serif;
  font-size: 14.5px;
  font-weight: 700;
  text-transform: none;
  letter-spacing: 0.01em;
  transition: all var(--ease-smooth);
  box-shadow: 0 4px 18px rgba(197, 230, 65, 0.30);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}`
);

// 2. .btn-secondary-action
css = css.replace(
  /\.btn-secondary-action\s*\{[\s\S]*?\n\}/,
  `.btn-secondary-action {
  width: 100%;
  padding: 13px 24px;
  border-radius: var(--radius-full);
  border: 1.5px solid var(--gold);
  background: transparent;
  color: #FFFFFF;
  font-family: 'Outfit', sans-serif;
  font-size: 14px;
  font-weight: 700;
  text-transform: none;
  letter-spacing: 0.01em;
  transition: all var(--ease-smooth);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}`
);

// 3. .btn-primary-login
css = css.replace(
  /\.btn-primary-login\s*\{[\s\S]*?\n\}/,
  `.btn-primary-login {
  width: 100%;
  padding: 14px 24px;
  border-radius: var(--radius-full);
  border: none;
  background: var(--gradient-btn);
  color: #08331E;
  font-family: 'Outfit', sans-serif;
  font-size: 15px;
  font-weight: 700;
  transition: all var(--ease-smooth);
  margin-top: 8px;
  text-transform: none;
  letter-spacing: 0.02em;
  cursor: pointer;
}`
);

// 4. .btn-join-match
css = css.replace(
  /\.btn-join-match\s*\{[\s\S]*?\n\}/,
  `.btn-join-match {
  width: 100%;
  padding: 11px 18px;
  border-radius: var(--radius-full);
  border: none;
  background: var(--gradient-btn);
  color: #08331E;
  font-family: 'Outfit', sans-serif;
  font-size: 12.5px;
  font-weight: 700;
  transition: all var(--ease-smooth);
  text-transform: none;
  letter-spacing: 0.02em;
  cursor: pointer;
}`
);

// 5. .btn-launch-match-cta
css = css.replace(
  /\.btn-launch-match-cta\s*\{[\s\S]*?\n\}/,
  `.btn-launch-match-cta {
  position: fixed;
  bottom: 88px;
  right: 50%;
  transform: translateX(50%);
  max-width: 390px;
  width: calc(100% - 40px);
  padding: 14px 24px;
  border-radius: var(--radius-full);
  border: none;
  background: var(--gradient-btn);
  color: #08331E;
  font-family: 'Outfit', sans-serif;
  font-size: 14.5px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  box-shadow: 0 8px 32px rgba(197, 230, 65, 0.38);
  transition: all var(--ease-smooth);
  text-transform: none;
  letter-spacing: 0.02em;
  z-index: 200;
  cursor: pointer;
}`
);

// 6. .btn-new-admin-booking
css = css.replace(
  /\.btn-new-admin-booking\s*\{[\s\S]*?\n\}/,
  `.btn-new-admin-booking {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 20px;
  border-radius: var(--radius-full);
  border: none;
  background: var(--gradient-btn);
  color: #08331E;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  transition: all var(--ease-smooth);
  box-shadow: 0 4px 16px rgba(197, 230, 65, 0.28);
}`
);

// Write updated CSS
fs.writeFileSync(cssPath, css, 'utf8');
console.log('Updated app.css successfully.');

// 3. Update public/index.html (Header brand badge, Gérant header, Login header)
let html = fs.readFileSync(htmlPath, 'utf8');

// Top header brand section
html = html.replace(
  /<div class="brand-section">[\s\S]*?<span class="brand-tag">Padel Club<\/span>\s*<\/div>/,
  `<div class="brand-section">
      <div class="hayapala-logo-badge" onclick="switchViewMode('player-app')" style="cursor:pointer">
        <div class="pala-icon-symbol">
          <img src="./images/the-circle-icon.png" alt="The Circle" class="pala-head-img" />
        </div>
        <div class="the-circle-brand-wrap">
          <span class="the-circle-title">The Circle</span>
          <span class="the-circle-sub">PADEL CLUB</span>
        </div>
      </div>
    </div>`
);

// Gérant dashboard header
html = html.replace(
  /<div class="hayapala-logo-badge">\s*<div class="pala-icon-symbol">\s*<img src="\.\/images\/pwa-icon\.jpg" alt="CirclePadel" class="pala-head-img" \/>\s*<\/div>\s*<div class="hayapala-brand-text">CirclePadel <span style="font-size:13px; color:var\(--gold\); font-weight:700">Club Pro<\/span><\/div>\s*<\/div>/,
  `<div class="hayapala-logo-badge">
            <div class="pala-icon-symbol">
              <img src="./images/the-circle-icon.png" alt="The Circle" class="pala-head-img" />
            </div>
            <div class="the-circle-brand-wrap">
              <span class="the-circle-title">The Circle <span style="font-size:12px; color:var(--gold); font-family:'Outfit',sans-serif; font-weight:700">PRO</span></span>
              <span class="the-circle-sub">PADEL CLUB</span>
            </div>
          </div>`
);

// Login logo area
html = html.replace(
  /<div class="login-logo-area">[\s\S]*?<div class="login-brand-title">CirclePadel<\/div>\s*<div class="login-brand-sub">Portail Gérant &amp; Administration<\/div>/,
  `<div class="login-logo-area">
          <div class="hayapala-logo-badge" style="justify-content:center">
            <div class="pala-icon-symbol" style="width:62px; height:62px; border-width:2px">
              <img src="./images/the-circle-icon.png" alt="The Circle" class="pala-head-img" />
            </div>
          </div>
          <div class="the-circle-title" style="font-size:27px; text-align:center; margin-top:12px">The Circle</div>
          <div class="the-circle-sub" style="font-size:10px; text-align:center; letter-spacing:0.32em; margin-top:4px">PADEL CLUB</div>
          <div class="login-brand-sub" style="margin-top:8px">Portail Gérant &amp; Administration</div>`
);

// Update theme color meta
html = html.replace(
  /<meta name="theme-color" content="#[a-fA-F0-9]+" \/>/,
  `<meta name="theme-color" content="#092B1D" />`
);

fs.writeFileSync(htmlPath, html, 'utf8');
console.log('Updated index.html successfully.');

// 4. Update manifest.json
let manifest = fs.readFileSync(manifestPath, 'utf8');
manifest = manifest.replace(/"background_color":\s*"#[a-fA-F0-9]+"/, '"background_color": "#092B1D"');
manifest = manifest.replace(/"theme_color":\s*"#[a-fA-F0-9]+"/, '"theme_color": "#092B1D"');
manifest = manifest.replace(/"name":\s*"[^"]+"/, '"name": "The Circle - Padel Club"');
manifest = manifest.replace(/"short_name":\s*"[^"]+"/, '"short_name": "The Circle"');
fs.writeFileSync(manifestPath, manifest, 'utf8');
console.log('Updated manifest.json successfully.');
