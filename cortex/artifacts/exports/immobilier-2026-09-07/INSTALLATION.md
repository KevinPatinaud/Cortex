# Importer Immobilier sur Patinaud.org

Archive : `Immobilier.ctx`, exportée depuis le Cortex local le 7 septembre 2026.
Projet source : `c14e940a-50df-45fc-b70f-3a5c1c404804`.

## Installation

1. Ouvrir votre instance Cortex sur Patinaud.org et vous connecter.
2. Utiliser l'import de projet et sélectionner le fichier `Immobilier.ctx` sans le décompresser.
3. Vérifier les quatre agents : Recherche des annonces, Sélection des biens, Négociation par mail et Bilan de l'accord.
4. Vérifier les liaisons Recherche → Sélection et Négociation → Bilan, ainsi que la liaison asynchrone Sélection → Négociation. La version serveur de Cortex doit prendre en charge l'import de `.cortex/workflow.json` et de `dossierBranches`.
5. Renseigner les paramètres Recherche, Mandat et Identité sur le serveur. Les instructions exportées contiennent déjà le contexte de recherche et les consignes d'autonomie enregistrées localement.
6. Vérifier la disponibilité du moteur d'agents et de son accès Gmail sur le serveur, puis configurer la planification souhaitée. Les connexions et identifiants d'authentification ne sont pas transférés.

## Portée de l'export

L'archive contient les instructions actuelles, les quatre définitions d'agents, le README du projet et le graphe d'exécution avec sa liaison asynchrone.

Les dossiers de négociation existants, conversations, historiques, valeurs des paramètres et planifications ne sont pas transférés. L'import restaure la liaison asynchrone en pause. Cet export installe donc le projet pour de nouvelles exécutions ; il ne reprend pas les négociations locales en cours. Leur déduplication n'est pas transférée non plus : tenir compte des contacts déjà effectués avant de relancer les mêmes recherches sur le serveur.

## Vérification effectuée

L'archive a été relue par le lecteur d'import Cortex. Les six fichiers du projet sont identiques aux fichiers locaux ; le graphe correspond aux instructions actuelles, avec quatre agents et une liaison asynchrone. Aucun déploiement sur Patinaud.org n'a été effectué.
