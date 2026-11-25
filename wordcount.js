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
 * Matches a luacode or luacode* environment together with its content.
 */
const LUA_ENVIRONMENT_RE = /\\begin\{(luacode\*?)\}[\s\S]*?\\end\{\1\}/g;

/**
 * Matches a verbatim or code listing environment together with its content.
 */
const VERBATIM_RE = /\\begin\{(verbatim\*?|lstlisting|minted|Verbatim)\}[\s\S]*?\\end\{\1\}/g;

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
 * Replaces the comments of a text with spaces, so that every other character
 * keeps its original offset.
 *
 * @param {string} text   The LaTeX text to process.
 * @returns {string}   The text with its comments blanked.
 */
function blankComments(text) {
  return text.replace(/[^\r\n]+/g, (line) => {
    const kept = stripComment(line);
    return kept + ' '.repeat(line.length - kept.length);
  });
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
 * Table commands whose leading arguments are not text, mapped to the number of
 * braced groups to remove. For `\multicolumn{2}{c}{text}` the span and the
 * alignment go, the text stays.
 */
const TABLE_COMMANDS = {
  multicolumn: 2,
  multirow: 2,
  cmidrule: 1,
  cline: 1,
};

const TABLE_COMMAND_RE = new RegExp(
  '\\\\(' + Object.keys(TABLE_COMMANDS).join('|') + ')(?![a-zA-Z@])\\*?\\s*' +
  '(?:\\[[^\\]]*\\]\\s*)?(?:\\([^)]*\\)\\s*)?',
  'g'
);

/**
 * Lua commands and the number of braced groups that hold their code.
 */
const LUA_COMMANDS = {
  directlua: 1,
  luaexec: 1,
  latelua: 1,
};

/**
 * Matches the start of a Lua command and captures its name in group 1.
 */
const LUA_COMMAND_RE = new RegExp(
  '\\\\(' + Object.keys(LUA_COMMANDS).join('|') + ')(?![a-zA-Z@])\\s*',
  'g'
);

/**
 * Matches the word count annotation of a Lua block, such as `-- words: 3`
 * or `--[[ words: 3 ]]`, and captures the number in group 1.
 */
const LUA_WORDS_RE = /--(?:\[\[)?\s*words:\s*(\d+)/;

/**
 * Matches the code checksum in the annotation of a Lua block, such as
 * `code: 1a2b3c4d`, and captures the eight hexadecimal digits in group 1.
 */
const LUA_CODE_RE = /\bcode:\s*([0-9a-f]{8})\b/;

/**
 * Matches the ignore marker of a Lua block, either as its own line
 * (`-- ignore`) or in its bracket form (`--[[ ignore ]]`).
 */
const LUA_IGNORE_RE = /--\[\[\s*ignore\s*\]\]|^[ \t]*--[ \t]*ignore[ \t\r]*$/m;

/**
 * Matches a call that typesets text from Lua: `tex.print`, `tex.sprint`,
 * `tex.tprint` or `tex.cprint`.
 */
const LUA_PRINT_RE = /\btex\.[stc]?print\b/;

/**
 * Replaces a removed Lua block with the number of words announced in its
 * annotation. A block without an annotation is replaced as if it held no words.
 *
 * @param {string} removedText   The Lua block that is removed.
 * @param {boolean} preserveOffsets   When true, the replacement has exactly
 *        the length of the block and keeps its newlines.
 * @returns {string}
 */
function replaceLuaBlock(removedText, preserveOffsets) {
  const announced = LUA_WORDS_RE.exec(removedText);
  const announcedWords = announced ? Number(announced[1]) : 0;
  if (!preserveOffsets) {
    return ' x'.repeat(announcedWords) + ' ';
  }

  const padded = blank(removedText).split('');
  const lineLength = padded.filter((character) => character !== '\n').length;
  const wordCount = Math.min(announcedWords, Math.floor((lineLength - 1) / 2));
  let position = 0;
  let placed = 0;
  for (let index = 0; index < padded.length && placed < wordCount; index++) {
    if (padded[index] === '\n') {
      continue;
    }
    if (position % 2 === 1) {
      padded[index] = 'x';
      placed++;
    }
    position++;
  }
  return padded.join('');
}

/**
 * Computes the 32 bit FNV-1a hash of a text, taken over its UTF-8 bytes.
 *
 * @param {string} text   The text to hash.
 * @returns {string}   The hash as eight lowercase hexadecimal digits.
 */
function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(text, 'utf8')) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Matches the words annotation of a Lua block in its bracket form
 * (`--[[ words: 3 ]]`) or its line form (`-- words: 3`), including a checked
 * date and a code checksum that may follow.
 */
const LUA_ANNOTATION_RE = /--\[\[\s*words:[\s\S]*?\]\]|--\s*words:[^\n]*/g;

/**
 * Computes the checksum of a Lua block. Used to detect changed Lua code
 * to hint the user to recount the block's words.
 * The annotation is left out and line endings are unified, so neither
 * editing the annotation nor a Windows line ending changes the result.
 *
 * Limitations: The checksum only sees the text of this block. If the block
 * reads data from a file or calls functions defined elsewhere, its output can
 * change while the checksum stays the same. Any edit to the block, even one
 * that does not change output, changes the checksum, so a changed
 * checksum is a reason to check the word count again, not proof that it is
 * wrong. The hash is not cryptographic, and two different texts share a
 * checksum by chance with a probability of about one in 4.3 billion.
 *
 * @param {string} blockText   The text of the Lua block.
 * @returns {string}   The checksum as eight lowercase hexadecimal digits.
 */
function luaChecksum(blockText) {
  const normalized = blockText
    .replace(/\r\n/g, '\n')
    .replace(LUA_ANNOTATION_RE, '');
  return fnv1a(normalized);
}

/**
 * Removes the beginning of an environment or command together with the
 * leading arguments that are not text, such as the column specification of
 * `tabular` or the span of `\multicolumn`. Optional arguments directly after
 * the name are removed as well, for example a `[t]`.
 *
 * @param {string} text   The LaTeX text to process.
 * @param {RegExp} beginRe   Matches the beginning and captures the name in group 1.
 * @param {Object<string, number>} groupCounts   The number of braced groups to remove per name.
 * @param {string|function} gap   What the removed text is replaced with. A
 *        function receives the removed text and the index where it starts.
 * @returns {string}
 */
function removeLeadingArguments(text, beginRe, groupCounts, gap) {
  let result = '';
  let copiedUpTo = 0;
  beginRe.lastIndex = 0;
  let beginMatch;
  while ((beginMatch = beginRe.exec(text)) !== null) {
    let removedUpTo = beginMatch.index + beginMatch[0].length;
    for (let group = 0; group < groupCounts[beginMatch[1]]; group++) {
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
    result += typeof gap === 'function' ? gap(removedText, beginMatch.index) : gap;
    copiedUpTo = removedUpTo;
    beginRe.lastIndex = removedUpTo;
  }
  return result + text.slice(copiedUpTo);
}

/**
 * Describes a Lua block found in a text.
 *
 * @param {string} blockText   The text of the Lua block.
 * @param {number} start   The index of the block in the text.
 * @returns {{ start: number, end: number, status: string, announcedWords: number, printsText: boolean}}
 *          The position of the block, its status, the words announced in its
 *          annotation and whether it typesets text. The status is `ignored`,
 *          `ok`, `changed`, `unconfirmed` or `missing`.
 */
function describeLuaBlock(blockText, start) {
  const announced = LUA_WORDS_RE.exec(blockText);
  const storedChecksum = LUA_CODE_RE.exec(blockText);
  let status = 'missing';
  if (LUA_IGNORE_RE.test(blockText)) {
    status = 'ignored';
  } else if (announced && !storedChecksum) {
    status = 'unconfirmed';
  } else if (announced) {
    status = storedChecksum[1] === luaChecksum(blockText) ? 'ok' : 'changed';
  }
  return {
    start,
    end: start + blockText.length,
    status,
    announcedWords: announced ? Number(announced[1]) : 0,
    printsText: LUA_PRINT_RE.test(blockText),
  };
}

/**
 * Finds all Lua blocks of a text, that is the `luacode` environments and the
 * braces of the Lua commands. Lua blocks inside comments and verbatim
 * environments are not found, and neither is a Lua command without a braced
 * group.
 *
 * @param {string} text   The LaTeX text to search in.
 * @returns {Array<{ start: number, end: number, status: string, announcedWords: number, printsText: boolean}>}
 *          The blocks in the order they appear in the text.
 */
function findLuaBlocks(text) {
  const searchable = blankComments(text).replace(VERBATIM_RE, blank);
  const blocks = [];
  const collectBlock = (foundText, start) => {
    if (!foundText.includes('{')) {
      return foundText;
    }
    const blockText = text.slice(start, start + foundText.length);
    blocks.push(describeLuaBlock(blockText, start));
    return blank(foundText);
  };

  for (const match of searchable.matchAll(LUA_ENVIRONMENT_RE)) {
    collectBlock(match[0], match.index);
  }
  removeLeadingArguments(searchable, LUA_COMMAND_RE, LUA_COMMANDS, collectBlock);

  return blocks.sort((first, second) => first.start - second.start);
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
  const luaGap = (removedText) => replaceLuaBlock(removedText, options.preserveOffsets);

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
  cleaned = cleaned.replace(VERBATIM_RE, gap);

  cleaned = cleaned.replace(LUA_ENVIRONMENT_RE, luaGap);

  // 3. Remove display and inline mathematics.
  cleaned = cleaned.replace(/\$\$[\s\S]*?\$\$/g, gap);
  cleaned = cleaned.replace(/\\\[[\s\S]*?\\\]/g, gap);
  cleaned = cleaned.replace(/\\\([\s\S]*?\\\)/g, gap);
  cleaned = cleaned.replace(/(?<!\\)\$[^$]*\$/g, gap);

  // 4. Remove non-text commands together with their braced argument
  //    (\usepackage{...}, \begin{...}, \label{...}, \cite{...}, …).
  cleaned = removeLeadingArguments(cleaned, TABLE_BEGIN_RE, TABLE_ENVIRONMENTS, gap);
  cleaned = removeLeadingArguments(cleaned, TABLE_COMMAND_RE, TABLE_COMMANDS, gap);
  cleaned = removeLeadingArguments(cleaned, LUA_COMMAND_RE, LUA_COMMANDS, luaGap);
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
  fnv1a,
  luaChecksum,
  findLuaBlocks,
};
