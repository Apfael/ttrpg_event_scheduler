# Tabletop · portable TTRPG event planner

**Open `index.html` in your browser. Nothing to install.** No Docker, Node server, package installation, account, or application setup is needed to use this tool. The checked-in HTML file contains all styles, scripts, scheduling logic, and icons. It works offline.

Keep the app and its data together in a local or cloud-synced folder:

```text
Our gathering/
  index.html               Complete organizer app
  event.json               Roster, dates, responses, and schedule
  questionnaire.html       Exported player questionnaire / released schedule
  responses/
    response-<id>.json      One response file per player
```

The app creates `event.json` when you open a writable folder. Export `questionnaire.html` when ready to invite players; players create the response files. **Event data lives in these files alongside the app, rather than browser local storage.** Only the light/dark theme uses browser storage.

## Open and save an event

1. Download `index.html` using GitHub’s **Download raw file**, or copy it from your checkout. Put it in the folder for your event, including a cloud-synced folder on your computer.
2. Double-click it to open in a modern browser. If your cloud service shows an HTML preview, download/open the file in the browser instead.
3. In supported desktop browsers, click **Open event folder**, select the folder containing the app, and allow the browser’s folder access prompt. The app opens `event.json` if present; otherwise it writes the displayed event there. Subsequent organizer changes save directly to that file.
4. In other browsers, use **Open event file** and **Save event file**. Save/move the resulting `event.json` beside the app, replacing the previous copy. A downloaded `event (1).json` is another copy, not an update to the original.

The top banner shows whether a folder is connected or changes are only in the current tab. **Save before closing when no folder is open.** When reopening the app, open its folder/event file again. Copy or sync the whole folder to move the event to another computer.

Direct folder access uses the browser’s [directory picker API](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker), which is supported in Chromium desktop browsers such as Chrome and Edge but is not universal. Phones and other browsers use file import/save/download instead. Browser permission is necessary: an HTML file cannot silently read or overwrite neighboring files. No extension is required.

## Plan the gathering

The initial layout has six sample adventures and three future play windows, without fake player responses. **Overview → Try sample responses** adds 18 clearly marked sample players. Use **Event settings → Create a blank event** before configuring a real event. Use a separate folder per event.

- **Event settings:** enter the name, location, introduction, and IANA time zone (for example `Europe/Berlin`). Set parallel table count and whether every GM should receive at least one session. Choose **Rotation** for one adventure per available slot, or **Single session** for at most one session per player over the entire event.
- **Time slots:** enter date, start/end times, and a label. Times are local to the event time zone. Slots cannot overlap; use parallel tables for simultaneous games. Leave gaps for breaks. Each session occupies one slot; split overnight play at midnight.
- **Game roster:** define title, GM, minimum/maximum players excluding the GM, maximum repeat sessions, and allowed slots. Adventure name, game system, short description, and expandable long notes are optional. Use consistent GM names across offerings; case and surrounding spaces do not create separate identities.

Selecting every current slot makes a game available in future slots too. If the last explicitly allowed slot is deleted, the offering remains unavailable until you edit its allowed slots.

## Share the questionnaire and collect files

1. Choose **Share questionnaire → Save questionnaire HTML**. With an event folder connected, this writes `questionnaire.html` beside the app. Otherwise, save/move it there yourself.
2. Share that file or its individual cloud link. It includes games, dates, and any released schedule, but **no organizer response list or player names**. Keep `event.json` accessible only to your organizer team.
3. Players open it in a browser, enter a name, rank games, and choose available slots. Unranked games are never assigned. A GM who also wants to play selects their GM identity to prevent conflicts with running a session.
4. **Save my response file** creates `response-<id>.json`. Players put it in the shared `responses` subfolder, upload it using the cloud provider’s ordinary file interface, or send it to the organizers. Supported browsers also offer **Save into event folder**, which writes into the selected folder’s `responses` subfolder.
5. After cloud sync completes, organizers choose **Read response folder**, or **Import responses** to select received JSON files. New response IDs are added, newer versions update existing entries, and repeated imports do not create duplicates. Manual imports reject other-event files; folder scans skip them.

To update preferences, players use **Open my saved response** to load their original JSON before editing. Saving increments that response’s version. Starting again without loading the original produces a new ID; organizers can remove accidental duplicates. Removed response IDs remain excluded during future imports until **Allow importing them again** is selected. Conflicting equal versions are rejected, and older versions cannot replace newer ones.

