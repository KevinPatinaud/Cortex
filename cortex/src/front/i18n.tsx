import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

export type Language = "fr" | "en";
type Variables = Record<string, string | number>;

const STORAGE_KEY = "cortex.language.v1";

const fr = {
  "language.label": "Langue",
  "language.help": "Langue de l’interface",
  "language.fr": "Français",
  "language.en": "English",
  "common.close": "Fermer",
  "common.cancel": "Annuler",
  "common.delete": "Supprimer",
  "common.add": "Ajouter",
  "common.save": "Enregistrer",
  "common.saving": "Enregistrement...",
  "common.loading": "Chargement...",
  "common.unexpectedError": "Une erreur inattendue est survenue.",
  "sidebar.aria": "Gestion des projets",
  "sidebar.workspace": "Espace de travail",
  "sidebar.projects": "Projets",
  "sidebar.count": "{count} projets",
  "sidebar.hideList": "Masquer la liste des projets",
  "sidebar.showList": "Afficher la liste des projets",
  "sidebar.hide": "Masquer",
  "sidebar.change": "Changer",
  "sidebar.editing": "Édition en cours",
  "sidebar.activeProject": "Projet actif",
  "sidebar.newProject": "Nouveau projet",
  "sidebar.opening": "Ouverture...",
  "sidebar.import": "Importer un projet existant",
  "project.loadingList": "Chargement des projets...",
  "project.emptyList": "Aucun projet enregistré pour le moment.",
  "project.agentRunning": "Un agent est en cours d’exécution",
  "project.agentCompleted": "Un agent a terminé, résultat à consulter",
  "project.running": "En cours",
  "project.review": "À voir",
  "project.resetAria": "Réinitialiser le workflow de {name}",
  "project.deleteAria": "Supprimer {name}",
  "project.imported": "Le projet a été ajouté depuis son fichier d’instructions.",
  "project.deleted": "Le projet a été supprimé.",
  "project.reloaded": "Les fichiers du projet ont été rechargés.",
  "project.created": "Le projet et ses agents ont été générés.",
  "project.resetTitle": "Réinitialiser le workflow ?",
  "project.resetDescription": "Vous vous apprêtez à réinitialiser le workflow suivant :",
  "project.reset": "Réinitialiser",
  "project.resetting": "Réinitialisation...",
  "project.deleteTitle": "Supprimer ce projet ?",
  "project.deleteDescription": "Le projet sera retiré de Cortex. Les fichiers resteront présents sur le disque et ne seront pas supprimés.",
  "project.deleting": "Suppression...",
  "dialog.confirmation": "Confirmation",
  "dialog.affectedProject": "Projet concerné",
  "creation.eyebrow": "Nouvel espace de travail",
  "creation.title": "Créer un projet Cortex",
  "creation.description": "Décrivez votre projet : Cortex générera ses instructions et ses agents.",
  "creation.projectName": "Nom du projet",
  "creation.defaultName": "nouveau-projet",
  "creation.parentDirectory": "Dossier parent",
  "creation.parentHelp": "Le dossier du projet sera créé à cet emplacement.",
  "creation.engine": "Moteur d’agents",
  "creation.projectDescription": "Description du projet",
  "creation.descriptionPlaceholder": "Décrivez le projet, ses objectifs, ses utilisateurs, ses contraintes et les livrables attendus... et Cortex se chargera d'initialiser le projet pour vos.",
  "creation.descriptionHelp": "Cortex utilisera le moteur IA actif pour générer les instructions du projet et les agents adaptés.",
  "creation.previewAria": "Aperçu du projet",
  "creation.generatedStructure": "Structure générée",
  "creation.readyHelp": "Les instructions et les agents seront générés par le moteur IA actif.",
  "creation.creating": "Génération...",
  "creation.create": "Générer le projet",
  "engine.detectError": "Impossible de détecter le moteur IA.",
  "engine.saveError": "Impossible d’enregistrer la configuration des agents.",
  "engine.detecting": "Détection...",
  "engine.notConfigured": "Non configuré",
  "engine.settings": "Paramètres",
  "engine.saving": "Enregistrement...",
  "engine.autopilotHelp": "Exécuter les tâches automatiquement",
  "engine.allowAllHelp": "Sans sandbox ni confirmation en autopilot",
  "workspace.welcome": "Sélectionnez un projet dans le bandeau latéral pour afficher ses agents.",
  "workspace.project": "Projet {engine}",
  "workspace.contentAria": "Contenu du projet",
  "workspace.instructionsTab": "Instructions projet",
  "workspace.workflowTab": "Workflow ({count} {agents})",
  "workspace.agentSingular": "agent",
  "workspace.agentPlural": "agents",
  "workspace.manualAll": "Repasser tous les agents en exécution manuelle",
  "workspace.autoAll": "Enchaîner automatiquement les agents dès que leurs prérequis sont remplis",
  "workspace.editUnavailable": "L’édition sera disponible à la fin de l’exécution",
  "workspace.editTitle": "Modifier le projet et ses agents",
  "workspace.edit": "Modifier le projet",
  "workspace.instructionsFile": "Fichier d’instructions",
  "workspace.emptyFile": "Le fichier est vide.",
  "workspace.missingFile": "Le fichier {name} est introuvable à la racine du projet.",
  "workspace.noAgents": "Aucun agent n’est configuré dans ce projet.",
  "workspace.step": "Étape {number}",
  "workspace.branchEnd": "Fin de la branche",
  "schedule.button": "Planifier",
  "schedule.scheduled": "Planifié",
  "schedule.configure": "Planifier l’exécution du workflow",
  "schedule.edit": "Modifier la planification du workflow",
  "schedule.eyebrow": "Ordonnanceur",
  "schedule.title": "Planifier le workflow",
  "schedule.description": "Le serveur exécutera automatiquement tout le workflow selon cette expression cron, même si l’interface est fermée.",
  "schedule.enabled": "Planification active",
  "schedule.enabledHelp": "Désactivez-la pour conserver l’expression sans lancer le workflow.",
  "schedule.expression": "Expression cron",
  "schedule.expressionHelp": "Format à 5 champs : minute, heure, jour du mois, mois, jour de semaine.",
  "schedule.explanation": "Interprétation",
  "schedule.explanationUnavailable": "Complétez une expression cron valide pour afficher son interprétation.",
  "schedule.examples": "Exemples",
  "schedule.weekdays": "en semaine à 9 h",
  "schedule.everySixHours": "toutes les 6 heures",
  "schedule.timezone": "Fuseau horaire du serveur : {timezone}",
  "schedule.nextRun": "Prochaine exécution : {date}",
  "schedule.running": "Planifié · en cours",
  "schedule.lastRunSucceeded": "Dernière exécution réussie : {date}",
  "schedule.lastRunFailed": "Dernière exécution échouée : {date}",
  "schedule.lastRunSkipped": "Dernière exécution ignorée : {date}",
  "handoff.automatic": "Automatique",
  "handoff.manual": "Manuel",
  "handoff.current": "Mode actuel : {state}. {description}",
  "agent.responsesAria": "Réponses proposées",
  "agent.noResponse": "Aucune réponse proposée.",
  "agent.selectedBranch": "Branche sélectionnée",
  "agent.workflowEnd": "Fin du workflow",
  "agent.conversationAria": "Conversation avec {name}",
  "agent.conversation": "Conversation",
  "agent.you": "Vous",
  "agent.instance": "Instance {number}",
  "agent.activeSession": "Session active",
  "agent.instanceName": "{name}, instance {number}",
  "agent.details": "Précisions",
  "agent.instancePlaceholder": "Ajoutez une précision pour cette instance...",
  "agent.frozenInstance": "Cette instance est figée car un agent en aval a déjà été lancé.",
  "agent.rerunInstanceTitle": "Relancer l’instance {number}",
  "agent.running": "Exécution...",
  "agent.rerunInstance": "Relancer cette instance",
  "agent.parallelAria": "{name}, lancement préparé sur {count} instances parallèles",
  "agent.manual": "Repasser {name} en exécution manuelle",
  "agent.auto": "Lancer automatiquement {name} dès que les résultats requis sont prêts",
  "agent.model": "Modèle",
  "agent.reasoning": "Raisonnement",
  "agent.noDescription": "Aucune description.",
  "agent.noInstruction": "Aucune instruction.",
  "agent.instancesAria": "Instances de {name}",
  "agent.evolutionZone": "Zone d’évolution · {count} instances",
  "agent.branchesHelp": "Chaque branche possède sa propre session et peut être relancée séparément.",
  "agent.rerunPlaceholder": "Ajoutez une précision pour la prochaine relance...",
  "agent.runPlaceholder": "Ajoutez une précision avant de lancer l’agent...",
  "agent.frozen": "Cet agent est figé car un agent en aval a déjà été lancé.",
  "agent.rerunTitle": "Relancer {name}",
  "agent.runTitle": "Lancer {name}",
  "agent.emptyInstruction": "Cet agent ne contient aucune instruction.",
  "agent.rerun": "Relancer",
  "agent.run": "Lancer",
  "prerequisite.runFirst": "Exécutez d’abord « {name} ».",
  "prerequisite.waitAll": "Attendez la fin de tous les agents précédents : {names}.",
  "prerequisite.notSelected": "Cette branche n’a pas été sélectionnée par les agents précédents.",
  "prerequisite.selectMany": "Sélectionnez un ou plusieurs résultats de « {name} ».",
  "prerequisite.selectOne": "Sélectionnez un résultat de « {name} ».",
  "prerequisite.noResult": "Aucun agent précédent exécuté n’a produit de résultat transmissible.",
  "prerequisite.notReady": "Les résultats de tous les agents précédents ne sont pas encore prêts.",
  "editor.promptPlaceholder": "Décrivez précisément la mission et le résultat attendu de cet agent.",
  "editor.newAgent": "Nouvel agent {number}",
  "editor.leaveConfirm": "Quitter le mode édition et abandonner les modifications ?",
  "editor.nameRequired": "Le nom du projet est obligatoire.",
  "editor.agentRequired": "Chaque agent doit avoir un nom et des instructions.",
  "editor.saved": "Projet enregistré — le workflow est à jour.",
  "editor.mode": "Mode édition",
  "editor.workshop": "Atelier {engine}",
  "editor.draftChanged": "Brouillon modifié",
  "editor.upToDate": "À jour",
  "editor.leave": "Quitter l’édition",
  "editor.deleteProject": "Supprimer le projet",
  "editor.composition": "Composition",
  "editor.configured": "Configurées",
  "editor.toComplete": "À compléter",
  "editor.workflowPreview": "Aperçu du workflow",
  "editor.unnamed": "Sans nom",
  "editor.sections": "Sections du projet",
  "editor.library": "Bibliothèque",
  "editor.projectAgents": "Agents du projet",
  "editor.unnamedAgent": "Agent sans nom",
  "editor.missionMissing": "Mission à préciser",
  "editor.new": "Nouveau",
  "editor.emptyWorkflow": "Le workflow est vide",
  "editor.firstAgentHelp": "Créez un premier agent pour donner vie à ce projet.",
  "editor.firstAgent": "Premier agent",
  "editor.agentConfiguration": "Configuration de l’agent",
  "editor.name": "Nom",
  "editor.shortDescription": "Description courte",
  "editor.namePlaceholder": "Architecte logiciel",
  "editor.descriptionPlaceholder": "Analyse et structure la solution",
  "editor.optional": "optionnel",
  "editor.defaultModel": "Modèle par défaut",
  "editor.reasoningEffort": "Effort de raisonnement",
  "editor.default": "Par défaut",
  "editor.low": "Faible",
  "editor.medium": "Moyen",
  "editor.high": "Élevé",
  "editor.xhigh": "Très élevé",
  "editor.mission": "Mission et instructions",
  "editor.promptHelp": "Soyez explicite sur le périmètre de l’agent et le livrable attendu.",
  "editor.selectAgent": "Sélectionnez un agent",
  "editor.settingsHere": "Ses paramètres apparaîtront ici.",
  "editor.sharedContext": "Contexte partagé",
  "editor.sharedHelp": "Ces instructions sont transmises à l’ensemble du projet.",
  "editor.markdown": "Contenu Markdown",
  "editor.contextPlaceholder": "# Contexte du projet",
  "editor.improveWithAi": "Suggestion",
  "editor.improving": "Amélioration...",
  "editor.improveError": "Impossible d’améliorer cet agent avec le moteur Cortex.",
  "editor.aiSuggestion": "Suggestion du moteur Cortex",
  "editor.improvementTitle": "Comparer l’agent amélioré",
  "editor.improvementHelp": "Le moteur actif de Cortex a amélioré l’agent sélectionné en s’appuyant sur les instructions et tous les agents du projet. Vous pouvez encore modifier sa proposition avant de l’utiliser.",
  "editor.currentAgent": "Agent actuel",
  "editor.improvedAgent": "Agent amélioré",
  "editor.useImprovedAgent": "Utiliser cet agent",
  "editor.improved": "L’agent amélioré a été ajouté au brouillon.",
  "editor.deletedOnSave": "« {name} » sera supprimé à l’enregistrement."
} as const;

