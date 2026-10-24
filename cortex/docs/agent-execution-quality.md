# Qualité et continuité des exécutions

Dans un projet, ouvrir **Instructions projet → Qualité et contexte d’exécution**.
Le profil configure le dépôt réel, les valeurs par défaut du modèle et du
raisonnement, la délégation, les critères de livraison et les contrôles.

La priorité est : réglage propre à l’agent, défaut du projet, configuration du
Codex du serveur, puis défaut annoncé par le modèle. Modèle et effort résolus
sont explicitement transmis au CLI et enregistrés avant son lancement, y
compris lorsqu’une exécution échoue ensuite. Une résolution incomplète est
signalée, sans inventer un modèle. Les efforts incompatibles sont refusés.
Le catalogue reste celui du serveur ; aucun modèle de remplacement n’est choisi
silencieusement. Les versions et paramètres historiques restent consultables
dans **Historique → Afficher le détail technique**.

## Contexte et reprise

Les instructions AGENTS.md du dossier de lancement Codex sont chargées par le
moteur et ne sont plus recopiées dans la requête. Si le dépôt de travail est
distinct du dossier de définition Cortex, les instructions du projet sont
transmises une fois, avec leur rôle d’exécution et de routage explicite ; les
instructions propres au dépôt restent chargées par Codex. Les autres moteurs
reçoivent toujours les consignes partagées.

Chaque nouvelle réponse contient un dossier borné `continuity` : résumé,
décisions, preuves et travail restant dans la tâche courante. Il est transmis
aux successeurs avec les éléments sélectionnés. Ceux-ci peuvent revérifier les
sources et utiliser leurs outils. Ces données historiques n’accordent aucune
autorisation supplémentaire.

La dernière continuité est conservée dans `data/execution-quality/`, avec
écriture atomique, une clé par projet et agent et une empreinte de la mission,
des paramètres, du dépôt, du profil et des entrées. Un changement d’objectif ou
d’entrée empêche sa réutilisation. Une intervention partielle compatible peut
reprendre sa session native lors du passage suivant. Annuler ou réinitialiser
invalide la continuité avant tout nouveau passage. Les états natifs de workflow
restent repris par le mécanisme de checkpoint existant. Les dossiers isolés
n’utilisent ni ne modifient cette mémoire commune.

Un changement de dépôt ouvre une nouvelle session native et transmet le dernier
résultat comme contexte historique. Une session liée à l’ancien dossier n’est
pas présentée comme travaillant dans le nouveau dépôt.

La continuité est de la donnée privée du projet, pas une mémoire globale entre
clients ou dossiers. Elle ne remplace pas les rapports détaillés et leurs
sources. Les limites de taille sont validées avant stockage et dans le schéma
de sortie natif ; un objet malformé n’est pas partiellement restauré.

## Résultat déclaré et résultat contrôlé

L’agent fournit une preuve pour chaque critère d’acceptation demandé. Cortex
exécute lui-même les commandes de contrôle configurées pour une livraison
terminale. Les critères communs de livraison ne sont pas imposés à chaque
prérequis parallèle. Les contrôles du dépôt partagé, de publication Git et de
santé du service continuent de s’appliquer.

- **Résultat déclaré · objectif à vérifier** : les preuves sont celles de
  l’agent ; les critères visuels ou métier restent à apprécier.
- **Résultat partiel** : un critère est sans preuve, un contrôle échoue, le
  dossier manque ou du travail reste dans la tâche courante.
- **Contrôles configurés réussis** : les vérifications automatiques ont réussi,
  dans leur seul périmètre, sans critère subjectif restant à faire apprécier.
- **Bloqué/en échec** et **en attente** conservent leur sens existant.

Une déclaration `success` est ramenée à `partial` si ces conditions l’exigent.
L’historique du workflow conserve ce résultat partiel, en tenant compte de la
dernière tentative de chaque instance. Une étape technique terminée n’est plus
présentée comme la preuve d’un objectif produit atteint. Une capture seule,
un code HTTP 200 ou un push ne garantissent pas une réussite visuelle.

Les prérequis s’exécutent avant l’appel au modèle ; leur échec est audité. Les
commandes sont des exécutables et tableaux d’arguments, sans shell. Les
prérequis ont un délai de 30 secondes, les contrôles de 120 secondes. Ces bornes
ne sont pas des limites de durée des agents. Les diagnostics enregistrent le
code de sortie sans recopier stdout/stderr, qui pourraient contenir des secrets.
Configurer uniquement des vérifications proportionnées, sans publication,
envoi de message ni modification de données métier.

## Dépôts partagés et délégation

Un dépôt choisi dans le profil bénéficie de l’exclusion entre projets, même
sans entrée `executionWorkspaces` explicite. Une configuration explicite de
dépôt partagé conserve ses règles Git et santé ; le profil ne peut pas choisir
un autre dépôt pour les contourner. Comme le mécanisme existant, ce verrou
coordonne un processus serveur Cortex ; il ne remplace pas les verrous de
déploiement pour des interventions extérieures.

La délégation reste désactivée par défaut. L’option bornée active le mécanisme
natif Codex avec deux sous-agents simultanés maximum. Les consignes limitent
leur rôle à la recherche et la revue, sans écriture, publication, contact
externe ou nouvelle délégation. La concurrence est bornée par le moteur ; les
restrictions de rôle sont des consignes, pas un sandbox distinct garanti pour
chaque sous-agent. Cortex garde la maîtrise des étapes métier suivantes.

L’audit distingue les compétences déclarées par le moteur, les serveurs MCP
déclarés et les capacités observées dans ses événements. L’absence d’un nom
dans ces listes n’est jamais présentée comme la preuve que l’outil est absent.

## Mise en service et comparaison

API : `GET/PUT /api/agents/projects/:projectId/execution-policy`. Une modification
de profil pendant l’exécution du projet est refusée. Les anciens historiques
et checkpoints restent lisibles ; la colonne de profil est additive.

`python3 ops/configure-execution-quality.py --preset lunaria-website` (ou
`poulailler`) prévisualise les profils des projets nommés. `--apply` les crée
via l’API authentifiée après une sauvegarde privée ; les profils existants,
missions, horaires et quotas sont conservés. Le script réutilise le secret
local du service sans l’afficher. Les profils ne déclenchent aucun workflow.

Depuis `cortex/` :

```sh
node --import tsx scripts/benchmark-agent-execution.ts --model gpt-6.1-sol --effort xhigh --repeats 2 --output /chemin/prive/comparaison.json
```

La comparaison utilise le vrai CLI, le pipeline Cortex, des dépôts temporaires
distincts, les mêmes fichiers initiaux et les mêmes modèle/effort. L’ordre des
routes alterne. Elle conserve les artefacts, le temps et la consommation
annoncée par le CLI ; des vérifications indépendantes évaluent le code et la
fidélité aux sources. Elle respecte le contrôle de quotas existant et ne lance
aucun workflow enregistré. Le contrat JSON de continuité constitue une
différence volontaire de la route Cortex.

`--task code` ou `--task evidence` permet de répéter un scénario isolément.
Le contrat d’entrée du scénario de code précise le champ booléen `cancelled`
et fournit un exemple : une ambiguïté de données ne doit pas être interprétée
comme une différence de qualité entre les routes.

Cet échantillon fonctionnel réduit ne démontre ni un gain statistique général,
ni une supériorité artistique. Pour une décision visuelle, compléter par des
comparaisons avant/après sur les parcours concernés et une appréciation humaine.
