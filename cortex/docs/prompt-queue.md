# Chats et files de prompts

Le bouton **Chats et prompts**, en haut de la liste des projets, ouvre le mode
de préparation et d’exécution automatique. Il est aussi accessible à l’adresse
`http://127.0.0.1:3000/?mode=prompts`. Les workflows et leurs planifications restent
accessibles avec le bouton **Workflows**.

## Préparer des tâches

1. Cliquer sur **Nouveau chat** et écrire la première demande.
2. Cliquer sur **Envoyer** ou appuyer sur **Entrée** ; **Maj + Entrée** ajoute une
   ligne. Le chat est créé au premier envoi, avec un titre tiré de la demande,
   un dossier dédié et un modèle disponible choisi automatiquement.
3. Envoyer les prompts suivants dans l’ordre souhaité. Ils sont automatiquement
   mis en file ; Cortex les lance lorsque les deux réserves sont suffisantes.

Aucun formulaire de création ni réglage technique n’est nécessaire. Le menu
**Paramètres**, en bas de la barre latérale, contient les valeurs par défaut :
modèle, effort, dossier, démarrage automatique, quotas et nombre de chats
simultanés. Un dossier vide utilise un dossier propre à chaque chat dans
`cortex/data/prompt-chats/`. Un dossier de projet peut aussi être choisi.
Les choix sont sauvegardés et s’appliquent aux nouveaux chats ; les chats
existants conservent leur dossier, leur modèle et leur état de pause.

Le démarrage après envoi est activé par défaut. Il peut être désactivé dans les
paramètres pour préparer des chats en pause. Le bouton **Reprendre la file**
autorise ensuite leur exécution. Le menu **…** d’une conversation ouvre l’onglet
**Ce chat** des paramètres pour renommer le chat, modifier son modèle ou le
supprimer. Les statistiques détaillées des quotas restent dans les paramètres.

Chaque chat possède sa propre session Codex persistante. Les prompts suivants
reprennent cette session et son contexte ; les conversations de chats différents
restent indépendantes. Les réponses sont affichées avec leur prompt. Les prompts
en attente peuvent être modifiés ou annulés, y compris pendant le travail d’un
autre chat.

## Programmer un prompt

L’icône **horloge**, à côté du trombone, ouvre **Programmer le prompt**. La date
est remplie avec celle du jour ; choisir l’heure, et changer la date si besoin,
puis cliquer sur **Appliquer**. Le fuseau horaire du navigateur est indiqué dans
la fenêtre. Un récapitulatif apparaît dans le composeur avant l’envoi.
**Retirer la programmation** ou **Sans programmation** rétablit le fonctionnement
habituel selon les quotas. Fermer la fenêtre sans appliquer conserve le choix
précédent. Les brouillons de chats différents ont des programmations séparées.

L’heure choisie est une **heure de départ au plus tôt**. Cortex ne lance pas ce
prompt avant, même si les quotas sont suffisants. À partir de cette date, il
respecte les réserves, la pause, les créneaux disponibles et les messages
précédents du chat. Un message placé derrière un prompt programmé attend son
tour ; les autres chats peuvent continuer. Le contrôle des files a lieu toutes
les 15 secondes : le départ peut donc suivre légèrement l’heure affichée.

Dans l’historique, **Modifier la programmation** change ou retire la date d’un
prompt encore en attente, sans modifier son texte, son modèle ni ses fichiers.
Le bouton de forçage des quotas ne contourne pas une programmation future :
retirer ou avancer d’abord sa date pour l’exécuter plus tôt. Les dates passées
ou inexistantes lors d’un changement d’heure sont refusées à la saisie.

La date est enregistrée comme un instant UTC dans le prompt SQLite, et affichée
dans le fuseau horaire du navigateur. L’ordinateur et le serveur Cortex doivent
fonctionner pour exécuter les prompts. Si le serveur redémarre après la date prévue, le prompt encore en
attente redevient éligible, sans rejouer les prompts déjà terminés.

## Images et documents

Le bouton **Joindre des images ou documents** (trombone) ajoute des fichiers au
message. Il est aussi possible de les glisser dans la zone de saisie ou de coller
une image depuis le presse-papiers. Les images ont une vignette ; chaque fichier
peut être retiré avant l’envoi. Un envoi peut contenir uniquement des fichiers.
Les pièces jointes des brouillons restent propres à chaque chat tant que la page
est ouverte, et restent présentes si le transfert échoue.

