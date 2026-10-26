# Personnages et habitants de Lunaria

Agent Cortex autorisé pour saveLunaria.com, quotidien à **20 h Europe/Paris**.
Il enrichit et synchronise le panneau des habitants et l’herbier à partir du
projet d’auteur, de la campagne courante, du récit et des médias officiels.
Sa première mission réalise le catalogue éditorial partagé et les fiches manquantes.

## Installation

Préparer un accès GitHub **en lecture seule** à `KevinPatinaud/Lunaria` avec une clé
de déploiement dédiée ; sa clé privée reste sur le serveur, hors de Git. La branche
retenue est `refactor/clean-architecture`. Aucun jeton de compte général n’est copié.

Le paquet privé initial contient `baseline/authoring.json`, `story.md`, `runtime.json`,
les médias référencés sous `baseline/media/` et un `manifest.json`. Ce manifeste
indique le commit local, les empreintes, les changements non publiés et les anciens
commits distants qui ne doivent pas remplacer une référence locale plus récente.
Le paquet, les sources complètes, les clés et l’état d’exécution ne sont pas versionnés.

Depuis le serveur, dans `/home/kevin/Cortex/cortex` :

```sh
python3 ops/lunaria-characters/install.py --baseline-archive /chemin/prive/baseline.tar.gz
```

L’installation emploie l’API authentifiée existante, crée un seul projet et un seul
agent, valide l’accès et l’inventaire, applique le profil, l’inscrit au groupe de
verrouillage du site puis active 20 h. Elle conserve les consignes, horaires, profils
et seuils de quota existants et sauvegarde la configuration privée avant modification.
Une réinstallation réutilise le projet et conserve sa référence initiale.

Le moteur n’expose pas d’API pour inscrire une identité au groupe de dépôt partagé :
ce seul ajout est fait par remplacement atomique de la configuration après les
écritures API, avec contrôle de concurrence et vérification des paramètres existants.

## Outils de sources

```sh
python3 tools/character_sources.py refresh --project /chemin/du/projet-cortex
python3 tools/character_sources.py asset --project /chemin/du/projet-cortex \
  --reference 'library://02_characters/chemin/image.png' --output work/portrait.png
python3 -m unittest -v test_character_sources.py
```

Les deux premiers exemples s’exécutent avec les outils copiés dans le dossier de
définition de l’agent. Le dernier s’exécute dans ce dossier `tools/` ou celui des ops.
L’outil de sources ne modifie ni les fiches, ni les dépôts sources, ni les autres agents.
Une lecture invalide préserve le dernier inventaire et publie un état d’échec explicite.

L’inventaire suit les références et le marqueur de fin, exclut les films inutilisés,
réunit les variantes de casse et conserve les preuves de plans et de dialogues.
Les personnages hors champ, les décors habités et les autres usages de gameplay
demandent une revue éditoriale. Une bulle sans locuteur explicite ne devient pas
automatiquement une citation attribuée. Le retrait d’une fiche nécessite une
réconciliation complète ; une absence dans une scène ne suffit pas.

La référence initiale comprend les changements locaux déjà connus de l’auteur,
notamment Lierre. Le vieux commit GitHub ne doit pas réintroduire Fougère. Les
futures modifications à suivre automatiquement doivent être publiées sur la
branche GitHub retenue. Tout nouveau commit est comparé à la référence et au
registre d’identités avant modification des fiches.
