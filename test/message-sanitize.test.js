// The league-message body is admin-authored HTML that lands in players'
// inboxes: only what the editor can produce survives the sanitizer.
// Run: node test/message-sanitize.test.js
const clean = require('../routes/leagues').sanitizeMessageHtml;

let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (x !== '' ? ` [${x}]` : '')); };

ok('formatting the editor emits survives',
  clean('<p><strong>Hi</strong> <em>all</em> <u>tonight</u></p>') === '<p><strong>Hi</strong> <em>all</em> <u>tonight</u></p>');
ok('lists survive',
  clean('<ol><li>one</li></ol><ul><li>two</li></ul>') === '<ol><li>one</li></ol><ul><li>two</li></ul>');
ok('headings survive', clean('<h2>News</h2><h3>Small news</h3>') === '<h2>News</h2><h3>Small news</h3>');
ok('script tags are stripped', !/script|alert/.test(clean('<p>hey<script>alert(1)</script></p>')), clean('<p>hey<script>alert(1)</script></p>'));
ok('event handlers are stripped', !/onclick/.test(clean('<p onclick="x()">hey</p>')));
ok('images are stripped', !/img/.test(clean('<p><img src="x" onerror="x()"></p>')));
ok('style attributes are stripped', clean('<p style="color:red">hey</p>') === '<p>hey</p>');
const link = clean('<a href="https://example.com">site</a>');
ok('links keep their href', /href="https:\/\/example\.com"/.test(link), link);
ok('and open in a new tab safely', /target="_blank"/.test(link) && /rel="noopener"/.test(link));
ok('javascript: links lose their href', !/javascript/.test(clean('<a href="javascript:alert(1)">x</a>')));
ok('mailto links are allowed', /mailto:/.test(clean('<a href="mailto:a@b.c">mail</a>')));
ok('unknown tags unwrap to their text', clean('<div><span>plain</span></div>') === 'plain');

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
