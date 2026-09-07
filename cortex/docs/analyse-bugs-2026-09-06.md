# Analyse des bugs de Cortex — 6 septembre 2026

L'audit a reproduit plusieurs défauts que les tests existants ne détectent pas : diagnostics du moteur incomplets, perte de configuration à la sauvegarde, reprise d'exécution incorrecte, état utilisateur perdu lors de la navigation et erreurs de planification. Les résultats ci-dessous portent sur le code présent dans le répertoire de travail, y compris les modifications non commitées qui existaient avant l'analyse.

L'analyse n'a pas modifié le code applicatif, les projets enregistrés ni la configuration des moteurs. Elle ajoute ce rapport et des scripts de reproduction. Le build de production a été régénéré par la commande de vérification.

## Erreur visible sur la capture

Deux problèmes distincts sont établis.

**L'incompatibilité du cache est réelle.** Sous Windows, Cortex privilégie systématiquement le Codex installé par npm lorsqu'il le trouve. Sur cette machine, ce CLI est en version **0.147.0**. Le fichier de cache local indique **0.153.4** comme version de son producteur et ses **9 modèles sur 9** ne possèdent pas `supports_parallel_tool_calls`. Un autre binaire installé avec l'extension VS Code répond **0.153.0**, mais ce n'est pas celui que Cortex sélectionne par ce chemin de code.

**Le message montré par Cortex peut masquer l'erreur qui a réellement fait échouer l'appel.** Le lanceur conserve `stdout` pendant l'exécution, puis le jette lorsque le processus termine avec un code non nul. Il ne remonte alors que `stderr`. Or Codex transmet ses événements JSON `error` et `turn.failed` sur `stdout` en mode `--json`. Ce fonctionnement est également décrit dans la [documentation officielle du mode non interactif](https://learn.chatgpt.com/docs/non-interactive-mode).

Une reproduction avec le véritable CLI 0.147.0, une copie temporaire du cache et un endpoint HTTP **strictement local** a donné :

1. Le même message `missing field supports_parallel_tool_calls at line 132 column 5` sur `stderr`.
2. Malgré ce message, `thread.started`, puis `turn.started`, et une requête reçue par le serveur local.
3. Une erreur volontaire `AUDIT_LOCAL_SENTINEL` renvoyée par ce serveur, présente dans les événements `error` et `turn.failed` sur `stdout`.
4. Le code d'échec 1. Le lanceur Cortex, testé séparément avec les mêmes canaux, ne conserve que l'avertissement et perd la cause réelle.

La même sonde sans la copie du cache ne produit plus l'erreur de schéma, mais remonte toujours le refus HTTP volontaire. **Supprimer le cache ne constitue donc pas une correction démontrée de l'échec montré dans la capture.** L'erreur fatale de cet appel historique reste inconnue faute de son flux JSON complet. Aucun appel à un modèle distant ni aucune modification du cache utilisateur n'a été nécessaire pour établir ces résultats.

Preuves : [sonde moteur](../artifacts/audit-bugs-2026-09-06/engine-probe.mts), [sortie enregistrée](../artifacts/audit-bugs-2026-09-06/engine-results.txt).

## Priorités

P1 désigne une perte de données/configuration, un résultat de workflow incorrect ou un blocage d'un parcours pris en charge. P2 désigne un défaut fonctionnel conditionnel, une dégradation de diagnostic ou de disponibilité. Aucun P0 n'est établi.

