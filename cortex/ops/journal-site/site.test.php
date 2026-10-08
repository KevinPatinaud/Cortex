<?php
declare(strict_types=1);
require __DIR__ . '/site/journal.php';

$checks = 0;
function check(bool $condition, string $message): void {
    global $checks;
    if (!$condition) throw new RuntimeException($message);
    $checks++;
}
function fixture(string $date, string $body): string {
    return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Journal</title><style>.sample{color:red}</style></head><body><main>' . $body . '</main><footer class="page page-footer"><time datetime="' . $date . '">Édition</time></footer><script>const untouched = "source";</script></body></html>';
}

$root = sys_get_temp_dir() . '/journal-site-test-' . bin2hex(random_bytes(8));
mkdir($root, 0700);
try {
    $body = '<article class="story" id="article-01"><header><span class="story-category">Économie</span><h3 class="story-title">Gazole &amp; énergie : une baisse ?</h3></header><div class="prose"><p>Un dossier sur les retraites et l’été.</p><a data-source href="https://example.org/source?a=1&amp;b=2">Source originale</a></div></article>';
    $latest = fixture('2026-10-08', $body);
    $old = fixture('2026-09-06', '<article class="article" id="article-07"><p class="kicker">Science</p><h2>Un sujet ancien</h2><p>Un contenu intégral.</p></article>');
    file_put_contents($root . '/2026-10-08.html', $latest);
    file_put_contents($root . '/2026-09-06.html', $old);
    file_put_contents($root . '/2026-10-07.html', '');
    file_put_contents($root . '/2026-02-30.html', fixture('2026-02-30', $body));
    file_put_contents($root . '/agenda-2026-10-08.html', $latest);
    file_put_contents($root . '/2026-10-09.html.tmp', $latest);
    file_put_contents($root . '/2026-10-09.json', '{"private":true}');
    $all = journal_editions($root);
    check(array_keys($all) === ['2026-10-08', '2026-09-06'], 'Seules les éditions HTML valides sont classées par date décroissante.');
    check($all['2026-10-08']['articles'][0]['title'] === 'Gazole & énergie : une baisse ?', 'Titre courant décodé.');
    check($all['2026-09-06']['articles'][0]['title'] === 'Un sujet ancien', 'Ancien gabarit conservé.');
    check($all['2026-09-06']['articles'][0]['category'] === 'Science', 'Ancienne catégorie lisible.');
    check(array_keys(journal_editions($root, 'retraites ete')) === ['2026-10-08'], 'Recherche intégrale, plusieurs mots, accents insensibles.');
    check(count(journal_editions($root, 'introuvable')) === 0, 'Recherche vide.');
    check(count(journal_editions($root, 'septembre')) === 1, 'Recherche par date en français.');
    check(count(journal_editions($root, 'sample')) === 0, 'Les styles ne polluent pas les résultats.');
    check(!journal_date_valid('../private') && !journal_date_valid('2026-02-30') && journal_date_valid('2028-02-29'), 'Dates et chemins validés.');
    $rendered = journal_reader($latest, $all, '2026-10-08');
    check(substr_count($rendered, $body) === 1, 'Articles, liens, sources et contenu conservés exactement une fois.');
    check(str_contains($rendered, '<script>const untouched = "source";</script>'), 'Script original conservé.');
    check(str_contains($rendered, 'href="2026-09-06.html" rel="prev"'), 'L’édition précédente saute les jours absents.');
    check(!str_contains($rendered, 'rel="next"'), 'Pas de faux lien suivant sur la dernière édition.');
    check(str_contains(journal_reader($old, $all, '2026-09-06'), 'href="2026-10-08.html" rel="next"'), 'Navigation depuis la première édition.');
    check(substr_count($rendered, 'id="journal-edition-top"') === 1 && substr_count($rendered, 'id="journal-edition-bottom"') === 1, 'Identifiants des menus uniques.');
    check(journal_escape('<script>"&') === '&lt;script&gt;&quot;&amp;', 'Échappement HTML.');
    $illustrated = str_replace('<div class="prose">', '<figure class="journal-figure"><img data-journal-image src="/journal/images/energy-v1.webp" alt="Une pompe" width="1536" height="1024"><figcaption>Illustration — Carburants. <small>Visuel généré par IA</small></figcaption></figure><div class="prose">', $latest);
    check(journal_metadata($illustrated, '2026-10-08')['articles'][0]['image']['src'] === '/journal/images/energy-v1.webp', 'Image locale transmise à la une et aux archives.');
    check(journal_metadata($illustrated, '2026-10-08')['articles'][0]['image']['alt'] === 'Une pompe', 'Texte alternatif conservé.');
    check(str_contains(journal_metadata($illustrated, '2026-10-08')['articles'][0]['image']['caption'], 'généré par IA'), 'Légende et crédit conservés.');
    check(journal_metadata(str_replace('/journal/images/energy-v1.webp', 'https://tracker.example/image.jpg', $illustrated), '2026-10-08')['articles'][0]['image'] === null, 'Ressource externe non reprise dans les archives.');
    $_GET = ['q' => ['unexpected'], 'page' => '2', 'month' => '2026-09'];
    check(journal_parameter('q') === '', 'Paramètre tableau ignoré.');
    $_GET['q'] = '<script> &';
    check(str_contains(journal_query(['page' => '3']), 'q=%3Cscript%3E%20%26'), 'Pagination encode et conserve les filtres.');
    file_put_contents($root . '/2026-10-10.html', fixture('2026-10-10', $body));
    check(array_key_first(journal_editions($root)) === '2026-10-10', 'Intégration automatique des prochaines éditions.');
    $privateTarget = $root . '/private.txt';
    file_put_contents($privateTarget, $latest);
    if (symlink($privateTarget, $root . '/2026-10-11.html')) {
        check(count(journal_editions($root)) === 3, 'Liens symboliques exclus.');
    }
    echo "Journal site : $checks contrôles réussis.\n";
} finally {
    foreach (glob($root . '/*') as $file) unlink($file);
    rmdir($root);
}
