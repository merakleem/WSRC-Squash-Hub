// ===== EMAIL =====
// Single place where mail leaves the app. Every route sends through here so that
// the redirect sink, the from address and failure logging behave identically
// everywhere; including from background jobs that have no `req`.

const log = require('./log');

const RESEND_FROM = process.env.RESEND_FROM || 'Play WSRC <no-reply@playwsrc.ca>';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Staging safety net. When set, every message is rerouted to this one address
// instead of the real recipient, with the intended recipient named in the
// subject. Lets staging exercise real sends at real volume without any chance
// of reaching a member. Unset in production.
const REDIRECT_TO = process.env.EMAIL_REDIRECT_TO || null;

// Exemptions from the sink, comma separated. A message goes out for real only
// when EVERY one of its recipients is listed; anything else still ends up at the
// sink. That is what lets a handful of named testers hold real accounts on
// staging while the ~70 scrubbed @staging.invalid addresses stay contained.
// Has no effect in production, where nothing is redirected in the first place.
const ALLOWLIST = new Set(
  String(process.env.EMAIL_ALLOWLIST || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
);

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * Base URL for links inside emails.
 *
 * Prefers APP_URL so background jobs (which have no request) build the same
 * links as request-driven sends. Falls back to deriving from the request.
 */
function appUrl(req) {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/+$/, '');
  if (req) return `${req.protocol}://${req.get('host')}`;
  throw new Error('APP_URL is not set and no request was supplied to build a link from.');
}

function _toList(to) {
  return Array.isArray(to) ? to : [to];
}

// `to` entries are bare addresses everywhere in this app, but accept the
// "Name <addr>" form too rather than silently failing to match one.
function _bareAddress(entry) {
  const match = /<([^>]+)>/.exec(String(entry));
  return (match ? match[1] : String(entry)).trim().toLowerCase();
}

// Rewrites a message to the sink address when EMAIL_REDIRECT_TO is set.
function _applyRedirect(payload) {
  if (!REDIRECT_TO) return payload;
  const recipients = _toList(payload.to);
  // All-or-nothing: one unlisted recipient sends the whole message to the sink.
  // Splitting a message so part of it goes out for real would be a surprising
  // thing for a safety net to do.
  if (recipients.length && recipients.every((entry) => ALLOWLIST.has(_bareAddress(entry)))) {
    return payload;
  }
  const intended = recipients.join(', ');
  return { ...payload, to: [REDIRECT_TO], subject: `[to: ${intended}] ${payload.subject}` };
}

function _withDefaults(payload) {
  return _applyRedirect({ from: RESEND_FROM, ...payload });
}

