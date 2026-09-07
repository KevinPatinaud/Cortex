# Audit stockage, import/export, configuration et HTTP — 6 septembre 2026

Analyse du code courant, sans modification du code applicatif ni des données utilisateur. Six constats ont été reproduits au moyen de scripts Node exécutant les classes réelles dans des répertoires temporaires dédiés. Aucun moteur IA ni serveur utilisateur n'a été lancé. Les répertoires temporaires ont été supprimés après contrôle de leur parent et de leur préfixe.

## 1. P1 — Sauvegarder un projet supprime les paramètres d'agents non représentés par l'éditeur

- Emplacements : `src/back/application/service/projectService/ProjectService.ts:386`, `:393`, `:889` ; projections également dans les mappers Codex/Claude/Copilot.
- Déclencheur : ouvrir un projet dont un agent possède des paramètres supplémentaires, modifier uniquement les instructions globales, puis enregistrer.
- Cause : chaque agent conservé est entièrement resérialisé. Le sérialiseur ne produit que `name`, `description`, `model`, l'effort et le prompt ; il ne fusionne pas les champs modifiés avec le fichier existant.
- Reproduction : création d'un projet temporaire Codex, ajout de `sandbox_mode = "read-only"` et de `[tools] web_search = false` dans le TOML, puis `saveAgentProject` avec les mêmes agents et seulement les instructions globales modifiées.
- Résultat réellement observé : le fichier devient exactement `name = "review"\ndescription = "Review"\ndeveloper_instructions = "Inspect"\n`. Les champs ajoutés ont disparu, alors que l'utilisateur ne les a pas édités.
- Impact : perte silencieuse de configuration dans les fichiers du projet existant ; le comportement lors d'une utilisation ultérieure du projet peut changer. Les commentaires et le format original sont également remplacés.
- Correction : conserver les fichiers sources/champs inconnus et appliquer les seules modifications autorisées ; tester une modification des instructions globales avec métadonnées agent supplémentaires.

## 2. P2 — Charger un projet lit intégralement tous ses fichiers, sans exclusions ni plafond

- Emplacements : `src/back/application/service/projectService/ProjectService.ts:474`, `:627`, `:647`, `:652`, `:685` ; appel depuis `src/back/application/usecase/AgentUseCase.ts:1319`.
- Déclencheur : ouvrir/recharger un dépôt contenant des dépendances installées, des artefacts de build ou de gros fichiers.
- Cause : `readProjectDirectory` parcourt récursivement tous les répertoires et `readProjectFile` exécute `readFile` sans limite. Les plafonds de l'import/export ne s'appliquent pas à ce parcours.
- Reproduction : ajout à un projet temporaire de `node_modules/demo/large.bin` contenant 21 MiB et d'un `.env` synthétique, puis appel à `getProjectContent`.
- Résultat réellement observé : l'arbre retourné contient `node_modules/demo/large.bin` avec `size: 22020096` et son contenu complet ; il contient aussi `.env`. Les octets lus sont ensuite conservés sous forme de chaînes dans l'arbre.
- Impact : ouverture/rechargement coûteux en I/O et mémoire, avec risque de blocage ou d'épuisement mémoire sur un gros dépôt. Aucun épuisement mémoire n'a été provoqué pour ce test. Ce constat ne démontre pas une exposition HTTP de `.env`, car le mapping de réponse sélectionne ensuite les données utiles.
- Nuance : le polling de l'interface pendant une exécution normale utilise le projet déjà chargé (`AgentUseCase.ts:1314-1317`) ; il ne faut pas présenter ces lectures comme nécessairement répétées toutes les secondes.
- Correction : ne lire que les instructions et fichiers de configuration réellement nécessaires ; borner taille, nombre et profondeur des lectures pertinentes.

## 3. P2 — La conversion d'import supprime tout le dossier source Codex/Claude, y compris les ressources des agents

- Emplacements : `src/back/application/service/projectService/ProjectImportConverter.ts:78`, `:79`, `:200`, `:210` ; choix automatique du moteur cible dans `src/back/application/usecase/ProjectUseCase.ts:236`.
- Déclencheur : importer un projet Codex lorsque Claude est le moteur actif, avec un prompt utilisant une ressource située dans `.codex/skills/`.
- Cause : `isSourceConfigurationFile` retourne vrai pour tous les fichiers sous `.codex/` ou `.claude/`, puis seuls les agents convertis et les instructions sont recréés. La conversion ne traite pas les autres ressources supprimées.
- Reproduction : conversion Codex → Claude de quatre fichiers : `AGENTS.md`, `.codex/agents/review.toml`, `.codex/skills/audit/SKILL.md`, `.codex/config.toml`.
- Résultat réellement observé : la sortie contient uniquement `CLAUDE.md` et `.claude/agents/review.md`. Le skill et la configuration ont disparu de la copie importée. Le prompt, lui, continue de demander l'utilisation du skill.
- Impact : projet importé incomplet, dépendances des prompts manquantes. Le dossier original/l'archive d'origine n'est pas modifié ; la perte concerne la copie importée. La suppression d'une configuration spécifique à l'ancien moteur peut être intentionnelle, mais la disparition des ressources référencées n'est pas accompagnée d'une conversion ni d'un signalement détaillé.
- Correction : classer et convertir/conserver les ressources utiles ; fournir une liste des éléments non transférés lorsque leur conversion n'est pas supportée.

