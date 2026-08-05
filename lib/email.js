// ===== EMAIL =====
// Single place where mail leaves the app. Every route sends through here so that
// the redirect sink, the from address and failure logging behave identically
// everywhere — including from background jobs that have no `req`.

const RESEND_FROM = process.env.RESEND_FROM || 'Play WSRC <no-reply@playwsrc.ca>';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Staging safety net. When set, every message is rerouted to this one address
// instead of the real recipient, with the intended recipient named in the
// subject. Lets staging exercise real sends at real volume without any chance
// of reaching a member. Unset in production.
const REDIRECT_TO = process.env.EMAIL_REDIRECT_TO || null;

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

// Rewrites a message to the sink address when EMAIL_REDIRECT_TO is set.
function _applyRedirect(payload) {
  if (!REDIRECT_TO) return payload;
  const intended = _toList(payload.to).join(', ');
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
 * Resolves to { ok: true } or { ok: false, error } — it never throws on a
 * failed send, so callers decide whether a failure is fatal.
 */
async function sendEmail(payload) {
  if (!isConfigured()) return { ok: false, error: 'Email service is not configured.' };

  const message = _withDefaults(payload);
  let response;
  try {
    response = await _post(RESEND_ENDPOINT, message);
  } catch (err) {
    console.error('[email] send failed (network):', err.message);
    return { ok: false, error: 'Could not reach the email service.' };
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = body.message || `Email service returned ${response.status}.`;
    console.error(`[email] send failed: ${error}`, { to: _toList(message.to), subject: message.subject });
    return { ok: false, error };
  }
  return { ok: true };
}

/**
 * Send many emails via Resend's batch endpoint, 100 at a time.
 *
 * Returns { sent, failed, errors } — unlike the previous inline loops, a failed
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
      console.error('[email] batch failed (network):', err.message);
      continue;
    }
    if (response.ok) {
      sent += chunk.length;
    } else {
      const body = await response.json().catch(() => ({}));
      const error = body.message || `Email service returned ${response.status}.`;
      failed += chunk.length;
      errors.push(error);
      console.error(`[email] batch of ${chunk.length} failed: ${error}`);
    }
  }

  return { sent, failed, errors };
}

module.exports = { sendEmail, sendBatch, isConfigured, appUrl, RESEND_FROM, REDIRECT_TO };