| Réf. | Priorité | Constat et conséquence |
| --- | --- | --- |
| M1 | P1 | Les erreurs JSON du moteur sont perdues : l'utilisateur reçoit un diagnostic incomplet et peut corriger la mauvaise cause. |
| M2 | P2 | Cortex sélectionne un ancien CLI npm incompatible avec le cache partagé de cette machine. |
| D1 | P1 | Enregistrer un projet efface les paramètres d'agents non représentés dans l'éditeur. |
| W1 | P1 | Relancer une instance réussie peut faire oublier une autre instance échouée et supprimer sa reprise. |
| W2 | P1 | Deux lancements amont/aval concurrents peuvent produire un workflow incohérent et un faux état inactif. |
| M3 | P1 | Les projets hors dépôt Git et hors répertoire approuvé sont acceptés par Cortex mais refusés par Codex à l'exécution. |
| U1 | P2 | Ouvrir puis quitter l'éditeur efface les choix de réponses et les instructions supplémentaires du workflow. |
| U2 | P2 | Une réponse de sauvegarde tardive ferme l'éditeur d'un autre projet. |
| S1 | P2 | Une expression cron sans occurrence est enregistrée malgré une erreur et bloque ensuite les lectures de planification. |
| S2 | P2 | Un second démarrage marque les exécutions d'une première instance active comme interrompues. |
| D2 | P2 | La conversion d'import supprime des ressources utilisées par les agents dans la copie importée. |
| D3 | P2 | Modifier une connexion MCP efface son répertoire de travail. |
| D4 | P2 | Le chargement d'un projet lit tous ses fichiers sans limite, y compris les dépendances et les gros binaires. |
| M4 | P2 | L'indicateur de disponibilité du moteur reste positif après sa disparition. |
| H1 | P2 | Un argument `--password=` vide désactive l'authentification, y compris en présence d'un mot de passe d'environnement. |

## Défauts du moteur

### M1 — L'erreur réelle disparaît lorsque le CLI échoue

Emplacement : `src/back/application/service/iaService/CliAgentProvider.ts:75`. Le parseur Codex à `providers/CodexAgentProvider.ts:111` ne reçoit jamais la sortie d'un processus en échec.

Reproduction minimale : un processus écrit `{"type":"turn.failed","error":{"message":"ACTUAL_FAILURE_SENTINEL"}}` sur `stdout`, `CACHE_WARNING_SENTINEL` sur `stderr`, puis sort avec le code 1. Cortex remonte exactement `The agent engine exited (1). CACHE_WARNING_SENTINEL` ; le vrai message est absent.

Correction recommandée : conserver séparément code de sortie, événements JSON et diagnostics ; extraire les événements d'échec avant de construire l'erreur utilisateur. Afficher une explication concise avec des détails techniques accessibles. Ne pas présenter chaque ligne `ERROR` de diagnostic comme la cause de l'arrêt.

### M2 — Le choix du binaire ne vérifie pas sa compatibilité

Emplacements : `providers/CodexAgentProvider.ts:24`, `:36`, `:45` ; logique dupliquée dans `CodexPluginService.ts:99`.

L'existence du script npm décide du binaire à utiliser, sans comparaison de versions ou option de sélection. `login status` réussit sur cette machine ; ce test confirme l'authentification, mais ne détecte pas l'incompatibilité du cache ni la capacité à exécuter une requête.

Correction recommandée : centraliser la résolution du binaire, permettre de configurer son chemin, exposer le chemin/version effectivement utilisés et vérifier les fonctionnalités attendues. Aligner les versions qui partagent le même répertoire Codex avant d'envisager une régénération contrôlée du cache. L'audit n'a pas installé, désinstallé ou mis à jour Codex.

### M3 — Un dossier de projet valide pour Cortex peut être inexécutable par Codex

Emplacement : `providers/CodexAgentProvider.ts:61`, construction des arguments et sélection du répertoire à `:81`.

Reproduction : exécuter la commande construite pour un dossier temporaire sans dépôt Git, avec une configuration isolée ne lui accordant aucune confiance. Le CLI termine immédiatement avec `Not inside a trusted directory and --skip-git-repo-check was not specified.` Aucune requête au serveur local n'est faite.

