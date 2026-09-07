# Audit Cortex — projet Immobilier, 7 septembre 2026

Projet local : `c14e940a-50df-45fc-b70f-3a5c1c404804`.

## Anomalies corrigées

- Les réponses structurées `blocked` et `error` étaient enregistrées comme des réussites. Elles arrêtent maintenant la branche et mettent le dossier en échec. La réponse et la session sont conservées pour une reprise explicite, ainsi que l’événement ayant réveillé une attente. Les anciennes lignes d’historique ne sont pas réécrites.
- La sélection affichait directement ses objets JSON. Chaque résultat présente maintenant un titre et son contenu Markdown, avec prise en charge des retours à la ligne doublement échappés dans les anciens dossiers.
- Les contrôles de sélection et « Fin du workflow » étaient trompeurs pour un déclencheur asynchrone. Ils sont remplacés par une explication de la création des dossiers et de l’état de la règle. Les liaisons asynchrones ne dépendent plus du choix de branche synchrone.
- Une exécution lancée hors de l’onglet pouvait laisser « En cours » dans la barre latérale après sa fin. Le rafraîchissement du projet remet maintenant ce statut à jour.
- Une règle réactivée pouvait reprendre, au redémarrage, des résultats produits pendant sa pause. La date de réactivation est désormais persistée et borne cette reprise ; la déduplication reste conservée.
- L’archive `.ctx` perdait la liaison asynchrone interne. Cette liaison est maintenant exportée, validée et réimportée en pause, sans conversations, dossiers ni valeurs de paramètres. Les identifiants des agents sont adaptés si le moteur est converti à l’import.

## État du projet réel après intervention

Le serveur local a été redémarré. La recherche et la sélection restent terminées, les trois résultats restent présents et les quatre agents sont conservés. La règle de négociation reste en pause et aucun dossier n’a été créé. L’archive réelle a été relue pour vérifier qu’elle contient la liaison Sélection → Négociation.

Les tests de contact et de réponse utilisent exclusivement un moteur et Gmail simulés, dans un répertoire temporaire indépendant. Aucun contact d’agence n’a été effectué par cet audit.

## Points du contenu restant à résoudre avant l’usage réel

- La troisième sélection cite un bail se terminant le **30 juillet 2026**, puis le décrit comme une échéance à venir. Au 7 septembre 2026, cette justification est incorrecte. La situation locative actuelle et les données servant au classement doivent être revérifiées ; cet audit logiciel ne valide pas la disponibilité réelle des annonces.
- La sélection attribue ses sources à la recherche précédente sans établir une nouvelle vérification indépendante de chaque page.
- Le mandat saisi indique seulement une fourchette de recherche de 50 à 100 k€. Il ne précise pas l’offre initiale, les concessions et les frais autorisés que demande le prompt de négociation. Un champ rempli ne signifie donc pas que le mandat est suffisant pour négocier automatiquement.
- L’identité d’expéditeur demandée doit être rapprochée du compte mail réellement connecté avant tout envoi. Les scénarios simulés ne valident pas cette connexion réelle.

## Vérifications

Résultats : **336 tests unitaires réussis** (1 ignoré), **150 tests navigateur réussis** sur 390 et 1440 pixels (2 ignorés selon le format d’écran), puis 6 vérifications ciblées réussies après les derniers ajustements. TypeScript et compilation de production passent également.

Les tests couvrent notamment le passage recherche → sélection, la création de dossiers indépendants, la déduplication, l’accord et le refus, l’expiration d’une attente, la corrélation des réponses Gmail, le redémarrage, la reprise explicite après blocage, l’export/import et l’affichage sur mobile et grand écran. Les journaux détaillés sont conservés localement dans `data/audit-unit-tests-final.log` et `data/audit-e2e-all.log`.

Sauvegarde préalable : `data/backups/immobilier-audit-1788796407185` (projet, configuration et sauvegarde SQLite cohérente).

## Suivi du 7 septembre : trois dossiers affichés en échec

