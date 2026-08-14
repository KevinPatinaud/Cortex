Projet multi agent simulant le cycle de la vie.

Le workflow est :
- Le premier agent choisit aléatoirement un continent parmi tous les continents habités.
- Ensuite, l'agent « Choix plante » choisit une plante au hasard vivant dans ce continent et indique explicitement si elle est comestible ou toxique.
- Si la plante est comestible, il sélectionne exclusivement l'agent « Choix herbivore ». Celui-ci choisit aléatoirement un herbivore valide parmi plusieurs candidats. L'agent botaniste ne doit pas être sélectionné.
- L'agent suivant choisit aléatoirement un carnivore pouvant manger l'herbivore. Puis il relance le choix de la plante et reboucle.
- Si la plante est toxique, l'agent « Choix plante » sélectionne exclusivement l'agent « Agent botaniste ». L'agent herbivore ne doit pas être sélectionné.
- L'agent botaniste fait alors une description complète de la plante et le projet s'arrête.

Les branches « Choix herbivore » et « Agent botaniste » sont mutuellement exclusives : elles ne doivent jamais être sélectionnées simultanément.

Pour chaque choix aléatoire, utilise impérativement le tirage fourni par Cortex et considère plusieurs candidats valides avant de sélectionner le résultat.
