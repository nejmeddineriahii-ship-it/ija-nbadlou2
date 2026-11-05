# Ija Nbadlou — fichiers du site

```
public/                 -> tout ce qui est publié sur ija-nbadlou.tn
  index.html            le site (favoris, tri, annonces similaires, /annonce/<id>, PWA…)
  sw.js                 service worker (installation + mode hors connexion)
  manifest.webmanifest  "Installer l'app"
  offline.html          page "pas de connexion" avec le logo
  icons/                icônes de l'app (+ logo.svg)
  _redirects            fait marcher les liens /annonce/<id> et /a-propos
  robots.txt, sitemap.xml
worker.js               (optionnel) SEO avancé : photo/titre de l'annonce dans les liens partagés + sitemap automatique
wrangler.jsonc          configuration pour déployer le Worker
```

## Deux façons de déployer

### A — Simple (sans ligne de commande)
Remplace le contenu publié par **tout le dossier `public/`** (y compris `_redirects` et le dossier `icons/`).
Ça active : favoris, tri, annonces similaires, URL par annonce (`/annonce/<id>`), bouton Partager avec ce lien, page À propos,
installation comme app, mode hors connexion, compteur de vues, notifications.

### B — Complète (recommandée pour le SEO)
Depuis ce dossier :

```
npx wrangler deploy
```

- Dans `wrangler.jsonc`, mets dans `"name"` **exactement le nom de ton Worker actuel** sur Cloudflare
  (sinon un nouveau Worker est créé et le domaine reste sur l'ancien).
- Ça ajoute : quand quelqu'un partage `/annonce/<id>` sur WhatsApp/Facebook, la **photo, le titre et la description de l'annonce**
  apparaissent dans l'aperçu, et Google les lit sans JavaScript. Le `sitemap.xml` liste automatiquement toutes les annonces disponibles.
- Si Firestore ne répond pas, le Worker retombe sur la page normale : le site ne tombe jamais à cause de lui.

## Compteur de vues : règle Firestore
Pour que les vues s'incrémentent, les règles Firestore doivent autoriser **uniquement** l'ajout de +1 sur le champ `views`.
Dans `match /listings/{id}`, ajoute (à côté de tes règles actuelles) :

```
allow update: if request.resource.data.diff(resource.data).affectedKeys().hasOnly(['views'])
              && request.resource.data.views == (('views' in resource.data) ? resource.data.views : 0) + 1;
```

Sans cette règle, le site marche normalement, mais le compteur reste à 0 (l'erreur est ignorée).

## Notifications
Elles marchent quand le site est ouvert (même en arrière-plan) : message dans l'onglet + notification du navigateur
(l'utilisateur clique « Activer les notifications » en bas de page).
Une notification **quand le téléphone est verrouillé et l'app fermée** demande Firebase Cloud Messaging + une Cloud Function : pas inclus.

## Après le déploiement
1. Ouvre une annonce : l'adresse doit devenir `ija-nbadlou.tn/annonce/…`.
2. Teste le partage : https://developers.facebook.com/tools/debug/ (colle le lien d'une annonce).
3. Search Console : renvoie `sitemap.xml`.
4. Sur téléphone : le bouton « Installer l'app » apparaît en bas de page (sur iPhone : Partager → Sur l'écran d'accueil).