async function _post(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

/**
 * Send one email.
 *
 * Resolves to { ok: true } or { ok: false, error }; it never throws on a
 * failed send, so callers decide whether a failure is fatal.
 */
async function sendEmail(payload) {
  if (!isConfigured()) return { ok: false, error: 'Email service is not configured.' };

  const message = _withDefaults(payload);
  let response;
  try {
    response = await _post(RESEND_ENDPOINT, message);
  } catch (err) {
    log.error({ err, subject: message.subject }, 'email send failed (network)');
    return { ok: false, error: 'Could not reach the email service.' };
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = body.message || `Email service returned ${response.status}.`;
    log.error({ error, status: response.status, to: _toList(message.to), subject: message.subject }, 'email send failed');
    const retryAfter = Number(response.headers?.get?.('retry-after')) || null;
    return { ok: false, error, status: response.status, retryAfter };
  }
  return { ok: true };
}

// Resend allows about two requests a second. Single sends are spaced to stay
// under that, and a 429 is retried after the pause the service asks for.
const SINGLE_SEND_GAP_MS = 600;
const RATE_LIMIT_RETRIES = 3;
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function _sendPaced(payload, gapMs) {
  for (let attempt = 0; ; attempt++) {
    const result = await sendEmail(payload);
    if (result.ok || result.status !== 429 || attempt >= RATE_LIMIT_RETRIES) return result;
    await _sleep(Math.max(gapMs, (result.retryAfter || 1) * 1000));
  }
}

/**
 * Send many emails the way Resend allows: its batch endpoint refuses
 * attachments, so messages carrying a file go one at a time, and the rest go
 * in batches. Same { sent, failed, errors } either way.
 */
async function sendMany(payloads, { gapMs = SINGLE_SEND_GAP_MS } = {}) {
  const withFiles = payloads.filter((p) => Array.isArray(p.attachments) && p.attachments.length);
  const plain = payloads.filter((p) => !(Array.isArray(p.attachments) && p.attachments.length));
  const result = plain.length ? await sendBatch(plain) : { sent: 0, failed: 0, errors: [] };
  for (const [i, payload] of withFiles.entries()) {
    if (i > 0 || plain.length) await _sleep(gapMs);
    const one = await _sendPaced(payload, gapMs);
    if (one.ok) result.sent++;
    else { result.failed++; result.errors.push(one.error); }
  }
  return result;
}

/**
 * Send many emails via Resend's batch endpoint, 100 at a time.
 *
 * Returns { sent, failed, errors }; unlike the previous inline loops, a failed
 * chunk is counted and logged rather than silently dropped.
 */
async function sendBatch(payloads) {
  if (!isConfigured()) return { sent: 0, failed: payloads.length, errors: ['Email service is not configured.'] };

  const BATCH_SIZE = 100;
  const messages = payloads.map(_withDefaults);
  let sent = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const chunk = messages.slice(i, i + BATCH_SIZE);
    let response;
    try {
      response = await _post(`${RESEND_ENDPOINT}/batch`, chunk);
    } catch (err) {
      failed += chunk.length;
      errors.push(err.message);
      log.error({ err, count: chunk.length }, 'email batch failed (network)');
      continue;
    }
    if (response.ok) {
      sent += chunk.length;
    } else {
      const body = await response.json().catch(() => ({}));
      const error = body.message || `Email service returned ${response.status}.`;
      failed += chunk.length;
      errors.push(error);
      log.error({ error, status: response.status, count: chunk.length }, 'email batch failed');
    }
  }

  return { sent, failed, errors };
}

// ===== THE INVITE =====
// One body, three senders: the players page sends it one at a time and in
// bulk, and a league sends it to everyone it just entered. Kept here so the
// three cannot drift apart - the wording is the club's first word to a member
// who has never seen the app, and it should say what the app is for.
const INVITE_SUBJECT = 'Activate your Play WSRC account';

function inviteEmail(name, url) {
  return {
    subject: INVITE_SUBJECT,
    html: `<p>Hi ${name},</p>
<p>You've been invited to create an account on Play WSRC.</p>
<p>Play WSRC is the new member portal for the Winnipeg Squash Racquet Club. From here you can book courts, see upcoming club events, follow the ladder and your league, and record your scores.</p>
<p><a href="${url}">Click here to activate your account</a></p>
<p>This link expires in 72 hours.</p>`,
  };
}

// ===== A COURT BOOKED WITH YOU =====
// Sent to each player the booker added, when they ticked "Notify the selected
// players by email". Plain on purpose: who, when, where, and a way back in.

const _escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const _DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const _MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const _clock = (min) => `${((Math.floor(min / 60) + 11) % 12) + 1}:${String(min % 60).padStart(2, '0')} ${Math.floor(min / 60) % 24 >= 12 ? 'PM' : 'AM'}`;

/** "you", "you and Marcus Chen", "you, Marcus Chen and Sophie Tremblay". */
function _withList(others) {
  const all = ['you', ...others];
  return all.length === 1 ? all[0] : `${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}`;
}

/**
 * `others` are the rest of the booking besides the booker and the recipient.
 * `date` is YYYY-MM-DD, `startTime` HH:MM, in club time.
 */
