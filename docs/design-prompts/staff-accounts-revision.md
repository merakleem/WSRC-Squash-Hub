# Claude Design prompt: staff accounts, revision 1

Please revise the **staff accounts** design you just made (`design_handoff_staff_accounts`). The scope was misread: there is no "part 2" and no transition. The shared admin login stays exactly as it is. This round only adds staff accounts beside it.

## What changes

**1. The admin login is not touched.**
- People still sign in as admin the way they do today: a blank email plus the shared password. That account keeps full access, as it has now.
- Don't show it as temporary, "shared", a fallback or being phased out anywhere. Remove all transition language. That covers banners, notes, empty-state copy, labels like "Shared admin login", and any hint that it will change or stop working.
- In the app it's simply **the admin account**. The sidebar card keeps today's "Administrator / Club management".

**2. Drop part 2 entirely.** Remove these screens from the design and the handoff:
- owner setup
- owner sign-in
- "the old password no longer works" messages
- owner "My account" (change email, backup codes, sign out of all devices)

**3. "Owner" becomes "the admin account".**
- Everything the design gave the owner now belongs to the admin account: managing staff, every Settings tab, and the only role that can't be restricted.
- Don't use the word "owner" in the UI.

**4. The sign-in page itself doesn't change.** It keeps the same single form.
- Staff sign in on it with their own email and password.
- If their account requires two-step sign-in, they then get the code step.
- No new tabs, toggles or "sign in as staff" choice.

**5. Settings tabs.**
- **The admin account sees:** Club, Ladder and seasons, Courts and booking, Staff accounts and Activity log.
  - The admin account has no "My account" tab, since it has no name or email of its own.
- **A staff member sees:** "My account" (their name, email, password and two-step sign-in) plus whichever tabs their permissions allow.

**6. Activity log.**
- Actions taken from the admin account show as **"Administrator"**, plain, with no explanation attached.
- Staff actions show the staff member's name, as before.

**7. Staff accounts empty state.** Keep it neutral, for example "No staff accounts yet" with an Invite button. Don't mention the shared login.

## What stays as designed

Permissions with Select all / Clear all, the per-staff two-step switch, invite and edit, disable and re-enable, the invite landing page, two-step setup and sign-in, the limited staff view of the app, "not allowed", and how the tabs behave on a phone.

Keep the existing rules: design system components and tokens only, one primary button per screen, no em dashes, and the same realistic names. "Alex Morgan" isn't needed now, because the admin account has no name.

## Handoff

Update `design_handoff_staff_accounts` in place:
- Part 2 is removed.
- Every changed screen or string is listed under a short **"Changes in revision 1"** heading at the top, so the implementation can be checked against it.
