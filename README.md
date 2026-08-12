# Cortex

Cortex est une interface web locale de visualisation et de pilotage de workflows
multi-agents. Elle détecte les agents déclarés dans un projet, représente leur
enchaînement, permet de suivre leur état d’exécution et laisse l’utilisateur
contrôler les résultats transmis d’un agent au suivant.

Cortex n’est pas un modèle d’intelligence artificielle et ne remplace pas les
outils existants. Il s’appuie sur les installations et les sessions locales de
Codex, Claude ou GitHub Copilot, puis leur ajoute une interface et un protocole
d’orchestration communs.

## Objectifs

Cortex poursuit cinq objectifs principaux :

1. **Rendre un workflow multi-agent lisible** : afficher les agents, leurs
   instructions, leur configuration, leur ordre et leur état.
2. **Garder l’humain dans la boucle** : chaque agent est lancé explicitement et
   l’utilisateur choisit les résultats à transmettre lorsque plusieurs options
   sont proposées.
3. **Uniformiser plusieurs écosystèmes** : présenter de la même manière les
   agents Codex, Claude et GitHub Copilot sans imposer un nouveau format de
   configuration.
4. **Conserver le contexte utile** : maintenir une conversation propre à chaque
   agent et à chaque projet pendant l’exécution de l’application.
5. **Rendre l’orchestration extensible** : isoler les moteurs, les formats de
   fichiers, les cas d’usage et l’interface afin de pouvoir ajouter des moteurs,
   des outils et de nouveaux types de workflows.

## Fonctionnement actuel

### 1. Chargement d’un projet

L’utilisateur enregistre un répertoire local dans Cortex. Le projet est reconnu
par la présence, à sa racine, d’un des répertoires suivants :

| Moteur | Répertoire | Définition des agents | Instructions globales |
| --- | --- | --- | --- |
| Codex | `.codex/` | fichiers `.toml` dans `.codex/agents/` | `AGENTS.md` |
| Claude | `.claude/` | fichiers `.md` dans `.claude/agents/` | `CLAUDE.md` |
| GitHub Copilot | `.github/` | fichiers `.agent.md` dans `.github/agents/` | `AGENTS.md` |

Un projet doit déclarer **un seul moteur**. Cortex refuse donc un projet qui
contient plusieurs de ces trois répertoires de configuration. Le fichier
d’instructions globales est lu à la racine du projet ; son absence n’empêche pas
le chargement.

Pour Codex, le nom et la description peuvent provenir du fichier de l’agent ou
de son enregistrement dans `.codex/config.toml`. Les instructions sont lues dans
`developer_instructions`. Pour Claude et Copilot, le nom, la description, le
modèle et l’effort de raisonnement sont lus depuis le frontmatter Markdown, et le
corps du fichier constitue le prompt de l’agent.

### 2. Construction du workflow

Le workflow affiché est actuellement **linéaire**. Lorsqu’un projet comporte
plusieurs agents, Cortex demande au moteur associé de proposer un ordre à partir
des instructions globales et des métadonnées de chaque agent. Ce classement est
validé strictement, puis mis en cache avec un hash du contenu analysé. Si le
classement ne peut pas être calculé ou validé, l’ordre des fichiers est conservé.

### 3. Exécution supervisée

Les agents sont lancés manuellement depuis leur carte. Cortex affiche leur état
(`idle`, `running` ou `failed`), leur conversation, leur modèle et leur effort de
raisonnement lorsqu’ils sont configurés. Une précision peut être ajoutée avant
une première exécution ou lors d’une relance.

À partir du deuxième agent, l’exécution dépend du résultat structuré de l’agent
précédent :

- un résultat unique est transmis automatiquement ;
- plusieurs résultats imposent une sélection de l’utilisateur ;
- la sélection multiple n’est possible que si l’agent précédent l’autorise
  explicitement ;
- les notes de l’agent restent informatives et ne sont jamais transmises au
  suivant ;
- relancer un agent invalide les résultats des agents placés après lui.

Les sessions et conversations sont isolées par projet et par agent. Elles sont
conservées en mémoire tant que le serveur Cortex fonctionne. La liste des
projets et le classement calculé sont, eux, persistés dans
`cortex/config.json`, fichier local ignoré par Git.

## Contrat de réponse des agents

Cortex ajoute aux prompts un contrat JSON commun. La réponse finale d’un agent
doit respecter exactement cette structure :

```json
{
  "status": "success",
  "items": [
    { "content": "Résultat transmissible" }
  ],
  "isMultiSelectionAllowed": false,
  "notes": null
}
```

Règles du contrat :

- `status` vaut `success`, `partial`, `blocked` ou `error` ;
- `items` contient uniquement les résultats susceptibles d’alimenter l’agent
  suivant ;
