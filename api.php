<?php
declare(strict_types=1);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

// Upload this file alongside the HTML entry points. No packages or database.
const DATA_GUARD = "<?php http_response_code(404); exit; ?>\n";
const DATA_FILE = __DIR__ . '/event-data.php';
const LOCK_FILE = __DIR__ . '/event-lock.php';
const METHODS = ['balanced', 'preference', 'lottery', 'first-choice'];
final class ApiError extends RuntimeException {
    public function __construct(string $message, public int $status = 400) { parent::__construct($message); }
}
function problem(string $message, int $status = 400): never { throw new ApiError($message, $status); }
function value_text(mixed $value, string $label, int $max = 200, bool $optional = false): string {
    if (!is_string($value) || !preg_match('//u', $value)) problem("$label must be valid text.");
    $value = trim($value); $length = preg_match_all('/./us', $value);
    if ((!$optional && $value === '') || $length > $max) problem("$label must contain " . ($optional ? 'at most' : 'between 1 and') . " $max characters.");
    return $value;
}
function number(mixed $value, string $label, int $min, int $max): int {
    if (!is_int($value) || $value < $min || $value > $max) problem("$label must be a whole number from $min to $max.");
    return $value;
}
function values(mixed $value, int $max, string $label): array {
    if (!is_array($value) || !array_is_list($value) || count($value) > $max) problem("Invalid $label list.");
    return $value;
}
function identifier(mixed $value): string {
    if (!is_string($value) || !preg_match('/\A[a-zA-Z0-9_-]{1,100}\z/', $value)) problem('Invalid identifier.');
    return $value;
}
function uuid(): string { return bin2hex(random_bytes(16)); }
function gm_key(string $value): string { return function_exists('mb_strtolower') ? mb_strtolower(trim($value), 'UTF-8') : strtolower(trim($value)); }
function by_id(array $items, mixed $id): ?array {
    foreach ($items as $item) if ($item['id'] === $id) return $item;
    return null;
}
function bool_value(array $input, string $key, bool $default = false): bool {
    $value = $input[$key] ?? $default;
    if (!is_bool($value)) problem("Invalid $key option.");
    return $value;
}
function event_fields(array $input): array {
    $zone = value_text($input['timezone'] ?? null, 'Time zone', 80);
    try { new DateTimeZone($zone); } catch (Throwable) { problem('Enter a valid IANA time zone.'); }
    $mode = $input['mode'] ?? '';
    if (!in_array($mode, ['rotation', 'free-choice'], true)) problem('Choose a valid play format.');
    $method = $input['assignmentMethod'] ?? 'balanced';
    if (!in_array($method, METHODS, true)) problem('Choose a valid assignment method.');
    return [
        'name' => value_text($input['name'] ?? null, 'Event name', 100), 'timezone' => $zone,
        'location' => value_text($input['location'] ?? '', 'Location', 160, true),
        'description' => value_text($input['description'] ?? '', 'Introduction', 3000, true),
        'mode' => $mode, 'parallelTables' => number($input['parallelTables'] ?? null, 'Parallel tables', 1, 16),
        'ensureEveryGm' => bool_value($input, 'ensureEveryGm', true), 'acceptingResponses' => bool_value($input, 'acceptingResponses', true),
        'assignmentMethod' => $method, 'requireFirstChoice' => bool_value($input, 'requireFirstChoice'),
        'allowUnranked' => bool_value($input, 'allowUnranked'), 'maxSessionsPerPlayer' => number($input['maxSessionsPerPlayer'] ?? 0, 'Sessions per player', 0, 30),
    ];
}
function organization_fields(array $input, array $current): array {
    $name = value_text($input['name'] ?? null, 'Organization name', 80);
    $logo = array_key_exists('logo', $input) ? $input['logo'] : ($current['logo'] ?? null);
    if ($logo === null || $logo === '') return ['name' => $name, 'logo' => null];
    if (!is_string($logo) || !preg_match('/\Adata:image\/(png|jpeg|webp);base64,([A-Za-z0-9+\/]*={0,2})\z/', $logo, $matches)) problem('Use a PNG, JPEG, or WebP logo image.');
    $bytes = base64_decode($matches[2], true);
    if ($bytes === false || strlen($bytes) > 262144) problem('Logo images must be 256 KB or smaller.');
    $image = @getimagesizefromstring($bytes);
    if (!$image || $image['mime'] !== 'image/' . $matches[1] || $image[0] > 1024 || $image[1] > 1024) problem('Use a valid PNG, JPEG, or WebP image no larger than 1024 × 1024 pixels.');
    return ['name' => $name, 'logo' => $logo];
}
function blank_state(): array {
    return ['version' => 1, 'revision' => 0, 'definitionRevision' => 0,
        'event' => ['id' => uuid(), 'sample' => false] + event_fields(['name' => 'Our tabletop gathering', 'timezone' => 'Europe/Berlin', 'mode' => 'rotation', 'parallelTables' => 3]),
        'games' => [], 'slots' => [], 'responses' => [], 'schedule' => null, 'published' => false];
}
function slot_fields(array $input, array $slots): array {
    $date = value_text($input['date'] ?? null, 'Date', 10);
    $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);
    if (!$parsed || $parsed->format('Y-m-d') !== $date) problem('Enter a valid date.');
    $start = $input['start'] ?? ''; $end = $input['end'] ?? '';
    foreach ([$start, $end] as $time) if (!is_string($time) || !preg_match('/\A(?:[01]\d|2[0-3]):[0-5]\d\z/', $time)) problem('Enter valid start and end times.');
    if ($end <= $start) problem('The slot must end after it starts, on the same day.');
    foreach ($slots as $slot) if ($slot['id'] !== ($input['id'] ?? null) && $slot['date'] === $date && $slot['start'] < $end && $slot['end'] > $start) problem('Time slots cannot overlap. Use parallel tables for concurrent games.');
    return ['label' => value_text($input['label'] ?? null, 'Slot name', 80), 'date' => $date, 'start' => $start, 'end' => $end];
}
function game_fields(array $input, array $slots): array {
    $min = number($input['minPlayers'] ?? null, 'Minimum players', 1, 30);
    $max = number($input['maxPlayers'] ?? null, 'Maximum players', $min, 30);
    $ids = values($input['slotIds'] ?? [], 30, 'allowed slot');
    foreach ($ids as $id) if (!by_id($slots, $id)) problem('Select valid game time slots.');
    return ['title' => value_text($input['title'] ?? null, 'Game title', 120), 'gm' => value_text($input['gm'] ?? null, 'GM', 80),
        'adventure' => value_text($input['adventure'] ?? '', 'Adventure', 120, true), 'system' => value_text($input['system'] ?? '', 'System', 80, true),
        'summary' => value_text($input['summary'] ?? '', 'Short description', 300, true), 'description' => value_text($input['description'] ?? '', 'Long description', 5000, true),
        'minPlayers' => $min, 'maxPlayers' => $max, 'runs' => number($input['runs'] ?? null, 'Maximum sessions', 1, 30), 'slotIds' => array_values(array_unique($ids))];
}
function response_fields(array $input, array $state): array {
    $preferences = values($input['preferences'] ?? null, 100, 'ranked preference');
    $vetoes = values($input['vetoes'] ?? [], 100, 'veto'); $availability = values($input['availability'] ?? null, 30, 'availability');
    if (!$preferences || count(array_unique($preferences, SORT_REGULAR)) !== count($preferences)) problem('Rank at least one game, with no duplicate priorities.');
    foreach (array_merge($preferences, $vetoes) as $id) if (!is_string($id) || !by_id($state['games'], $id)) problem('The roster changed. Reload the questionnaire and review your choices.');
    if (array_intersect($preferences, $vetoes) || count(array_unique($vetoes)) !== count($vetoes)) problem('A game cannot be both ranked and vetoed.');
    if (!$availability || count(array_unique($availability, SORT_REGULAR)) !== count($availability)) problem('Select at least one available time slot.');
    foreach ($availability as $id) if (!is_string($id) || !by_id($state['slots'], $id)) problem('Choose valid available time slots.');
    $gm = value_text($input['gm'] ?? '', 'GM identity', 80, true);
    if ($gm !== '' && !array_filter($state['games'], fn($g) => gm_key($g['gm']) === gm_key($gm))) problem('Select a GM from the roster.');
    return ['name' => value_text($input['name'] ?? null, 'Player name', 80), 'gm' => $gm, 'preferences' => $preferences, 'vetoes' => $vetoes, 'availability' => $availability, 'needsReview' => false];
}
function private_state(array $state): array {
    foreach ($state['responses'] as &$response) unset($response['tokenHash']);
    return $state;
}
function event_list(array $store): array {
    return array_values(array_map(fn($event) => ['id' => $event['event']['id'], 'name' => $event['event']['name'], 'location' => $event['event']['location']], $store['events']));
}
function admin_state(array $state, array $store): array {
    return private_state($state) + ['events' => event_list($store), 'organization' => $store['organization'], 'organizationRevision' => $store['organizationRevision']];
}
function public_state(array $state, array $organization): array {
    $schedule = null;
    if ($state['published'] && $state['schedule']) {
        $schedule = ['sessions' => array_map(function ($session) { $session['playerCount'] = count($session['playerIds']); unset($session['playerIds']); return $session; }, $state['schedule']['sessions'])];
    }
    return ['event' => $state['event'], 'organization' => $organization, 'definitionRevision' => $state['definitionRevision'], 'games' => $state['games'], 'slots' => $state['slots'], 'published' => $state['published'], 'schedule' => $schedule];
}
function schedule_fields(array $input, array $state): array {
    if ($state['event']['acceptingResponses']) problem('Close preferences before generating the schedule.');
    if (!$state['responses'] || !$state['games'] || !$state['slots']) problem('Add games, time slots, and player responses first.');
    if (($input['method'] ?? '') !== $state['event']['assignmentMethod']) problem('The assignment method changed. Generate the schedule again.');
    $sessions = []; $tables = []; $gms = []; $busy = []; $played = []; $runs = []; $counts = []; $first = [];
    foreach (values($input['sessions'] ?? null, 480, 'session') as $session) {
        if (!is_array($session)) problem('Invalid session.');
        $game = by_id($state['games'], $session['gameId'] ?? null); $slot = by_id($state['slots'], $session['slotId'] ?? null);
        if (!$game || !$slot) problem('Schedule refers to a missing offering or slot.');
        $table = number($session['table'] ?? null, 'Table', 1, $state['event']['parallelTables']);
        $ids = values($session['playerIds'] ?? null, $game['maxPlayers'], 'seated player');
        if (count($ids) < $game['minPlayers'] || count(array_unique($ids, SORT_REGULAR)) !== count($ids)) problem('Schedule violates group size limits.');
        if ($game['slotIds'] && !in_array($slot['id'], $game['slotIds'], true)) problem('Schedule violates GM availability.');
        $tableKey = $slot['id'] . ':' . $table; $gmSlot = $slot['id'] . ':' . gm_key($game['gm']);
        if (isset($tables[$tableKey]) || isset($gms[$gmSlot])) problem('Schedule double-books a table or GM.');
        $tables[$tableKey] = true; $gms[$gmSlot] = true; $runs[$game['id']] = ($runs[$game['id']] ?? 0) + 1;
        if ($runs[$game['id']] > $game['runs']) problem('Schedule exceeds repeat limits.');
        foreach ($ids as $id) {
            $player = by_id($state['responses'], $id);
            if (!$player || !in_array($slot['id'], $player['availability'], true)) problem('Schedule violates player availability.');
            if (in_array($game['id'], $player['vetoes'] ?? [], true)) problem('Schedule violates a player veto.');
            if (!$state['event']['allowUnranked'] && !in_array($game['id'], $player['preferences'], true)) problem('Unranked assignments are disabled.');
            $playerSlot = $slot['id'] . ':' . $id; $playerGame = $game['id'] . ':' . $id;
            if (isset($busy[$playerSlot]) || isset($played[$playerGame])) problem('Schedule double-books a player or repeats their adventure.');
            $counts[$id] = ($counts[$id] ?? 0) + 1;
            $cap = $state['event']['mode'] === 'free-choice' ? 1 : $state['event']['maxSessionsPerPlayer'];
            if ($cap && $counts[$id] > $cap) problem('Schedule exceeds the player session limit.');
            $busy[$playerSlot] = true; $played[$playerGame] = true;
            if (($player['preferences'][0] ?? null) === $game['id']) $first[$id] = true;
        }
        $sessions[] = ['id' => 'session-' . $slot['id'] . '-' . $table, 'slotId' => $slot['id'], 'gameId' => $game['id'], 'table' => $table, 'playerIds' => $ids];
    }
    foreach ($sessions as $session) foreach ($session['playerIds'] as $id) {
        $player = by_id($state['responses'], $id);
        if ($player['gm'] !== '' && isset($gms[$session['slotId'] . ':' . gm_key($player['gm'])])) problem('A GM cannot play while running a game.');
    }
    $unseated = []; $unmet = []; $missing = []; $scheduledGms = [];
    foreach ($state['responses'] as $player) { if (!isset($counts[$player['id']])) $unseated[] = $player['id']; if (!isset($first[$player['id']])) $unmet[] = $player['id']; }
    foreach ($sessions as $session) $scheduledGms[gm_key(by_id($state['games'], $session['gameId'])['gm'])] = true;
    foreach ($state['games'] as $game) if (!isset($scheduledGms[gm_key($game['gm'])])) $missing[gm_key($game['gm'])] = $game['gm'];
    $warnings = [];
    if ($unseated) $warnings[] = count($unseated) . ' players have no session. Review capacity, availability, and minimum group sizes.';
    if ($state['event']['ensureEveryGm'] && $missing) $warnings[] = 'Required GM coverage is unmet for: ' . implode(', ', array_values($missing)) . '. Publication is blocked.';
    $firstValid = !$state['event']['requireFirstChoice'] || !$unmet;
    $valid = $firstValid && (!$state['event']['ensureEveryGm'] || !$missing);
    if (!$firstValid) $warnings[] = 'First-choice requirement is unmet for ' . count($unmet) . ' players. Publication is blocked until the plan or rule is changed.';
    return ['method' => $input['method'], 'seed' => is_int($input['seed'] ?? null) ? $input['seed'] : 0, 'generatedAt' => gmdate('c'), 'sessions' => $sessions, 'unseated' => $unseated, 'missingGms' => array_values($missing), 'unmetFirstChoices' => $unmet, 'validForPublication' => $valid, 'warnings' => $warnings];
}
function save_store(array $store): void {
    $content = DATA_GUARD . json_encode($store, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT | JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES);
    $temporary = __DIR__ . '/event-temp-' . uuid() . '.php';
    try {
        if (file_put_contents($temporary, $content) !== strlen($content)) throw new RuntimeException('Incomplete data write.');
        @chmod($temporary, 0600);
        // A cloud-sync client or virus scanner can briefly hold a Windows file.
        $committed = false;
        foreach ([0, 50000, 100000, 200000] as $delay) {
            if ($delay) usleep($delay);
            if (@rename($temporary, DATA_FILE)) { $committed = true; break; }
        }
        if (!$committed) throw new RuntimeException('Could not commit shared event data.');
    } finally { if (is_file($temporary)) @unlink($temporary); }
}
function limit_attempt(array &$store, string $kind, int $maximum, int $seconds): void {
    $key = hash('sha256', $kind . ':' . ($_SERVER['REMOTE_ADDR'] ?? 'local'));
    $now = time(); $store['limits'] = array_filter($store['limits'] ?? [], fn($entry) => $entry['until'] > $now);
    if (count($store['limits']) > 1000) $store['limits'] = array_slice($store['limits'], -500, null, true);
    $entry = $store['limits'][$key] ?? ['count' => 0, 'until' => $now + $seconds];
    if ($entry['count'] >= $maximum) problem('Too many attempts. Try again later.', 429);
    $entry['count']++; $store['limits'][$key] = $entry;
}
function signed_in(): bool { return ($_SESSION['organizer_until'] ?? 0) > time(); }
function dispatch(string $action, array $input, ?array &$store, bool &$dirty): array {
    if ($action === 'status') return ['initialized' => $store !== null, 'authenticated' => signed_in(), 'csrf' => $_SESSION['csrf'],
        'organization' => $store['organization'] ?? ['name' => 'tabletop.', 'logo' => null]];
    if ($action === 'setup') {
        if ($store !== null) problem('This app is already configured. Sign in as an organizer.', 409);
        $password = value_text($input['password'] ?? null, 'Organizer password', 200);
        if (strlen($password) < 12 || strlen($password) > 72) problem('Use an organizer password between 12 and 72 bytes.');
        $state = blank_state();
        $store = ['version' => 1, 'passwordHash' => password_hash($password, PASSWORD_DEFAULT), 'state' => $state,
            'events' => [$state['event']['id'] => $state], 'activeEventId' => $state['event']['id'],
            'organization' => ['name' => 'tabletop.', 'logo' => null], 'organizationRevision' => 0, 'limits' => []];
        $dirty = true; session_regenerate_id(true); $_SESSION['organizer_until'] = time() + 43200;
        return ['ok' => true];
    }
    if ($store === null) problem('The organizers have not set up this event yet.', 503);
    if ($action === 'login') {
        limit_attempt($store, 'login', 10, 900); $dirty = true;
        $password = $input['password'] ?? '';
        if (!is_string($password) || strlen($password) > 72 || !password_verify($password, $store['passwordHash'])) return ['error' => 'That organizer password did not match.', '_status' => 401];
        session_regenerate_id(true); $_SESSION['organizer_until'] = time() + 43200; return ['ok' => true];
    }
    if ($action === 'logout') { unset($_SESSION['organizer_until']); session_regenerate_id(true); return ['ok' => true]; }
    if ($action === 'events') {
        if (!signed_in()) problem('Please sign in as an organizer.', 401);
        return ['events' => event_list($store)];
    }
    if (in_array($action, ['event-create', 'new-event'], true)) {
        if (!signed_in()) problem('Please sign in as an organizer.', 401);
        $state = blank_state(); $state['event']['name'] = 'New gathering ' . (count($store['events']) + 1); $id = $state['event']['id'];
        $store['events'][$id] = $state; $store['activeEventId'] = $id; $store['state'] = $state;
        $dirty = true;
        return admin_state($state, $store);
    }
    $state =& $store['state'];
    if ($action === 'event') return public_state($state, $store['organization']);
    if ($action === 'my-response') {
        $token = $_SERVER['HTTP_X_TABLETOP_RESPONSE'] ?? $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
        if (!preg_match('/\ABearer ([a-f0-9]{64})\z/', $token, $matches)) problem('No saved response on this browser.', 404);
        foreach ($state['responses'] as $response) if (hash_equals($response['tokenHash'], hash('sha256', $matches[1]))) {
            unset($response['tokenHash']); $assignments = [];
            if ($state['published']) foreach ($state['schedule']['sessions'] as $session) if (in_array($response['id'], $session['playerIds'], true)) { unset($session['playerIds']); $assignments[] = $session; }
            return ['response' => $response, 'assignments' => $assignments];
        }
        problem('No saved response on this browser.', 404);
    }
    if ($action === 'respond') {
        if (!$state['event']['acceptingResponses']) problem('Preferences are closed. Contact the organizers to make a change.');
        if (($input['eventId'] ?? '') !== $state['event']['id'] || ($input['definitionRevision'] ?? -1) !== $state['definitionRevision']) problem('The event changed. Reload the questionnaire and review your choices.', 409);
        $valid = response_fields($input, $state); $old = null; $index = null;
        $token = $input['token'] ?? '';
        if ($token !== '') {
            if (!is_string($token) || !preg_match('/\A[a-f0-9]{64}\z/', $token)) problem('Invalid response edit credential.');
            foreach ($state['responses'] as $i => $response) if (hash_equals($response['tokenHash'], hash('sha256', $token))) { $old = $response; $index = $i; break; }
            if (!$old) problem('Your response was removed. Reload the questionnaire before submitting again.', 409);
        } else $token = bin2hex(random_bytes(32));
        if (!$old && count($state['responses']) >= 2000) problem('This event has reached its response limit.');
        limit_attempt($store, 'respond', 60, 60);
        $response = $valid + ['id' => $old['id'] ?? uuid(), 'updatedAt' => gmdate('c'), 'tokenHash' => hash('sha256', $token)];
        if ($index === null) $state['responses'][] = $response; else $state['responses'][$index] = $response;
        $state['schedule'] = null; $state['published'] = false; $state['revision']++; $dirty = true;
        return ['ok' => true, 'token' => $token];
    }
    if (!signed_in()) problem('Please sign in as an organizer.', 401);
    if ($action === 'admin' || $action === 'backup') {
        return $action === 'admin' ? admin_state($state, $store) : private_state($state);
    }
    if ($action === 'organization-save') {
        if (($input['expectedOrganizationRevision'] ?? -1) !== $store['organizationRevision']) problem('Organization branding changed in another window. Refresh before saving this change.', 409);
        $store['organization'] = organization_fields($input, $store['organization']); $store['organizationRevision']++;
        $dirty = true; return admin_state($state, $store);
    }
    $configurationAction = in_array($action, ['event-save', 'game-save', 'slot-save'], true);
    $currentRevision = $configurationAction ? $state['definitionRevision'] : $state['revision'];
    $expectedRevision = $input[$configurationAction ? 'expectedDefinitionRevision' : 'expectedRevision'] ?? -1;
    if ($expectedRevision !== $currentRevision) problem('The event changed in another window. Refresh before saving this change.', 409);
    $configuration = false;
    if ($action === 'event-save') {
        $state['event'] = array_merge($state['event'], event_fields($input)); $configuration = true;
    } elseif ($action === 'game-save' || $action === 'slot-save') {
        $game = $action === 'game-save'; $collection = $game ? 'games' : 'slots';
        $value = $game ? game_fields($input, $state['slots']) : slot_fields($input, $state['slots']);
        $id = $input['id'] ?? null; $index = null;
        foreach ($state[$collection] as $i => $item) if ($item['id'] === $id) $index = $i;
        if ($id !== null && $index === null) problem('This item no longer exists. Refresh the workspace.');
        if ($index === null && count($state[$collection]) >= ($game ? 100 : 30)) problem('Offering or slot limit reached.');
        $value['id'] = $id ?? uuid();
        if ($index === null) $state[$collection][] = $value; else $state[$collection][$index] = $value;
        usort($state['slots'], fn($a, $b) => strcmp($a['date'] . $a['start'], $b['date'] . $b['start'])); $configuration = true;
    } elseif ($action === 'delete') {
        $collection = ['game' => 'games', 'slot' => 'slots', 'response' => 'responses'][$input['type'] ?? ''] ?? null;
        if (!$collection) problem('Invalid item type.'); $id = identifier($input['id'] ?? null);
        $state[$collection] = array_values(array_filter($state[$collection], fn($item) => $item['id'] !== $id));
        // Preserve original ranks: removing rank 1 must not silently promote rank 2
        // and then claim that the player's original first-choice guarantee was met.
        foreach ($state['responses'] as &$response) {
            $affected = $collection === 'games' ? array_merge($response['preferences'], $response['vetoes']) : ($collection === 'slots' ? $response['availability'] : []);
            if (in_array($id, $affected, true)) $response['needsReview'] = true;
        }
        unset($response);
        if ($collection === 'slots') foreach ($state['games'] as &$game) if ($game['slotIds']) { $game['slotIds'] = array_values(array_filter($game['slotIds'], fn($value) => $value !== $id)); if (!$game['slotIds']) $game['slotIds'] = ['unavailable']; }
        unset($game); $configuration = $collection !== 'responses'; $state['schedule'] = null; $state['published'] = false;
    } elseif ($action === 'schedule-save') {
        if (!is_array($input['schedule'] ?? null)) problem('Invalid draft schedule.');
        $state['schedule'] = schedule_fields($input['schedule'] ?? [], $state); $state['published'] = false;
    } elseif ($action === 'publish') {
        if (empty($state['schedule']['sessions'])) problem('Generate a schedule with at least one session.');
        if (!$state['published'] && !$state['schedule']['validForPublication']) problem('A required first-choice guarantee or GM coverage rule is unmet. Adjust the schedule or rules before publishing.');
        $state['published'] = !$state['published']; $state['event']['acceptingResponses'] = false;
    } else problem('Unknown action.', 404);
    if ($configuration) { $state['schedule'] = null; $state['published'] = false; $state['definitionRevision']++; }
    $state['revision']++; $dirty = true; $store['events'][$state['event']['id']] = $state;
    return admin_state($state, $store);
}

