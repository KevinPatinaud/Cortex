<?php
declare(strict_types=1);
require __DIR__ . '/journal.php';
header('Content-Type: text/html; charset=UTF-8');
header('Cache-Control: no-cache');
header('X-Robots-Tag: noindex, nofollow');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

$editions = journal_editions(__DIR__);
$edition = journal_parameter('edition');
if ($edition !== '') {
    if (!journal_date_valid($edition) || !isset($editions[$edition])) {
        http_response_code(404);
        echo '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Édition introuvable</title><link rel="stylesheet" href="site.css"><body class="journal-portal"><main class="portal-wrap empty-state"><h1>Édition introuvable</h1><p>Cette édition n’a pas été publiée.</p><a class="button" href="./">Voir les éditions disponibles</a></main></body></html>';
        exit;
    }
    echo journal_reader(file_get_contents(__DIR__ . '/' . $edition . '.html'), $editions, $edition);
    exit;
}
$query = journal_parameter('q');
$month = journal_parameter('month');
if (!preg_match('/^\d{4}-(0[1-9]|1[0-2])$/D', $month)) $month = '';
$filtered = $query === '' ? $editions : journal_editions(__DIR__, $query);
if ($month !== '') $filtered = array_filter($filtered, fn($value) => str_starts_with($value['date'], $month));
$months = [];
foreach ($editions as $value) {
    $key = substr($value['date'], 0, 7);
    $months[$key] = preg_replace('/^\d+ /', '', journal_date_label($key . '-01', false));
}
$total = count($filtered);
$pageCount = max(1, (int)ceil($total / 12));
$page = min($pageCount, max(1, (int)journal_parameter('page')));
$visible = array_slice($filtered, ($page - 1) * 12, 12, true);
$latest = $editions ? reset($editions) : null;
$isFiltered = $query !== '' || $month !== '';
$archiveHeading = $latest && !$isFiltered && $page === 1 ? 'h2' : 'h1';
$currentYear = (new DateTimeImmutable('now', new DateTimeZone('Europe/Paris')))->format('Y');
?>
<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <meta name="description" content="Le Journal de Kévin. Retrouvez la dernière édition, explorez les archives et recherchez dans les articles et l’agenda.">
  <title>Le Journal de Kévin — <?= $isFiltered ? 'Recherche & archives' : 'Toutes les éditions' ?></title>
  <link rel="stylesheet" href="site.css?v=1">
  <link rel="icon" type="image/svg+xml" href="favicon.svg">
</head>
<body class="journal-portal">
<a class="portal-skip" href="#contenu">Aller au contenu</a>
<div class="portal-topline"><div class="portal-wrap"><span><i aria-hidden="true"></i> LE BRIEF DE KÉVIN</span><span>L’agenda &amp; l’actualité</span></div></div>
<header class="portal-wrap portal-masthead">
  <a href="./" class="portal-brand" aria-label="Le Journal, accueil">Le Journal<span>Une pause pour comprendre.</span></a>
  <nav aria-label="Navigation principale"><a href="./"<?= !$isFiltered ? ' aria-current="page"' : '' ?>>À la une</a><a href="#editions">Les éditions <span class="count"><?= count($editions) ?></span></a></nav>
</header>
<main id="contenu" class="portal-wrap">
<?php if ($latest && !$isFiltered && $page === 1): $lead = $latest['articles'][0] ?? null; ?>
  <section class="portal-feature" aria-labelledby="latest-title">
    <div class="feature-main">
      <div class="feature-meta"><span class="live-badge">DERNIÈRE ÉDITION</span><time datetime="<?= $latest['date'] ?>"><?= journal_escape($latest['label']) ?></time></div>
      <p class="feature-kicker"><?= $lead && $lead['category'] !== '' ? journal_escape($lead['category']) : 'À la une' ?></p>
      <h1 id="latest-title"><?= $lead ? journal_escape($lead['title']) : 'Votre dernière édition est disponible.' ?></h1>
      <p class="feature-description">L’essentiel, votre agenda et <?= count($latest['articles']) ?> articles à retrouver dans l’édition du jour.</p>
      <a class="button button-light" href="<?= $latest['date'] ?>.html">Lire l’édition <span aria-hidden="true">↗</span></a>
    </div>
    <aside class="feature-contents" aria-label="Dans la dernière édition">
      <p class="eyebrow">AU FIL DE L’ÉDITION</p>
      <?php foreach (array_slice($latest['articles'], 1, 3) as $index => $article): ?>
      <a class="feature-story" href="<?= $latest['date'] ?>.html<?= $article['anchor'] ? '#' . $article['anchor'] : '' ?>"><span class="story-index">0<?= $index + 2 ?></span><span><small><?= journal_escape($article['category'] ?: 'Actualités') ?></small><strong><?= journal_escape($article['title']) ?></strong></span></a>
      <?php endforeach; ?>
      <a class="feature-agenda" href="<?= $latest['date'] ?>.html#aujourdhui">Consulter l’agenda <span aria-hidden="true">→</span></a>
    </aside>
  </section>
  <div class="portal-mail-note"><span class="mail-icon" aria-hidden="true">✉</span><p>Le journal sur le web, le rendez-vous par mail.<span>Votre alerte quotidienne continue à vous prévenir de chaque nouvelle édition.</span></p><a href="#editions">Explorer les archives ↓</a></div>