function bookingNoticeEmail({ recipientName, bookerName, others = [], courtName, date, startTime, durationMinutes, url }) {
  const [y, mo, d] = String(date).split('-').map(Number);
  const day = new Date(Date.UTC(y, mo - 1, d));
  const when = `${_DAYS[day.getUTCDay()]}, ${_MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}`;
  const [h, m] = String(startTime).split(':').map(Number);
  const start = h * 60 + m;
  const time = `${_clock(start)} to ${_clock(start + Number(durationMinutes))}`;
  const first = String(recipientName || '').trim().split(/\s+/)[0] || 'there';
  const line = `${bookerName} booked a court with ${_withList(others)}.`;
  return {
    subject: `${bookerName} booked a court with you`,
    html: `<p>Hi ${_escHtml(first)},</p>
<p>${_escHtml(line)}</p>
<p>${_escHtml(courtName)}<br>${_escHtml(when)}<br>${_escHtml(time)}</p>
<p>See your bookings on Play WSRC: <a href="${_escHtml(url)}">${_escHtml(url)}</a></p>`,
    text: `Hi ${first},\n\n${line}\n\n${courtName}\n${when}\n${time}\n\nSee your bookings on Play WSRC: ${url}\n`,
  };
}

const _firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

// Sent to the address a member wants to change to. Nothing changes until the
// link is clicked, so a typo never locks anyone out.
function emailChangeConfirmEmail({ name, newEmail, url }) {
  const line = `${_firstName(name)}, click the link below to make ${newEmail} your Play WSRC sign-in email. If you did not ask for this, ignore this message and nothing will change.`;
  return {
    subject: 'Confirm your new email for Play WSRC',
    html: `<p>${_escHtml(line)}</p>
<p><a href="${_escHtml(url)}">Confirm my new email</a></p>
<p>This link expires in 24 hours.</p>`,
    text: `${line}\n\n${url}\n\nThis link expires in 24 hours.\n`,
  };
}

// Sent to the old address once the change has gone through.
function emailChangedNoticeEmail({ newEmail }) {
  const line = `Your sign-in email was changed to ${newEmail}. If this was not you, contact the club.`;
  return {
    subject: 'Your Play WSRC email was changed',
    html: `<p>${_escHtml(line)}</p>`,
    text: `${line}\n`,
  };
}

function passwordResetEmail({ name, url }) {
  return {
    subject: 'Reset your Play WSRC password',
    html: `<p>Hi ${_escHtml(name)},</p>
<p>A password reset was requested for your Play WSRC account.</p>
<p><a href="${_escHtml(url)}">Click here to reset your password</a></p>
<p>This link expires in 24 hours. If you did not request this, you can ignore this email.</p>`,
  };
}

// ===== WHAT MEMBERS ASKED TO HEAR ABOUT =====
// Sent only to members who turned the matching switch on in Settings, so
// each one ends by saying which switch and where to turn it off.

/** "Tuesday, November 4" from YYYY-MM-DD. */
function _dayDate(iso) {
  const [y, mo, d] = String(iso).split('-').map(Number);
  const day = new Date(Date.UTC(y, mo - 1, d));
  return `${_DAYS[day.getUTCDay()]}, ${_MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}`;
}
/** "Marcus Chen", "Marcus Chen and Sophie Tremblay". */
function _names(list) {
  return list.length <= 1 ? (list[0] || '') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}
/** "October 25" from YYYY-MM-DD. */
function _monthDate(iso) {
  const [, mo, d] = String(iso).split('-').map(Number);
  return `${_MONTHS[mo - 1]} ${d}`;
}

function _optInEmail({ recipientName, subject, lines, linkText, url, setting }) {
  const first = _firstName(recipientName);
  const footer = `You get this email because "${setting}" is on in your Settings. You can turn it off there at any time.`;
  return {
    subject,
    html: `<p>Hi ${_escHtml(first)},</p>
${lines.map((l) => `<p>${_escHtml(l)}</p>`).join('\n')}
<p>${_escHtml(linkText)}: <a href="${_escHtml(url)}">${_escHtml(url)}</a></p>
<p style="color:#6b7280;font-size:12px">${_escHtml(footer)}</p>`,
    text: `Hi ${first},\n\n${lines.join('\n\n')}\n\n${linkText}: ${url}\n\n${footer}\n`,
  };
}

function leagueAnnouncedEmail({ recipientName, name, startDate, signupDeadline, url }) {
  return _optInEmail({
    recipientName,
    subject: `New league: ${name}`,
    lines: [`A new league has been announced: ${name}. It starts ${_dayDate(startDate)}.${signupDeadline ? ` Sign up by ${_monthDate(signupDeadline)}.` : ''}`],
    linkText: 'See the details and sign up on Play WSRC',
    url,
    setting: 'A new league is announced',
  });
}

