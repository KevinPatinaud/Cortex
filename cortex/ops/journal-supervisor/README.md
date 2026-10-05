# Surveillance du journal de Patinaud

Le projet Cortex « Surveillance et réparation du journal » vérifie chaque jour à **08:30 Europe/Paris** que l'édition du jour est accessible en HTTP 200 et porte la date du jour dans le pied de page du générateur. Il ne répare rien si cette preuve est présente. Le fuseau est conservé par Cortex, y compris lors du changement d'heure.

En cas d'absence, `recover-journal.mjs` tente un rendu depuis les données du jour, avec les textes intégraux disponibles dans l'audit. Une production encore en cours est laissée en place. Les données sont sauvegardées avant toute modification et la publication se fait par remplacement atomique. Les erreurs restantes sont confiées à l'agent, autorisé à corriger Cortex, tester, pousser un commit limité sur GitHub puis vérifier son déploiement. Ce projet ne déclenche aucun email.

Les scripts et consignes ici sont versionnés. Le projet installé, ses résultats, les articles et les agendas restent dans les dossiers ignorés par Git. La clé GitHub du serveur est une clé de déploiement en écriture limitée au dépôt Cortex; aucune clé n'est enregistrée dans ce répertoire.

`apply-journal-continuity.mjs` met à jour de façon idempotente la consigne du collecteur Agenda : une collecte partielle ou indisponible est signalée dans son bilan, mais sa restitution réussie ne bloque pas les articles et la synthèse du journal.

Sur le serveur, depuis `cortex` :

```sh
python3 ops/journal-supervisor/install.py
node --test ops/journal-supervisor/journal-supervisor.test.mjs
node ops/journal-supervisor/apply-journal-continuity.mjs
node ops/journal-supervisor/check-journal.mjs
```

L'installation utilise l'API locale et ses identifiants existants en mémoire, conserve l'identifiant du projet lors d'une mise à jour et active sa planification immédiatement. Les rapports vont dans `.cortex/journal-watch/` du projet. Le code de sortie 2 du contrôle ou de la récupération indique une publication non confirmée, pas une panne du script.

Les tests simulent une édition publiée, un HTTP 200 avec une date ancienne, une page vide, une panne HTTP, un changement de date à Paris, une production en cours et une récupération avec sauvegarde. Ils ne touchent pas au journal public. Pour le moteur Cortex, ses tests et `npm run check` restent requis avant de pousser un correctif.
