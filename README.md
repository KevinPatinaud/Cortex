# Cortex

Cortex est une application locale de création, de visualisation et de pilotage de
workflows Codex, Claude et GitHub Copilot. Elle prend en charge les graphes avec
branches et jonctions, les lancements manuels ou planifiés, les attentes durables
et les dossiers indépendants. Les checkpoints SQLite permettent de reprendre
explicitement une exécution interrompue.

Le code de l'application se trouve dans **cortex/**. Le
[guide de référence](cortex/README.md) décrit les fonctions, l'installation, les
limites et la configuration. Voir aussi le [guide d'architecture](cortex/docs/architecture.md)
et le [guide des automatisations](cortex/docs/workflow-automations.md).

## Démarrage

Node.js **^20.19.0 || >=22.12.0** et npm sont nécessaires. Un moteur installé et
authentifié est requis pour les fonctions IA ; la création sans IA reste disponible.

~~~powershell
cd cortex
npm ci
npm start
~~~

Pour le développement, lancer **npm run dev** et **npm run dev:web** dans deux terminaux.
L'API écoute par défaut sur **127.0.0.1:3000**.

## Maîtriser les exécutions

Chaque projet dispose d'une pause persistante. Elle bloque les nouveaux appels
IA, les plannings, les dossiers et les réveils ; les appels déjà commencés peuvent
terminer. Les réponses reçues restent conservées. Le panneau « Consommation et
limites » présente les appels, les tokens disponibles et les plafonds par journée
UTC ou par exécution. Le serveur partage un même plafond de concurrence entre
tous les projets. Les détails et limites de ces mesures figurent dans le guide.

## Validation

Depuis **cortex/** : **npm run check** vérifie le typage, les tests et le build.
**npm run check:all** ajoute les parcours navigateur aux quatre largeurs prévues.
Le workflow GitHub Actions est situé à la racine dans **.github/workflows/ci.yml**
et exécute cette campagne sur Windows et Linux.

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
   comme la construction du graphe, doit conserver les données utilisateur et
   fournir une erreur explicite si le moteur renvoie une réponse invalide.
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

