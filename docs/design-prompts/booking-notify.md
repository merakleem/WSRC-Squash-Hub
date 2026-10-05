# Claude Design prompt: notify players when you book a court

A small addition to **Play WSRC**'s court booking. Use the **PlayWSRC** design system and the linked codebase. Fit it into the booking panel as it is today; don't redesign the panel.

## The feature

When a member books a court they can add up to three other club players ("Playing with"). We're adding a checkbox, **"Notify the selected players by email"**, to that panel. When the member confirms the booking with it ticked, each added player gets an email saying who booked a court with them, and when and where. It is **ticked by default** and only appears once at least one other player has been added.

For context, this is the email (no design needed, it's plain text):

> **Subject:** Liam Gallagher booked a court with you
>
> Hi Priya,
>
> Liam Gallagher booked a court with you, Marcus Chen and Sophie Tremblay.
>
> Court 2
> Saturday, October 10
> 6:00 PM to 7:00 PM
>
> See your bookings on Play WSRC: (link)

## Where it lives in the code

- The panel: `_buildPanelInner()` in `renderer/pages/courtBooking.js`. The "Playing with" section (player chips plus the search box), the footer summary line (`cb-summary`), and the Cancel / Confirm booking buttons.
- Its styles: the `COURT BOOKING PAGE (cb-)` section of `renderer/styles.css`, especially "Booking panel" and "Mobile".
- The panel is a side panel on desktop and a bottom sheet on phones (`cb-panel--mobile`). The dashboard's "Book a court" card opens the same panel.
- After booking, a toast confirms it: `Court booked · 6:00–7:00 PM` (in `_confirmBooking()`).

## What to design

Decide where the checkbox and any supporting note sit, and how they look in each of these states, on **desktop and phone**:

1. **No one added yet:** the checkbox doesn't show. Decide whether anything hints that it will appear.
2. **One to three players added, box ticked** (the default).
3. **Box unticked.**
4. **An added player has no email on file:** they can't be notified. Show this quietly, e.g. a short note naming them. We'll add a flag so the page knows.
5. **Every added player lacks an email:** the checkbox can't do anything. Decide whether it hides, disables, or explains.
6. **Booking in progress** ("Booking…" on the button): what the checkbox does while the request runs.
7. **After booking:** the toast. Suggest copy that says who was notified, e.g. "Court booked · 6:00–7:00 PM · 2 players notified".
8. **Editing an existing booking** ("Your booking", "Save changes"): no emails are sent when a booking is changed, so the checkbox doesn't appear there. Decide whether the edit view needs a note saying so.

Also consider whether the footer summary line (`Court 2 · Sat Oct 10 · 6:00–7:00 PM · 3 players`) should mention notifying, and how it all fits on a small phone without pushing the Confirm button off screen.

## Rules

- Use existing design system parts and tokens only; the app has a `.check-label` checkbox style already.
- Keep it small and quiet. This is an option inside an existing panel, not a new section competing with Duration and Playing with.
- No em dashes in any copy.

## Handoff

Produce a handoff named `design_handoff_booking_notify` with:

- Each state above, desktop and phone.
- For each element, whether it is **existing (reused as is)**, **existing (modified, with what changed)**, or **new**, with markup and class names (`cb-` prefix) and CSS using only existing tokens.
- All copy: the checkbox label, any notes, the toast.
