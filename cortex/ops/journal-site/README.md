# Site du Journal de Kévin

Le site complète les éditions publiées par Cortex à
`https://kevinpatinaud.fr/journal/`. Il fournit une page d’accueil avec la dernière
édition, des archives paginées, une recherche dans les articles et l’agenda et un
filtre par mois. La recherche ignore la casse et les principaux accents français.
La page reste entièrement utilisable sans JavaScript et sur téléphone.
La une et les cartes peuvent afficher l’image créditée de leur premier article.
Le [module d’images](../journal-images/README.md) permet aux rédacteurs de rechercher
et importer des images réelles des sources d’actualité, puis au renderer de les
intégrer avec leurs légendes et crédits, en complément de ce site.

Chaque URL historique `AAAA-MM-JJ.html` reste valide, y compris dans les mails.
Une règle Apache affiche le fichier existant à travers le lecteur PHP qui ajoute
les liens d’accueil, les menus de dates et les éditions précédente/suivante. Les
jours sans édition sont sautés. Les premières et dernières éditions n’ont pas de
lien vers une date inexistante. Les articles, les sources, les commandes de
lecture, le pied de page et les scripts d’origine restent inchangés dans la réponse.

Les nouveaux fichiers HTML apparaissent dès leur publication ; aucun modèle,
nouvelle planification ni nouvelle génération d’index n’est nécessaire. Les JSON
du projet et les files de mail ne sont pas lus. Seuls les fichiers HTML complets
avec une date valide sont retenus, hors liens symboliques et fichiers temporaires.

## Installation sur le serveur existant

Prérequis : Apache avec `mod_rewrite` et `AllowOverride All`, PHP 8 avec `dom`
et `mbstring`. Aucun package supplémentaire ni changement de service Cortex.

```sh
php cortex/ops/journal-site/site.test.php
python3 cortex/ops/journal-site/install.py
curl -f https://kevinpatinaud.fr/journal/
curl -f https://kevinpatinaud.fr/journal/2026-10-08.html
```

L’installateur vérifie la syntaxe PHP avant installation, sauvegarde les fichiers
de présentation dans `cortex/data/backups/journal-site/<date UTC>` et écrit chaque
fichier par remplacement atomique. Les éventuelles règles Apache extérieures au
bloc `cortex-journal-site` sont préservées. `--web-root` et `--backup-root` servent
à une installation de test. Pour restaurer, recopier les fichiers sauvegardés et
retirer uniquement ceux listés dans `absent.txt` ; les éditions ne sont pas touchées.

La publication du JSON/HTML et le Publieur Cortex restent les mêmes. Le cron
`send-mail-journal`, sa file et les marqueurs `.sent-journal` restent actifs et
inchangés : l’alerte quotidienne continue avec son lien habituel vers l’édition.
L’installation n’envoie pas de mail de test et ne réexpédie pas les archives.

Le site conserve l’accès existant aux éditions et leurs consignes `noindex,
nofollow`. Ces consignes concernent les moteurs de recherche ; elles ne constituent
pas une authentification. Il ne crée ni compte, ni cookie, ni service externe.

## Validation

Le test PHP vérifie les gabarits anciens/récents, le texte intégral, les URL de
sources, les dates et chemins, la recherche, l’arrivée d’une nouvelle édition, la
navigation avec des jours absents et les identifiants uniques des menus.
Après installation, vérifier les anciennes URL, les 404, la recherche et sa
pagination, les menus de dates et le rendu à 320/390/430 px ainsi que sur ordinateur.
Les tests généraux Cortex restent `npm run check` dans `cortex/`.
