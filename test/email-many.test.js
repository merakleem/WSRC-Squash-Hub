// Resend's batch endpoint does not accept attachments, so a message carrying
// a file has to be posted on its own. This stubs fetch and watches which
// endpoint each message goes to.
// Run: node test/email-many.test.js
process.env.RESEND_API_KEY = 'test-key';
delete process.env.EMAIL_REDIRECT_TO;

let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== '' ? ` [${x}]` : '')); };

const posts = [];
const okResponse = { ok: true, json: async () => ({}) };
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  posts.push({ url, body, at: Date.now() });
  return okResponse;
};

const { sendMany } = require('../lib/email');
const file = { filename: 'rules.pdf', content: 'JVBERi0=' };

(async () => {
  console.log('PLAIN MESSAGES GO IN ONE BATCH');
  let r = await sendMany([
    { to: ['a@x.invalid'], subject: 's', html: '<p>hi</p>' },
    { to: ['b@x.invalid'], subject: 's', html: '<p>hi</p>' },
  ]);
  ok('one request, to the batch endpoint', posts.length === 1 && posts[0].url.endsWith('/emails/batch'), posts.map((p) => p.url).join());
  ok('carrying both messages', Array.isArray(posts[0].body) && posts[0].body.length === 2);
  ok('counted as two sent', r.sent === 2 && r.failed === 0, JSON.stringify(r));

  console.log('\nMESSAGES WITH A FILE GO ONE AT A TIME');
  posts.length = 0;
  r = await sendMany([
    { to: ['a@x.invalid'], subject: 's', html: '<p>hi</p>', attachments: [file] },
    { to: ['b@x.invalid'], subject: 's', html: '<p>hi</p>', attachments: [file] },
  ], { gapMs: 120 });
  ok('two requests, neither to the batch endpoint', posts.length === 2 && posts.every((p) => p.url.endsWith('/emails')), posts.map((p) => p.url).join());
  ok('each carries its attachment', posts.every((p) => p.body.attachments?.[0]?.filename === 'rules.pdf' && p.body.attachments[0].content === 'JVBERi0='));
  ok('each goes to its own recipient', posts.map((p) => p.body.to[0]).sort().join() === 'a@x.invalid,b@x.invalid');
  ok('counted as two sent', r.sent === 2 && r.failed === 0, JSON.stringify(r));
  ok('and spaced out, not fired as a burst', posts[1].at - posts[0].at >= 100, `${posts[1].at - posts[0].at}ms apart`);

  console.log('\nA RATE LIMIT IS WAITED OUT AND RETRIED');
  posts.length = 0;
  let calls = 0;
  global.fetch = async (url, opts) => {
    calls++;
    posts.push({ url, at: Date.now() });
    if (calls === 1) return { ok: false, status: 429, headers: { get: () => '0' }, json: async () => ({ message: 'Too many requests' }) };
    return okResponse;
  };
  r = await sendMany([{ to: ['a@x.invalid'], subject: 's', html: 'x', attachments: [file] }], { gapMs: 50 });
  ok('the 429 is retried and the message gets through', calls === 2 && r.sent === 1 && r.failed === 0, JSON.stringify(r) + ` calls=${calls}`);

  console.log('\nA FAILED SINGLE SEND IS COUNTED');
  posts.length = 0;
  global.fetch = async () => ({ ok: false, status: 422, json: async () => ({ message: 'Attachment too large' }) });
  r = await sendMany([{ to: ['a@x.invalid'], subject: 's', html: 'x', attachments: [file] }], { gapMs: 10 });
  ok('reported as failed with the service\'s reason', r.sent === 0 && r.failed === 1 && /too large/.test(r.errors[0]), JSON.stringify(r));
  global.fetch = async () => ({ ok: false, status: 429, headers: { get: () => '0' }, json: async () => ({ message: 'Too many requests' }) });
  r = await sendMany([{ to: ['a@x.invalid'], subject: 's', html: 'x', attachments: [file] }], { gapMs: 10 });
  ok('a rate limit that never lifts is reported, not looped forever', r.failed === 1 && /Too many/.test(r.errors[0]), JSON.stringify(r));

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
