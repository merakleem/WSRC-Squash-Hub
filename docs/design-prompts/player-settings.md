# Claude Design prompt: player Settings page

Design a **Settings** page for **Play WSRC**, the member app of a squash club. Use the **PlayWSRC** design system and the linked codebase, and make it feel like the rest of the app. It's for players only; admins don't get it. Every screen must work on desktop and on a phone (the app switches to its mobile layout below 768px).

## What it holds

Organise these however reads best: one scrolling page with sections, tabs, or something else. Tell me why you chose it. There are three groups of settings.

**Profile**
- **Photo:** change or remove it, using the same upload and crop flow the profile page already has (`openPhotoModal()` in `renderer/pages/playerPhoto.js`). Players without a photo show their initials.
- **Name:** editable. It appears on the ladder, in brackets and on bookings.
- **Phone number:** editable, optional.
- **Member number** and **membership status:** shown read-only, so a member can check them.

**Sign-in and security**
- **Email:** this is also their login, so changing it is a confirmed change, not a plain edit:
  1. They enter a new address and save.
  2. The app emails a confirmation link to the **new** address. Until they click it, nothing changes: they still sign in with the old one.
  3. The page shows the pending change ("Waiting for you to confirm new@address. Check that inbox.") with options to resend the link or cancel the change.
  4. Once confirmed, the email changes and the old address gets a short notice that it was changed.
- **Password:** a button that emails them a password reset link (the app already has the reset email and page). Show the "sent" state.

**Email notifications** (one switch each)
| Setting | Default |
|---|---|
| Someone adds me to a court booking | **On** |
| A new league is announced | Off |
| A new tournament is announced | Off |
| A new event is posted | Off |
| Someone reports a score for my match | Off |

Add a short note that messages from the club (the admins' "Message players" emails) always arrive and can't be turned off.

Each switch saves as soon as it's flipped, with a quiet confirmation, unless you think a Save button is clearer. Profile and email changes need an explicit Save.

## Getting there

- **Desktop:** the account menu that opens from the profile card at the bottom of the sidebar currently has "My Profile" and "Logout". Add **Settings** between them. Markup: the `sbMenu` block in `renderer/index.html`; styles: "Account popover (players)" in `renderer/styles.css`.
- **Phone:** there is no account menu. The drawer has a profile header at the top (opens My Profile) and a Logout link at the bottom (`sb-drawer-profile`, `sb-drawer-foot`). Decide where Settings goes there.
- Consider whether the player's own profile page should link to Settings too (`renderer/pages/playerProfile.js`).

## States to show

- The page as a member first sees it, desktop and phone.
- Editing profile fields: unsaved changes, saving, saved, and an error (for example "Name is required").
- A player with no email on file at all: they can't sign in by email or get notifications. Show how the page explains that and lets them add one, with the same confirmation flow.
- Email change: entering the new address, the pending state with resend and cancel, and an error ("That email is already used by another member").
- Password reset link sent.
- The notification switches, including one being saved.
- **The confirmation link's landing page:** the page someone sees after clicking the link in the email, for success and for an expired or used link. These pages are server-rendered in the style of the app's sign-in pages (`authPage()` and `messagePage()` in `routes/auth.js`).

## One thing to remove

The court booking panel currently has a "Notify the selected players by email" checkbox, from the `design_handoff_booking_notify` handoff. Players now decide for themselves with the "Someone adds me to a court booking" switch, so the checkbox and its "has no email on file" hint come out of the panel. Confirm what the "Playing with" section looks like without them, and say if anything should take their place (for example nothing, or a quiet line that added players are emailed if they've chosen to be).

## Rules

- Design system components and tokens only. There's no toggle switch in the system yet; design one that fits, or use the existing `.check-label` checkbox if you think that's better.
- One primary button per screen.
- Realistic content: a member named Liam Gallagher, liam.gallagher@example.com, member number 1068.
- No em dashes in any copy.

## Handoff

Produce a handoff named `design_handoff_player_settings` with:

- Every screen and state above, desktop and phone, including the entry points and the email-confirmation landing pages.
- For each element, whether it's **existing (reused as is)**, **existing (modified, with what changed)**, or **new**, with markup and class names (a `ps-` prefix for new ones) and CSS using only existing tokens.
- All copy: labels, help text, confirmations, errors and toasts.