Après la simplification de l’interface et le lancement par l’utilisateur, les trois dossiers ont chacun effectué deux tentatives. Leurs dernières réponses structurées portent `status: blocked` : le Gmail connecté est `kevin.patinaud.professional@gmail.com`, tandis que l’identité initiale indique `kevin@patinaud.org`, et le mandat ne donne qu’une fourchette de recherche de 50 à 100 k€, sans les limites de négociation demandées par les instructions. Les trois agents indiquent n’avoir envoyé aucun mail. Relancer avec les mêmes paramètres reproduit ces blocages.

La correction distingue désormais **À préciser** d’une panne technique. La liste affiche la raison, et le détail propose un champ de précision avant la reprise. Les précisions explicites sont datées et persistées avec le dossier ; elles sont transmises à la session existante et aux étapes suivantes, sans modifier la veille ni les autres dossiers. Une reprise vide d’un dossier bloqué est refusée. Les anciennes réponses bloquées sont présentées correctement en lecture, sans réécrire leurs historiques ni leurs checkpoints.

Vérification locale après redémarrage : les trois identifiants sont conservés, chacun reste à deux tentatives, la veille reste terminée et aucun bilan n’a été exécuté. L’utilisateur a autorisé les deux adresses dans la conversation ; le contenu autorisé des premiers mails reste à préciser avant toute reprise réelle. Aucune reprise ni envoi réel n’a été effectué pendant cette correction.

Validation : 341 tests unitaires réussis (1 ignoré), 12 scénarios navigateur réussis sur 390 et 1440 pixels, TypeScript et compilation réussis. Les scénarios simulent les contacts et vérifient la reprise après précision, sa persistance après redémarrage, l’isolation des dossiers, l’attente avant le bilan et le maintien des véritables pannes en échec. Journaux : `data/blocked-dossiers-unit.log`, `data/blocked-dossiers-e2e.log`. Sauvegarde avant redémarrage : `data/backups/immobilier-audit-1788803053406`.

## Autonomie demandée ensuite par l’utilisateur

L’utilisateur a confirmé vouloir laisser les agents mener seuls les démarches. Les consignes du projet ont été corrigées par l’API normale d’édition : les données absentes se recherchent ou se demandent aux agences ; les premiers contacts et négociations indicatives ne nécessitent plus un mandat chiffré détaillé. Les deux adresses sont explicitement autorisées. Les signatures, paiements et engagements d’achat restent hors du périmètre autorisé. La mise à jour du projet conserve les anciens dossiers et leur historique ; la veille dispose du nouveau graphe et des valeurs enregistrées pour une prochaine exécution. Sa planification de nouvelles recherches reste désactivée comme avant cette intervention.

Le chargement a aussi révélé que l’analyse du graphe utilisait le modèle global `gpt-6-astra`, refusé par le moteur Codex local. Cortex utilise désormais pour cette analyse un modèle explicitement choisi dans le projet (`gpt-5.5` ici), sans changer la configuration globale. TypeScript et 342 tests unitaires passent (1 ignoré), dont une régression sur le choix du modèle indépendamment de l’ordre des fichiers. La réanalyse réelle a confirmé les mêmes quatre agents et la même liaison asynchrone.

Les trois dossiers ont été repris via leur API avec la nouvelle instruction d’autonomie, sans réécrire leurs snapshots ou checkpoints. Les premiers envois ont été vérifiés indépendamment dans Gmail, avec le label `SENT`, le 7 septembre 2026 vers 18:00 UTC :

| Référence | Destinataire | Identifiant Gmail du message et du fil |
| --- | --- | --- |
| 2846P | leport@ofim.fr | `1a07d071846ac4c5` |
| TAPP970803 | wringuin@citya.com | `1a07d070d35cc410` |
| 2840P | leport@ofim.fr | `1a07d0708e5ee346` |

Les trois dossiers sont maintenant `waiting`, avec un réveil horaire enregistré et une échéance au 21 septembre 2026. Aucun bilan d’accord n’a été déclenché : aucune réponse d’agence n’était encore confirmée lors de cette vérification. Les paramètres et instructions ont été enregistrés pour les prochaines exécutions. Sauvegarde avant modification : `data/backups/immobilier-audit-1788803699106`.
