// The sign-in chrome and everything that shares it. Boots the real server on
// a scratch DB: the form still posts, the error/info slots land in the panel,
// and the invite/reset/expired pages inherit the new look without losing
// their own headings or their way back to login.
// Run: node test/auth-pages.test.js
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const PORT = 8131;
const BASE = `http://localhost:${PORT}`;
const DB = '/tmp/auth-pages-test.db';

let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== '' ? ` [${x}]` : '')); };
const sh = (cmd) => execSync(cmd, { encoding: 'utf8' });
const get = (p) => sh(`curl -s ${BASE}${p}`);
const post = (p, data) => sh(`curl -s -o /dev/null -w '%{http_code}' -X POST ${BASE}${p} -H 'Content-Type: application/x-www-form-urlencoded' ${data.map((d) => `--data-urlencode '${d}'`).join(' ')}`).trim();
const postBody = (p, data) => sh(`curl -s -X POST ${BASE}${p} -H 'Content-Type: application/x-www-form-urlencoded' ${data.map((d) => `--data-urlencode '${d}'`).join(' ')}`);

async function main() {
  try { fs.unlinkSync(DB); } catch (_) {}
  const dbm = require('../database/db');
  dbm.initDB(DB);
  const { run } = dbm;
  run("INSERT INTO players (name, email) VALUES ('Mona Member', 'mona@x.invalid')");
  run('INSERT INTO user_accounts (player_id, password_hash) VALUES (1, ?)', [bcrypt.hashSync('pw12345678', 4)]);
  run("INSERT INTO players (name, email) VALUES ('Ivan Invited', 'ivan@x.invalid')");
  run("INSERT INTO user_accounts (player_id, invite_token, invite_expires) VALUES (2, 'goodinvite', '2099-01-01')");
  run("INSERT INTO players (name, email) VALUES ('Rita Reset', 'rita@x.invalid')");
  run("INSERT INTO user_accounts (player_id, password_hash, reset_token, reset_expires) VALUES (3, 'x', 'goodreset', '2099-01-01')");

  const server = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: DB, SESSION_SECRET: 's', SITE_PASSWORD: 'sitepw', RESEND_API_KEY: '' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 2500));

  try {
    console.log('THE SIGN-IN PAGE');
    const login = get('/login');
    ok('the court photo is the backdrop', /class="shot" src="\/assets\/court-racquets\.jpg"/.test(login));
    ok('under the navy gradient', /linear-gradient\(120deg, rgba\(15,21,51,\.9\)/.test(login));
    ok('the crest and headline lead the left column', /class="crest"/.test(login) && /<h2 class="headline">Welcome Back\.<\/h2>/.test(login));
    ok('the blurb names what the app is for', /Court booking, leagues, ladder, and events for WSRC members\./.test(login));
    ok('the panel is frosted glass', /backdrop-filter: blur\(18px\)/.test(login) && /-webkit-backdrop-filter: blur\(18px\)/.test(login));
    ok('with a fallback where that is unsupported', /@supports not/.test(login) && /rgba\(30,39,88,\.55\)/.test(login));
    ok('titled Sign in', /<h1>Sign in<\/h1>/.test(login));
    // The headline beside the panel already says welcome back; a second one in
    // the card was saying it twice.
    ok('with no subtitle under it', !/class="panel-sub"/.test(login));
    ok('the form still posts to \/login', /<form method="POST" action="\/login">/.test(login));
    ok('the email field keeps its name and autocomplete', /name="email"[^>]*autocomplete="email"/.test(login));
    ok('the password field keeps its name, autofocus and autocomplete', /name="password"[^>]*autofocus autocomplete="current-password"/.test(login));
    ok('both fields carry a mobile placeholder', (login.match(/data-mph="/g) || []).length === 2);
    ok('the forgot link sits under the panel', /class="foot-link" href="\/forgot-password">Forgot password\?/.test(login));
    ok('the body is marked as the login variant', /<body class="is-login">/.test(login));
    ok('mobile drops the panel chrome', /@media \(max-width: 899px\)/.test(login) && /background: none;/.test(login));
    ok('and reflows the photo and gradient', /object-position: 62% 60%/.test(login) && /linear-gradient\(180deg, rgba\(15,21,51,\.55\)/.test(login));
    ok('16px inputs keep iOS from zooming', /font-size: 16px; \/\* keeps iOS from zooming on focus \*\//.test(login));
    ok('the old white card is gone', !/class="card"/.test(login) && !/background: #fff; border-radius: 12px/.test(login));

    console.log('SIGNING IN STILL WORKS');
    ok('a member signs in', post('/login', ['email=mona@x.invalid', 'password=pw12345678']) === '302');
    ok('the admin signs in with a blank email', post('/login', ['email=', 'password=sitepw']) === '302');
    const bad = postBody('/login', ['email=mona@x.invalid', 'password=nope']);
    ok('a wrong password is refused', /Invalid email or password\./.test(bad));
    ok('and the error reads on the dark panel', /class="error"/.test(bad) && /#ffb4a8/.test(bad));
    ok('with the form still there to retry', /<form method="POST" action="\/login">/.test(bad));
    const badAdmin = postBody('/login', ['email=', 'password=nope']);
    ok('a wrong site password is refused', /Incorrect password\./.test(badAdmin));

    console.log('THE PAGES THAT SHARE THE SHELL');
    const invite = get('/invite/goodinvite');
    ok('the invite page inherits the chrome', /class="shot"/.test(invite) && /class="panel"/.test(invite));
    ok('and names its own task', /<h1>Activate your account<\/h1>/.test(invite));
    ok('greeting them in the info slot', /class="info"/.test(invite) && /Welcome, Ivan Invited!/.test(invite));
    ok('with both password fields posting to the token', /action="\/invite\/goodinvite"/.test(invite) && (invite.match(/type="password"/g) || []).length === 2);
    ok('it is not the login variant, so mobile keeps its heading', !/<body class="is-login">/.test(invite));
    const shortPw = postBody('/invite/goodinvite', ['password=short', 'confirm=short']);
    ok('a short password is refused in the panel', /Password must be at least 8 characters\./.test(shortPw) && /class="error"/.test(shortPw));
    const mismatch = postBody('/invite/goodinvite', ['password=longenough1', 'confirm=different1']);
    ok('a mismatch is refused too', /Passwords do not match\./.test(mismatch));

    const reset = get('/reset-password/goodreset');
    ok('the reset page inherits it as well', /class="shot"/.test(reset) && /<h1>Reset password<\/h1>/.test(reset));
    ok('posting to its own token', /action="\/reset-password\/goodreset"/.test(reset));

    const expired = get('/invite/nosuchtoken');
    ok('an expired link says so', /<h1>Link expired<\/h1>/.test(expired) && /invalid or has expired/.test(expired));
    ok('reading on the dark panel, not the old grey', /class="note"/.test(expired) && !/6b7e93/.test(expired));
    ok('with a way back to login', /class="foot-link" href="\/login">Back to login/.test(expired));

    const forgot = get('/forgot-password');
    ok('forgot-password explains what to do', /Contact your administrator to send you a password reset link\./.test(forgot));
    ok('and offers the way back', /href="\/login">Back to login/.test(forgot));

    console.log('THE PHOTO IS SERVED');
    ok('the court photo is reachable', sh(`curl -s -o /dev/null -w '%{http_code}' ${BASE}/assets/court-racquets.jpg`).trim() === '200');
    const bytes = Number(sh(`curl -s -o /dev/null -w '%{size_download}' ${BASE}/assets/court-racquets.jpg`).trim());
    ok('at the resized weight, not the original', bytes > 40000 && bytes < 120000, `${bytes} bytes`);
  } finally {
    server.kill();
    try { fs.unlinkSync(DB); } catch (_) {}
  }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
