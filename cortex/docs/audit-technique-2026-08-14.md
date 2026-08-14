# Audit technique — 14 août 2026

## Synthèse

Le produit possède une base fonctionnelle solide : TypeScript strict, séparation frontend/backend lisible, cas d’usage testés et aucune vulnérabilité npm connue après mise à jour du verrou. L’intervention a ciblé les écarts qui empêchaient surtout une exploitation et une contribution fiables.

## Corrections réalisées

| Priorité | Constat | Action |
| --- | --- | --- |
| P0 | Le script `test` ignorait 7 tests existants. | Découverte automatique de tous les fichiers `src/**/*.test.ts` ; 44 tests exécutés après ajout des nouveaux cas. |
| P0 | Une vulnérabilité élevée `nanoid` existait dans l’arbre de développement. | Mise à jour verrouillée de la dépendance transitive ; `npm audit` retourne 0 vulnérabilité. |
| P1 | Les erreurs réseau, HTTP et JSON étaient traitées différemment par chaque appel frontend. | Client HTTP commun, erreurs typées, conservation du statut et tests des réponses invalides ou nulles. |
| P1 | Le serveur acceptait des corps JSON sans limite explicite et renvoyait une erreur 500 sur du JSON invalide. | Limite de 1 Mio, réponses 400/413 dédiées et testées. |
| P1 | Les routes API inconnues tombaient sur le fallback de la SPA. | Réponse JSON 404 dédiée sous `/api`. |
| P1 | Le serveur exposait sa signature et ne posait pas d’en-têtes de sécurité. | Suppression de `X-Powered-By`, CSP, `nosniff`, anti-frame, politique de référent et permissions. |
| P1 | Le serveur écoutait sur une constante et manquait de supervision simple. | `HOST`/`PORT` validés, écoute locale par défaut et endpoint `/api/health`. |
| P1 | Aucun pipeline ne garantissait les contrôles avant intégration. | Commande `npm run check` et workflow GitHub Actions. |
| P2 | Le dépôt versionnait le build et la configuration locale. | Ajout de `.gitignore`, modèle de configuration et retrait du suivi de `dist/` et `config.json` sans supprimer les copies locales. |
| P2 | Le projet n’avait ni guide de démarrage ni conventions d’éditeur. | README opérationnel et `.editorconfig`. |

## Vérifications finales

- `npm run typecheck` : réussi ;
- `npm test` : 44/44 tests réussis ;
- `npm run build` : réussi ;
- `npm audit` : 0 vulnérabilité ;
- test HTTP réel : healthcheck 200, route inconnue 404, JSON invalide 400, en-têtes de sécurité présents.

## Suite recommandée

1. Scinder `AgentProjectWorkspace.tsx` et `AgentUseCase.ts`, qui concentrent encore beaucoup de responsabilités, en hooks/composants et services plus ciblés.
2. Ajouter des tests d’interaction React sur les parcours critiques (création, édition, lancement et reprise d’un workflow).
3. Centraliser et sérialiser les écritures de `config.json` afin d’éviter une perte de mise à jour en cas de requêtes concurrentes.
4. Rendre les sauvegardes multi-fichiers transactionnelles ou récupérables pour éviter un projet partiellement modifié après une erreur disque.
5. Ajouter une journalisation structurée avec identifiant de requête si Cortex doit être supervisé au-delà d’un usage local.

Le binding local est une mesure de sécurité volontaire. Toute exposition réseau future doit être précédée d’une authentification et d’une politique d’autorisation, car l’application peut lire et modifier des projets sur la machine hôte.