**Saving a response creates a file; it does not upload it.** The organizer receives the choices only after the file reaches the event folder and is imported. Cloud-drive previews may not execute HTML; players can download and open the file instead.

## Schedule and share the result

Close preferences in Event settings, import the final responses, and choose a method in **Schedule**:

| Method | Focus |
| --- | --- |
| Balanced | Seat more distinct players and spread opportunities while considering rankings. |
| Preference first | Give greater weight to higher-ranked games. |
| Lottery | Randomize selection among willing players while seeking broad participation. |

All methods respect table capacity, player/GM availability, minimum/maximum groups, repeat limits, and the play format. Players cannot repeat an offering, sit at two tables simultaneously, or play while running a session under their selected GM identity. The GM coverage option prioritizes at least one session per GM, rather than one per adventure. Impossible coverage and unseated players are reported.

Scheduling uses a repeated greedy search, with fewer attempts for larger inputs. These are heuristic proposals, not guaranteed optimal allocations or audited lotteries. Review the draft and try another method if needed. Response and assignment CSVs are available for further review. Limits are 100 offerings, 30 slots, 16 parallel tables, and 2,000 responses; these are validation bounds, not performance guarantees for very large events.

Include the final schedule in the player export, then **export a fresh `questionnaire.html`** and share/replace it. Players open their saved response JSON in the new file to see their personal assignments. The public plan has games, GMs, tables, seat counts, and anonymous assignment IDs, without player names. Organizer CSVs contain names.

Files are snapshots: old downloaded copies do not update automatically. Closing preferences or excluding a schedule from future exports cannot change previously distributed copies. Organizer changes to settings, games, slots, or imported responses clear the schedule; regenerate and re-export afterward.

## Cloud folders and HTTPS links

For a **cloud-synced folder**, the browser edits local synced files; your existing cloud client handles transfer. The app installs no service and connects to no cloud accounts. Each player writes a separate response file. Let sync finish before importing or switching organizer computers.

For a **cloud web folder**, use the provider’s normal upload/download interface for these same files. If it supports hosting HTML, share its `questionnaire.html` URL. Static hosting, including GitHub Pages, can serve the HTML without running app software. Hosting is optional; offline file sharing needs no setup.

An HTTPS page cannot write back to an arbitrary cloud folder merely because its HTML is stored there. Automatic remote writes require an authorized provider API or upload endpoint. This version uses native browser file operations plus existing cloud upload/sync facilities. Its proposed hosted questionnaire URL is only a convenience: upload the file there before sharing the link.

HTML files themselves have no password protection. Use cloud sharing permissions to keep organizer data private and share the questionnaire individually. Do not publish `event.json`, private response files, or organizer CSVs in a public repository or web directory.

## Backups and team use

- Back up the entire event folder. `index.html` plus `event.json` is enough to continue organizing elsewhere; retain `responses/` for original submissions.
- Use **one organizer editing `event.json` at a time**. Before saving, the app checks whether the visible file changed since opening and refuses to overwrite a changed file. This is not a distributed lock: simultaneous offline edits on synced devices can still cause cloud conflicts. Reload before switching editors.
- Keep player response filenames stable when updating them. Use a separate folder per event.
- Real event files, exported questionnaires, and responses are ignored by Git.
- To migrate from the original server version, open its `data/event.json` using **Open event file**, then save into your event folder. Server-only edit credentials are discarded on import. Keep a copy of the original data directory before migrating.

## For contributors only

**The generated `index.html` is committed and ready to use. End users run no commands.** Node.js 22+ is optional developer tooling for rebuilding/checking sources and running tests, with no external packages to install.

```sh
npm run build
npm run check
npm test
```

```text
index.html           Complete portable app; double-click to use
public/index.html    Source HTML template
public/app.js        Interface and file pickers
public/styles.css    Responsive light/dark styles
lib/model.js         Browser-compatible event model and validation
lib/scheduler.js     Scheduling methods
lib/portable.js      File formats, imports, local actions, folder persistence
scripts/build.mjs    Generates the checked-in index.html
test/                Scheduler, file workflow, and bundle checks
```

After changing source files, rebuild and commit `index.html` too. Checks cover scheduling constraints, import/update behavior, public export privacy, folder writes/conflicts, and the standalone HTML bundle. Direct folder access is an enhancement; ordinary file import/save remains available.
