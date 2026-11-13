<?php
declare(strict_types=1);

// The portable server exposes app pages only, never the synced folder itself.
$root = getenv('TABLETOP_APP_ROOT') ?: dirname(__DIR__);
$instance = getenv('TABLETOP_INSTANCE_ID') ?: '';
$shareHost = getenv('TABLETOP_SHARE_HOST') ?: '127.0.0.1';
$host = strtolower(explode(':', $_SERVER['HTTP_HOST'] ?? '')[0]);
if (!in_array($host, ['127.0.0.1', 'localhost', strtolower($shareHost)], true)) {
    http_response_code(403); exit;
}
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
if ($path === '/__tabletop/health' && ($_SERVER['REQUEST_METHOD'] ?? '') === 'GET') {
    header('Content-Type: application/json');
    echo json_encode(['app' => 'tabletop-portable', 'instance' => $instance, 'processId' => getmypid(), 'phpVersion' => PHP_VERSION]);
    return true;
}
if ($path === '/api.php') {
    $_SERVER['SCRIPT_NAME'] = '/api.php';
    require $root . '/api.php';
    return true;
}
$files = ['/' => 'index.html', '/index.html' => 'index.html', '/organizer.html' => 'organizer.html', '/players.html' => 'players.html', '/README.md' => 'README.md'];
if (!isset($files[$path]) || !in_array($_SERVER['REQUEST_METHOD'] ?? '', ['GET', 'HEAD'], true)) {
    http_response_code(404); exit;
}
header('Content-Type: ' . (str_ends_with($files[$path], '.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8'));
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'HEAD') readfile($root . '/' . $files[$path]);
return true;
