# Claude Design prompt: Knockout tournaments

Design a knockout tournament feature for **Play WSRC**, the member and admin web app of a squash club. Use the **PlayWSRC** design system in this project for every screen: its components, colours, fonts and rules. The README explains how. Every screen must work on desktop and on a phone (the app switches to its mobile layout below 768px).

## The feature in one paragraph

An admin announces a tournament with a cap of 8 or 16 players. Members see it on the Tournaments page, get a notification dot, and sign up. The admin then builds it in a wizard: confirm entrants, set the seeding, schedule each round, and preview the bracket. It is **single elimination, singles only**: 8 players play quarterfinals, semifinals and a final, and a 16-player draw adds a round of 16. There is no losers' bracket and no third-place match. If fewer players enter than the cap, the draw shrinks to the smallest size that fits (5 to 8 entrants make an 8-draw, 9 to 16 a 16-draw), and the byes go to the top seeds. Once built, the tournament has its own page with a **Bracket** tab and an **Entrants** tab. Scores are best of five (3–0, 3–1, 3–2).

## What already exists, so do not redesign it

These parts of the app already exist for leagues and will be reused as they are. Design only what is new or different. Where a screen below says "same as the league version", keep its layout and show only the changes.

The app's codebase is linked to this project. Its pages are plain JavaScript that build HTML in template strings, and all styling is in `renderer/styles.css`. Before designing, read the functions and stylesheet sections below. Recreate each existing screen from its markup and CSS, so your designs start from what is really there.

| Existing piece | Markup (function in file) | Styles (section in `renderer/styles.css`) |
|---|---|---|
| "New league" choice modal: "Announce it for signups" / "Build it now" | `openNewLeagueChoice()` in `renderer/pages/leagues.js` | `UPCOMING LEAGUES (lgl- card additions, lgu- page)` (the `lgl-choice` classes) |
| Announce modal: name, start date, sign-up deadline, spots cap, description | `openAnnounceModal()` in `renderer/pages/leagues.js` | same section |
| Upcoming league card, with its sign-up count bar and Sign up / Withdraw | `_upcomingCardHTML()` in `renderer/pages/leagues.js` | same section, plus `LEAGUES LIST` |
| Upcoming league page: hero, facts sidebar, member action, roster, admin add-member search, "Build this league" banner | the `lgu` functions near the top of `renderer/pages/leagueDetail.js` (hero, facts, member action, roster, `_wireLguAdd`) | `THE UPCOMING LEAGUE PAGE` |
| League wizard frame: clickable stepper, summary strip, footer with Back and Next | `renderCreateLeague()`, `_summaryHTML()`, `_footerHTML()` in `renderer/pages/createLeague.js` | `NEW LEAGUE WIZARD (wz-)`: stepper card, live summary strip, step card anatomy |
| Wizard player picker: club list in ladder order with search, selected list with seed numbers | `renderStep2()` in `renderer/pages/createLeague.js` | `NEW LEAGUE WIZARD`: "Step 2: player picker" |
| Wizard schedule panel: start time, match length, court chips, buffer, late-finish warning | `_step3RightHTML()` and `_playDaysHTML()` in `renderer/pages/createLeague.js` | `NEW LEAGUE WIZARD`: "Step 3: structure" and "Step 3: play days" |
| Wizard preview step: hero with stat tiles, schedule preview, Create footer | `_step5ShellHTML()` in `renderer/pages/createLeague.js` | `NEW LEAGUE WIZARD`: "Step 5: preview & confirm" |
| League page: hero, tab bar, admin Options menu (Message players, Send account invites, End, Delete) | `renderLeagueDetail()` in `renderer/pages/leagueDetail.js` | `LEAGUE DETAIL REDESIGN (lg-)` and `OPTIONS MENU` |
| Message players modal (rich-text email) and Send account invites modal | `openMessagePlayersModal()` and `openBulkInviteModal()` in `renderer/pages/leagues.js` | nearby modal sections |
| Notification dot on a nav item and on the phone hamburger | `renderer/unread.js` | the section containing "The hamburger's dot" (`um-dot`, `um-new`) |
| Match modal and best-of-five score entry | **MatchCard** and **ScorePicker** in the design system | already in the design system |

The current tournament screens are in `renderer/pages/tournaments.js`. They belong to an old groups format that this feature **replaces**, so don't copy their layout. Treat them only as reference for existing class names.

## Screens to design

### 1. Tournaments page (list)
Members can now see this page; until now it was admin-only. Show sections for **Open for signups**, **In progress** and **Completed**.
- **Announced tournament card:** name, draw cap (8 or 16) with a filled/cap bar ("6 of 16"), sign-up deadline, first-round date, faces of the entrants, and Sign up / Withdraw. Show a "new" marker when the member hasn't seen it yet.
- **In-progress card:** current round and the member's own next match if they're still in.
- **Completed card:** the champion.
- An **empty state**.
- Admins get a primary "New Tournament" button, which opens the same announce-or-build choice as leagues.

