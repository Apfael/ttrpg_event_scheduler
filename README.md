# Tabletop · TTRPG event planner

A small, self-hosted web app for bringing a roleplaying event together: define the games and dates, collect ranked player preferences, and generate a table schedule. The interface follows the device’s light/dark theme, with a manual theme switch. The player questionnaire is designed for phones; the organizer workspace makes good use of a desktop screen and also adapts to smaller devices.

This first version supports **one event per server**, with a shared organizer password. It uses plain HTML, CSS, browser JavaScript, and a Node.js server. There are **no external packages, build step, accounts for players, or third-party services**.

## Run locally

Install **Node.js 22 or later**. From this repository:

```sh
npm start
```

Open:

- Organizer workspace: [http://localhost:3000/organizer](http://localhost:3000/organizer)
- Player questionnaire: [http://localhost:3000/play](http://localhost:3000/play)

On the first run, the server creates a random organizer password in `data/organizer-key.txt`. Open that file locally and use its contents to sign in. Alternatively, set `ORGANIZER_PASSWORD` to a unique password of at least 12 characters before starting the server. The `data/` folder is excluded from Git.

No `npm install` is needed. For development, `npm run dev` restarts the server after server-side edits; refresh the browser after changing frontend files.

## Plan an event

1. **Explore or start fresh.** The first run includes six example adventures and three future time slots, with no player responses. Use **Overview → Try sample responses** to test scheduling with 18 clearly marked sample players. Use **Event settings → Create a blank event** before setting up a real gathering. This replaces the sample data and creates a new event identity.
2. **Set up the event.** Enter a name, location, introduction, and IANA time zone (for example `Europe/Berlin`). Choose the number of parallel tables, whether to prioritize a session for every GM, and a play format:
   - **Rotation:** a player may join one game in each available slot.
   - **Single session:** a player may join at most one game over the whole event.
3. **Add time slots.** Set the date, start time, end time, and a readable label for each play window. Times are local to the event time zone. Slots cannot overlap; use parallel tables for concurrent games. Leave gaps for meals and breaks. Each session occupies one whole slot. Split overnight play into separate slots on their respective dates.
4. **Build the game roster.** Each offering has a title, GM, minimum and maximum player counts (excluding the GM), and maximum number of sessions. Optional fields include game system, adventure name, a short description, and longer adventure notes. Long notes expand on click/tap, rather than relying on hover. A game’s allowed slots express its GM’s availability; checking every slot means it also becomes available in future slots you add. Separate offerings by the same GM share the same GM identity; use consistent names.
5. **Invite players.** Click **Share player link** and distribute the public `/play` URL. Players enter a name, rank games they are willing to play, and select available slots. Selecting a rank inserts that game into the ordered wishlist and renumbers the other choices. Unranked games will never be assigned. A GM who also wants to play should select their GM identity so the scheduler avoids conflicts with their own games.
6. **Close preferences.** Turn off **Accept player preferences** in Event settings and save. Refresh Player responses before reviewing the final list. You can export the responses as CSV.
7. **Generate and review.** In Schedule, choose a method and generate a private draft. Review unseated players and GM coverage warnings; try another method or change the offering/slot setup if needed. Export the table and player assignments as CSV if you want to adjust the result outside the app.
8. **Publish.** Publish the schedule when ready. Players return to the **same `/play` link**. The browser used to submit their preferences shows their personal assignments. The public schedule lists games, GMs, tables, and seat counts, without disclosing player names. Unpublish to remove the public schedule.

Players can update their submission from the same browser while preferences are open. Their private edit credential is saved in browser local storage; it survives a server restart. Clearing browser storage or switching devices loses that access. Organizers can look up assignments or remove a duplicate response. Players do not receive email notifications.

**Changes to event settings, games, slots, or responses clear any generated/published schedule.** Regenerate and republish after changes. Reopening preferences therefore starts another planning round.

## How scheduling works

Three methods are available:

| Method | Focus |
| --- | --- |
| Balanced | Seat more distinct players and spread opportunities across the event, while considering rankings. |
| Preference first | Give greater weight to higher-ranked games, while also rewarding participation. |
| Lottery | Randomize selection among players willing to join a game, while seeking broad participation. |

All methods enforce minimum/maximum group sizes, player availability, game/GM availability, maximum repeats, table capacity, and one concurrent session per GM. Players cannot repeat the same offering, sit at two tables at once, or play while running a game under their selected GM identity. The GM coverage option prioritizes **one session per GM**, rather than requiring every adventure offered by that GM to run.

The scheduler uses a seeded, repeated greedy search. The number of search attempts scales down for larger events. It is a **heuristic**, not a proof of an optimal or feasible schedule. GM coverage is a soft goal: insufficient demand, availability, or tables can make it impossible, and the draft reports unmet goals. A maximum session count is a limit, not a promise that all repeats will run. Lottery results are randomized proposals, not an audited drawing. The three methods are planning aids, not guarantees of seats or first choices.

The app is intended for small community events. Limits are 100 offerings, 30 slots, 16 parallel tables, and 2,000 responses; the upper limits are validation bounds, not a performance guarantee. Avoid simultaneous scheduling requests for large events. Manual drag-and-drop schedule editing, multiple event management, individual organizer accounts, and authenticated player identity are future extensions.

## Put it on a cloud server

The HTML is served by the Node server, which writes all shared event data and responses to a JSON file on the server’s disk. A static HTML file or GitHub Pages alone cannot persist shared responses. **This repository is ready to deploy; committing or pushing it does not automatically host it.**

Use a VPS or another host that runs a long-lived Node process with persistent disk, or use Docker. Give players an HTTPS URL on that server. Do not share a localhost URL with remote players.

### Docker Compose

1. Copy `.env.example` to `.env` and set a long, unique organizer password. The example password must be replaced.
2. For a public server, set `PUBLIC_URL=https://games.example.org` to your actual domain. Set `TRUST_PROXY=true` only when requests reach the app through your own HTTPS reverse proxy.
3. Build and run:

```sh
docker compose up -d --build
```

The app listens on `127.0.0.1:3000` on the host. The named `planner-data` volume preserves responses when the container is recreated. Keep that volume; `docker compose down -v` removes it.

Place your HTTPS reverse proxy in front of port 3000. For example, a host-installed Caddy server can use this Caddyfile after pointing your domain’s DNS at your server:

```caddyfile
games.example.org {
    reverse_proxy 127.0.0.1:3000
}
```

Allow ports 80/443 to reach the proxy. Keep the Node port private. The resulting links are:

- `https://games.example.org/organizer` — password-protected setup, responses, and scheduling.
- `https://games.example.org/play` — share this with your players.

For local Docker use, leave `PUBLIC_URL=http://localhost:3000` and `TRUST_PROXY=false`. For access through another hostname, set `PUBLIC_URL` to exactly that origin (scheme, hostname, and port).

### Run Node directly

Set environment variables using your host or service manager, then run `npm start`. For example, in PowerShell:

```powershell
$env:ORGANIZER_PASSWORD = 'your-long-unique-password'
$env:HOST = '127.0.0.1'
$env:PORT = '3000'
$env:DATA_DIR = 'D:\tabletop-data'
$env:PUBLIC_URL = 'https://games.example.org'
$env:TRUST_PROXY = 'true'
npm start
```

Use a service manager to restart the process on boot. Put an HTTPS reverse proxy in front of it. `npm start` does **not** automatically read `.env`; `.env` is consumed by Docker Compose, or you can use Node’s `--env-file=.env` flag explicitly.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind address; the Docker image uses `0.0.0.0` inside the container. |
| `PORT` | `3000` | HTTP port. |
| `DATA_DIR` | `./data` relative to the app | Persistent storage directory. |
| `ORGANIZER_PASSWORD` | Generated local key | Shared organizer password, at least 12 characters. |
| `PUBLIC_URL` | Current request origin | Expected browser origin for write requests. Set to the public HTTPS URL when hosted. |
| `TRUST_PROXY` | `false` | Trust the HTTPS scheme forwarded by your reverse proxy. |

Organizer sessions last 12 hours and are cleared on server restart. Shared passwords, session cookies, and player edit credentials should be treated as private. Password-protected endpoints guard roster writes and response access; requests use same-origin checks, strict cookies, input validation, and bounded bodies. Anonymous player submissions are intentionally open, with basic IP rate limits, so the app does not verify player identity or prevent all duplicates. Forwarded client IPs are not trusted: behind a proxy the submission limit is shared (30 writes/minute), and login attempts are limited to 10 per 15 minutes.

## Data and backups

- The authoritative file is `DATA_DIR/event.json`. Writes are serialized and use a temporary file plus rename, so readers do not see a half-written JSON document.
- Run **one server instance per data directory**. The JSON store is not a distributed database and does not support several processes writing the same file. Use a persistent volume, not ephemeral container/serverless disk.
- **Download JSON** in Event settings exports configuration, responses, and schedule for review, without response edit credentials. It is not an in-app restore package.
- For a full backup, stop the app briefly and copy the entire data directory (or snapshot the Docker volume). Restore that directory/volume before restarting to retain event identities and player edit access. Keep backups private. The app does not send data to another service.
- Keep `data/`, `.env`, passwords, and real player exports out of Git. Data is kept until organizers remove it or replace the event; agree on retention with your group.
- If the server cannot load the data file, it stops instead of overwriting it with sample data.

## Repository and checks

```text
public/            HTML, responsive styles, and browser interface
lib/model.js       Sample event and input validation
lib/scheduler.js   Scheduling methods and constraint handling
server.js          HTTP routes, organizer authentication, JSON persistence
test/              Scheduling invariants and real HTTP workflow tests
```

```sh
npm run check
npm test
```

Tests cover capacity, availability, GM/player conflicts, single-session mode, repeat limits, infeasible coverage, validation, protected writes, player updates, publication privacy, and restart persistence. API tests use a temporary data directory and do not change the event in your local `data/` folder.

This repo does not require a cloud account, CDN, online fonts, or internet access at runtime. It can also run on a local network for an in-person gathering: bind to an appropriate network interface and share the server’s LAN address. Use HTTPS for a public deployment.
