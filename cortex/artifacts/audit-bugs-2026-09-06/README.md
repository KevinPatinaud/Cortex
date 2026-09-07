# Reproductions de l'audit du 6 septembre 2026

Rapport principal : [analyse des bugs](../../docs/analyse-bugs-2026-09-06.md).

Exécuter depuis la racine du projet, avec les dépendances déjà installées :

```powershell
node --import tsx artifacts/audit-bugs-2026-09-06/engine-probe.mts
node --import tsx artifacts/audit-bugs-2026-09-06/workflow-probe.mts
node --import tsx artifacts/audit-bugs-2026-09-06/scheduler-probe.mts
node artifacts/audit-bugs-2026-09-06/frontend-repro.mjs
```

- La sonde moteur vérifie la perte d'erreurs JSON, la disponibilité mémorisée et, sous Windows avec Codex npm installé, le cache et le prérequis de répertoire. Elle copie uniquement le cache dans un répertoire temporaire et dirige les requêtes vers un serveur HTTP local qui répond volontairement 400. Aucun appel à un modèle distant. Les codes 1 des sous-processus sont attendus. Le dossier temporaire est conservé pour inspection et son chemin est affiché.
- La sonde workflow utilise des moteurs simulés et SQLite en mémoire.
- La sonde planification utilise un stockage en mémoire et règle le fuseau uniquement dans son propre processus. Elle reproduit volontairement un calcul cron lent.
- La sonde frontend utilise le build `dist` courant et Chromium Playwright. Son serveur écoute sur un port local aléatoire ; toutes les requêtes API sont simulées. Le navigateur et le serveur sont fermés à la fin.

Les fichiers `*-results.txt` contiennent les résultats observés pendant l'audit, y compris la campagne E2E complète. `storage-http.md` documente séparément six reproductions réalisées dans des projets, configurations et bases temporaires. Les sondes illustrent le comportement du code audité ; elles ne sont pas encore des tests de régression intégrés à `npm test`.
