export const fr = {
  normal: "Mode normal", prompts: "Chats et prompts", description: "Les agents de vos projets, dans l’ordre de votre choix. Une seule exécution à la fois, en boucle.",
  sequence: "Ordre d’exécution", available: "Choisir les agents", empty: "Choisissez les agents à inclure dans la boucle.",
  noAgents: "Aucun agent disponible. Configurez vos agents dans le mode normal.", search: "Rechercher un agent ou un projet", refresh: "Actualiser les agents",
  up: "Monter", down: "Descendre", remove: "Retirer", start: "Démarrer Work Force", schedule: "Programmer Work Force", stop: "Arrêter Work Force",
  stopping: "L’agent en cours termine avant l’arrêt.", save: "Enregistrer", saved: "Configuration enregistrée.",
  startAt: "Début planifié", endAt: "Fin planifiée", scheduleHelp: "Horaires facultatifs. Sans début : démarrage immédiat. Sans fin : arrêt manuel. L’agent en cours termine à l’échéance.",
  zone: "Fuseau horaire", server: "Le serveur Cortex doit rester en marche. Vous pouvez fermer cette page.",
  current: "Agent en cours", next: "Prochain agent", check: "Prochaine vérification des quotas", nextAttempt: "Prochaine tentative", cycles: "Tours terminés", history: "Dernières exécutions",
  settings: "Paramètres Work Force", quotaHelp: "Quota restant minimum avant chaque agent. Les deux seuils doivent être atteints. Nouvelle vérification toutes les 5 minutes en cas d’attente.",
  fiveHour: "Réserve minimale sur 5 h (%)", weekly: "Réserve minimale hebdomadaire (%)", saveSettings: "Enregistrer les seuils",
  settingsSaved: "Seuils Work Force enregistrés.", unknown: "Non vérifié", fiveRemaining: "Restant sur 5 h", weekRemaining: "Restant sur la semaine",
  settingsIndependent: "Ces seuils s’appliquent à Work Force, indépendamment de la règle du mode normal.",
  invalidDate: "Vérifiez les dates et heures choisies.", failed: "Échec", succeeded: "Terminé", interrupted: "Interrompu", result: "Voir le résultat",
  retry: "Réessayer", unavailable: "Agent indisponible", status: "État de Work Force", selectionLocked: "Arrêtez Work Force pour modifier la sélection ou les horaires.",
  phases: { stopped: "À l’arrêt", scheduled: "Début programmé", queued: "Dans la file globale de Cortex", running: "En cours", waiting_quota: "En attente des quotas", waiting_agent: "Projet occupé", stopping: "Arrêt après l’agent en cours", failed: "À vérifier avant de reprendre", interrupted: "Exécution interrompue" }
};
export const en: typeof fr = {
  normal: "Normal mode", prompts: "Chats and prompts", description: "Your project agents, in your chosen order. One execution at a time, in a loop.",
  sequence: "Execution order", available: "Choose agents", empty: "Choose the agents to include in the loop.",
  noAgents: "No agents available. Configure agents in normal mode.", search: "Search agents or projects", refresh: "Refresh agents",
  up: "Move up", down: "Move down", remove: "Remove", start: "Start Work Force", schedule: "Schedule Work Force", stop: "Stop Work Force",
  stopping: "The current agent will finish before stopping.", save: "Save", saved: "Configuration saved.",
  startAt: "Scheduled start", endAt: "Scheduled end", scheduleHelp: "Optional times. Without a start: run immediately. Without an end: stop manually. The current agent finishes at the deadline.",
  zone: "Time zone", server: "The Cortex server must stay running. You may close this page.",
  current: "Current agent", next: "Next agent", check: "Next quota check", nextAttempt: "Next attempt", cycles: "Completed cycles", history: "Recent executions",
  settings: "Work Force settings", quotaHelp: "Minimum remaining quota before each agent. Both thresholds must be met. Quotas are checked every 5 minutes while waiting.",
  fiveHour: "Minimum 5-hour reserve (%)", weekly: "Minimum weekly reserve (%)", saveSettings: "Save thresholds",
  settingsSaved: "Work Force thresholds saved.", unknown: "Not checked", fiveRemaining: "5-hour remaining", weekRemaining: "Weekly remaining",
  settingsIndependent: "These thresholds apply to Work Force independently of the normal-mode rule.",
  invalidDate: "Check the selected dates and times.", failed: "Failed", succeeded: "Completed", interrupted: "Interrupted", result: "View result",
  retry: "Retry", unavailable: "Unavailable agent", status: "Work Force status", selectionLocked: "Stop Work Force to edit the selection or schedule.",
  phases: { stopped: "Stopped", scheduled: "Start scheduled", queued: "In the Cortex global queue", running: "Running", waiting_quota: "Waiting for quota", waiting_agent: "Project busy", stopping: "Stopping after current agent", failed: "Check before resuming", interrupted: "Execution interrupted" }
};
