# Cortex

Cortex est une application locale pour créer, visualiser et exécuter des workflows d'agents Codex, Claude ou GitHub Copilot. Le frontend React est servi par une API Express qui lit les configurations d'agents directement dans les projets enregistrés.

## Prérequis

- Node.js 20.19 minimum, ou Node.js 22.12 et versions ultérieures ;
- npm ;
- au moins un moteur compatible installé et authentifié (`codex`, `claude` ou GitHub Copilot).

## Démarrage

```bash
npm ci
npm start
```

L'application est alors disponible sur <http://127.0.0.1:3000>. Le fichier local `config.json` est créé au premier enregistrement et n'est pas versionné. `config.example.json` documente sa structure.

Pour le développement avec rechargement à chaud, utilisez deux terminaux :

```bash
npm run dev
npm run dev:web
```

Vite sert le frontend et redirige `/api` vers le serveur Express.

## Qualité

```bash
npm run check
```

Cette commande exécute le typage TypeScript strict, tous les tests Node et le build de production. Elle est également lancée par la CI sur chaque pull request.

## Configuration serveur

| Variable | Valeur par défaut | Description |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Interface d'écoute du serveur |
| `PORT` | `3000` | Port HTTP, entre 1 et 65535 |

Le serveur est volontairement local par défaut : les routes permettent de lire et modifier des projets présents sur la machine et ne doivent pas être exposées publiquement sans authentification ni contrôle d'accès supplémentaires.

## Structure

- `src/front` : application React et client API ;
- `src/back/application` : cas d'usage, services et fournisseurs d'agents ;
- `src/back/infrastructure` : serveur HTTP Express ;
- `src/shared` : contrats et algorithmes partagés ;
- `docs` : campagnes de recette manuelle.
