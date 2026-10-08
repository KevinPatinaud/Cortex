# Images du journal personnel

Le journal peut afficher des illustrations de contexte et des photographies avec
texte alternatif, légende et crédit. Les images sont servies depuis son propre
domaine, en WebP léger pour la bibliothèque, et chargées à la demande dans les
articles. Les textes, sources, commandes de lecture et alertes mail sont conservés.
La page d’accueil et les cartes d’archives reprennent l’image de l’article à la une.

## Sélection quotidienne

Une bibliothèque initiale de quatre visuels originaux générés par IA couvre les
carburants, l’économie, l’informatique et les sciences du vivant. Ils sont identifiés
comme illustrations, jamais comme des photographies d’un événement réel. Leur
sélection repose sur le titre et la catégorie, avec au plus quatre images distinctes
par édition. Un sujet qui ne correspond pas à la bibliothèque reste sans image.
Une scène générée n’est pas ajoutée automatiquement aux articles concernant un
conflit, une catastrophe, une affaire judiciaire ou un diagnostic personnel.

La synthèse peut choisir `illustration: "energy"`, `"economy"`, `"technology"` ou
`"science"` sur un article, ou `null` pour le laisser sans image. Le champ est
facultatif. `image: null` désactive également l’image de cet article ; `images: false`
désactive les images de toute l’édition. Le moteur quotidien ne fait aucun nouvel
appel à un modèle d’image, et l’absence d’un visuel n’empêche pas la publication.

Pour utiliser une photographie réelle, déposer un fichier dont les droits de
réutilisation ont effectivement été vérifiés dans le dossier public `images/`,
puis fournir les métadonnées sur l’article :

```json
{
  "image": {
    "src": "/journal/images/photo-2026-10-08.webp",
    "alt": "Description précise de ce qui est visible",
    "caption": "Légende factuelle, lieu et date s’ils sont établis",
    "credit": "Auteur de la photographie",
    "kind": "photo",
    "sourceUrl": "https://example.org/page-originale",
    "license": "Licence effectivement vérifiée",
    "width": 1536,
    "height": 1024
  }
}
```

Le fichier de cet exemple est fictif. Les photos nécessitent crédit, provenance et
licence ; le code valide ces métadonnées mais ne vérifie pas lui-même les droits
sur une page distante. Seuls des noms locaux simples en WebP/JPEG/PNG sont permis,
sans traversée de répertoire, ressource externe, données embarquées ou paramètres
d’accès. Un fichier absent, lié symboliquement ou une image invalide est omis.
Les images Markdown ordinaires continuent à devenir des liens ; elles ne sont pas
insérées automatiquement sans le contrat de métadonnées.

## Installation

```sh
cd /home/kevin/Cortex/cortex
npm run test:journal-images
php ops/journal-site/site.test.php
python3 ops/journal-site/install.py
node ops/journal-images/install.mjs --edition 2026-10-08
```

L’installateur déploie les quatre images et le module, adapte le renderer existant
et les consignes de Synthèse, et sauvegarde les fichiers modifiés dans
`data/backups/journal-images-<horodatage>`. Le patch du renderer est borné : il
s’arrête lorsque le gabarit est inconnu, et préserve ses autres validations.
`--edition` est facultatif : il ajoute les figures à une édition existante sans
réécrire les paragraphes, les liens, les scripts ni la date de génération. Les
autres éditions sont préservées. Une réinstallation ne duplique pas les images.
La file mail et ses marqueurs ne sont pas touchés ; aucun mail de test n’est envoyé.

Les options `--journal-project`, `--web-root`, `--cortex-root` permettent des essais
isolés. L’installateur vérifie les empreintes et le format des images. Les fichiers
`*-v1.webp` sont immuables : une autre image doit recevoir un nouveau nom. Les
origines et briefs de génération se trouvent dans `assets.json` et `prompts.md`.

## Vérification

`npm run check` inclut les tests du module : sélection, désactivation, données
invalides, ressources interdites, provenance des photos, légendes accessibles,
fichiers absents, préservation de contenu, installation et réinstallation.
Le test PHP couvre la reprise de l’image, de son texte alternatif et du crédit
dans les archives. Après installation, tester le renderer réel sur une copie des
données d’édition, puis vérifier les images chargées, leurs légendes, le sommaire,
l’impression et les largeurs 320/390/430 px. La prochaine production quotidienne
reste à observer pour confirmer le choix éditorial effectué par l’agent.