type TranslationKey = keyof typeof fr;

const en: Record<TranslationKey, string> = {
  ...fr,
  "editor.deleteProject": "Delete project",
  "language.label": "Language", "language.help": "Interface language", "language.fr": "Français", "language.en": "English",
  "common.close": "Close", "common.cancel": "Cancel", "common.delete": "Delete", "common.add": "Add", "common.save": "Save", "common.saving": "Saving...", "common.loading": "Loading...", "common.unexpectedError": "An unexpected error occurred.",
  "sidebar.aria": "Project management", "sidebar.workspace": "Workspace", "sidebar.projects": "Projects", "sidebar.count": "{count} projects", "sidebar.hideList": "Hide project list", "sidebar.showList": "Show project list", "sidebar.hide": "Hide", "sidebar.change": "Change", "sidebar.editing": "Editing", "sidebar.activeProject": "Active project", "sidebar.newProject": "New project", "sidebar.opening": "Opening...", "sidebar.import": "Import an existing project",
  "project.loadingList": "Loading projects...", "project.emptyList": "No projects saved yet.", "project.agentRunning": "An agent is running", "project.agentCompleted": "An agent has finished; result ready to review", "project.running": "Running", "project.review": "Review", "project.resetAria": "Reset {name} workflow", "project.deleteAria": "Delete {name}", "project.imported": "The project was added from its instruction file.", "project.deleted": "The project was deleted.", "project.reloaded": "The project files were reloaded.", "project.created": "The project and its agents were generated.", "project.resetTitle": "Reset the workflow?", "project.resetDescription": "You are about to reset the following workflow:", "project.reset": "Reset", "project.resetting": "Resetting...", "project.deleteTitle": "Delete this project?", "project.deleteDescription": "The project will be removed from Cortex. Its files will remain on disk and will not be deleted.", "project.deleting": "Deleting...",
  "dialog.confirmation": "Confirmation", "dialog.affectedProject": "Affected project",
  "creation.eyebrow": "New workspace", "creation.title": "Create a Cortex project", "creation.description": "Describe your project and Cortex will generate its instructions and agents.", "creation.projectName": "Project name", "creation.defaultName": "new-project", "creation.parentDirectory": "Parent folder", "creation.parentHelp": "The project folder will be created here.", "creation.engine": "Agent engine", "creation.projectDescription": "Project description", "creation.descriptionPlaceholder": "Describe the project, its goals, users, constraints, and expected deliverables...", "creation.descriptionHelp": "Cortex will use the active AI engine to generate the project instructions and suitable agents.", "creation.previewAria": "Project preview", "creation.generatedStructure": "Generated structure", "creation.readyHelp": "The instructions and agents will be generated by the active AI engine.", "creation.creating": "Generating...", "creation.create": "Generate project",
  "engine.detectError": "Unable to detect the AI engine.", "engine.saveError": "Unable to save the agent configuration.", "engine.detecting": "Detecting...", "engine.notConfigured": "Not configured", "engine.settings": "Settings", "engine.saving": "Saving...", "engine.autopilotHelp": "Run tasks automatically", "engine.allowAllHelp": "No sandbox or confirmation in autopilot",
  "workspace.welcome": "Select a project in the sidebar to view its agents.", "workspace.project": "{engine} project", "workspace.contentAria": "Project content", "workspace.instructionsTab": "Project instructions", "workspace.workflowTab": "Workflow ({count} {agents})", "workspace.agentSingular": "agent", "workspace.agentPlural": "agents", "workspace.manualAll": "Switch all agents back to manual execution", "workspace.autoAll": "Run agents automatically as soon as their prerequisites are met", "workspace.editUnavailable": "Editing will be available when execution finishes", "workspace.editTitle": "Edit the project and its agents", "workspace.edit": "Edit project", "workspace.instructionsFile": "Instruction file", "workspace.emptyFile": "The file is empty.", "workspace.missingFile": "The {name} file was not found in the project root.", "workspace.noAgents": "No agents are configured in this project.", "workspace.step": "Step {number}", "workspace.branchEnd": "End of branch",
  "schedule.button": "Schedule", "schedule.scheduled": "Scheduled", "schedule.configure": "Schedule workflow execution", "schedule.edit": "Edit workflow schedule", "schedule.eyebrow": "Scheduler", "schedule.title": "Schedule workflow", "schedule.description": "The server will automatically run the entire workflow using this cron expression, even when the interface is closed.", "schedule.enabled": "Schedule enabled", "schedule.enabledHelp": "Disable it to keep the expression without running the workflow.", "schedule.expression": "Cron expression", "schedule.expressionHelp": "Five-field format: minute, hour, day of month, month, day of week.", "schedule.explanation": "Interpretation", "schedule.explanationUnavailable": "Enter a valid cron expression to see its interpretation.", "schedule.examples": "Examples", "schedule.weekdays": "weekdays at 9:00 AM", "schedule.everySixHours": "every 6 hours", "schedule.timezone": "Server timezone: {timezone}", "schedule.nextRun": "Next run: {date}", "schedule.running": "Scheduled · running", "schedule.lastRunSucceeded": "Last run succeeded: {date}", "schedule.lastRunFailed": "Last run failed: {date}", "schedule.lastRunSkipped": "Last run skipped: {date}",
  "handoff.automatic": "Automatic", "handoff.manual": "Manual", "handoff.current": "Current mode: {state}. {description}",
  "agent.responsesAria": "Suggested responses", "agent.noResponse": "No response suggested.", "agent.selectedBranch": "Selected branch", "agent.workflowEnd": "End of workflow", "agent.conversationAria": "Conversation with {name}", "agent.conversation": "Conversation", "agent.you": "You", "agent.instance": "Instance {number}", "agent.activeSession": "Active session", "agent.instanceName": "{name}, instance {number}", "agent.details": "Additional instructions", "agent.instancePlaceholder": "Add instructions for this instance...", "agent.frozenInstance": "This instance is locked because a downstream agent has already run.", "agent.rerunInstanceTitle": "Rerun instance {number}", "agent.running": "Running...", "agent.rerunInstance": "Rerun this instance", "agent.parallelAria": "{name}, ready to run on {count} parallel instances", "agent.manual": "Switch {name} back to manual execution", "agent.auto": "Run {name} automatically when the required results are ready", "agent.model": "Model", "agent.reasoning": "Reasoning", "agent.noDescription": "No description.", "agent.noInstruction": "No instructions.", "agent.instancesAria": "Instances of {name}", "agent.evolutionZone": "Evolution zone · {count} instances", "agent.branchesHelp": "Each branch has its own session and can be rerun separately.", "agent.rerunPlaceholder": "Add instructions for the next run...", "agent.runPlaceholder": "Add instructions before running the agent...", "agent.frozen": "This agent is locked because a downstream agent has already run.", "agent.rerunTitle": "Rerun {name}", "agent.runTitle": "Run {name}", "agent.emptyInstruction": "This agent has no instructions.", "agent.rerun": "Rerun", "agent.run": "Run",
  "prerequisite.runFirst": "Run “{name}” first.", "prerequisite.waitAll": "Wait for all previous agents to finish: {names}.", "prerequisite.notSelected": "This branch was not selected by the previous agents.", "prerequisite.selectMany": "Select one or more results from “{name}”.", "prerequisite.selectOne": "Select a result from “{name}”.", "prerequisite.noResult": "No previous agent produced a result that can be passed on.", "prerequisite.notReady": "The results from all previous agents are not ready yet.",
  "editor.improveWithAi": "Suggestion",
  "editor.improving": "Improving...",
  "editor.improveError": "Unable to improve this agent with the Cortex engine.",
  "editor.aiSuggestion": "Cortex engine suggestion",
  "editor.improvementTitle": "Compare the improved agent",
  "editor.improvementHelp": "Cortex's active engine improved the selected agent using the project instructions and every agent as context. You can edit its suggestion before using it.",
  "editor.currentAgent": "Current agent",
  "editor.improvedAgent": "Improved agent",
  "editor.useImprovedAgent": "Use this agent",
  "editor.improved": "The improved agent was added to the draft.",
  "editor.promptPlaceholder": "Describe this agent’s mission and expected result precisely.", "editor.newAgent": "New agent {number}", "editor.leaveConfirm": "Leave edit mode and discard your changes?", "editor.nameRequired": "The project name is required.", "editor.agentRequired": "Every agent must have a name and instructions.", "editor.saved": "Project saved — the workflow is up to date.", "editor.mode": "Edit mode", "editor.workshop": "{engine} workshop", "editor.draftChanged": "Draft changed", "editor.upToDate": "Up to date", "editor.leave": "Leave editing", "editor.composition": "Composition", "editor.configured": "Configured", "editor.toComplete": "To complete", "editor.workflowPreview": "Workflow preview", "editor.unnamed": "Unnamed", "editor.sections": "Project sections", "editor.library": "Library", "editor.projectAgents": "Project agents", "editor.unnamedAgent": "Unnamed agent", "editor.missionMissing": "Mission to define", "editor.new": "New", "editor.emptyWorkflow": "The workflow is empty", "editor.firstAgentHelp": "Create a first agent to bring this project to life.", "editor.firstAgent": "First agent", "editor.agentConfiguration": "Agent configuration", "editor.name": "Name", "editor.shortDescription": "Short description", "editor.namePlaceholder": "Software architect", "editor.descriptionPlaceholder": "Analyzes and structures the solution", "editor.optional": "optional", "editor.defaultModel": "Default model", "editor.reasoningEffort": "Reasoning effort", "editor.default": "Default", "editor.low": "Low", "editor.medium": "Medium", "editor.high": "High", "editor.xhigh": "Very high", "editor.mission": "Mission and instructions", "editor.promptHelp": "Be explicit about the agent’s scope and expected deliverable.", "editor.selectAgent": "Select an agent", "editor.settingsHere": "Its settings will appear here.", "editor.sharedContext": "Shared context", "editor.sharedHelp": "These instructions are shared with the entire project.", "editor.markdown": "Markdown content", "editor.contextPlaceholder": "# Project context", "editor.deletedOnSave": "“{name}” will be deleted when you save."
};

function interpolate(message: string, variables?: Variables): string {
  return message.replace(/\{(\w+)\}/g, (_, name: string) =>
    String(variables?.[name] ?? `{${name}}`)
  );
}

interface I18nValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, variables?: Variables) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function getInitialLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "fr" || saved === "en") return saved;
  } catch {
    // Browser storage can be disabled without blocking the interface.
  }
  return window.navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(getInitialLanguage);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // The selected language still applies for the current session.
    }
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18nValue>(() => ({
    language,
    setLanguage,
    t: (key, variables) => interpolate((language === "fr" ? fr : en)[key], variables)
  }), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useTranslation must be used inside I18nProvider");
  return context;
}

export type Translate = I18nValue["t"];
