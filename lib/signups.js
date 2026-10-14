// What an announcement's signups mean right now. Shared by announced leagues
// and announced tournaments: both have an optional cap, an optional deadline,
// and a list of members who joined.

/**
 * `cap` null means no limit; `deadline` null means no deadline. Signups close
 * when the list is full or the deadline (the last day to sign up) has passed.
 */
function signupState({ cap = null, deadline = null }, count, today) {
  const full = cap != null && count >= cap;
  const pastDeadline = !!deadline && deadline < today;
  return {
    signup_count: count,
    spots_left: cap == null ? null : Math.max(0, cap - count),
    full,
    signups_closed: full || pastDeadline,
    deadline_passed: pastDeadline,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

module.exports = { signupState, ISO_DATE };