Formats acceptés : PNG, JPEG, WebP, GIF, PDF, Word, Excel, PowerPoint, OpenDocument,
RTF et fichiers texte (TXT, Markdown, CSV, JSON, XML, YAML, HTML, LOG). Limites :
**10 fichiers par prompt**, **20 Mo par fichier**, **50 Mo au total**. Un fichier
vide ou un format non pris en charge est refusé.

Après l’envoi, les fichiers sont conservés avec leur prompt dans
`cortex/data/prompt-attachments/`, y compris pendant l’attente des quotas et après
un redémarrage. Les images passent par l’option native `--image` de Codex, au
premier message comme lors des reprises. Les documents sont transmis dans leur
format d’origine : le moteur reçoit leurs chemins locaux et doit lire leur
contenu avec ses outils. Cortex n’effectue pas d’OCR ni de conversion bureautique
lui-même ; la lecture dépend des capacités et outils disponibles pour Codex. Une
impossibilité de lecture doit être signalée par le moteur.

Dans l’historique, cliquer sur une image l’ouvre ; les documents sont proposés au
téléchargement. Ces accès utilisent l’authentification Cortex et sont limités aux
fichiers du prompt concerné. Annuler un prompt conserve ses pièces jointes dans
l’historique ; supprimer le chat supprime ses copies enregistrées par Cortex,
sans toucher aux fichiers d’origine sur le poste.

## Modèle et réflexion

Le sélecteur au bas de la zone de saisie affiche le modèle et le niveau de
réflexion. Un clic ouvre les deux choix, sans devoir passer par les paramètres.
Les modèles viennent du catalogue du CLI Codex installé sur le serveur ; les
niveaux proposés sont uniquement ceux pris en charge par le modèle choisi. Si
un changement de modèle rend le niveau précédent incompatible, son niveau par
défaut est sélectionné. Un choix de brouillon reste propre à chaque chat.

Le catalogue est relu à l’ouverture du sélecteur lorsque sa lecture date de plus
de cinq secondes, au retour dans la fenêtre et toutes les 60 secondes lorsque
la page est visible. Ces lectures ne lancent aucune inférence. Un échec de
lecture reste visible ; un modèle enregistré absent du catalogue est conservé
et signalé, puis doit être remplacé explicitement avant un nouvel envoi.

### Mise à jour automatique du moteur Codex

Cortex vérifie la dernière version **stable** du paquet officiel `@openai/codex`
au démarrage, puis toutes les six heures. La consultation du catalogue peut
également déclencher cette vérification lorsqu’elle est échue. Le téléchargement
et l’installation ont lieu en arrière-plan dans `cortex/data/codex-runtime/`,
sans modifier l’installation npm globale, la connexion ou le fichier de
configuration Codex de l’utilisateur. Les versions alpha ne sont pas installées
automatiquement et un moteur plus récent n’est pas rétrogradé.

La nouvelle version est testée avec `--version`, les options nécessaires à
`exec` et `exec resume`, et une lecture réelle du catalogue, sans inférence.
Cortex attend la fin des exécutions en cours avant
de l’activer. Les fichiers des anciennes versions restent disponibles pour les
processus qui les utilisent. Une erreur réseau, d’installation ou de validation
conserve le moteur précédent ; une nouvelle tentative est prévue cinq minutes
plus tard. Le passage à une version validée utilise un pointeur atomique
`current.json`, partagé par l’exécution, les modèles, les quotas et les plugins.

Le sélecteur affiche la version du CLI et l’état de la mise à jour. Pendant
l’installation ou l’attente d’une activation, le catalogue est relu toutes les
trois secondes lorsque la page est visible. Le bouton **Actualiser les modèles**
demande également une vérification immédiate du moteur. Les choix des prompts
déjà préparés ne sont pas remplacés. La liste reste issue du compte Codex
connecté : mettre à jour le CLI n’ajoute pas de droits à des modèles réservés à
un autre abonnement ou espace de travail.

API : `GET /api/codex-engine` lit l’état sans déclencher d’installation ;
`POST /api/codex-engine/check` (JSON) demande une vérification en arrière-plan
et renvoie l’état courant avec HTTP 202. Ces routes utilisent la même
authentification que Cortex. `CORTEX_CODEX_RUNTIME_DIRECTORY` permet de choisir
un autre dossier de stockage du moteur si nécessaire.

