# Audit de l’interface — 7 septembre 2026

L’amélioration prioritaire concerne la lecture du workflow : les liaisons ont été redessinées et leur placement tient maintenant compte des obstacles. L’organisation générale de Cortex reste cohérente ; une refonte globale des écrans n’était pas nécessaire.

## Périmètre et méthode

Examen du code React/CSS, captures Chromium et parcours automatisés à **390, 700, 980 et 1440 px**, hauteur 900 px. Vérification du clavier, des débordements horizontaux, des états d’erreur et contrôles axe WCAG 2 A/AA et 2.1 AA sur les écrans couverts. Les tests utilisent un serveur isolé et un moteur simulé.

| Zone | Constat et décision |
| --- | --- |
| Navigation et projets | Navigation active identifiable, recherche et regroupement disponibles, panneau mobile repliable. Conserver les modifications de dossiers déjà présentes dans le répertoire de travail. |
| Accueil et connexion | Actions de création et de nouvelle tentative explicites. Parcours de panne réseau et retour au contenu vérifiés. |
| Création et édition | Hiérarchie des formulaires claire ; contrôle du clavier, de la validation, de la sauvegarde et de la récupération des brouillons. |
| Workflow | Principal point faible : angles rigides, tronçons confondus, flèches multiples minuscules et contournements mobiles serrés. Corrections détaillées ci-dessous. |
| Cartes d’agents | Ombres trop diffuses ; déplacement au survol désolidarisant visuellement les cartes des liens. Ombres allégées et déplacement supprimé. |
| États et accessibilité | Les couleurs des liens nécessitaient une explication. Ajout d’une légende avec des motifs de trait distincts et des libellés français/anglais. Contraste de « Fin de la branche » et « Aucune branche retenue » renforcé : le contrôle initial relevait 4,3:1 pour un minimum de 4,5:1. |
| Historique | Liste des exécutions, filtre et état vide structurés ; accès au workflow depuis l’état vide. Vérification de l’affichage et des parcours d’exécution. |
| Paramètres et MCP | Contrôles groupés, erreurs de chargement et d’enregistrement explicites ; vérification de la correction et du retour du focus. |
| Planification | Contrastes insuffisants sur le projet concerné, les aides et le fuseau horaire (environ 3,1 à 3,6:1). Textes assombris et aides agrandies. Retour du focus vers le bouton d’ouverture rétabli après fermeture. |
| Instances multiples | Sur mobile, la largeur calculée depuis la fenêtre dépassait le conteneur et coupait le contenu d’une instance. Largeur désormais calculée depuis le conteneur, avec défilement entre des cartes entièrement visibles. |

## Changements livrés

- Tracés orthogonaux à coins arrondis, avec un rayon borné pour les petits segments.
- Points de départ et d’arrivée espacés pour séparer embranchements et convergences.
- Recherche d’un passage libre lorsque le trajet direct croise une carte ou son résumé de routage ; contournement des niveaux sautés et des cartes empilées.
- Recalcul regroupé par frame lors du redimensionnement du workflow et des cartes.
- Point de départ cerclé, pointe pleine et compteur `×N` lisible pour les destinations à plusieurs instances ; un seul compteur par convergence.
- Légende des destinations possibles, retenues, en cours et non retenues. Boucles de retour violettes avec une pointe cohérente avec les autres liens.
- Correction d’un lien manquant : un agent qui revient vers lui-même affiche désormais sa boucle et la légende correspondante.
- Espacement vertical renforcé, y compris entre les branches empilées sur mobile.
- Ombres des cartes plus discrètes, survol stable et contraste renforcé des fins de branche.
- Aides de planification plus lisibles et cartes d’instances adaptées à leur conteneur sur mobile.
- Animation réservée aux liens en cours ; préférence de réduction des animations respectée.

## Vérification

Les tests spécifiques échantillonnent les **courbes SVG effectivement dessinées** pour détecter une intersection avec les cartes et les résumés, avant et après un changement de largeur ou de hauteur de carte. Ils vérifient aussi les points d’attache distincts, la légende bilingue et la réduction des animations.

Un microbenchmark local du routage, avec 50 cartes et 48 liaisons longues, a calculé tous les trajets en environ 59 ms. Il mesure uniquement le calcul géométrique dans Node, pas le rendu complet du navigateur. Reproduction : `node --import tsx artifacts/interface-audit-2026-09-07/benchmark.mjs`.

| Vérification | Résultat |
| --- | --- |
| TypeScript et build de production | Réussis après les dernières corrections. |
| Tests Node (`npm run check`) | 299 réussis, 1 ignoré par la suite existante. |
| Audit UX et formulaires existants | 46 scénarios réussis, 2 cas exclusivement mobiles ignorés sur grand écran. |
| Campagne étendue : création, éditeur, revue, propositions, exécution, reprise et sémantique | 161 scénarios réussis, 3 cas ignorés ; les 4 scénarios de boucle ont ensuite été corrigés et repris dans la validation ciblée. |
| Validation ciblée des liens, instances, boucles et planification | 36 scénarios réussis, puis les 4 contrôles de planification réussis après correction du retour du focus. Les contrôles de contraste axe passent sur ces écrans. |
| Contrôle des différences | `git diff --check` réussi. |

Les journaux `check.log`, `browser.log`, `design-final.log` et `schedule-final.log` conservent les résultats des campagnes. Les échecs intermédiaires de planification ont conduit aux corrections de contraste et de focus ; `schedule-final.log` contient leur reprise réussie. Les erreurs de moteur simulées dans la campagne étendue sont des scénarios attendus de vérification de la récupération.

## Captures

| Vue | Avant | Après |
| --- | --- | --- |
| Embranchements sur ordinateur | [Avant](before/branches-1440.png) | [Après](after/workflow-parallel-1440.png) |
| Embranchements sur mobile | [Avant](before/branches-390.png) | [Après](after/workflow-parallel-390.png) |
| Graphe avec niveaux sautés | — | [Ordinateur](after/graph-chromium-1440.png) · [Mobile](after/graph-chromium-390.png) |
| Boucle de retour | — | [Ordinateur](after/feedback-chromium-1440.png) · [Mobile](after/feedback-chromium-390.png) |
| Instances multiples | — | [Mobile](after/workflow-instance-counts-390.png) |
| Planification | — | [Mobile](after/schedule-chromium-390.png) |
| Revue de projet | — | [Conversation](after/project-review-conversation-390.png) · [Proposition](after/project-review-proposal-390.png) |

## Suites possibles

- Pour les graphes très denses, prévoir une vue compacte avec zoom et filtrage : le présent changement améliore les trajets sans remplacer l’affichage par un éditeur de diagrammes. Des tronçons peuvent encore être partagés dans les graphes très ramifiés ; l’absence de tout croisement entre liens n’est pas garantie.
- Les métadonnées secondaires restent petites, notamment dans l’éditeur et les paramètres. Un mode de densité confortable serait utile à évaluer avec les utilisateurs.
- La feuille CSS accumule des règles et surcharges historiques. Une extraction progressive par composant faciliterait les évolutions ; elle n’a pas été mêlée à cette intervention visuelle.

Les contrôles automatisés ne remplacent pas un essai avec lecteur d’écran. Firefox, Safari, les vrais fournisseurs IA et les graphes de production très volumineux ne font pas partie de cette validation.
