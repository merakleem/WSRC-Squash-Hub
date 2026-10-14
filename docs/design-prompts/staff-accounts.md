# Claude Design prompt: staff accounts, permissions and Settings tabs

Design **staff accounts** for **Play WSRC**, the squash club's member and admin app. Use the **PlayWSRC** design system and the linked codebase, and make it feel like the rest of the admin side. Every screen must work on desktop and on a phone (the app switches to its mobile layout below 768px).

## Background

Today "admin" is a single shared password. Several club staff sign in with it (a blank email plus that password) and all get full control. We're replacing that with:

- **One owner account**, which can't be restricted and is the only account that manages staff.
- **Staff accounts**: each person has their own name, email, password and a set of permissions the owner chooses.

Staff accounts are completely separate from player accounts. Staff who also play keep their player account and sign in to it separately. They aren't players: they never appear in player lists, the ladder, brackets or the activity feed that players see.

This ships in two parts. **Design both now so they match. We'll build part 1 first.**

- **Part 1: staff accounts.** The shared password keeps working throughout, and during this part it *is* the owner. Staff are invited and set up their own accounts while everyone still has access.
- **Part 2: securing the owner account.** The owner sets their own email, a new password and two-step sign-in. Then the shared password stops working.

## Part 1

### Permissions
The owner turns each one on or off per staff member. The editor has **Select all** and **Clear all** for quick setup.

| Permission | Covers |
|---|---|
| Players and accounts | Add and edit players, membership, account invites, password resets, "View as" a member |
| Leagues | Create, edit and run leagues |
| Tournaments | Create, edit and run tournaments |
| Events | Create and edit events and their signups |
| Court schedule and bookings | The admin court schedule, admin bookings |
| Scores | Enter or correct any match result |
| Message players | Group emails and account invites to players |
| Ladder and seasons | Seasons, joining the ladder, winning margin (the game rules) |
| Courts and booking types | Courts and booking types |
| Club settings | Club-wide settings such as the time zone |
| Activity log | Read the activity log |

Managing staff accounts is **owner only** and never a permission, so no one can grant themselves access.

### Two-step sign-in for staff
Each staff account has a **Require two-step sign-in** switch, set by the owner. When it's on, that person signs in with their password and then a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Apple Passwords). These apps all use the standard TOTP method and we use them as they are. During setup they scan a QR code and save a set of one-time backup codes.

### Settings, reorganised into tabs
Today's Club Settings is one long page (`renderClubSettings()` in `renderer/pages/dashboard.js`; styles in the `CLUB SETTINGS` section of `renderer/styles.css`). Rename it **Settings** and split it into tabs. Each tab shows only to people with its permission:

| Tab | Contains | Who sees it |
|---|---|---|
| Club | Time zone | Club settings |
| Ladder and seasons | Seasons, joining the ladder, winning margin | Ladder and seasons |
| Courts and booking | Courts, booking types | Courts and booking types |
| Staff accounts | New: the staff list, invites, permissions, two-step requirement | Owner only |
| Activity log | New | Activity log |
| My account | New: your own name, email, password and two-step sign-in | Every staff member |

Today's existing settings keep their current controls; only where they live changes.

### Screens to design

1. **Settings with tabs:** the owner's view (all tabs) and a limited staff member's view (for example only "My account" and "Ladder and seasons"). Show how the tabs behave on a phone.
2. **Staff accounts tab:**
   - The list: name, email, status (Invited / Active / Disabled), two-step required or not, last signed in.
   - The empty state, while everyone still uses the shared login.
3. **Invite a staff member:** name, email, the permissions editor with Select all / Clear all, and the two-step switch. Explain that the email must differ from their player account's, and that Gmail users can use an alias such as `sam+staff@gmail.com`, which arrives in the same inbox.
4. **Edit a staff member:**
   - Permissions and the two-step switch.
   - Resend the invite.
   - Send a password reset.
   - Disable the account (it's kept so their name stays in the activity log), and re-enable it.
5. **The invite email's landing page:** setting a name and password, then two-step setup when it's required. These sign-in style pages are server-rendered (`authPage()` in `routes/auth.js`).
6. **Two-step setup:** the QR code (with the key written out for typing in), entering the first code, then the backup codes with a clear "save these" step.
7. **Signing in with two-step:** the code prompt after the password, "use a backup code instead", and wrong or expired code errors.
8. **Activity log tab:**
   - Entries like "Sam Patel changed the score of Priya Nair v Marcus Chen to 3–1 · Oct 4, 7:12 PM".
   - Filters by person, area and date.
   - Actions taken with the shared password show as "Shared admin login".
   - Show the empty and long-list states.
9. **A limited staff member's app:** the sidebar, the admin dashboard and an Options menu with only what their permissions allow. For example, someone with only Tournaments: no Court Schedule, no league options, no player editing. Decide whether anything says what is hidden, or whether it's simply absent.
10. **Who's signed in:** the sidebar footer card currently says "Administrator / Club management" for everyone. Show the staff member's name, their account menu (My account, Logout), and how the shared login reads during the transition.
11. **Not allowed:** what a staff member sees if they follow a link to a page they don't have access to.

## Part 2 (design now, built later)

12. **Owner setup:** the first time someone signs in with the shared password after part 2 ships, a guided setup: owner email, new password, then required two-step sign-in with backup codes. Show the step indicator and each step.
13. **Owner sign-in:** email, password, then the code. Also what someone who still tries the old shared password sees: a clear message that it no longer works, and who to ask.
14. **Owner "My account":** change email (confirmed by a link to the new address), change password, see and regenerate backup codes, and "Sign out of all devices".

## Rules

- Design system components and tokens only. A toggle switch may be needed for permissions; if the player Settings handoff (`design_handoff_player_settings`) introduced one, reuse it.
- One primary button per screen.
- Realistic content: owner Alex Morgan; staff Sam Patel, Jordan Lee and Chris Nguyen with different permission sets.
- No em dashes in any copy.

## Handoff

Produce a handoff named `design_handoff_staff_accounts` with:

- Every screen and state above, desktop and phone, with part 1 and part 2 clearly separated.
- For each element, whether it's **existing (reused as is)**, **existing (modified, with what changed)**, or **new**, with markup and class names (an `sa-` prefix for new ones) and CSS using only existing tokens.
- All copy: labels, help text, permission descriptions, emails' landing pages, errors and toasts.