## 4. P2 — Modifier une connexion MCP efface son répertoire de travail

- Emplacements : `src/back/application/service/iaService/McpConfigurationService.ts:667`, `:668` ; détails renvoyés par `getMachineConnection` dans la même classe.
- Déclencheur : renommer une connexion stdio existante dont la commande dépend de `cwd` ou `workingDirectory`.
- Cause : `toRawServer` supprime systématiquement ces deux propriétés. Le modèle d'édition ne les restitue pas, et la sérialisation ne les réintroduit jamais.
- Reproduction : configuration temporaire `[mcp_servers.demo]` avec `command="node"`, `args=["server.js"]`, `cwd="C:/apps/demo"`. Lecture des détails, puis `updateMachineConnection` pour changer uniquement le nom en `renamed`.
- Résultat réellement observé : le fichier contient seulement `[mcp_servers.renamed]`, `command` et `args`. `cwd` est absent.
- Impact : la prochaine connexion peut chercher `server.js` dans le mauvais répertoire et échouer. La mutation réelle de configuration a été reproduite ; aucun processus MCP n'a été lancé.
- Correction : conserver le répertoire de travail lors d'une édition qui ne le modifie pas, ou l'exposer explicitement dans le contrat d'édition.

## 5. P2 — Un second démarrage marque les exécutions de la première instance comme interrompues

- Emplacements : `src/back/infrastructure/audit/SqliteWorkflowAuditRepository.ts:81`, `:507` ; ordre d'initialisation dans `src/back/infrastructure/web/controller/server.ts:75` et `:99`.
- Déclencheur : relancer Cortex alors qu'une première instance travaille encore, ou démarrer une seconde instance utilisant la même base.
- Cause : le constructeur du repository appelle immédiatement `markInterruptedExecutions` sur toutes les lignes `running`, sans vérifier qu'elles appartiennent à un processus arrêté. Le serveur construit le repository avant son `listen`.
- Reproduction : ouverture d'un repository A sur une base temporaire, création d'un run et d'une occurrence planifiée `running`, ouverture d'un repository B sur cette même base sans fermer A, puis relecture depuis A.
- Résultat réellement observé : avant l'ouverture B, les deux statuts valent `running` ; après, ils valent tous deux `interrupted`, alors que A est toujours ouvert.
- Impact : faux statuts d'interruption dans l'historique et les occurrences planifiées. Pour un double lancement sur le même port, cette mutation se produit avant la détection de `EADDRINUSE` ; cette dernière séquence est déduite de l'ordre d'initialisation, sans lancement d'un second serveur utilisateur.
- Correction : établir la propriété exclusive de l'instance/base avant la récupération, puis récupérer uniquement les exécutions dont le propriétaire a réellement disparu.

## 6. P2 — `--password=` désactive silencieusement l'authentification

- Emplacements : `src/back/infrastructure/web/middleware/PasswordAuthentication.ts:197`, `:214` ; priorité argument/environnement dans `src/back/infrastructure/web/controller/server.ts:44`.
- Déclencheur : passer `--password=` avec une valeur vide, par exemple après expansion d'une variable vide.
- Cause : `readPasswordArgument` retourne la chaîne vide ; `readAccessPassword` la traite comme une absence de mot de passe et retourne `null`. L'argument vide prend aussi priorité sur un éventuel `CORTEX_PASSWORD` non vide, car le choix utilise `??`.
- Reproduction : `readAccessPassword(readPasswordArgument(['--password=']))`.
- Résultat réellement observé : `null`, sans erreur, alors que la forme `--password` sans valeur est explicitement rejetée.
- Impact : configuration de démarrage différente de l'intention de fournir un mot de passe. Ce constat n'affirme pas une exposition publique de l'installation : l'hôte par défaut reste `127.0.0.1`.
- Correction : distinguer l'absence d'argument d'un argument explicitement vide et refuser ce dernier avant de démarrer.

## Vérifications et limites

- Les six comportements ont été reproduits directement avec les modules du dépôt sous `node --import tsx --input-type=module`.
- Les fichiers de configuration, projets et bases SQLite de preuve étaient exclusivement synthétiques et temporaires.
- Aucun correctif applicatif n'a été appliqué dans cet audit. La suite globale est pilotée par l'agent principal ; elle n'a pas été relancée en doublon ici.
- Le code existant comporte déjà des protections pertinentes : validation portable des archives, limites de tailles et nombres à l'import/export, verrou partagé de configuration JSON au sein du processus, remplacement atomique, transactions de fichiers et rollback. Les constats ci-dessus portent sur des chemins et scénarios qui restent distincts de ces protections.