Cortex accepte la création/l'import de tels dossiers et n'initialise pas de dépôt Git. Le problème apparaît notamment avec un répertoire de projets externe ou une installation obtenue par archive. Une installation dans un dépôt approuvé peut masquer ce défaut. Cette précondition Git et son option dédiée sont documentées par [OpenAI](https://learn.chatgpt.com/docs/non-interactive-mode#git-repository-required).

Correction recommandée : définir explicitement la politique pour les projets sélectionnés dans Cortex, détecter cette précondition et la gérer avec les permissions prévues. Tester les créations/imports hors de l'arborescence du dépôt de développement.

### M4 — La disponibilité du moteur est mémorisée indéfiniment

Emplacements : `AgentService.ts:156`, `:222`.

Reproduction : faire répondre `true`, puis `false` à `provider.isAvailable()`, et appeler deux fois `getStatus()`. L'API renvoie deux fois Codex avec `error: null`, après une seule vérification de disponibilité.

Correction recommandée : renouveler la vérification à intervalles bornés et invalider l'état lors d'un échec pertinent. Permettre une actualisation explicite des moteurs après installation, déconnexion ou mise à jour.

## Perte de données et de configuration

### D1 — Sauvegarder les instructions réécrit et appauvrit les fichiers d'agents

Emplacements : `ProjectService.ts:386`, `:393`, `:889`.

Reproduction : ajouter `sandbox_mode = "read-only"` et une table `[tools]` à un agent TOML, puis enregistrer seulement une modification des instructions globales. Les paramètres supplémentaires disparaissent du fichier de l'agent. Le sérialiseur réécrit tous les agents avec seulement les champs exposés dans l'éditeur, sans fusion avec le document source.

Impact établi : perte silencieuse de configuration sur le projet existant, y compris lorsque l'agent n'a pas été modifié par l'utilisateur. La transaction protège la cohérence des écritures, mais ne protège pas contre cette perte sémantique.

Correction recommandée : préserver les propriétés inconnues et les fichiers inchangés ; modifier seulement les propriétés effectivement éditées. Ajouter un test de conservation des métadonnées TOML/frontmatter lors d'un changement des seules instructions globales.

### D2 — L'import converti supprime des ressources référencées

Emplacements : `ProjectImportConverter.ts:78`, `:200`, `:210`.

Reproduction : convertir Codex vers Claude avec `AGENTS.md`, un agent, `.codex/skills/audit/SKILL.md` et `.codex/config.toml`. Seuls `CLAUDE.md` et l'agent converti subsistent. Le prompt peut encore référencer le skill disparu.

La perte concerne **la copie importée** ; le dossier ou l'archive source reste intact. Réinitialiser certains réglages spécifiques au moteur est documenté, mais supprimer toutes les ressources sous `.codex/` ou `.claude/` laisse des dépendances de prompts insatisfaites.

Correction recommandée : convertir ou conserver les ressources utiles et signaler précisément les éléments non transférés.

### D3 — Un renommage de connexion MCP efface son `cwd`

Emplacement : `McpConfigurationService.ts:667`.

Reproduction : une connexion contient `command="node"`, `args=["server.js"]`, `cwd="C:/apps/demo"`. Lire ses détails puis modifier seulement son nom supprime `cwd`. `workingDirectory` est également supprimé par le sérialiseur.

La mutation est prouvée ; l'échec de lancement d'un script relatif est la conséquence attendue, sans avoir lancé un serveur MCP pendant l'audit. Correction : conserver les propriétés de contexte non éditées ou les prendre en charge explicitement dans le formulaire et le contrat de sauvegarde.

### D4 — Le chargement parcourt et conserve tout le projet

Emplacements : `ProjectService.ts:627`, `:647`, `:685` ; appel depuis `AgentUseCase.ts:1319`.

Reproduction : placer un binaire synthétique de 21 MiB sous `node_modules/demo/large.bin`, puis charger le projet. Son contenu complet est lu et intégré à l'arbre. Un `.env` synthétique est aussi lu. Le parcours n'utilise aucune exclusion ni limite de taille, de nombre ou de profondeur.

Impact : coût d'ouverture/rechargement élevé et risque d'épuisement mémoire pour de gros projets. L'audit n'a pas provoqué d'épuisement mémoire et ne démontre pas une exposition HTTP du `.env` : le mapping de réponse filtre ensuite les données utiles. Le polling pendant une exécution normale utilise le projet déjà chargé ; ces lectures ne se reproduisent donc pas nécessairement à chaque polling.

Correction recommandée : lire uniquement les instructions et définitions nécessaires à l'orchestration, avec des limites explicites.

Preuves détaillées de ces quatre constats : [audit stockage/HTTP](../artifacts/audit-bugs-2026-09-06/storage-http.md).

## Exécution et reprise des workflows

### W1 — Une relance individuelle fait disparaître des échecs non traités

Emplacements : `AgentUseCase.ts:742`, `:764`, `:966` ; action d'interface à `AgentCard.tsx:654`.

Reproduction : lancer trois instances, dont A et C réussissent et B échoue. Relancer A depuis sa carte. Avant : `failed`, `resumable=true`, deux réponses réussies. Après : `idle`, `resumable=false`, toujours deux réponses réussies ; B n'a été appelée qu'une seule fois. Le nouvel audit est `succeeded`.

Le code remplace les identifiants d'échec par ceux de la relance sélectionnée, puis les efface globalement. Ce parcours est accessible dans l'interface lorsqu'au moins deux instances réussies affichent les contrôles par instance.

Correction recommandée : conserver tous les échecs non traités et recalculer le statut et la reprise à partir de l'ensemble des instances, pas uniquement de la dernière requête.

### W2 — Les lancements amont et aval peuvent se contredire

Emplacements : `AgentUseCase.ts:661` et invalidation des descendants à `:2810`.

Reproduction A→B : exécuter A, lancer B avec sa réponse `INPUT_1`, puis relancer A pendant que B tourne. La fin de A efface l'état d'exécution de B sans annuler son moteur. La sonde observe simultanément `hasActiveExecutions=true`, `isProjectRunning=false`, B marqué `idle`. À sa fin, B réinsère `STALE_RESULT_FROM_INPUT_1` alors que la réponse actuelle de A est `INPUT_2`.

L'interface du même onglet bloque normalement ce chevauchement. Le serveur l'accepte cependant : appels API concurrents ou deux onglets avant actualisation suffisent. La protection doit donc exister côté serveur.

Correction recommandée : verrouiller les dépendances lors des lancements, conserver les contrôleurs actifs et associer les résultats à une version des entrées. Un résultat devenu obsolète ne doit pas pouvoir réintégrer le workflow.

Preuves : [sonde workflow](../artifacts/audit-bugs-2026-09-06/workflow-probe.mts), [sortie enregistrée](../artifacts/audit-bugs-2026-09-06/workflow-results.txt).

## Interface et navigation

### U1 — Visiter l'éditeur perd des choix utilisateur

Emplacements : `App.tsx:162`, `AgentProjectWorkspace.tsx:185`, `:354`, `AgentCard.tsx:400` et `:295`.

Reproduction Chromium : sélectionner la seconde réponse d'un agent et saisir des instructions supplémentaires ; ouvrir « Modifier le projet », puis quitter sans rien changer. Avant : choix `[false,true]` et instructions présentes. Après : choix `[true,false]` et instructions vides.

Le workspace et les cartes sont démontés pendant l'édition. Les choix et textes restent uniquement dans leurs références/états locaux. Le remount restaure les valeurs par défaut. Cela peut modifier le résultat envoyé à l'agent suivant.

Correction recommandée : conserver ces valeurs par projet, agent et réponse au-dessus de la bascule entre vues ; invalider uniquement les valeurs dont la réponse source a changé.

### U2 — Une sauvegarde d'A ferme l'éditeur de B

Emplacements : `AgentProjectEditor.tsx:502`, `App.tsx:171`.

Reproduction Chromium : lancer une sauvegarde lente d'A, revenir vers B avec Retour du navigateur, accepter le départ, ouvrir l'éditeur de B et saisir. L'arrivée de la réponse de sauvegarde d'A ferme l'éditeur de B. Son brouillon reste récupérable dans `localStorage` ; il ne s'agit pas d'une perte définitive du brouillon dans cette reproduction.

Le callback `onSaved` protège déjà le projet courant, mais `onClose` ferme l'éditeur sans vérifier qu'il appartient toujours à la sauvegarde terminée. Correction : associer la fermeture au projet et à l'instance d'édition, ou ignorer le callback d'un composant devenu inactif.

Preuve des deux parcours, API entièrement simulée : [sonde frontend](../artifacts/audit-bugs-2026-09-06/frontend-repro.mjs), [résultats](../artifacts/audit-bugs-2026-09-06/frontend-results.txt).

## Planification et démarrage

### S1 — Une planification invalide reste enregistrée après l'erreur

Emplacements : `WorkflowScheduler.ts:148`, `:269` ; recherche minute par minute dans `CronExpression.ts`.

Reproduction : enregistrer `0 0 31 2 *` activé. La syntaxe est valide, mais le 31 février n'existe pas. La sauvegarde est effectuée avant le calcul de la prochaine occurrence. La méthode renvoie une erreur tout en conservant cette planification active, et les lectures suivantes échouent également.

La recherche synchrone sur huit ans prend environ 1,3 à 4,4 secondes dans les reproductions, selon la charge, pendant lesquelles l'event loop du processus concerné est bloquée. Correction : valider la prochaine occurrence avant toute écriture, préserver la configuration précédente en cas de refus et utiliser un calcul borné plus efficace.

Preuve : [sonde planification](../artifacts/audit-bugs-2026-09-06/scheduler-probe.mts), [résultats](../artifacts/audit-bugs-2026-09-06/scheduler-results.txt).

### S2 — Un double démarrage altère les statuts de la première instance

Emplacements : `SqliteWorkflowAuditRepository.ts:81`, `:507` ; ordre de démarrage dans `server.ts:75`, `:99`.

Reproduction : ouvrir un repository A sur une base temporaire, créer une exécution et une occurrence planifiée `running`, puis ouvrir B sur cette base sans fermer A. Les deux statuts lus par A deviennent `interrupted`.

Le constructeur récupère toutes les exécutions inachevées sans vérifier que leur propriétaire est arrêté. Comme il est appelé avant `listen`, un second lancement peut altérer la base avant d'échouer sur un port déjà occupé. Cette dernière séquence est déduite du code ; aucun second serveur utilisateur n'a été démarré.

Correction recommandée : établir la propriété exclusive de l'instance/base avant de récupérer les exécutions orphelines.

### H1 — L'argument explicite de mot de passe vide est accepté comme désactivation

Emplacements : `PasswordAuthentication.ts:197`, `:214`, `server.ts:44`.

Reproduction : `readAccessPassword(readPasswordArgument(['--password=']))` renvoie `null`, sans erreur. L'argument vide prend aussi priorité sur un `CORTEX_PASSWORD` valide à cause de `??`.

Une variable vide dans une commande de lancement peut donc désactiver l'authentification alors que l'utilisateur essayait de la configurer. L'hôte par défaut reste local ; aucune exposition publique de cette installation n'est affirmée.

Correction recommandée : distinguer l'absence d'argument d'une valeur explicitement vide, et refuser cette dernière avant le démarrage.

## Deux observations supplémentaires

**Issue métier et succès technique confondus.** Un agent terminal retournant un JSON valide avec `status="error"` ou `"blocked"`, `items=[]` et une explication d'impossibilité produit un audit `succeeded` et `workflowResumable=false`. Le comportement est reproduit à `AgentUseCase.ts:869` et `:2539`. La réussite de l'appel au moteur peut être légitime, mais le contrat produit doit préciser l'état du workflow et la possibilité de reprendre lorsque sa mission a échoué. Ce point n'est pas présenté comme une panne du transport.

**Prochaine occurrence incorrecte au changement d'heure.** Pour Europe/Paris, après `2026-10-25T00:45Z`, `getNextCronOccurrence("30 2 * * *", ...)` annonce le 26 octobre, alors que `cronMatchesDate` reconnaît encore une occurrence le 25 octobre à `01:30Z`. La progression par `setMinutes()` local à `CronExpression.ts:82` saute l'heure répétée. L'anomalie démontrée concerne le calcul de la prochaine occurrence ; elle ne prouve pas que le scheduler, lorsqu'il reste actif, manque lui-même cette exécution.

## Vérifications et limites de couverture

| Contrôle | Résultat |
| --- | --- |
| TypeScript strict | Réussi. |
| Tests Node | 250 tests : 249 réussis, aucun échec, 1 ignoré sur Windows. |
| Build Vite de production | Réussi. |
| `npm audit --json` | 0 vulnérabilité signalée dans l'arbre analysé à la date de l'audit. |
| `git diff --check` | Réussi ; avertissements de conversion LF/CRLF sur des fichiers déjà modifiés. |
| Chromium, 390/700/980/1440 px | 172 scénarios : 167 réussis, aucun échec, 5 ignorés par les conditions de viewport ; durée 9,6 minutes. |

Les 5 exclusions navigateur correspondent à 3 répétitions du contrôle API des formats, exécuté seulement à 1440 px, et à 2 exclusions desktop d'un scénario mobile. [Journal de campagne](../artifacts/audit-bugs-2026-09-06/e2e-results.txt). Le rapport HTML local est également disponible dans `playwright-report/index.html`.

Les tests navigateur utilisent l'application HTTP de production avec un moteur simulé et du stockage temporaire. Plusieurs scénarios de revue interceptent directement les réponses API. Les tests du provider Codex remplacent `runCommand` et contrôlent les arguments : ils ne vérifient ni le binaire réellement installé, ni sa compatibilité avec le cache, ni les erreurs JSON d'un véritable processus.

Les nouvelles sondes établissent les défauts de concurrence, de navigation et d'intégration ci-dessus. Elles ne constituent pas une matrice complète des versions de Codex/Claude/Copilot. Aucun modèle distant n'a été sollicité, aucun serveur MCP réel n'a été lancé, et Safari/Firefox/Linux n'ont pas été testés dans cette session. L'absence de vulnérabilité npm connue ne constitue pas une certification de sécurité de l'application.

Les garanties existantes ont aussi été examinées : écriture atomique de configuration et verrou partagé dans le processus, transactions de fichiers avec rollback, contrôles de chemins et de tailles des archives, annulation et checkpoints. Les défauts présentés sont des scénarios distincts qui restent possibles malgré ces protections.

## Ordre de correction recommandé

1. **Rendre l'erreur moteur exploitable et son installation identifiable** : M1, M2, M3 et M4. Cela permettra de reproduire ensuite l'appel réel de la capture avec un diagnostic complet.
2. **Protéger les configurations et les résultats** : D1, W1 et W2, avec tests de conservation de champs et d'instances échouées.
3. **Préserver l'état de l'utilisateur et des connexions** : U1, U2, D2 et D3.
4. **Fiabiliser les tâches planifiées et le démarrage** : S1, S2, H1 et calcul au changement d'heure ; définir séparément l'issue métier du workflow.
5. **Borner le chargement des projets** : D4, puis vérifier un dépôt réaliste comportant dépendances et artefacts volumineux.

Chaque correction devrait ajouter le scénario reproduit à la suite automatisée correspondante. L'audit fournit les causes et reproductions ; aucun de ces correctifs n'est annoncé comme déjà appliqué.
