# AI Video Creator — Frontend

Interface statique (HTML/CSS/JS, sans framework ni build) qui consomme l'API du backend `ai-video-creator-backend` (déployé séparément, ex. sur Railway).

## Configuration

Avant de déployer, éditez **`config.js`** avec l'URL publique de votre backend :

```js
window.APP_CONFIG = {
  API_BASE: "https://votre-backend.up.railway.app",
};
```

En local, laissez `http://localhost:3000` (ou l'URL de votre backend local).

## Tester en local

Aucune dépendance à installer : c'est du HTML/JS statique. Servez le dossier avec n'importe quel serveur statique, par exemple :

```bash
npx serve .
# ou
python3 -m http.server 5500
```

Puis ouvrez l'URL affichée (ex: `http://localhost:5500`).

⚠️ Le backend doit autoriser cette origine dans sa variable `CORS_ORIGIN` (voir README du backend).

## Déployer

Ce dossier étant 100% statique, il se déploie sur n'importe quelle plateforme de sites statiques :

- **Vercel** : `vercel.com/new` → importez ce dépôt → Framework Preset: *Other* → Deploy.
- **Netlify** : `app.netlify.com` → *Add new site → Import an existing project* → build command vide, publish directory `.`.
- **Railway** (si vous préférez tout centraliser) : *New Project → Deploy from GitHub repo*, Railway servira les fichiers statiques (ajoutez un `Procfile` avec `web: npx serve .` ou équivalent si besoin).
- **GitHub Pages** : activez Pages sur ce dépôt, branche principale, dossier racine.

Après déploiement :
1. Récupérez l'URL de votre backend Railway.
2. Mettez-la dans `config.js` (`API_BASE`).
3. Redéployez le frontend.
4. Ajoutez l'URL du frontend dans la variable `CORS_ORIGIN` du backend, puis redéployez le backend.

## Structure

```
frontend/
  index.html
  style.css
  app.js        # logique de l'interface, appelle l'API via API_BASE
  config.js     # URL du backend à renseigner
```
