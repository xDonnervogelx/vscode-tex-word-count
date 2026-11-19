# Change Log

### PR-Unreleased

- Keys of biblatex citation commands (`\parencite`, `\textcite`, `\autocite`, `\footcite`, `\smartcite`) are no longer counted as words, and commands with several optional arguments (such as `\parencite[cf.][35]{key}`) are now removed completely.

## 0.4.2

- Changing a setting from the status bar menu no longer fails with a bare
  "Unable to write into user settings" from VS Code. The extension now says
  which settings file could not be written and why (usually a JSON error in it),
  and offers to open that file.

## 0.4.1

- Updated the extension icon.

## 0.4.0

- Added in-editor progress markers: a faint label at the end of the line where
  the running word count reaches each milestone (every 250 words by default).
- Added `texWordCount.progressMarkers.enabled` and
  `texWordCount.progressMarkers.interval` settings.
- Added **TeX Word Count: Set Progress Marker Interval** (a picker with 100,
  250, 500, 1000 or a custom number) and **TeX Word Count: Toggle Progress
  Markers**. Both respect a per-workspace value of the setting when there is
  one.
- Clicking the status bar item now opens a menu with the word count and the
  marker settings; the count on its own is still available as **TeX Word Count:
  Show Word Count**.

## 0.3.0

- Ignore the contents of `\begin{comment}...\end{comment}` blocks in the
  document count (they are still counted when they fall inside an explicit
  selection).
- Updated the extension icon.

## 0.2.0

- Added a character count (without spaces) alongside the word count, with a
  `texWordCount.showCharacters` setting to toggle it.
- Added selection mode: counts reflect the current selection when there is one.
- Added an extension icon.

## 0.1.0

- Initial release.
- Live LaTeX word count in the status bar, excluding commands and comments.
- Ignores mathematics and verbatim environments.
- `texWordCount.countBracedArguments` setting to include or exclude braced
  argument text.