Chaque prompt enregistre son modèle et son niveau lors de l’envoi. Changer le
sélecteur s’applique aux messages suivants, y compris pendant une exécution.
Les prompts déjà en file et celui en cours conservent leurs choix. Le dernier
choix envoyé devient la préférence du chat pour ses messages suivants.
Si un modèle d’un ancien prompt est désormais refusé par Codex, ce prompt peut
être annulé puis renvoyé dans le même chat avec un modèle disponible.

À la création, Cortex
enregistre le modèle configuré s’il est proposé par le catalogue ; sinon il
utilise le modèle recommandé par ce catalogue. Le choix est visible dans les paramètres du chat.
Un modèle explicitement enregistré n’est jamais remplacé automatiquement, et
la configuration globale du CLI n’est pas modifiée. Le dossier peut
être utilisé sans dépôt Git et sans déclaration d’agents Cortex.

## Quotas et parallélisme

Les seuils par défaut sont **50 % disponibles sur cinq heures** et **10 % sur la
semaine**. Il faut respecter les deux seuils ; l’égalité est autorisée. Une lecture
incomplète ou indisponible empêche également les départs automatiques. Ce contrôle reste
obligatoire pour les départs automatiques, même si l’option globale de contrôle des lancements des
workflows est désactivée. Les seuils de réserve sont partagés avec les réglages
généraux des quotas.

À chaque envoi, les quotas sont actualisés. Si une réserve est sous son seuil
ou ne peut pas être vérifiée, une fenêtre **Prompt placé en file d’attente**
affiche les réserves et leurs seuils. **Garder en file d’attente**, ou la touche
**Échap**, conserve le prompt sans le lancer. Il partira automatiquement lorsque
les réserves seront suffisantes, si son chat est actif.

**Forcer l’exécution maintenant** autorise uniquement cette tentative, sans
modifier les seuils ni autoriser les prompts suivants. Cette action reste aussi
accessible sur le premier prompt en attente lorsque les quotas le bloquent.
L’ordre du chat et le nombre de chats simultanés sont toujours respectés : le
bouton indique si un prompt précédent ou un créneau occupé empêche le départ.
Une exécution manuelle peut démarrer dans un chat en pause ; sa file reste en
pause. L’historique indique **Exécution forcée**. Un échec ou un redémarrage
ne réutilise pas cette autorisation. Les limites réelles du compte Codex
restent applicables : ce bouton ignore les réserves configurées dans Cortex.

Dans **Paramètres → Valeurs par défaut**, les seuils peuvent être changés entre 0 et 100 %,
et le nombre de chats simultanés entre 1 et 8 (**2 par défaut**). Avec une limite
de 1, les chats avancent à tour de rôle ; à l’intérieur d’un chat, un seul prompt
peut être exécuté à la fois.

Ce plafond respecte le paramètre général **Autoriser les exécutions simultanées**.
Quand il est désactivé, les prompts, les agents normaux et Work Force partagent
une seule file : une exécution à la fois sur tout Cortex. Quand il est activé,
des chats et agents différents peuvent avancer en parallèle, dans leurs limites
respectives. Le forçage des quotas respecte lui aussi cette file globale.
Un prompt programmé pour plus tard ou en attente de quotas ne réserve pas de
créneau ; les quotas sont revérifiés lorsqu’il obtient réellement son tour.

Le quota est relu avant chaque départ autorisé. Cortex vérifie les files toutes
les 15 secondes ; une lecture ayant refusé un départ peut être conservée pendant
60 secondes pour limiter les appels au CLI. **Vérifier les quotas** force une
nouvelle lecture et réévalue immédiatement les files. Les pourcentages sont des
réserves d’abonnement Codex, pas une estimation du coût du prochain prompt.

Une mise en pause bloque les prochains départs et laisse le prompt en cours
se terminer. **Arrêter le prompt** interrompt le moteur et met le chat en pause.
Un échec met également le chat en pause : les prompts suivants ne passent pas
devant la tâche en échec. Après vérification, elle peut être reprise dans la même
conversation ou annulée pour passer à la suite.

## Persistance et reprise