- `isMultiSelectionAllowed` vaut `true`, `false` ou `null` lorsque la
  cardinalité ne s’applique pas ou reste incertaine ;
- `notes` contient un complément destiné à l’utilisateur, jamais au prochain
  agent ;
- aucune propriété supplémentaire ni aucun texte autour de l’objet JSON ne sont
  acceptés.

## Architecture

Le code applicatif se trouve dans `cortex/` :

```text
cortex/
├── src/
│   ├── front/                 Interface React et clients HTTP
│   ├── back/
│   │   ├── application/
│   │   │   ├── mapper/       Lecture des formats Codex, Claude et Copilot
│   │   │   ├── service/      Projets, moteurs IA et outils d’agents
│   │   │   └── usecase/      Règles d’orchestration
│   │   └── infrastructure/   API Express, contrôleurs et erreurs HTTP
│   └── shared/               Contrats partagés entre le front et le back
├── public/                    Ressources statiques
└── vite.config.ts             Construction du front et proxy de développement
```

Le front React communique avec une API Express. Les fournisseurs de moteurs
implémentent tous le contrat `AgentProvider`. Codex et Claude sont exécutés par
leur CLI locale ; Copilot utilise `@github/copilot-sdk`. Le serveur écoute sur le
port `3000` et sert le build Vite en production.

## Installation et lancement

### Prérequis

- Node.js `^20.19.0` ou `>=22.12.0` ;
- npm ;
- au moins un moteur installé et authentifié localement : Codex, Claude ou
  GitHub Copilot.

Depuis le répertoire `cortex/` :

```powershell
npm install
```

Pour le développement, lancer le back et le front dans deux terminaux :

```powershell
npm run dev
```

```powershell
npm run web
```

L’interface Vite utilise automatiquement `http://localhost:3000` pour les
requêtes `/api`. Pour construire le front puis démarrer le serveur complet :

```powershell
npm start
```

## Règles de développement

### Principes

1. **Respecter les formats natifs.** Une évolution ne doit pas obliger les
   projets utilisateurs à dupliquer leurs agents dans un format propre à
   Cortex.
2. **Préserver le contrôle humain.** Une décision ambiguë, une sélection ou une
   action sensible doit rester visible et explicite dans l’interface.
3. **Ne jamais mélanger les contextes.** L’état d’exécution, les sessions et les
   conversations doivent rester isolés par projet et par agent.
4. **Valider toutes les frontières.** Les entrées HTTP, les fichiers de
   configuration et les réponses des moteurs sont des données non fiables et
   doivent être vérifiés avant usage.
5. **Prévoir un comportement de repli.** Une fonctionnalité assistée par IA,
   comme le classement, ne doit pas rendre le projet inutilisable si le moteur
   renvoie une réponse invalide.
6. **Ne pas persister de secret.** Cortex réutilise les mécanismes
   d’authentification des outils locaux. Aucun jeton ne doit être écrit dans le
   dépôt ou dans `config.json`.

### Conventions de code

- utiliser TypeScript en mode strict et conserver les imports ESM explicites
  avec leur extension `.ts` ;
- garder les composants React centrés sur l’affichage et les interactions, et
  placer les appels HTTP dans `src/front/services/` ;
- placer les règles métier dans les cas d’usage, les accès externes dans les
  services et l’adaptation HTTP dans l’infrastructure web ;
- ajouter un nouveau moteur derrière l’interface `AgentProvider` et un mapper
  dédié à son format, sans introduire de condition propre au fournisseur dans
  le front ;
- utiliser `ValidationError` ou `NotFoundError` pour les erreurs attendues et
  les convertir en réponses HTTP via les mappers existants ;
- maintenir la compatibilité du contrat `AgentResponsePayload` entre le back et
  le front ;
- conserver les libellés visibles en français et les éléments d’accessibilité
  (`label`, `aria-*`, navigation clavier) lors des changements d’interface ;
- accompagner toute nouvelle règle d’orchestration d’un test automatisé ciblé.

### Validation avant contribution

Toute modification doit au minimum passer les commandes suivantes :

```powershell
npm test
npm run typecheck
npm run build
```

Une contribution est considérée comme terminée lorsque le comportement attendu
est testé, que le typage strict passe, que le front se construit et que la
documentation reflète toute modification de format, de configuration ou de
workflow.

## Limites actuelles

- un projet ne peut utiliser qu’un seul moteur à la fois ;
- le workflow est une séquence, pas encore un graphe avec branches et jonctions ;
- les exécutions sont déclenchées manuellement ;
- les sessions et conversations ne survivent pas au redémarrage du serveur ;
- Cortex dépend de la disponibilité et de l’authentification des moteurs locaux.

