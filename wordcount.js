'use strict';

/**
 * Commands whose first braced argument is *not* prose and should be removed
 * along with the command. Commands that take a trailing text argument (such as
 * `\href{url}{text}` or `\textcolor{colour}{text}`) are included here too: only
 * their first, non-text brace group is stripped, and the remaining `{text}`
 * group is left in place to be counted.
 */
const DROP_WITH_ARG = [
  // Preamble and structure.
  'documentclass', 'usepackage', 'RequirePackage', 'begin', 'end',
  'newcommand', 'renewcommand', 'providecommand', 'newenvironment',
  'DeclareMathOperator', 'newtheorem', 'setcounter', 'setlength',
  // Cross-references and citations.
  'label', 'ref', 'eqref', 'pageref', 'cref', 'Cref', 'autoref', 'nameref',
  'cite', 'citep', 'citet', 'citeauthor', 'citeyear', 'citealt', 'nocite',
  // Inputs, bibliography and graphics.
  'input', 'include', 'includeonly', 'includegraphics', 'bibliography',
  'bibliographystyle', 'addbibresource', 'printbibliography',
  // Spacing, colours, links and setup.
  'hspace', 'vspace', 'usetikzlibrary', 'definecolor', 'geometry',
  'pagestyle', 'thispagestyle', 'textcolor', 'colorbox', 'fcolorbox',
  'href', 'url', 'hypersetup',
];

const DROP_WITH_ARG_RE = new RegExp(
  '\\\\(?:' + DROP_WITH_ARG.join('|') + ')\\*?\\s*(?:\\[[^\\]]*\\])?\\s*\\{[^{}]*\\}',
  'g'
);

/**
 * Strips a LaTeX comment from a single line.
 *
 * A `%` begins a comment that runs to the end of the line, unless it is
 * escaped as `\%`. An even number of preceding backslashes means the `%` is
 * not escaped (the backslashes pair up into literal `\\`).
 *
 * @param {string} line
 * @returns {string}
 */
function stripComment(line) {
  let backslashes = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') {
      backslashes++;
    } else if (ch === '%' && backslashes % 2 === 0) {
      // Unescaped `%`: the rest of the line is a comment.
      return line.slice(0, i);
    } else {
      backslashes = 0;
    }
  }
  return line;
}

/**
 * Replaces a matched chunk with whitespace of exactly the same length, keeping
 * newlines in place. Used when the caller needs the cleaned text to line up,
 * character for character, with the original document.
 * @param {string} match
 * @returns {string}
 */
function blank(match) {
  return match.replace(/[^\n]/g, ' ');
}

/**
 * Table environments whose first mandatory arguments are not text, mapped to
 * the number of those arguments. For `\begin{tabular}{lcr}` that is the column
 * specification, for `\begin{tabularx}{12cm}{XX}` the width and the columns.
 */
const TABLE_ENVIRONMENTS = {
  tabular: 1,
  'tabular*': 2,
  tabularx: 2,
  tabulary: 2,
  longtable: 1,
  xltabular: 2,
  NiceTabular: 1,
};

const TABLE_BEGIN_RE = new RegExp(
  '\\\\begin\\{(' +
  Object.keys(TABLE_ENVIRONMENTS)
    .map((name) => name.replace('*', '\\*'))
    .join('|') +
  ')\\}\\s*(?:\\[[^\\]]*\\]\\s*)?',
  'g'
);

/**
 * Finds the end of a braced group, including groups nested inside it, such as
 * the `{3cm}` in `{|l|p{3cm}|}`. Escaped braces (`\{` and `\}`) are skipped.
 *
 * @param {string} text   The text to search in.
 * @param {number} openingBraceIndex   The index of the opening brace.
 * @returns {number}   The index just after the matching closing brace, or -1
 *                     when the group is not closed.
 */