### 2. Announce tournament modal
Same as the league version, with two changes: **Draw size** is a required segmented choice between 8 and 16, replacing the free-number spots cap, and there is no format choice. Keep the name, a tentative start date, the sign-up deadline and the description.

### 3. Upcoming tournament page
Same as the upcoming league page, with these changes:
- The facts show the draw cap and spots left.
- The entrant list is ordered by current ladder rank, so members can see roughly where they'd be seeded.
- The admin banner says "Build this tournament".

States:
- open
- full (sign-up closes at the cap; the admin can still add or remove players)
- deadline passed
- member signed up / not signed up

### 4. Build wizard (new steps inside the existing wizard frame)
Steps: **Details → Players & seeding → Schedule → Preview**. There is no blackout-dates step. Details is the name, prefilled from the announcement. The summary strip shows name, entrants, draw size, byes and first-round date.

**Players & seeding (new):**
- Sign-ups are prefilled.
- The admin can add club members (search the club list, shown in ladder order) and remove entrants.
- A seeding control has two options: **By ladder** (default; seeds follow ladder rank, unranked players last) and **Manual**.
- The entrant list shows the seed number, name and ladder rank, and can be reordered. Design drag handles for desktop plus an accessible move up/down option that works on a phone. Reordering switches the control to Manual, and switching back to By ladder resets the order.
- A live draw indicator shows how many entrants, the draw size, the byes and who gets them ("11 entrants · 16-draw · seeds 1–5 get byes").
- Show these states:
  - not enough players to build
  - the cap reached
  - a player without a ladder rank

**Schedule (new layout, reusing the existing schedule panel):**
- One row per round (Round of 16, Quarterfinals, Semifinals, Final), each with its own **date** and **start time**. Show only the rounds the draw needs.
- Shared settings are the existing match length, buffer and court chips.
- Each round row shows the matches it holds and when it will finish; when there are more matches than courts it shows them in waves ("4 matches · 2 courts · ends ~8:40 PM").
- Show these warnings: late finish, a round dated before the previous round, and a court conflict with an existing booking.

**Preview (new):**
- The full bracket tree with every first-round matchup, byes marked, and later rounds as "Winner of QF1" placeholders.
- The schedule per round.
- The primary **Create Tournament** button.

Use the same visual bracket language as the chosen Bracket tab (section 6), in a compact form.

### 5. Tournament page
- A hero with name, status (Not started / Round of 16 / Quarterfinals… / Completed), dates, draw size, and the **champion** once finished.
- Tabs: **Bracket** and **Entrants**.
- The admin Options menu is the same as the league version: Message players, Send account invites, Edit schedule, Delete tournament.
- Tapping any match opens the existing MatchCard.
- A player can enter the score of their own match, and an admin can enter or edit any score, both through the existing ScorePicker. Show where that action sits in the bracket.

### 6. Bracket tab: design 3 distinct options
This is the centrepiece. I want **three genuinely different visual concepts** to choose from, for example a classic left-to-right tree, a two-sided tree that converges on a central final, and a round-by-round focused view. Each option must:
- **Read as a real bracket:** connector lines show who will meet whom. Selecting or hovering a player (or a match) highlights their path through the draw, the possible opponents in each later round, and "if X wins" lines.
- **Be easy to navigate on a phone:** a 16-draw has four rounds. Show how you move between rounds and still understand the tree (round tabs, swipe, pinch, collapse, or something better).
- **Show every state:**
  - not started
  - mid-tournament, with some rounds scored
  - completed, with the champion celebrated
  - byes
  - TBD slots
  - the signed-up member's own path, highlighted in the design system's "you" blue
- Show each match's date, time and court, and its score once played.
- Give admins a clear but quiet score-entry affordance, and players one on their own unplayed match only.
- Be shown at both **8** and **16** draws, on desktop and phone.

Present the three options side by side, with a short note on each explaining its strengths and trade-offs.

### 7. Entrants tab
- Players in seed order, with seed, avatar, name, ladder rank at seeding, and a status: still in, "Out in QF" (with the score), Runner-up, or Champion. Byes are marked.
- The signed-in member's own row is highlighted.
- Admins can replace or withdraw a player before their first match is played.

### 8. Small touches
- The Tournaments nav item gets the notification dot, the same as Leagues.
- MatchCard kicker text for these matches reads like "Spring Knockout · Quarterfinal".

## Rules
- Use design system components and tokens only. Don't introduce new colours or fonts. New layout CSS is fine.
- One primary button per screen.
- Show realistic squash-club data: real-looking names, dates, courts ("Court 1–3") and scores such as 3–1.
- Reuse over reinvent. If something I listed as existing would do the job, use it and say so.

## Handoff
When I pick a bracket option and we've iterated, produce a handoff named `design_handoff_knockout_tournament` containing:
- Each screen and state, desktop and phone.
- For every element, whether it is **existing (reused as-is)**, **existing (modified, with what changed)**, or **new**.
- For new elements, the markup structure with proposed class names, using a `ko-` prefix, and the CSS, using only the design system's tokens.
- The bracket interaction spec: what's selectable, what the highlights mean, and the phone navigation and gestures.
- All copy text, including empty, error and warning messages.