Les chats, prompts, réponses, identifiants de session, états et réglages de
concurrence et valeurs par défaut sont enregistrés dans `cortex/data/prompt-queue.sqlite` (SQLite WAL).
Les sessions de conversation elles-mêmes sont conservées par le CLI Codex local.
Les seuils restent enregistrés dans `cortex/config.json`, rubrique `codexQuota`.

Cortex peut poursuivre les files lorsque le navigateur est fermé, tant que son
serveur fonctionne. Au redémarrage, les prompts encore en attente sont conservés
et les files actives sont à nouveau évaluées. Les prompts terminés ne sont pas
relancés. Une exécution interrompue par un arrêt du serveur est signalée comme
**Interrompu** et son chat reste en pause ; sa reprise explicite réutilise la
session existante et demande au moteur de vérifier les effets déjà produits.

Limites : 200 chats conservés et 1 000 prompts par chat. La suppression d’un chat
retire son historique de la file Cortex ; elle n’efface pas les fichiers produits
dans son dossier de travail.

## API et validation

Dans une même ouverture de Cortex, les brouillons non envoyés (message, pièces
jointes, modèle et programmation) sont conservés pendant les changements de
mode. Ils restent en mémoire dans le navigateur ; rechargez la page uniquement
après les avoir envoyés si vous souhaitez les conserver. Les boutons Précédent
et Suivant du navigateur retrouvent également le chat sélectionné. Une demande
d’envoi déjà engagée reste associée à son chat si vous en consultez un autre.

Un arrêt accepté garde le statut **Annulé**, même si le moteur renvoie une
réponse tardive. Le chat reste alors en pause et les messages suivants attendent
une activation explicite.

Les routes sont regroupées sous `/api/prompt-queue` et utilisent la même
authentification que le reste de Cortex :

- `GET /` : chats, compteurs, réserves observées et réglages ;
- `POST /check` : vérification immédiate des quotas et des files ;
- `GET /settings`, `PUT /settings` : concurrence et `defaults` (`workingDirectory`, `model`, `reasoningEffort`, `autoStart`) ;
- `GET /models` : catalogue pour les valeurs par défaut ;
- `POST /chats` : `{}` suffit ; titre, dossier, modèle, effort et pause peuvent être fournis explicitement ;
- `GET`, `PATCH`, `DELETE /chats/:id` : lecture, réglages ou suppression ;
- `PUT /chats/:id/pause` : `{ "paused": false }` pour activer la file ;
- `GET /chats/:id/models` : catalogue des modèles dans le dossier du chat ;
- `POST /chats/:id/prompts` : JSON `{ "content": "Ma demande" }`, avec `model`, `reasoningEffort` et `scheduledAt` facultatifs ; `scheduledAt` est un instant ISO 8601 futur avec fuseau horaire, ou `null` pour aucun horaire ; ou multipart avec un champ JSON `message` (mêmes champs et `fileNames` dans l’ordre des fichiers) et les fichiers dans `files` ; renvoie le prompt, ses pièces jointes et `quotaWarning` (réserves, seuils et motif, ou `null`) ;
- `GET /chats/:id/prompts/:promptId/attachments/:attachmentId` : consultation d’une image ou téléchargement d’un document ;
- `PATCH /chats/:id/prompts/:promptId` : modification du `content` et/ou de `scheduledAt` d’un prompt en attente ; les champs absents sont conservés ;
- `POST /chats/:id/prompts/:promptId/cancel` et `/retry` : annulation ou reprise.
- `POST /chats/:id/prompts/:promptId/force` : démarrage manuel immédiat du premier prompt en attente, sans contrôle des réserves et sans changer les réglages ; refus si le chat travaille déjà ou si tous les créneaux sont occupés.

Les tests métier couvrent les seuils, la disponibilité des quotas, l’isolation des
sessions, la concurrence, les mises en pause et les reprises après interruption.
Les tests Playwright `tests/e2e/prompt-queue.spec.ts` passent par le véritable
serveur HTTP et le stockage SQLite, avec un moteur et des quotas simulés pour
contrôler les scénarios de récupération. Ils vérifient aussi l’accessibilité et
l’absence de débordement sur plusieurs largeurs d’écran. Les parcours
`prompt-quota-override.spec.ts` couvrent la fenêtre, le clavier, l’exécution
forcée, les quotas indisponibles et le maintien des contrôles après ce départ.