function findGroupEnd(text, openingBraceIndex) {
  let depth = 0;
  for (let index = openingBraceIndex; index < text.length; index++) {
    const character = text[index];
    if (character === '\\') {
      index++;
    } else if (character === '{') {
      depth++;
    } else if (character === '}') {
      depth--;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  return -1;
}

/**
 * Removes the beginning of a table environment together with the arguments
 * that are not text, such as the column specification of `tabular`. An
 * optional position argument like `[t]` is removed as well.
 *
 * @param {string} text   The LaTeX text to process.
 * @param {string|function} gap   What the removed text is replaced with.
 * @returns {string}
 */
function removeTableColumnSpecifications(text, gap) {
  let result = '';
  let copiedUpTo = 0;
  TABLE_BEGIN_RE.lastIndex = 0;
  let beginMatch;
  while ((beginMatch = TABLE_BEGIN_RE.exec(text)) !== null) {
    let removedUpTo = beginMatch.index + beginMatch[0].length;
    for (let group = 0; group < TABLE_ENVIRONMENTS[beginMatch[1]]; group++) {
      let braceIndex = removedUpTo;
      while (/\s/.test(text[braceIndex] || '')) {
        braceIndex++;
      }
      if (text[braceIndex] !== '{') {
        break;
      }
      const groupEnd = findGroupEnd(text, braceIndex);
      if (groupEnd === -1) {
        break;
      }
      removedUpTo = groupEnd;
    }
    const removedText = text.slice(beginMatch.index, removedUpTo);
    result += text.slice(copiedUpTo, beginMatch.index);
    result += typeof gap === 'function' ? gap(removedText) : gap;
    copiedUpTo = removedUpTo;
    TABLE_BEGIN_RE.lastIndex = removedUpTo;
  }
  return result + text.slice(copiedUpTo);
}

/**
 * Reduces a piece of LaTeX to just its prose, removing comments, commands,
 * mathematics and verbatim blocks. This shared step backs both the word and
 * the character counts.
 *
 * @param {string} text            The full document contents.
 * @param {object} [options]
 * @param {boolean} [options.countBracedArguments=true]  When true, text inside
 *        the braces of text commands (such as `\section{...}`) is kept.
 * @param {boolean} [options.ignoreCommentEnvironment=false]  When true, the
 *        contents of `\begin{comment}...\end{comment}` blocks are removed.
 * @param {boolean} [options.preserveOffsets=false]  When true, everything that
 *        is removed is padded with spaces instead of collapsed, so that every
 *        surviving character keeps its original offset in `text`. Needed to map
 *        a word back to a position in the document.
 * @returns {string}
 */
function cleanLatex(text, options = {}) {
  const countBraced = options.countBracedArguments !== false;
  // What removed text is replaced with: same-length padding, or a single space.
  const gap = options.preserveOffsets ? blank : ' ';

  // 1. Remove comments line by line. Working line by line with a regex (rather
  //    than split/join) leaves the line terminators, CRLF included, untouched.
  let cleaned = text.replace(/[^\r\n]+/g, (line) => {
    const kept = stripComment(line);
    return options.preserveOffsets
      ? kept + ' '.repeat(line.length - kept.length)
      : kept;
  });

  // 1b. Optionally remove `comment` environments (from the `comment` package).
  if (options.ignoreCommentEnvironment) {
    cleaned = cleaned.replace(
      /\\begin\{comment\}[\s\S]*?\\end\{comment\}/g,
      gap
    );
  }

  // 2. Remove verbatim and code environments (their contents are not words).
  cleaned = cleaned.replace(
    /\\begin\{(verbatim\*?|lstlisting|minted|Verbatim)\}[\s\S]*?\\end\{\1\}/g,
    gap
  );

  // 3. Remove display and inline mathematics.
  cleaned = cleaned.replace(/\$\$[\s\S]*?\$\$/g, gap);
  cleaned = cleaned.replace(/\\\[[\s\S]*?\\\]/g, gap);
  cleaned = cleaned.replace(/\\\([\s\S]*?\\\)/g, gap);
  cleaned = cleaned.replace(/(?<!\\)\$[^$]*\$/g, gap);

  // 4. Remove non-text commands together with their braced argument
  //    (\usepackage{...}, \begin{...}, \label{...}, \cite{...}, …).
  cleaned = removeTableColumnSpecifications(cleaned, gap);
  cleaned = cleaned.replace(DROP_WITH_ARG_RE, gap);

  // 5. Remove any remaining commands and their optional argument, keeping the
  //    braces so that text commands such as \section{...} or \textbf{...}
  //    retain their contents.
  cleaned = cleaned.replace(/\\[a-zA-Z@]+\*?\s*(?:\[[^\]]*\])?/g, gap);

  // 6. Remove single-character escaped symbols: \%, \&, \_, \\, \{, \}, etc.
  cleaned = cleaned.replace(/\\[^a-zA-Z@]/g, gap);

  // 7. Braces: either keep their contents or drop them entirely.
  if (countBraced) {
    cleaned = cleaned.replace(/[{}]/g, ' ');
  } else {
    cleaned = cleaned.replace(/\{[^{}]*\}/g, gap);
    cleaned = cleaned.replace(/[{}]/g, ' ');
  }

  // 8. Alignment and other symbols that are not words.
  cleaned = cleaned.replace(/[&~^]/g, ' ');

  return cleaned;
}

/** A word: a run starting with a letter or digit. */
const WORD_SOURCE = "[\\p{L}\\p{N}][\\p{L}\\p{N}'’-]*";

/**
 * Counts the words in a piece of LaTeX, ignoring comments and commands.
 * @param {string} text
 * @param {object} [options]  See {@link cleanLatex}.
 * @returns {number}
 */
function countWords(text, options = {}) {
  // Count runs that contain at least one letter or digit.
  const matches = cleanLatex(text, options).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}

/**
 * Counts the prose characters in a piece of LaTeX, ignoring comments,
 * commands and runs of whitespace (a "characters without spaces" count).
 * @param {string} text
 * @param {object} [options]  See {@link cleanLatex}.
 * @returns {number}
 */
function countCharacters(text, options = {}) {
  return cleanLatex(text, options).replace(/\s+/g, '').length;
}

/**
 * Convenience helper returning both counts from a single cleaning pass.
 * @param {string} text
 * @param {object} [options]  See {@link cleanLatex}.
 * @returns {{ words: number, characters: number }}
 */
function analyse(text, options = {}) {
  const cleaned = cleanLatex(text, options);
  const words = cleaned.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return {
    words: words ? words.length : 0,
    characters: cleaned.replace(/\s+/g, '').length,
  };
}

/**
 * Finds where the running word count reaches each multiple of `interval`.
 *
 * Each milestone reports the offset *in the original text* just after the last
 * character of the word that reached it, so a caller can turn it into an editor
 * position. Words are located in the cleaned text, which is padded to keep the
 * original offsets (see {@link cleanLatex}).
 *
 * @param {string} text
 * @param {number} interval   Words between milestones (250, 500, …).
 * @param {object} [options]  See {@link cleanLatex}.
 * @returns {Array<{ count: number, offset: number }>}
 */
function wordMilestones(text, interval, options = {}) {
  const milestones = [];
  const step = Math.floor(interval);
  if (!Number.isFinite(step) || step < 1) {
    return milestones;
  }

  const re = new RegExp(WORD_SOURCE, 'gu');
  const cleaned = cleanLatex(text, { ...options, preserveOffsets: true });
  let count = 0;
  let match;

  while ((match = re.exec(cleaned)) !== null) {
    count++;
    if (count % step === 0) {
      milestones.push({ count, offset: match.index + match[0].length });
    }
  }

  return milestones;
}

module.exports = {
  countWords,
  countCharacters,
  analyse,
  cleanLatex,
  stripComment,
  wordMilestones,
};
