<?php
declare(strict_types=1);

// Only already published, dated HTML files belong to the archive. Project JSON,
// mail queues, temporary renders and arbitrary paths are never read here.
function journal_escape(string $value): string {
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function journal_date_valid(string $value): bool {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value)) return false;
    [$year, $month, $day] = array_map('intval', explode('-', $value));
    return $year >= 1000 && checkdate($month, $day, $year);
}

function journal_date_label(string $date, bool $weekday = true): string {
    $months = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    $days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    $value = new DateTimeImmutable($date, new DateTimeZone('Europe/Paris'));
    return ($weekday ? $days[(int)$value->format('w')] . ' ' : '') . (int)$value->format('d') . ' ' . $months[(int)$value->format('m')] . ' ' . $value->format('Y');
}

function journal_text(string $html): string {
    $html = preg_replace('~<(script|style)\b[^>]*>.*?</\1>~is', '', $html) ?? '';
    $html = preg_replace('~</(?:p|li|h[1-6]|div|article|section|td|th)>~i', ' ', $html) ?? '';
    return trim(preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags($html), ENT_QUOTES | ENT_HTML5, 'UTF-8')) ?? '');
}

function journal_search_text(string $value): string {
    $value = mb_strtolower($value, 'UTF-8');
    return strtr($value, ['à'=>'a','â'=>'a','ä'=>'a','á'=>'a','ç'=>'c','é'=>'e','è'=>'e','ê'=>'e','ë'=>'e','î'=>'i','ï'=>'i','ô'=>'o','ö'=>'o','ù'=>'u','û'=>'u','ü'=>'u','œ'=>'oe','æ'=>'ae','’'=>"'"]);
}

function journal_metadata(string $html, string $date): array {
    $document = new DOMDocument();
    $previous = libxml_use_internal_errors(true);
    try {
        $document->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
    } finally {
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
    }
    $xpath = new DOMXPath($document);
    $articles = [];
    foreach ($xpath->query('//article') as $article) {
        $heading = $xpath->query('.//*[self::h2 or self::h3 or self::h1]', $article)->item(0);
        if (!$heading) continue;
        $category = $xpath->query('.//*[contains(concat(" ", normalize-space(@class), " "), " story-category ") or contains(concat(" ", normalize-space(@class), " "), " kicker ")]', $article)->item(0);
        $anchor = $article->getAttribute('id');
        $image = null;
        $node = $xpath->query('.//img[@data-journal-image]', $article)->item(0);
        if ($node && preg_match('~^/journal/images/[a-z0-9][a-z0-9_-]{0,150}\.(?:webp|jpg|jpeg|png)$~D', $node->getAttribute('src'))) {
            $caption = $xpath->query('.//figcaption', $article)->item(0);
            $image = ['src'=>$node->getAttribute('src'), 'alt'=>$node->getAttribute('alt'),
                'caption'=>$caption ? trim(preg_replace('/\s+/u', ' ', $caption->textContent) ?? '') : '',
                'width'=>(int)$node->getAttribute('width'), 'height'=>(int)$node->getAttribute('height')];
        }
        $articles[] = [
            'title' => trim(preg_replace('/\s+/u', ' ', $heading->textContent) ?? ''),
            'category' => $category ? trim($category->textContent) : '',
            'anchor' => preg_match('/^[A-Za-z][A-Za-z0-9_-]*$/D', $anchor) ? $anchor : '',
            'image' => $image
        ];
    }
    return ['date' => $date, 'label' => journal_date_label($date), 'articles' => $articles];
}

function journal_editions(string $directory, string $query = ''): array {
    $editions = [];
    $terms = preg_split('/\s+/u', journal_search_text(trim($query)), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    foreach (glob($directory . '/*.html') ?: [] as $file) {
        $date = basename($file, '.html');
        if (!journal_date_valid($date) || is_link($file) || !is_readable($file)) continue;
        $html = file_get_contents($file);
        if ($html === false || !preg_match('/<main\b/i', $html) || !preg_match('/<\/html\s*>/i', $html)) continue;
        if ($terms) {
            $content = journal_search_text($date . ' ' . journal_date_label($date) . ' ' . journal_text($html));
            foreach ($terms as $term) {
                if (!str_contains($content, $term)) continue 2;
            }
        }
        $editions[$date] = journal_metadata($html, $date);
    }
    krsort($editions, SORT_STRING);
    return $editions;
}

function journal_query(array $changes = []): string {
    $parameters = array_merge([
        'q' => journal_parameter('q'), 'month' => journal_parameter('month'), 'page' => journal_parameter('page')
    ], $changes);
    $parameters = array_filter($parameters, fn($value) => $value !== '' && $value !== null);
    return './' . ($parameters ? '?' . http_build_query($parameters, '', '&', PHP_QUERY_RFC3986) : '') . '#editions';
}

function journal_parameter(string $name): string {
    $value = $_GET[$name] ?? '';
    return is_string($value) ? mb_substr(trim($value), 0, 200, 'UTF-8') : '';
}

function journal_navigation(array $editions, string $date, string $position = 'top'): string {
    $dates = array_keys($editions);
    $index = array_search($date, $dates, true);
    if ($index === false) throw new RuntimeException('Édition absente.');
    $older = $dates[$index + 1] ?? null;
    $newer = $index > 0 ? $dates[$index - 1] : null;
    $link = static fn(string $target, string $label, string $rel): string => '<a href="' . $target . '.html" rel="' . $rel . '">' . $label . '</a>';
    $options = '';
    foreach ($editions as $value) {
        $options .= '<option value="' . $value['date'] . '"' . ($value['date'] === $date ? ' selected' : '') . '>' . journal_escape($value['label']) . '</option>';
    }
    $id = 'journal-edition-' . $position;
    return '<nav class="journal-site-nav" aria-label="Navigation entre les éditions"><div class="journal-site-nav-inner">'
        . '<a class="journal-site-home" href="./">← Le Journal <span>Accueil &amp; archives</span></a>'
        . '<form action="index.php" method="get"><label for="' . $id . '">Édition</label><select id="' . $id . '" name="edition">' . $options . '</select><button type="submit">Lire</button></form>'
        . '<div class="journal-site-neighbors">' . ($older ? $link($older, '← Précédente', 'prev') : '<span>Première édition</span>')
        . ($newer ? $link($newer, 'Suivante →', 'next') : '<span>Dernière édition</span>') . '</div></div></nav>';
}

function journal_reader(string $html, array $editions, string $date): string {
    $style = '<link rel="stylesheet" href="site.css?v=3">';
    $html = preg_replace('/<\/head\s*>/i', $style . '</head>', $html, 1) ?? $html;
    // Insert UI around the document without parsing/reserializing its articles:
    // original text, source URLs, IDs, scripts and footer remain byte-for-byte.
    $nav = journal_navigation($editions, $date);
    $html = preg_replace_callback('/<body\b[^>]*>/i', fn($match) => $match[0] . $nav, $html, 1) ?? $html;
    return preg_replace('/<\/body\s*>/i', journal_navigation($editions, $date, 'bottom') . '</body>', $html, 1) ?? $html;
}
