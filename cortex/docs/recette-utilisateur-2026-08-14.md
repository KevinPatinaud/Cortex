# Recette utilisateur Cortex — 14 août 2026

## Périmètre

Campagne exécutée localement sur `http://localhost:3000` avec les cinq projets enregistrés dans `config.json`.

- Contrôles techniques : tests Node, TypeScript et build Vite.
- Contrôles d'intégration : page d'accueil et API Express.
- Parcours métier : chargement de projets, détection du moteur, exécution d'un agent simple et chaîne multi-agent.
- Actions destructives : aucune suppression ni réinitialisation confirmée sur les projets existants.

## Synthèse

- 22 tests automatisés sur 22 réussis.
- TypeScript : réussi.
- Build de production : réussi.
- 12 scénarios fonctionnels réussis.
- 1 anomalie confirmée.
- 4 scénarios visuels bloqués faute de navigateur connecté à la session.

## Résultats exécutés

| ID | Scénario | Résultat | Observation |
|---|---|---|---|
| TECH-01 | Exécuter les tests automatisés | Réussi | 22/22 tests passent. |
| TECH-02 | Vérifier les types TypeScript | Réussi | `tsc --noEmit` sans erreur. |
| TECH-03 | Compiler le client de production | Réussi | Build Vite généré sans erreur. |
| FONC-01 | Charger la page d'accueil | Réussi | HTTP 200, racine React et asset compilé présents. |
| FONC-02 | Afficher les projets enregistrés | Réussi | 5 projets retournés. |
| FONC-03 | Détecter le moteur d'agents | Réussi | Codex détecté, sans erreur. |
| FONC-04 | Lire la configuration des agents | Réussi | `autopilot=true`, `allowAll=true`. |
| FONC-05 | Charger chaque projet | Réussi | Les 5 projets répondent en HTTP 200 ; 1, 3, 1, 4 et 3 agents détectés. |
| FONC-06 | Restaurer le projet actuellement chargé | Réussi | L'API restitue le dernier projet chargé. |
| FONC-07 | Rejeter un projet inexistant | Réussi | HTTP 404. |
| FONC-08 | Rejeter une configuration invalide | Réussi | HTTP 400 ; configuration inchangée après le test. |
| FONC-09 | Rejeter ajout/suppression sans chemin | Réussi | HTTP 400 dans les deux cas, sans modification de la liste. |
| FONC-10 | Rejeter une exécution sans agent | Réussi | HTTP 400. |
| FONC-11 | Exécuter l'agent humoriste | Réussi | Réponse en 13,9 s, session créée, 2 messages et 1 thread. |
| FONC-12 | Exécuter une chaîne de 3 agents | Réussi | Ville → météo → tenue ; résultats transmis et 1 session par étape. |
| ROB-01 | Envoyer un JSON syntaxiquement invalide | Échec | HTTP 500 au lieu d'une erreur client HTTP 400. |

## Détail du parcours multi-agent

1. Le sélectionneur a proposé cinq villes en 13,2 s.
2. Le premier résultat, Kyoto, a été transmis à l'agent météo.
3. L'agent météo a répondu en 391,7 s et son état est resté `running` pendant l'attente.
4. Le résultat météo a été transmis à l'agent vestimentaire, qui a répondu en 12,2 s.
5. À la fin, les trois agents étaient `idle`, chacun avec une session et un thread.

La chaîne est fonctionnelle. La durée de 6 min 32 s pour la recherche météo constitue toutefois un risque UX : l'interface ne dispose que d'un état « en cours », sans progression détaillée ni estimation.

## Anomalie confirmée

### ROB-01 — JSON mal formé traité comme erreur serveur

- Requête : `PUT /api/agents/configuration` avec un corps JSON incomplet.
- Attendu : HTTP 400 avec un message indiquant que la requête est invalide.
- Obtenu : HTTP 500 avec une erreur interne générique.
- Sévérité proposée : moyenne.
- Cause probable : l'erreur de parsing levée par `express.json()` arrive dans le middleware générique et n'est pas reconnue comme une erreur client.

## Scénarios restant à exécuter visuellement

| ID | Scénario | Statut |
|---|---|---|
| UI-01 | Navigation réelle entre les projets, onglets Instructions/Agents et états de sélection | Bloqué — aucun navigateur connecté. |
| UI-02 | Ouverture puis annulation du sélecteur de fichier « Ajouter un projet » | Bloqué — aucun navigateur connecté. |
| UI-03 | Ouverture/annulation et focus clavier des dialogues Supprimer/Réinitialiser | Bloqué — aucun navigateur connecté. |
| UI-04 | Mise en page desktop/mobile, débordements, console et appels réseau | Bloqué — aucun navigateur connecté. |

Ces scénarios doivent être rejoués avec le navigateur intégré ou une extension Chrome connectée. Les confirmations destructives doivent rester annulées ou utiliser un projet de test dédié.
