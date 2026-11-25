'use strict';

const assert = require('assert');
const {
  countWords,
  countCharacters,
  analyse,
  cleanLatex,
  stripComment,
  wordMilestones,
  fnv1a,
  luaChecksum,
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

test('ignores the column specification of a tabular', () => {
  assert.strictEqual(countWords(
    '\\begin{tabular}{lcr} one & two & three \\\\ four & five & six \\end{tabular}'
  ), 6);
});

const tableEnvironments = [
  { environmentName: 'tabular', columnArguments: '{ll}' },
  { environmentName: 'tabular*', columnArguments: '{12cm}{ll}' },
  { environmentName: 'tabularx', columnArguments: '{12cm}{XX}' },
  { environmentName: 'tabulary', columnArguments: '{12cm}{LL}' },
  { environmentName: 'longtable', columnArguments: '{ll}' },
  { environmentName: 'xltabular', columnArguments: '{12cm}{XX}' },
  { environmentName: 'NiceTabular', columnArguments: '{ll}' },
];

for (const { environmentName, columnArguments } of tableEnvironments) {
  test(`ignores the arguments of ${environmentName}`, () => {
    const latex = `\\begin{${environmentName}}${columnArguments} one & two \\end{${environmentName}}`;
    assert.strictEqual(countWords(latex), 2);
  });
}

test('keeps the words of a table at their original position', () => {
  const src = '\\begin{tabular}{|l|p{3cm}|} alpha & beta \\end{tabular}';
  const padded = cleanLatex(src, { preserveOffsets: true });

  assert.strictEqual(padded.length, src.length);
  assert.strictEqual(padded.indexOf('alpha'), src.indexOf('alpha'));
  assert.strictEqual(padded.indexOf('beta'), src.indexOf('beta'));
});

test('ignores the position argument of a tabular', () => {
  assert.strictEqual(
    countWords('\\begin{tabular}[t]{ll} one & two \\end{tabular}'),
    2
  );
});

test('ignores nested braces in a column specification', () => {
  assert.strictEqual(
    countWords('\\begin{tabular}{|l|p{3cm}|} one & two \\end{tabular}'),
    2
  );
});

test('ignores the span arguments of a multicolumn', () => {
  assert.strictEqual(
    countWords('\\multicolumn{2}{c}{one two} three'),
    3
  );
});

test('ignores the span arguments of a multirow', () => {
  assert.strictEqual(
    countWords('\\multirow{2}{*}{one two} three'),
    3
  );
});

test('ignores the trim and range arguments of a cmidrule', () => {
  assert.strictEqual(
    countWords('\\cmidrule(lr){2-3} one'),
    1
  );
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

test('ignores the content of a luacode environment', () => {
  const src = [
    'Before the code.',
    '\\begin{luacode}',
    'local total = 0',
    'for i = 1, 3 do total = total + i end',
    '\\end{luacode}',
    'After the code.',
  ].join('\n');

  assert.strictEqual(analyse(src).words, 6);
});

test('ignores the content of a luacode* environment', () => {
  const src = [
    'Before the code.',
    '\\begin{luacode*}',
    'tex.print("hello world")',
    '\\end{luacode*}',
    'After the code.',
  ].join('\n');

  assert.strictEqual(analyse(src).words, 6);
});

test('keeps counting the text after an incomplete luacode block inside verbatim', () => {
  const src = [
    '\\begin{verbatim}',
    '\\begin{luacode}',
    '\\end{verbatim}',
    'Four words stay here.',
    '\\begin{luacode}',
    'x = 1',
    '\\end{luacode}',
  ].join('\n');

  assert.strictEqual(analyse(src).words, 4);
});

test('keeps the words after a luacode environment at their original position', () => {
  const src = 'alpha\n\\begin{luacode}\nx = 1\n\\end{luacode}\nbeta';
  const padded = cleanLatex(src, { preserveOffsets: true });

  assert.strictEqual(padded.length, src.length);
  assert.strictEqual(padded.indexOf('alpha'), src.indexOf('alpha'));
  assert.strictEqual(padded.indexOf('beta'), src.indexOf('beta'));
});

test('ignores the code of the lua commands', () => {
  for (const name of ['directlua', 'luaexec', 'latelua']) {
    const src = `Before the code. \\${name}{tex.print("hi")} After the code.`;
    assert.strictEqual(analyse(src).words, 6, name);
  }
});

test('ignores a lua command with nested braces', () => {
  const src = [
    'Before the code.',
    '\\directlua{local list = {1, 2} for i = 1, #list do end}',
    'After the code.',
  ].join('\n');

  assert.strictEqual(analyse(src).words, 6);
});

test('keeps counting the text after an incomplete lua command inside verbatim', () => {
  const src = [
    '\\begin{verbatim}',
    '\\directlua{',
    '\\end{verbatim}',
    'Four words stay here.',
    '\\directlua{x = 1}',
  ].join('\n');

  assert.strictEqual(analyse(src).words, 4);
});

test('counts the words announced in a luacode environment', () => {
  const src = [
    'Before the code.',
    '\\begin{luacode}',
    '-- words: 3',
    'tex.print("one two three")',
    '\\end{luacode}',
    'After the code.',
  ].join('\n');

  assert.strictEqual(analyse(src).words, 9);
});

test('accepts different spacing in the words annotation', () => {
  for (const annotation of ['-- words: 2', '--words:2', '--   words:   2']) {
    const src = [
      'Before the code.',
      '\\begin{luacode}',
      annotation,
      'tex.print("a b")',
      '\\end{luacode}',
      'After the code.',
    ].join('\n');

    assert.strictEqual(analyse(src).words, 8, annotation);
  }
});

test('counts the words announced in a lua command', () => {
  const src =
    'Before the code. \\directlua{--[[ words: 2 ]] tex.print("a b")} After the code.';

  assert.strictEqual(analyse(src).words, 8);
});

test('keeps the words after an annotated luacode block at their original position', () => {
  const src = 'alpha\n\\begin{luacode}\n-- words: 2\nx = 1\n\\end{luacode}\nbeta';
  const padded = cleanLatex(src, { preserveOffsets: true });

  assert.strictEqual(padded.length, src.length);
  assert.strictEqual(padded.indexOf('alpha'), src.indexOf('alpha'));
  assert.strictEqual(padded.indexOf('beta'), src.indexOf('beta'));
});

test('preserving offsets does not change the count of announced words', () => {
  const src = 'alpha\n\\begin{luacode}\n-- words: 2\nx = 1\n\\end{luacode}\nbeta';
  const padded =
    cleanLatex(src, { preserveOffsets: true }).match(
      /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu
    ) || [];

  assert.strictEqual(analyse(src).words, 4);
  assert.strictEqual(padded.length, 4);
});

test('milestones place announced words inside the lua block', () => {
  const src = 'one\n\\begin{luacode}\n-- words: 2\n\\end{luacode}\ntwo';
  const milestones = wordMilestones(src, 2);

  assert.strictEqual(milestones.length, 2);
  assert.ok(milestones[0].offset > src.indexOf('\\begin'), 'milestone lies before the block');
  assert.ok(milestones[0].offset < src.indexOf('two'), 'milestone lies after the block');
  assert.strictEqual(milestones[1].offset, src.length);
});

test(
  'computes the FNV-1a checksum as eight hexadecimal digits to detect changed Lua code',
  () => {
    assert.strictEqual(fnv1a(''), '811c9dc5');
    assert.strictEqual(fnv1a('a'), 'e40c292c');
    assert.strictEqual(fnv1a('foobar'), 'bf9cf968');
  }
);

test('checksum ignores the whole annotation of a lua block', () => {
  const plain = '-- words: 3\nlocal a = 1';
  const confirmed = '-- words: 5 checked: 2026-11-25 code: abcd1234\nlocal a = 1';

  assert.strictEqual(luaChecksum(plain), luaChecksum(confirmed));
});

test('changes the checksum with the code but not with the line endings', () => {
  assert.notStrictEqual(luaChecksum('local a = 1'), luaChecksum('local a = 2'));
  assert.strictEqual(luaChecksum('a = 1\r\nb = 2'), luaChecksum('a = 1\nb = 2'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
