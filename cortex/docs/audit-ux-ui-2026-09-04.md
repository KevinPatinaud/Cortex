# Audit UX/UI de Cortex — 4 septembre 2026

## Périmètre

Audit du produit local en français sur les parcours suivants : accueil et sélection de projet, recherche et réorganisation, workflow mono et multi-agents, instructions, historique, planification, création de projet et éditeur. Les états desktop et mobile (390 × 844 px), la navigation navigateur, le clavier, les dialogues et l’arbre d’accessibilité ont été contrôlés. Aucun projet n’a été supprimé ou modifié pendant la recette.

## Synthèse

La direction visuelle est cohérente et déjà solide : hiérarchie claire, design system homogène, bons états de chargement, confirmations explicites et densité adaptée au desktop. Les défauts prioritaires concernaient surtout le mobile, la sémantique des contrôles de sélection et quelques incohérences de navigation et de langue.

Il ne reste aucun défaut bloquant identifié. Les corrections ci-dessous sont intégrées et vérifiées.

## Corrections prioritaires réalisées

### P1 — Actions essentielles masquées sur mobile

- Problème : les commandes Manuel, Planifier, Réinitialiser et Modifier, ainsi que la progression, nécessitaient un défilement horizontal peu visible.
- Correction : passage en grille responsive sur deux colonnes et repli des étapes de progression sur plusieurs lignes.
- Résultat : toutes les actions sont visibles à 390 px, sans débordement horizontal.

### P1 — Éditeur mobile difficile à parcourir

- Problème : les actions principales et la bibliothèque d’agents se comportaient comme des carrousels horizontaux. Une partie des commandes et des agents restait hors écran.
- Correction : grille d’actions 2 × 2, liste verticale des agents, actions de l’inspecteur en pleine largeur et barre Markdown repliable.
- Résultat : parcours linéaire, commandes découvrables et absence de débordement de page.

### P1 — Sémantique d’accessibilité incorrecte pour les projets

- Problème : les boutons de sélection de projet étaient annoncés comme des cases à cocher à cause de `aria-pressed`.
- Correction : boutons standards avec `aria-current="page"` pour le projet actif.
- Résultat : rôle et état cohérents dans l’arbre d’accessibilité.

### P1 — Repère principal de page mal structuré

- Problème : la barre latérale était incluse dans le landmark `main`, tandis que le contenu principal était une simple section.
- Correction : coque d’application neutre, barre latérale séparée et contenu de travail exposé comme unique `main`.
- Résultat : navigation par landmarks plus fiable pour les technologies d’assistance.

### P1 — Navigation navigateur désynchronisable

- Problème : un retour vers une URL sans paramètre `project` pouvait conserver le projet précédent à l’écran.
- Correction : effacement coordonné de la sélection et du mode édition lors de cet événement `popstate`.
- Résultat : l’URL, le titre de page et le contenu restent synchronisés.

### P2 — Contexte navigateur insuffisant

- Problème : tous les onglets portaient uniquement le titre « Cortex ».
- Correction : titre dynamique « Nom du projet · Cortex ».
- Résultat : onglets, historique et sélecteur de fenêtres identifiables.

### P2 — Microtextes trop faibles dans l’éditeur

- Problème : plusieurs métadonnées combinaient une très petite taille et une couleur trop claire.
- Correction : tailles légèrement augmentées et teintes renforcées pour le nom de projet, le résumé, la bibliothèque et l’inspecteur.
- Résultat : meilleure lisibilité sans augmenter sensiblement la densité.

### P2 — Message système non traduit dans l’historique

- Problème : une interruption enregistrée par le serveur apparaissait en anglais dans l’interface française.
- Correction : traduction des deux erreurs d’interruption connues au moment de l’affichage.
- Résultat : historique entièrement cohérent avec la langue active.

### P2 — Action de relance ambiguë

- Problème : le bouton « Répondre » suggérait l’envoi d’un message alors qu’il déclenchait une nouvelle exécution de l’agent. Son icône et son infobulle parlaient déjà de relance.
- Correction : libellés explicites « Relancer l’agent » et « Relancer avec ces précisions », CTA aligné à droite, casse normale et cible tactile agrandie. Le premier lancement est désormais nommé « Lancer l’agent ».
- Résultat : intention, coût d’action et relation avec le champ de précisions sont immédiatement compréhensibles.

## Points forts confirmés

- États disabled, loading, erreurs et succès explicites.
- Dialogues modaux titrés, décrits, fermables avec Échap et dotés d’un focus initial pertinent.
- Navigation des onglets compatible clavier.
- Libellés accessibles complets sur les boutons à icône et les interrupteurs.
- Confirmation avant les opérations destructrices et explication de leur portée.
- Hiérarchie visuelle et composants cohérents entre workflow, historique et éditeur.
- Aucun avertissement ou erreur console observé pendant les parcours testés.

## Améliorations suivantes recommandées

1. Découper le bundle initial : le build produit encore un chunk JavaScript d’environ 721 kB minifié (210 kB gzip). Charger à la demande l’éditeur, l’historique et les panneaux de réglages réduirait le temps d’ouverture sur les machines modestes.
2. Ajouter une campagne E2E avec captures aux largeurs 390, 700, 980 et 1440 px, complétée par axe-core, afin d’éviter les régressions responsive et ARIA.
3. Pour les workflows très longs, proposer une progression condensée ou repliable plutôt que d’afficher toutes les étapes sur mobile.
4. Enrichir l’état d’accueil d’un raccourci central « Nouveau projet » pour les nouveaux utilisateurs, en complément de la commande latérale.

## Validation

- TypeScript strict : réussi.
- Tests automatisés : 111/111 réussis.
- Build de production : réussi.
- Vérification visuelle desktop : réussie.
- Vérification mobile 390 × 844 px : réussie, aucun débordement de page détecté.
- Navigation entre projets, onglets, historique et fermeture clavier des dialogues : réussies.
