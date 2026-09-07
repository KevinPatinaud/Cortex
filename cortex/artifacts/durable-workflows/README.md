# Validation des workflows asynchrones

Projet réel : **Reservation hotel - asynchrone**.

- URL : http://127.0.0.1:3000/?project=7da79ebc-d18c-4f1a-825c-9529965a1dde
- Instance testée : `31e8ea7e-09cb-46cc-9243-f2a6745456f0`.
- Historique : `f7f15f6c-91fb-4654-af57-8e39888b633f`.
- Moteur réellement exécuté : Codex, GPT-5.5, raisonnement low.
- Résultat : réservation fictive confirmée, référence DEMO-2026.

La demande initiale et deux relances fictives ont été suivies d'une confirmation
fournie depuis l'interface, puis du bilan. Les cinq exécutions appartiennent au
même historique. Le serveur a été arrêté pendant l'attente et redémarré :
l'identifiant d'instance et celui de l'attente ont été conservés. Le renvoi du
même événement après la clôture a été acquitté sans nouvelle exécution.

Preuves : `before-restart.json`, `after-restart.json`,
`live-confirmation-audit.json`, `live-result.json`, `live-verification.json`.
Les captures `wait-chromium-390.png` et `wait-chromium-1440.png` proviennent
des tests navigateur sur le serveur de test isolé.

Validation du code : `npm run check` — 313 tests réussis, 1 test ignoré,
typecheck et build réussis. Les 18 tests Playwright ciblant attente, annulation,
reprise et branches parallèles passent en 390 et 1440 pixels.

L'archive `Reservation-hotel-asynchrone.ctx` permet d'importer le projet.
Le script `scripts/create-async-demo.mts` permet de le recréer.
Pour refaire le test dans le projet existant : Réinitialiser, lancer
Suivi de réservation, puis utiliser Apporter une réponse.

Cette démonstration n'envoie aucun vrai mail. Le moteur reçoit des événements
persistants par API et gère les minuteries ; un connecteur de boîte mail réelle
reste à intégrer. La version conserve une demande active par projet, avec
plusieurs attentes indépendantes possibles dans cette demande. Les détails
du contrat et de la reprise après incident figurent dans le README principal.
