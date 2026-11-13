# Tabletop · shared TTRPG event planner

**[Organizer](organizer.html) · [Players](players.html) · [Hosting](#put-the-app-online)**

One hosted app, one shared event. Organizers configure games and rules, share the player link, and receive preferences automatically. Players submit in their browser. All changes go to the same protected event data file beside the app. No questionnaire exports, response files, uploads by players, or manual imports.

The player questionnaire is a compact list of **game name, GM, and priority**. Capacity, system, adventure name, and descriptions are hidden under **More about this**. The interface adapts to phones and desktops and follows the system’s light/dark theme.

## Put the app online

Use **PHP-enabled web hosting with PHP 8.2 or later**, HTTPS, and a writable app folder. No Docker, Node server, package installation, database, or external account integration is needed on that host. The host must already provide PHP; a plain cloud-drive link or static-only host such as GitHub Pages cannot execute the write handler.

Upload these top-level files together into one web folder:

```text
gathering/
  index.html          Organizer entry, also the default page
  organizer.html      Direct organizer link
  players.html        Permanent player questionnaire link
  api.php             Shared read/write handler
  README.md           Instructions (optional)
```

1. Upload the files to your PHP web host. The development/source subfolders are not required on the host.
2. Open `https://your-host.example/gathering/organizer.html` yourself before sharing the link. The first visit lets you set the shared organizer password (12–72 bytes). This protects event setup, player responses, and scheduling. It is the app’s initial team login, not a software installation.
3. Configure the event, offerings, dates, and assignment rules in that browser page.
4. Share `https://your-host.example/gathering/players.html`, or use **Share player link**. Keep using this same link throughout the event.

PHP creates `event-data.php` and `event-lock.php` in the same folder. The first contains the entire event and authentication metadata as JSON behind a PHP access guard. The second coordinates writes. Temporary guarded files are used during atomic saves, then renamed/removed. These files should not be committed or overwritten when updating the application.

If the app reports a write failure, grant the hosting account’s PHP process write access to this folder using the host’s file manager. If PHP is downloaded or displayed as text, that hosting location is not executing PHP and is unsuitable. Opening HTML by double-clicking it is also insufficient for shared automatic saving; use the hosted HTTPS link.

This is portable between compatible PHP hosts: move the app files and its existing `event-data.php` together. It cannot run automatically in an arbitrary cloud storage folder without a server-side execution/write facility. Ordinary OneDrive/Google Drive/Dropbox file previews are not PHP hosting.

## Organizer workflow

**Event settings** controls the name, location, introduction, time zone, play format, parallel tables, and whether preferences are open. Times use the event’s IANA time zone, such as `Europe/Berlin`.

- **Rotation:** one game per player per available time slot, subject to the session limit.
- **Single session:** at most one session per player across the event.

**Time slots** defines dated play windows. Slots cannot overlap; use parallel tables for concurrent games. Leave gaps for breaks. A session occupies one whole slot. Split overnight play at midnight.

**Game roster** defines title, GM, minimum/maximum players excluding the GM, maximum repeat sessions, and allowed slots. Adventure name, game system, short description, and longer notes are optional. Use consistent GM names across offerings. Selecting all current slots also allows future slots; an offering whose last restricted slot is deleted remains unavailable until edited.

**Player responses** displays live submissions, ranked preferences, vetoes, and availability. While open, it checks for changes every 15 seconds; Refresh is available too. Optional CSV and JSON downloads are organizer exports, not part of collecting responses.

Edits to settings, games, slots, or responses clear an existing schedule. Configuration changes use a separate revision from player submissions, so saving settings preserves responses received while the form was open. Conflicting organizer edits are rejected rather than silently overwriting each other.

Removing a game or slot flags affected responses for review. Original ranks are retained: deleting a first choice cannot silently turn an old second choice into a supposedly fulfilled number-one preference. Reopen preferences when players need to revise their choices.

## Assignment methods and rules

Use the top-level **Assignment rules** navigation item to select:

| Method | What it prioritizes |
| --- | --- |
| Balanced | Broad participation and spreading opportunities across slots. |
| Preference score | Higher-ranked choices. |
| First-choice coverage | More distinct players receiving their number-one game at least once. |
| Lottery | Randomized selection among eligible players. |

Rules apply to every method:

- **Require every player to receive their first choice:** every responding player must receive at least one rank-1 assignment before the schedule can be published. If the draft fails, affected players are listed and publication is blocked. Adjust capacity, offerings, availability, the method, or the requirement.
- **Require at least one session per GM:** every distinct GM must have an allocated session before publication. This is across that GM’s offerings, not a requirement to run every offered adventure.
- **Allow unranked games as fallbacks:** disabled by default. When enabled, an unranked game may be assigned. An explicit veto is always excluded.
- **Maximum sessions per player:** `0` means up to all available slots; a positive number adds an event-wide cap. Single-session format always caps this at one.

Player vetoes are hard exclusions. All methods also enforce slot availability, player limits, GM conflicts, maximum repeats, no concurrent double booking, and no player repeating an offering. A GM who also wants to play selects their GM identity in the questionnaire so they cannot be seated while running a game.

The scheduler searches multiple candidate schedules in the organizer’s browser. PHP independently validates the submitted result against the current shared data and rules; changing browser-side flags cannot bypass vetoes or publication requirements. Saving a schedule is rejected if the event changed during generation.

The search is heuristic, not a mathematical proof of feasibility or optimality. A missing first choice in a draft does not prove that no valid schedule exists. Try another candidate/method or adjust the event. The tool never silently presents an unmet required guarantee as satisfied. Lottery is a randomized planning method, not an audited draw.

## Player workflow

1. Open the permanent player link and enter a name the team recognizes.
2. Choose priorities in the game list: `1` is the first choice. Selecting a rank inserts that game into the ordered choices and renumbers the others.
3. Mark **Veto · never assign** for games that must be excluded. A veto cannot also be ranked.
4. Expand **Availability** if any offered time slots do not work; all slots are initially selected. Game details and capacity are available under **More about this**.
5. Click **Submit preferences**. The browser saves directly to the shared event on the host. No file needs to be downloaded, sent, or imported.

The browser retains only a private edit credential; the authoritative preferences live on the server. Players can return in the same browser to update their response while preferences are open. Clearing browser storage or changing devices loses that credential; the organizers can look up assignments or remove duplicates. Anonymous player identity is not verified, and there are no email notifications.

## Generate and publish

Close preferences in Event settings, then open **Schedule**. Its method comes from Assignment rules. Generate and inspect a draft, including unseated players, unmet first choices, and GM coverage. Publication is disabled and also refused by PHP while required guarantees are unmet.

Publish when ready. The **same player link** now displays the schedule; players returning from their submitting browser see personal assignments. Open response/schedule views check for updates periodically. The public overview does not disclose player names or response edit credentials. Unpublish removes the public schedule immediately without distributing replacement HTML files.

## Data, security, and backups

- The authoritative shared store is `event-data.php`, in the same folder as the app. It holds configuration, responses, schedule, the hashed organizer password, response credential hashes, and bounded rate-limit metadata.
- Reads/writes coordinate through PHP file locking; changes use an atomic temporary-file rename. Concurrent player requests update the current store without replacing each other’s responses.
- Direct HTTP access to the data/lock PHP files returns 404 when PHP is configured correctly. Keep PHP execution enabled. Do not move the data file to a static-only public host.
- Organizer sessions use HTTP-only, same-site cookies and last up to 12 hours, subject to host session retention. Writes require a CSRF token. Requests and collection sizes are bounded. Players cannot call organizer actions.
- Basic IP limits apply to login attempts and response submissions. Proxied clients may share the same limit; forwarded client IPs are not trusted automatically.
- Back up `event-data.php` privately for full recovery. To restore, take the app out of use briefly, replace this file with the backup, and reopen it. An organizer JSON export excludes credentials and is a review/export copy, not a complete restore package.
- When updating the app, replace the HTML files and `api.php`; preserve the existing data file. Stop organizer editing briefly during an update. Do not sync an actively written data file across multiple running hosts: use one authoritative server.
- This version supports one event per app folder, 100 offerings, 30 slots, 16 parallel tables, and 2,000 responses. These limits are validation bounds, not performance guarantees for very large events. Create another hosted folder for a separate event.

## For contributors

Production needs only the four root application files above. Node.js 22+ is optional development tooling for bundling/checking JavaScript and running tests. There are no npm dependencies to install. PHP is needed to run the actual server integration tests.

```sh
npm run build
npm run check
php -l api.php
npm test
```

Set `PHP_BINARY` if PHP is not on PATH. Tests also recognize an ignored `test-results/php-runtime/php.exe` for local Windows checks. The PHP integration test uses a temporary app folder and exercises real HTTP submissions, concurrent clients, shared persistence, veto validation, first-choice publication blocking, privacy, CSRF protection, and restart recovery. It skips explicitly when no PHP executable is available.

```text
index.html / organizer.html / players.html  Ready-to-upload entry pages
api.php                                    Shared storage and validation
public/                                    Interface/style source templates
lib/model.js                               Browser model and validation
lib/scheduler.js                           Assignment methods and rules
lib/shared.js                              Same-origin PHP client
scripts/build.mjs                          Bundles the three root HTML files
test/                                      Scheduler, browser-bundle, and HTTP checks
```

Rebuild and commit all three HTML files after changing their source. The PHP handler is maintained directly at the repository root. The project has no Docker, separate database service, or production Node dependency.
