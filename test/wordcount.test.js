'use strict';

const assert = require('assert');
const {
  countWords,
  countCharacters,
  analyse,
  cleanLatex,
  stripComment,
  wordMilestones,
} = require('../wordcount');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL  ${name}`);
    console.error(`      ${err.message}`);
  }
}

test('counts plain words', () => {
  assert.strictEqual(countWords('one two three'), 3);
});

test('ignores line comments', () => {
  assert.strictEqual(countWords('hello world % this is ignored'), 2);
});

test('keeps escaped percent signs', () => {
  assert.strictEqual(countWords('a 50\\% increase'), 3);
});

test('does not count commands', () => {
  assert.strictEqual(countWords('\\textbf hello'), 1);
});

test('counts braced argument text by default', () => {
  assert.strictEqual(countWords('\\section{Introduction to LaTeX}'), 3);
});

test('drops braced argument text when disabled', () => {
  assert.strictEqual(
    countWords('\\section{Introduction to LaTeX} body', {
      countBracedArguments: false,
    }),
    1
  );
});

test('ignores optional command arguments', () => {
  assert.strictEqual(countWords('\\documentclass[12pt]{article} text'), 1);
});

test('ignores inline maths', () => {
  assert.strictEqual(countWords('the value $x = y + 1$ here'), 3);
});

test('ignores display maths', () => {
  assert.strictEqual(countWords('before \\[ a + b = c \\] after'), 2);
});

test('ignores verbatim environments', () => {
  const src = 'text \\begin{verbatim}\nlots of code here\n\\end{verbatim} more';
  assert.strictEqual(countWords(src), 2);
});

test('handles a small document', () => {
  const src = [
    '\\documentclass{article}',
    '% a comment line',
    '\\begin{document}',
    'Hello there, brave new world.',
    '\\end{document}',
  ].join('\n');
  assert.strictEqual(countWords(src), 5);
});

test('ignores labels, refs and citations', () => {
  assert.strictEqual(
    countWords('See \\ref{fig:one} in \\cite{smith2020} please'),
    3
  );
});

test('ignores parencite command key', () => {
  assert.strictEqual(countWords('\\parencite{smith2020} text'), 1);
});

for (const commandName of ['parencite', 'textcite', 'autocite', 'footcite']) {
  test(`ignores the key of ${commandName}`, () => {
    const latex = `\\${commandName}{smith2020} text`;
    assert.strictEqual(countWords(latex), 1);
  });
}

test('does not count package or class names', () => {
  assert.strictEqual(
    countWords('\\documentclass{article}\\usepackage{amsmath}text'),
    1
  );
});

test('keeps the text argument of two-argument commands', () => {
  assert.strictEqual(countWords('\\textcolor{red}{very important text}'), 3);
});

test('counts characters without spaces', () => {
  // "hello" (5) + "world" (5) = 10, command and comment excluded.
  assert.strictEqual(countCharacters('\\textbf hello world % x'), 10);
});

test('character count keeps punctuation', () => {
  // "Hi," -> H i , = 3, "there." -> t h e r e . = 6  => 9
  assert.strictEqual(countCharacters('Hi, there.'), 9);
});

test('analyse returns both counts from one pass', () => {
  assert.deepStrictEqual(analyse('one two three'), {
    words: 3,
    characters: 11,
  });
});

test('ignores comment environment when requested', () => {
  const src = 'before \\begin{comment}\nhidden words here\n\\end{comment} after';
  assert.strictEqual(countWords(src, { ignoreCommentEnvironment: true }), 2);
});

test('keeps comment environment contents by default (selection mode)', () => {
  const src = 'before \\begin{comment}\nhidden words here\n\\end{comment} after';
  // \begin/\end are stripped as non-text commands, leaving the inner words.
  assert.strictEqual(countWords(src), 5);
});

test('stripComment leaves escaped percent alone', () => {
  assert.strictEqual(stripComment('100\\% done % note'), '100\\% done ');
});

test('preserving offsets does not change the word count', () => {
  const src = [
    '\\documentclass[12pt]{article} % a comment',
    '\\begin{document}',
    'Hello there, $x + y$ brave \\textbf{new} world. % more',
    '\\begin{verbatim}',
    'code goes here',
    '\\end{verbatim}',
    'The \\href{http://example.com}{final words}.',
    '\\end{document}',
  ].join('\r\n');

  const plain = cleanLatex(src).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
  const padded =
    cleanLatex(src, { preserveOffsets: true }).match(
      /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu
    ) || [];
  assert.deepStrictEqual(padded, plain);
});

test('preserving offsets keeps every word at its original position', () => {
  const src = '% ignored\n\\section{Alpha} beta $z$ \\cite{ref} gamma';
  const padded = cleanLatex(src, { preserveOffsets: true });

  assert.strictEqual(padded.length, src.length);
  for (const word of ['Alpha', 'beta', 'gamma']) {
    assert.strictEqual(
      padded.indexOf(word),
      src.indexOf(word),
      `"${word}" moved`
    );
  }
});

test('milestones land just after the word that reaches them', () => {
  const src = 'one two three four five six';
  assert.deepStrictEqual(wordMilestones(src, 2), [
    { count: 2, offset: 'one two'.length },
    { count: 4, offset: 'one two three four'.length },
    { count: 6, offset: src.length },
  ]);
});

test('milestones skip removed material', () => {
  const src = '% a comment line\nalpha beta \\label{x} gamma delta';
  assert.deepStrictEqual(wordMilestones(src, 2), [
    { count: 2, offset: src.indexOf('beta') + 'beta'.length },
    { count: 4, offset: src.length },
  ]);
});

test('milestones respect the comment environment option', () => {
  const src = 'a b \\begin{comment} c d \\end{comment} e f';
  assert.deepStrictEqual(
    wordMilestones(src, 2, { ignoreCommentEnvironment: true }),
    [
      { count: 2, offset: 'a b'.length },
      { count: 4, offset: src.length },
    ]
  );
});

test('milestones are empty for an invalid interval', () => {
  assert.deepStrictEqual(wordMilestones('one two three', 0), []);
  assert.deepStrictEqual(wordMilestones('one two three', NaN), []);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
