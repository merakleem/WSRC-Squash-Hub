# Squash Management System — Codebase Guide

## Architecture

Node.js + Express web app. No build step, no framework, no TypeScript.

- **Backend**: `server.js` — Express REST API + server-side auth + HTML page serving
- **Frontend**: `renderer/app.js` — single-file vanilla JS SPA (~5200 lines); `renderer/styles.css` — all styles
- **Database**: SQLite via `better-sqlite3` (synchronous). One file: `squash.db`
- **Models**: `models/` — pure DB query functions, no business logic
- **Services**: `services/` — business logic that coordinates across models (league creation, player ops)

The app was originally an Electron desktop app (`main/main.js` + `main/preload.js`) but has been converted to a web app. The Electron files are vestigial — the live system runs via `node server.js`.

## Running the App

```
npm start        # production
npm run dev      # same thing — node server.js
```

The server starts on the port in `.env` (see `.env.example`). Database is `squash.db` in the project root.

---

## File Map

### `server.js`
All HTTP routes. Sections (by `// =====` comments):
- **Auth**: session tokens (cookie-based), login/logout, invite flow, password reset
- **Rate limiters**: login, email sending
- **Page template**: SSR HTML shell for non-SPA pages (login, invite, etc.)
- **API routes**: players, leagues, matches, ladder, activity feed, schedule, bookings, booking types, courts

Auth middleware: `requireAuth` (any logged-in user), `requireAdmin` (admin-only routes).
All async routes wrapped with `wrap()` for automatic error handling.

### `renderer/app.js`
Single-page app. All navigation is in-memory (`navigate(page, params)`). Sections:

| Line range | Section |
|---|---|
| 1–70 | Web API shim — `window.api.*` calls map to `fetch()` against the REST API |
| 71–132 | Global state object, role helpers (`isAdmin()`), conflict-cursor helper |
| 133–187 | Utils: `esc()`, date formatters, `toast()`, modal system |
| 188–243 | Navigation: `navigate()`, `renderPage()` router |
| 244–299 | Dashboard helpers |
| 300–1163 | **Schedule page** — `renderSchedule()` and all drag/drop logic (see below) |
| 1164–1435 | Schedule modals: `openNewBookingModal`, `openEditBookingModal` |
| 1436–1763 | Club Activity page + Club Settings page (courts, booking types) |
| 1764–2045 | Dashboard page: `renderDashboard()` |
| 2046–2430 | Players page: list, add/edit/delete, CSV export/import |
| 2431–2599 | Player Profile page |
| 2600–2729 | Ladder page |
| 2730–3176 | Leagues list + print boxes + public link |
| 3177–3307 | Print Schedule (modern leagues) |
| 3308–4135 | League Detail page: week cards, match rows, score saving, sub modal |
| 4136–5200 | Create League wizard (5-step): both Traditional and Modern setup types |

### `renderer/styles.css`
All styles, no preprocessor. Sections follow the same page order as app.js.
Schedule-specific classes are prefixed `sch-`.

### `database/db.js`
Initialises the DB, runs `schema.sql`, then applies additive migrations (one `ALTER TABLE` per line, errors silently ignored). New columns always go here — never edit `schema.sql` for existing databases.

### `database/schema.sql`
Base schema for fresh installs. Does NOT include migrated columns.

### `models/`
Pure query functions. Return raw data — no HTML, no business logic.

| File | Covers |
|---|---|
| `bookingModel.js` | Bookings, booking types, schedule query (`getScheduleForDate`) |
| `courtModel.js` | Courts CRUD |
| `leagueModel.js` | Leagues, teams, divisions, matches, weeks, subs, byes |
| `ladderModel.js` | Ladder positions |
| `playerModel.js` | Players, user accounts, invite/reset tokens |

### `services/`
| File | Covers |
|---|---|
| `leagueService.js` | `createLeague()` — the complex multi-step league generation (weeks, matchups, matches) |
| `playerService.js` | Player CRUD with ladder sync side-effects |

---

## Database Schema — Key Tables

```
players          id, name, email, phone, member_number, wsrc_member, club_locker_rating, exclude_from_ladder
ladder           player_id → position
leagues          id, name, start_date, setup_type ('traditional'|'modern'), status, num_rounds, ...
divisions        league_id, name, level
teams            league_id, name, team_order
league_players   league_id, player_id, skill_rank, team_id (nullable), division_id
weeks            league_id, week_number, date
team_matchups    week_id, team1_id, team2_id, bye_team_id, division_id
matches          matchup_id, player1_id, player2_id, scores, winner_id, court_id, court_number, match_time, skipped, confirmed_at
match_subs       match_id, original_player_id, sub_player_id
week_byes        week_id, player_id, division_id
courts           id, name, sort_order, active
booking_types    id, name, color
bookings         id, court_id, date, start_time, duration_minutes, booking_type_id, info, group_id
league_courts    league_id, court_id  (many-to-many)
user_accounts    player_id, password_hash, invite_token, reset_token, ...
```

---

## Key Invariants

### Multi-court bookings (`group_id`)
Bookings that span multiple adjacent courts share a `group_id`. The **anchor row** is the one where `id === group_id`. This row is **never deleted** during updates — only updated in place. Non-anchor rows are deleted and re-inserted freely. This keeps all `SELECT WHERE id = ?` lookups on the group stable forever.

If you break this invariant (anchor gets deleted), the group becomes orphaned: it shows on the schedule, can't be moved, and can't be deleted. The `deleteBooking` function defensively sweeps orphaned members with `DELETE WHERE group_id = id` before the main delete.

### Adjacent-court validation
Multi-court bookings must span courts that are adjacent in `sort_order`. Validated in both `bookingModel.js` (`_checkAdjacency`) and the frontend before any drag commit.

### Schedule grid time range
`DAY_START = 6 * 60` (6am), `DAY_END = 23 * 60` (11pm). Both constants are at the top of `renderSchedule()`. Slot heights are `SLOT_H = 44px` per `SLOT_MIN = 30` minutes, scaled by `--zh` CSS variable for zoom.

### League match IDs on the schedule
Custom booking IDs are integers. League match IDs are strings like `"m_123"` (where 123 is the `matches.id`). This distinction is used throughout the drag system — `rawBid.startsWith('m_')` is the guard. League matches are draggable (time + court only) but cannot be selected, resized, or edited via modal. Dragging one calls `updateMatchTiming`, which writes back to `matches.match_time` and `matches.court_id` — the same row read by all league views.

### `excludeIds` for batch moves
When moving a selection of multiple bookings simultaneously, each `updateBooking` call passes `excludeIds` containing all *other* moving bookings' row IDs. This prevents false conflict errors when two selected bookings are swapping positions.

### Edge caching for resize cursors
The hover `mousemove` caches `_hoverEdge` (bottom/left/right/null). The `mousedown` handler reads the cached value instead of recalculating — necessary because the mouse can drift 1–2px between the two events, causing `getBookingEdge` to return null and falling through to a move instead of a resize.

---

## Auth Model

Session tokens are random hex strings stored in an in-memory `Map` on the server (lost on restart). Cookie name: `session`. Two roles: `admin` (set via `ADMIN_EMAIL` env var) and regular user. The frontend detects role via `GET /api/me` on load and caches it in `state.currentUser`.

CSRF protection: double-submit cookie pattern. Token in `X-CSRF-Token` header, validated on all mutating API calls.