$lock = null;
try {
    header('Content-Type: application/json; charset=utf-8'); header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff'); header('X-Frame-Options: DENY'); header('Referrer-Policy: same-origin');
    ini_set('session.use_strict_mode', '1'); session_name('tabletop_session');
    $cookiePath = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/api.php')), '/') . '/';
    session_set_cookie_params(['lifetime' => 43200, 'path' => $cookiePath, 'httponly' => true, 'samesite' => 'Strict', 'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off']);
    if (!session_start()) throw new RuntimeException('PHP session storage is unavailable. Check the host session directory.');
    $_SESSION['csrf'] ??= bin2hex(random_bytes(32));
    $action = $_GET['action'] ?? 'status'; $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $read = in_array($action, ['status', 'event', 'my-response', 'admin', 'backup', 'events'], true);
    if ($method !== ($read ? 'GET' : 'POST')) problem('Method not allowed.', 405);
    $input = [];
    if (!$read) {
        if (!hash_equals($_SESSION['csrf'], $_SERVER['HTTP_X_TABLETOP_CSRF'] ?? '')) problem('Reload the page before submitting this form.', 403);
        if (!str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) problem('Send JSON form data.');
        $raw = file_get_contents('php://input', false, null, 0, 2097153);
        if (strlen($raw) > 2097152) problem('Request is too large.', 413);
        try { $input = json_decode($raw, true, 64, JSON_THROW_ON_ERROR); } catch (JsonException) { problem('Invalid JSON form data.'); }
        if (!is_array($input) || array_is_list($input) && $input !== []) problem('Invalid form data.');
    }
    if (!is_file(LOCK_FILE)) { $created = @fopen(LOCK_FILE, 'x'); if ($created) { fwrite($created, DATA_GUARD); fclose($created); @chmod(LOCK_FILE, 0600); } }
    $lock = @fopen(LOCK_FILE, 'r+');
    if (!$lock || !flock($lock, LOCK_EX)) throw new RuntimeException('Make the app folder writable by PHP so it can store shared event data.');
    $store = null; $migrationDirty = false;
    if (is_file(DATA_FILE)) {
        $raw = file_get_contents(DATA_FILE);
        if (!str_starts_with($raw, DATA_GUARD)) throw new RuntimeException('Shared data file is invalid. Restore a backup; it has not been overwritten.');
        $store = json_decode(substr($raw, strlen(DATA_GUARD)), true, 64, JSON_THROW_ON_ERROR);
        if (($store['version'] ?? null) !== 1 || !isset($store['state'], $store['passwordHash'])) throw new RuntimeException('Unsupported shared data file.');
        if (!isset($store['events'])) {
            $legacy = $store['state']; $id = $legacy['event']['id'] ?? null;
            if (!is_string($id) || !preg_match('/\A[a-f0-9-]{1,100}\z/', $id)) throw new RuntimeException('Unsupported legacy event data.');
            $store['events'] = [$id => $legacy]; $store['activeEventId'] = $id; $migrationDirty = true;
        }
        if (!isset($store['organization']) || !isset($store['organizationRevision'])) {
            $store['organization'] ??= ['name' => 'tabletop.', 'logo' => null]; $store['organizationRevision'] ??= 0; $migrationDirty = true;
        }
    }
    $selectedEvent = null;
    if ($store !== null && !in_array($action, ['status', 'setup', 'login', 'logout', 'events', 'event-create', 'new-event'], true)) {
        $selectedEvent = $_GET['event'] ?? $store['activeEventId'];
        if (!is_string($selectedEvent) || !preg_match('/\A[a-f0-9-]{1,100}\z/', $selectedEvent) || !isset($store['events'][$selectedEvent])) problem('This event could not be found.', 404);
        $store['state'] = $store['events'][$selectedEvent];
    }
    $dirty = $migrationDirty; $result = dispatch($action, $input, $store, $dirty);
    if ($selectedEvent !== null && $dirty) {
        $store['events'][$selectedEvent] = $store['state'];
        if (($store['activeEventId'] ?? null) === $selectedEvent) $store['state'] = $store['events'][$selectedEvent];
    }
    if ($dirty) save_store($store);
    flock($lock, LOCK_UN); fclose($lock); $lock = null;
    $status = $result['_status'] ?? 200; unset($result['_status']); http_response_code($status);
    if ($action === 'backup') header('Content-Disposition: attachment; filename="tabletop-event.json"');
    echo json_encode($result, JSON_THROW_ON_ERROR | JSON_HEX_TAG);
} catch (Throwable $error) {
    if (is_resource($lock)) { flock($lock, LOCK_UN); fclose($lock); }
    $status = $error instanceof ApiError ? $error->status : 500; http_response_code($status);
    if ($status === 500) error_log((string)$error);
    echo json_encode(['error' => $status === 500 ? 'Cannot read or save shared event data. Check PHP session storage, app-folder permissions, and data-file validity.' : $error->getMessage()]);
}