function tournamentAnnouncedEmail({ recipientName, name, drawCap, firstRoundDate, signupDeadline, url }) {
  return _optInEmail({
    recipientName,
    subject: `New tournament: ${name}`,
    lines: [`A new tournament has been announced: ${name}, a singles knockout for up to ${drawCap} players. It starts ${_dayDate(firstRoundDate)}.${signupDeadline ? ` Sign up by ${_monthDate(signupDeadline)}.` : ''}`],
    linkText: 'See the details and sign up on Play WSRC',
    url,
    setting: 'A new tournament is announced',
  });
}

function eventPostedEmail({ recipientName, name, date, startTime, url }) {
  let when = _dayDate(date);
  if (startTime) {
    const [h, m] = String(startTime).split(':').map(Number);
    when += ` at ${_clock(h * 60 + m)}`;
  }
  return _optInEmail({
    recipientName,
    subject: `New event: ${name}`,
    lines: [`A new event has been posted: ${name}, ${when}.`],
    linkText: 'See the details on Play WSRC',
    url,
    setting: 'A new event is posted',
  });
}

/**
 * To a player on the other side of a match someone else reported. `mine` and
 * `theirs` are games won, from the recipient's side; `opponents` names the
 * reporter's side.
 */
function scoreReportedEmail({ recipientName, reporterName, opponents, mine, theirs, url }) {
  const result = mine > theirs ? `you won ${mine}-${theirs}` : `you lost ${mine}-${theirs}`;
  return _optInEmail({
    recipientName,
    subject: `Score reported: you v ${_names(opponents)}`,
    lines: [
      `${reporterName} reported the score of your match: ${result}.`,
      'If the result is wrong, please email an admin and it will be corrected.',
    ],
    linkText: 'See the match on Play WSRC',
    url,
    setting: 'Someone reports a score for my match',
  });
}

// ===== STAFF ACCOUNTS =====

function _staffEmail({ subject, paragraphs, button, url }) {
  return {
    subject,
    html: paragraphs.map((p) => `<p>${_escHtml(p).replace('{link}', `<a href="${_escHtml(url)}">${_escHtml(button)}</a>`)}</p>`).join('\n'),
    text: `${paragraphs.map((p) => p.replace('{link}', url)).join('\n\n')}\n`,
  };
}

function staffInviteEmail({ name, url }) {
  return _staffEmail({
    subject: "You're invited to help run Play WSRC",
    paragraphs: [
      `Hi ${_firstName(name)}, you've been invited to Play WSRC as staff.`,
      'Set your password to get started: {link}',
      'The link works for 7 days. This is a staff account, separate from any player account you have.',
    ],
    button: 'Set up my account',
    url,
  });
}

function staffResetEmail({ url }) {
  return _staffEmail({
    subject: 'Reset your Play WSRC staff password',
    paragraphs: [
      'The club administrator sent you a password reset.',
      'Choose a new password: {link}',
      "The link works for 1 hour. If you weren't expecting this, you can ignore it.",
    ],
    button: 'Choose a new password',
    url,
  });
}

function staffEmailChangeEmail({ newEmail, oldEmail, url }) {
  return _staffEmail({
    subject: 'Confirm your new Play WSRC email',
    paragraphs: [
      `Confirm that ${newEmail} is your new sign-in email: {link}`,
      `Until you do, you still sign in with ${oldEmail}. The link works for 1 hour.`,
    ],
    button: 'Confirm my new email',
    url,
  });
}

module.exports = {
  sendEmail, sendBatch, isConfigured, appUrl, RESEND_FROM, REDIRECT_TO, _applyRedirect, sendMany, inviteEmail, INVITE_SUBJECT,
  bookingNoticeEmail, emailChangeConfirmEmail, emailChangedNoticeEmail, passwordResetEmail,
  leagueAnnouncedEmail, tournamentAnnouncedEmail, eventPostedEmail, scoreReportedEmail,
  staffInviteEmail, staffResetEmail, staffEmailChangeEmail,
};