<?php endif; ?>
  <section id="editions" class="portal-archives" aria-labelledby="archive-title">
    <div class="archive-heading"><div><p class="eyebrow">LA COLLECTION</p><<?= $archiveHeading ?> id="archive-title"><?= $isFiltered ? 'Retrouver une édition' : 'Au fil des jours' ?></<?= $archiveHeading ?>></div><p><?= count($editions) ?> éditions à parcourir.<br>Le temps passe, les idées restent.</p></div>
    <form class="archive-filters" action="./#editions" method="get" role="search">
      <div class="search-field"><label for="journal-search">Rechercher dans le journal</label><input id="journal-search" name="q" type="search" value="<?= journal_escape($query) ?>" placeholder="Un sujet, un nom, une date…" maxlength="200"></div>
      <div class="month-field"><label for="journal-month">Période</label><select id="journal-month" name="month"><option value="">Toutes les éditions</option><?php foreach ($months as $key => $label): ?><option value="<?= $key ?>"<?= $month === $key ? ' selected' : '' ?>><?= journal_escape(ucfirst($label)) ?></option><?php endforeach; ?></select></div>
      <button class="button" type="submit">Rechercher <span aria-hidden="true">→</span></button>
    </form>
    <?php if ($isFiltered): ?><div class="search-result" role="status"><p><?= $total ?> édition<?= $total > 1 ? 's' : '' ?> trouvée<?= $total > 1 ? 's' : '' ?><?= $query !== '' ? ' pour « ' . journal_escape($query) . ' »' : '' ?><?= $month !== '' ? ' en ' . journal_escape($months[$month] ?? $month) : '' ?>.</p><a href="./#editions">Effacer les filtres</a></div><?php endif; ?>
    <?php if ($visible): ?>
    <div class="edition-grid">
      <?php foreach ($visible as $value): ?>
      <article class="edition-card">
        <div class="card-date"><time datetime="<?= $value['date'] ?>"><span class="date-day"><?= (int)substr($value['date'], 8, 2) ?></span><span><?= journal_escape(preg_replace('/^\d+ /', '', journal_date_label($value['date'], false))) ?></span></time><?= $value['date'] === $latest['date'] ? '<span class="latest-dot">LA DERNIÈRE</span>' : '' ?></div>
        <h3><a href="<?= $value['date'] ?>.html"><?= journal_escape($value['articles'][0]['title'] ?? 'L’agenda et l’actualité de Kévin') ?></a></h3>
        <ul><?php foreach (array_slice($value['articles'], 1, 2) as $article): ?><li><a href="<?= $value['date'] ?>.html<?= $article['anchor'] ? '#' . $article['anchor'] : '' ?>"><?= journal_escape($article['title']) ?></a></li><?php endforeach; ?></ul>
        <div class="card-bottom"><span><?= count($value['articles']) ?> articles</span><a href="<?= $value['date'] ?>.html" aria-label="Lire l’édition du <?= journal_escape(journal_date_label($value['date'], false)) ?>">Lire l’édition <span aria-hidden="true">↗</span></a></div>
      </article>
      <?php endforeach; ?>
    </div>
    <?php else: ?>
    <div class="empty-state"><h3><?= $editions ? 'Aucune édition ne correspond.' : 'La première édition arrive bientôt.' ?></h3><p><?= $editions ? 'Essayez un autre mot-clé ou élargissez la période.' : 'Les éditions apparaîtront ici dès leur publication.' ?></p><?php if ($editions): ?><a href="./#editions">Voir toutes les éditions</a><?php endif; ?></div>
    <?php endif; ?>
    <?php if ($pageCount > 1): ?><nav class="archive-pagination" aria-label="Pages des archives"><?php if ($page > 1): ?><a href="<?= journal_escape(journal_query(['page' => (string)($page - 1)])) ?>" rel="prev">← Plus récentes</a><?php endif; ?><span>Page <?= $page ?> sur <?= $pageCount ?></span><?php if ($page < $pageCount): ?><a href="<?= journal_escape(journal_query(['page' => (string)($page + 1)])) ?>" rel="next">Plus anciennes →</a><?php endif; ?></nav><?php endif; ?>
  </section>
</main>
<footer class="portal-wrap portal-footer"><div><a class="footer-brand" href="./">Le Journal</a><p>Le brief de Kévin · <?= $currentYear ?></p></div><p>Vos éditions, au même endroit.<br>L’alerte quotidienne reste envoyée par mail.</p><a href="#contenu">Retour en haut ↑</a></footer>
</body></html>
