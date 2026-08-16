# Projet : couper application démarrage

## Objectif

Créer un système multi-agent qui recense les applications configurées pour démarrer automatiquement au lancement du PC, permet à l’utilisateur de sélectionner celles dont il ne veut plus le démarrage automatique, puis désactive leur lancement automatique.

## Fonctionnement attendu

1. Recenser toutes les applications configurées pour démarrer automatiquement, en examinant les mécanismes de démarrage pertinents du système.
2. Présenter une liste claire permettant d’identifier chaque application et, si possible, son éditeur, sa commande, son emplacement et son mécanisme de démarrage.
3. Demander explicitement à l’utilisateur de sélectionner les applications à désactiver. Ne rien modifier avant cette validation.
4. Pour chaque application sélectionnée, lancer un travailleur indépendant afin que les désactivations puissent être effectuées en parallèle, avec au maximum un travailleur par application.
5. Vérifier après chaque intervention que le démarrage automatique ciblé est effectivement désactivé.
6. Produire un bilan indiquant les réussites, les échecs, les éléments introuvables, les autorisations manquantes et les vérifications réalisées.

## Contraintes et sécurité

- Traiter le nom et la description du projet comme le besoin fonctionnel de référence.
- Ne jamais désinstaller une application, supprimer ses données, arrêter son processus en cours ou désactiver un service système sans demande explicite distincte.
- Ne modifier que les entrées correspondant aux applications expressément sélectionnées par l’utilisateur.
- Conserver suffisamment d’informations sur l’état initial pour permettre une restauration lorsque le mécanisme concerné le permet.
- Privilégier les opérations réversibles, telles que la désactivation d’une entrée, plutôt que sa suppression.
- Signaler clairement les applications essentielles au système, les logiciels de sécurité et toute cible dont la désactivation pourrait avoir des conséquences importantes.
- Ne pas contourner les protections du système. Si des droits administrateur sont nécessaires, l’indiquer et attendre l’autorisation appropriée.
- Dédupliquer les résultats lorsqu’une même application apparaît sous plusieurs noms, tout en conservant séparément ses différents mécanismes de démarrage.
- Isoler les erreurs : l’échec d’un travailleur ne doit pas interrompre les autres désactivations.
- Limiter le parallélisme à un niveau raisonnable pour éviter les conflits sur les ressources système partagées.
- Journaliser chaque cible, son état initial, l’action tentée, le résultat et son état final, sans exposer de secrets.

## Livrables

- Un inventaire structuré des applications lancées automatiquement.
- Une sélection utilisateur explicite et non ambiguë.
- Un résultat détaillé pour chaque application sélectionnée.
- Un récapitulatif final des modifications et des éventuelles actions manuelles restantes.