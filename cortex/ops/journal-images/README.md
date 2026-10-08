# Images réelles du journal

Le **Rédacteur journalistique** recherche une image pendant la préparation de
chaque actualité. Il examine le fichier, vérifie le contexte, le crédit et les
droits de republication, puis utilise `import-news-image.mjs`. **Synthèse** conserve
le titre et le texte intégral du rédacteur et publie avec le renderer habituel.
Le renderer retrouve automatiquement les fiches du jour par titre et source.

Aucune image générée par IA, aucun repli par mots-clés ou banque décorative.
Une vraie photo des événements/personnes/lieux concernés est préférée. Un document
ou une infographie effectivement publiée par une source est possible. Une photo
d’archive ou de contexte est légendée comme telle, sans inventer sa date.
Sans image pertinente et réutilisable, l’article est publié sans image.

## Acquisition quotidienne

Le rédacteur écrit un JSON à un **chemin unique par article** sous
`.cortex/journal/news-images/candidates/`, puis exécute :

```sh
node .cortex/journal/import-news-image.mjs --candidate CHEMIN-UNIQUE.json
```

Le JSON contient `editionDate`, `articleTitle`, `articleSourceUrl` (une source
présente dans l’article), `imageUrl`, `sourceUrl`, `origin: "published"`,
`kind: "photo"` ou `"graphic"`, `alt`, `caption`, `credit`, `license`, `licenseUrl`,
`rightsNote`, `relation`, `visualVerified: true`, `rightsVerified: true`.
`sourcePublishedAt` et `photoDate` sont facultatifs (AAAA-MM-JJ, null si inconnue).
Une date de publication ne vaut pas date de prise de vue. Un crédit ou une page
accessible ne constitue pas à lui seul une autorisation de republication.

L’importeur accepte HTTPS public, JPEG/PNG/WebP, jusqu’à 8 Mo, avec des dimensions
bornées. Il valide chaque redirection, refuse les réseaux privés et fixe la
réponse DNS validée pour la connexion. Il ne fournit ni cookie ni identifiant et
ne contourne aucun refus d’accès. Il conserve les octets originaux, sans retouche,
avec une empreinte SHA-256 et un nom immuable :
`/journal/images/news-AAAA-MM-JJ-empreinte.jpg` (ou png/webp).

La fiche reste privée dans `.cortex/journal/news-images/AAAA-MM-JJ/`. Plusieurs
rédacteurs peuvent importer en parallèle grâce aux noms fondés sur les empreintes.
Ils rendent uniquement leur article Markdown, afin que le garde de fidélité ne
mélange pas métadonnées et texte. Les imports réseau ne se font pas à la lecture.

## Rendu et publication

Le renderer charge les fiches après récupération des articles complets, exige la
même édition, le même titre et une source effectivement citée, puis contrôle
l’empreinte du fichier. Il affiche une image par article, sans doublons, jusqu’à
huit images, avec texte alternatif, dimensions, légende, crédit et lien de licence.
Un asset absent ou modifié est ignoré. `image: null` désactive un article et
`images: false` toute l’édition. Les photos et documents ne sont pas recadrés.
Le site affiche l’image du premier article dans la une et les archives.

```sh
node --test ops/journal-images/journal-images.test.mjs
php ops/journal-site/site.test.php
python3 ops/journal-site/install.py
node ops/journal-images/install.mjs --edition AAAA-MM-JJ
```

L’installation sauvegarde et remplace atomiquement les modules, le renderer et
les blocs de consignes de Rédacteur/Synthèse. Elle préserve les consignes hors
blocs, les autres agents et le workflow. `--edition` retire les anciens visuels
produits par ce module et insère les images importées, sans réécrire paragraphes,
liens, agenda, date d’origine ou scripts. Une réinstallation est idempotente.
Les JSON d’éditions et les autres éditions ne sont pas modifiés.

La notification quotidienne par mail conserve son workflow, sa file, son cron et
ses marqueurs anti-doublons. Aucune installation ne déclenche d’envoi de test.

## Validation

Les tests couvrent l’absence de repli artificiel, les métadonnées nécessaires,
l’échappement, les assets absents/modifiés, le rapprochement des fiches, l’import,
les refus de ressources réseau locales, la migration d’une édition publiée et
l’installation idempotente. Avant livraison, vérifier aussi le renderer réel sur
une copie des données et le site public sur ordinateur et téléphone. Une
publication manuelle validée ne prouve pas l’exécution du prochain cycle quotidien.
