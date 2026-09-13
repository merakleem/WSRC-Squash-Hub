# Play WSRC

The Winnipeg Squash Racquet Club's app: court booking, leagues (singles and
doubles), the ladder, tournaments, events and member profiles. Live at
[playwsrc.ca](https://playwsrc.ca).

Node + Express, a vanilla-JS single-page app with no build step, and one
SQLite file. `CLAUDE.md` is the codebase guide (architecture, file map, the
invariants that matter); this file is how to run, test and ship it.

## Run it locally

```
npm install
cp .env.example .env      # then fill in SITE_PASSWORD and SESSION_SECRET
npm start                 # http://localhost:8080
```

The database is created on first start (`squash.db` in the project root, or
`DB_PATH`). Sign in as the admin with a blank email and `SITE_PASSWORD`. To
sign in as a member, add a player in the Players page, then use "View as" or
send yourself an invite (invites and every other email need `RESEND_API_KEY`;
without it the app shows the invite link to copy instead).

## Tests

```
npm test                          # node tests: models, services, the API in-process
npm run test:browser              # browser suites: real renderer modules, headless
npm run test:browser -- events    # one suite by name
npm run lint                      # ESLint, house style + correctness
```

The node tests build the Express app in-process with supertest against a
scratch database, so they need no port, no running server and no sleep; the
whole set runs in a few seconds. Each `ok(...)` is a reported assertion.
The browser suites are pages under `test/*.browser.html` that drive the real
UI modules and set their `<title>` to PASS or FAIL; the runner needs a
Playwright browser once: `npx playwright install chromium`.

`.github/workflows/test.yml` runs all three on every push and pull request.

## Environments and shipping

Two Railway environments, each with its own volume at `/data`:

| Branch    | Environment | URL |
|-----------|-------------|-----|
| `staging` | staging     | wsrc-squash-hub-staging.up.railway.app |
| `main`    | production  | playwsrc.ca |

A push deploys the branch. The rhythm: work on `staging`, let CI and the
staging site confirm it (on a phone too), then merge `staging` into `main`.
Railway waits for `GET /health` to answer 200 before it routes traffic to a
new deploy, and the server refuses to start if a schema migration fails, so a
bad deploy stays on the old version rather than serving a broken one.

Before a merge that carries a migration, take a production backup first
(below), and dry-run the migration on a copy.

**Staging email.** Staging holds a real Resend key, so it can send for real;
`EMAIL_REDIRECT_TO` catches every message and delivers it to one inbox with
the intended recipient in the subject, and `EMAIL_ALLOWLIST` names the
testers who receive theirs for real. Production sets neither. Staging data is
a scrubbed copy of production: emails rewritten to `player<id>@staging.invalid`,
phones removed, one known password on every account.

## Operations

- **Health**: `GET /health` reports the database, its schema version against
  the code's, journal mode and the last backup. 503 when something is wrong.
- **Logs**: JSON lines with `level` and `message`; Railway's log explorer
  parses them, and any field is searchable (`@requestId:...`, `@playerId:42`).
  Every response carries an `X-Request-Id` header that matches its log lines.
- **Errors**: set `SENTRY_DSN` and every 500, crash and failed job is
  reported there with the request's context.
- **Backups**: a verified copy of the database is written to `/data/backups`
  every night at 03:30 club time, the newest 14 kept. Set the `BACKUP_S3_*`
  variables to also gzip each one to an S3-compatible bucket. As the admin:
  `GET /api/backups` lists them, `POST /api/backups` takes one now, and
  `GET /api/backups/latest` downloads it.
- **Migrations**: `database/migrations.js`, numbered, applied once and
  recorded. A new column or table is a new entry there, never an edit to
  `schema.sql`.
- **Container**: the image runs the server as the `node` user; the entrypoint
  starts as root only long enough to hand it the data volume.

All variables are documented in `.env.example`.
