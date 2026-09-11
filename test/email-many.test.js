// Resend's batch endpoint does not accept attachments, so a message carrying
// a file has to be posted on its own. This stubs fetch and watches which
// endpoint each message goes to.
// Run: node test/email-many.test.js
process.env.RESEND_API_KEY = 'test-key';
delete process.env.EMAIL_REDIRECT_TO;

let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== '' ? ` [${x}]` : '')); };

const posts = [];
global.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  posts.push({ url, body });
  return { ok: true, json: async () => ({}) };
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
  ]);
  ok('two requests, neither to the batch endpoint', posts.length === 2 && posts.every((p) => p.url.endsWith('/emails')), posts.map((p) => p.url).join());
  ok('each carries its attachment', posts.every((p) => p.body.attachments?.[0]?.filename === 'rules.pdf' && p.body.attachments[0].content === 'JVBERi0='));
  ok('each goes to its own recipient', posts.map((p) => p.body.to[0]).sort().join() === 'a@x.invalid,b@x.invalid');
  ok('counted as two sent', r.sent === 2 && r.failed === 0, JSON.stringify(r));

  console.log('\nA FAILED SINGLE SEND IS COUNTED');
  posts.length = 0;
  global.fetch = async () => ({ ok: false, status: 422, json: async () => ({ message: 'Attachment too large' }) });
  r = await sendMany([{ to: ['a@x.invalid'], subject: 's', html: 'x', attachments: [file] }]);
  ok('reported as failed with the service\'s reason', r.sent === 0 && r.failed === 1 && /too large/.test(r.errors[0]), JSON.stringify(r));

  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
