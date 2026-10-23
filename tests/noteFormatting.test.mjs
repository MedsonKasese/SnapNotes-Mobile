import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getNoteHtmlLines,
  normalizeNoteLink,
  noteHtmlToText,
  plainTextToHtml,
  sanitizeNoteHtml,
  updateChecklistHtml,
} from '../src/noteFormatting.ts';

test('sanitizes active markup, event handlers, styles, media, and unsafe links', () => {
  const safe = sanitizeNoteHtml('<p onclick="steal()" style="color:red"><strong>Safe</strong><script>alert(1)</script><img src="x" onerror="run()"><a href="java&#x73;cript:alert(1)" target="_blank">bad link</a><a href="https://example.com/a?x=1&amp;y=2" title="x">good</a><svg><text>hidden</text></svg></p>');
  assert.equal(safe, '<p><strong>Safe</strong><a>bad link</a><a href="https://example.com/a?x=1&amp;y=2">good</a></p>');
  assert.equal(sanitizeNoteHtml('<iframe><b>danger</b></iframe><math><mtext>bad</mtext></math>'), '');
});

test('escapes text and accepts only safe absolute link protocols', () => {
  assert.equal(sanitizeNoteHtml('<div>&lt;hello &amp; goodbye&gt;</div>'), '<div>&lt;hello &amp; goodbye&gt;</div>');
  assert.equal(normalizeNoteLink('https://example.com/a'), 'https://example.com/a');
  assert.equal(normalizeNoteLink('mailto:hello@example.com'), 'mailto:hello@example.com');
  for (const value of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/x', '//example.com', '/relative', ' https://example.com', 'https://exa\nmple.com']) {
    assert.equal(normalizeNoteLink(value), null, value);
  }
});

test('converts blocks, breaks, lists, and blank divs to predictable rich lines', () => {
  const html = '<div>first<br>second</div><p><b>bold</b> <i>ital</i></p><ul><li>one</li><li><em>two</em></li></ul><div><br></div><div>end</div>';
  const lines = getNoteHtmlLines(html);
  assert.deepEqual(lines.map(line => line.runs.map(run => run.text).join('')), ['first', 'second', 'bold ital', 'one', 'two', '', 'end']);
  assert.equal(lines[3].bullet, '• ');
  assert.equal(lines[4].bullet, '• ');
  assert.equal(lines[2].runs[0].bold, true);
  assert.equal(lines[2].runs.find(run => run.text === 'ital').italic, true);
  assert.equal(noteHtmlToText(html), 'first\nsecond\nbold ital\none\ntwo\n\nend');
  assert.deepEqual(getNoteHtmlLines('<div><br></div>').map(line => line.runs), [[]]);
});

test('plain text conversion round-trips multiline content with explicit blank lines', () => {
  const text = 'first\n\nthird & <fourth>';
  const html = plainTextToHtml(text);
  assert.equal(noteHtmlToText(html), text);
  assert.equal(sanitizeNoteHtml(html).includes('&lt;fourth&gt;'), true);
});

test('block boundaries split adjacent inline text and ordered lists display increasing numbers', () => {
  assert.equal(noteHtmlToText('a<div>b</div>'), 'a\nb');
  assert.equal(noteHtmlToText('<div>a</div>tail'), 'a\ntail');
  const lines = getNoteHtmlLines('<ol><li>first</li><li>second</li></ol>');
  assert.deepEqual(lines.map(line => line.bullet), ['1. ', '2. ']);
  assert.equal(lines.map(line => line.runs.map(run => run.text).join('')).join('\n'), 'first\nsecond');
});

test('updates only the checkbox marker on the requested flattened line', () => {
  const html = '<ul><li><strong>☐ </strong><em>First</em></li><li><strong>☑ </strong><b>Second</b></li></ul>';
  const changed = updateChecklistHtml(html, 0, true);
  assert.equal(changed, '<ul><li><strong>☑ </strong><em>First</em></li><li><strong>☑ </strong><b>Second</b></li></ul>');
  assert.equal(updateChecklistHtml(changed, 1, false), '<ul><li><strong>☑ </strong><em>First</em></li><li><strong>☐ </strong><b>Second</b></li></ul>');
  assert.equal(updateChecklistHtml(changed, 9, false), changed);
});

test('many sibling blocks retain formatting and deep markup is bounded without losing text', () => {
  const html = Array.from({ length: 120 }, (_, i) => `<div><b>Line ${i}</b></div>`).join('');
  const safe = sanitizeNoteHtml(html);
  assert.equal((safe.match(/<b>/g) ?? []).length, 120);
  const deep = '<b>'.repeat(5000) + 'Keep me' + '</b>'.repeat(5000);
  assert.equal(noteHtmlToText(deep), 'Keep me');
  assert.ok(sanitizeNoteHtml(deep).length < 1000);
});

test('literal text-node newlines align rich display lines and checkbox update offsets', () => {
  const html = '<b>First\n☐ Second\nThird</b>';
  assert.deepEqual(getNoteHtmlLines(html).map(line => line.runs.map(run => run.text).join('')), ['First', '☐ Second', 'Third']);
  const changed = updateChecklistHtml(html, 1, true);
  assert.equal(changed, '<b>First\n☑ Second\nThird</b>');
  assert.equal(noteHtmlToText(changed), 'First\n☑ Second\nThird');
  assert.equal(updateChecklistHtml('<div>☐</div>', 0, true), '<div>☑</div>');
});
