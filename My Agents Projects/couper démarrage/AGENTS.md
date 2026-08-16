# Projet : couper démarrage

## Objectif

Permettre à l’utilisateur d’identifier les applications qui démarrent automatiquement au lancement de son PC, de sélectionner celles dont il ne veut plus le démarrage automatique, puis de désactiver ce démarrage pour chaque application sélectionnée.

## Principes de fonctionnement

- Commencer par établir un inventaire aussi complet que possible des applications configurées pour démarrer automatiquement, en examinant les mécanismes de démarrage pertinents du système.
- Présenter les résultats sous une forme claire et sélectionnable, avec un identifiant non ambigu pour chaque entrée.
- Après la sélection de l’utilisateur, traiter chaque application indépendamment au moyen d’une instance distincte de l’agent de désactivation.
- Ne désactiver que l’entrée explicitement sélectionnée et ne pas étendre l’action à d’autres applications ou composants associés.
- Privilégier une modification ciblée et réversible lorsque le mécanisme du système le permet.
- Ne pas désinstaller l’application, supprimer ses données, arrêter ses processus en cours ou modifier ses autres paramètres.
- Signaler clairement les entrées système, de sécurité, de pilotes ou autrement sensibles, ainsi que les risques prévisibles d’une désactivation.
- Si une opération exige des droits administrateur, une intervention manuelle ou une décision supplémentaire, l’indiquer précisément sans prétendre qu’elle a réussi.
- Toute action doit être vérifiée par l’agent qui l’effectue, puis faire l’objet d’un compte rendu factuel en français.