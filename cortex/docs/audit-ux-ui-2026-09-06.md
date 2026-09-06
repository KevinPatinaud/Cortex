# Audit UX/UI de Cortex — 6 septembre 2026

## Périmètre et méthode

Audit du code et des parcours de l’application React : accueil, sélection/recherche/réorganisation des projets, création, édition Markdown, workflow, historique, connexion et réglages des moteurs/MCP. Les modifications déjà présentes dans le répertoire ont été conservées ; ce rapport décrit les corrections de cette session, en complément de l’audit du 4 septembre.

La recette navigateur utilise Chromium, le serveur HTTP de test et un moteur simulé avec stockage temporaire. Les découvertes de connexions machine sont simulées dans les tests des réglages. Aucun moteur IA réel ni projet utilisateur n’a été exécuté ou modifié pour la recette. Aucun script n’a été supprimé.

## Problèmes principaux et corrections

| Priorité | Problème observé | Correction intégrée |
| --- | --- | --- |
| P1 | Sur mobile sans projet sélectionné, la liste occupait tout l’écran et « Masquer » ne pouvait pas la fermer. L’accueil était inaccessible. | Liste ouverte explicitement et refermable, intégrée au défilement de la page ; accueil et bouton de création accessibles. |
| P1 | Une panne de la vérification de session affichait une demande de mot de passe ; une panne pendant la connexion était annoncée comme un mauvais mot de passe. | État de connexion indisponible avec nouvelle tentative ; distinction erreur réseau / identifiants refusés et conservation de la saisie. |
| P1 | Un échec de chargement des projets aboutissait à une liste vide sans reprise ; un lien invalide pouvait ouvrir un autre projet. | Erreur explicite, nouvelle tentative locale, conservation de la liste quand seule la restauration échoue, message pour les liens invalides. |
| P1 | Des réponses réseau retardées pouvaient rouvrir un projet après un changement de navigation. | Les résultats de sélection devenus obsolètes sont ignorés. |
| P1 | Le mode global indiquait « Automatique » alors qu’une partie seulement des agents était en automatique. | État « Mixte », nom accessible stable et état global correspondant aux agents. |
| P1 | Les réponses Markdown interactives étaient imbriquées dans des boutons ; des résultats historiques ressemblaient à des commandes. | Contrôles radio/cases à cocher natifs séparés du contenu et des liens ; historique présenté comme du contenu. |
| P1 | Les sélections pouvaient changer pendant l’exécution ; le changement de mode effaçait les précisions ; le polling perturbait la lecture. | Verrouillage pendant les opérations, conservation des précisions et suivi du défilement uniquement quand le lecteur est au bas de la conversation. |
| P1 | Les réglages/MCP restaient modifiables après un échec de lecture, à partir de valeurs par défaut ou périmées. | État d’échec avec reprise ; sauvegarde et contrôles concernés bloqués jusqu’au chargement réussi. |
| P2 | Contrastes insuffisants dans les choix de moteurs, les aides MCP/intégrations et les libellés de conversation/routage. | Teintes renforcées et textes secondaires agrandis ; contrôles axe supplémentaires sur ces vues. |
| P2 | Focus trop discret, recherche sans focus visible, onglets Markdown sans parcours clavier complet. | Focus visible sur fonds clairs et sombres, moteurs accessibles au clavier, lien d’évitement, onglets/panneaux Markdown reliés et navigables. |
| P2 | Réorganisation essentiellement dépendante du glisser-déposer, raccourci peu découvrable et focus perdu après enregistrement. | Boutons Monter/Descendre utilisables au toucher, conservation d’Alt + flèches, annonce d’enregistrement, désactivation pendant les opérations et restauration du focus pour enchaîner les déplacements. |
| P2 | Actions workflow désactivées sans explication exploitable ; champs requis difficiles à retrouver. | Explications visibles, accès direct au premier paramètre manquant, indication des erreurs et raccourci vers l’étape à reprendre. |
| P2 | Aides de formulaires peu reliées aux champs et format du nom MCP découvert après rejet serveur. | Associations accessibles, contrainte de format et longueur explicites, validation avant envoi, focus des dialogues amélioré. |

## Livrables de vérification

- Captures avant/après : `artifacts/ux-audit-2026-09-06/`.
- Tests existants et nouvelles régressions : `tests/e2e/`.
- Rapport navigateur : `playwright-report/index.html` après la campagne.
- Vérification TypeScript, tests unitaires et build de production.

Les scans automatisés couvrent les règles WCAG A/AA sélectionnées dans les vues testées ; ils ne constituent pas une certification exhaustive d’accessibilité. La recette est réalisée sous Chromium avec un moteur simulé : les comportements propres aux moteurs réels et aux autres navigateurs restent en dehors de cette campagne.

## Résultats

- TypeScript strict : réussi.
- Tests unitaires : 159 réussis, aucun échec, 1 test ignoré par la suite existante (160 au total).
- Build de production : réussi.
- Vérification des différences (`git diff --check`) : réussie ; aucune suppression de fichier.

- Validation navigateur consolidée après les corrections : **106 exécutions E2E réussies**, **2 ignorées** (scénario réservé au mobile, exclu sur desktop), **aucun échec restant**. La campagne complète a été complétée par des relances ciblées après correction des nouveaux tests et des derniers contrastes.
- Largeurs contrôlées : **390, 700, 980 et 1440 px** ; défilement mobile également vérifié à **600 px de hauteur**.
- Scans axe des vues couvertes et des choix de réponses : aucune violation restante des règles sélectionnées.
- **14 captures avant et 30 captures après**, avec revue visuelle de l’accueil, du workflow, de la création, de l’historique et des réglages.

Exemples de captures finales : [accueil mobile](../artifacts/ux-audit-2026-09-06/after/welcome-chromium-390.png), [création mobile](../artifacts/ux-audit-2026-09-06/after/project-creation-chromium-390.png), [workflow desktop](../artifacts/ux-audit-2026-09-06/after/workflow-chromium-1440.png), [intégrations desktop](../artifacts/ux-audit-2026-09-06/after/settings-integrations-chromium-1440.png).
