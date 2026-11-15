# TeX Word Count

A small Visual Studio Code extension that counts the words in a LaTeX
document and shows the total in the status bar. LaTeX commands and comments
are excluded from the count, so the number reflects the prose you have
actually written.

## Features

- Live word **and character** count for `.tex` files, shown in the status bar.
- **Selection mode**: when you select text, the counts update to reflect only
  the selection (shown with a `(selection)` label). Multiple selections are
  supported.
- Ignores LaTeX commands (`\section`, `\textbf`, …) and their optional
  arguments.
- Ignores comments (anything after an unescaped `%`).
- Ignores mathematics (`$…$`, `$$…$$`, `\[…\]`, `\(…\)`) and verbatim
  environments.
- Ignores the contents of `\begin{comment}...\end{comment}` blocks in the
  document count. (They are still counted if they fall inside a selection.)
- Counts the text inside command braces (for example the title in
  `\section{Introduction}`). This can be turned off.
- **Progress markers**: a faint, italic label at the end of the line where the
  running word count reaches each multiple of 250 words (`· 250`, `· 500`, …),
  so you can see how far into the text you are without leaving the page. The
  interval is configurable, and the markers can be turned off.
- Click the status bar item for a menu with the counts and the marker settings.

The character count excludes spaces (a "characters without spaces" figure) and,
like the word count, ignores commands and comments.

## Progress markers

Every 250 words (by default), a faint label appears at the end of the line where
the count reaches that milestone:

```
Ut enim ad minim veniam, quis nostrud exercitation
ullamco laboris nisi ut aliquip ex ea commodo.        · 250
```

The markers are drawn with the theme's CodeLens colour, faded, so they stay
legible without competing with your text, and they always describe the whole
document, so they do not move while you select text. They are decorations only:
nothing is ever written to your `.tex` file.

### Changing the interval

Pick whichever route suits you; all of them write the same setting.

**From the status bar** (quickest). Click the word count at the bottom right and
choose **Set marker interval…**. Pick 100, 250, 500 or 1000 words, or
**Custom…** to type any number. The same menu hides and shows the markers.

**From the Command Palette.**
<br><kbd><b>Cmd</b></kbd>+<kbd><b>Shift</b></kbd>+<kbd><b>P</b></kbd> (macOS)
/<br><kbd><b>Ctrl</b></kbd>+<kbd><b>Shift</b></kbd>+<kbd><b>P</b></kbd> (Windows/Linux),
then:

- **TeX Word Count: Set Progress Marker Interval** — the same picker as above.
- **TeX Word Count: Toggle Progress Markers** — hide or show them.

**From the Settings editor.**
<br><kbd><b>Cmd</b></kbd>+<kbd><b>,</b></kbd> (macOS)
/<br><kbd><b>Ctrl</b></kbd>+<kbd><b>,</b></kbd> (Windows/Linux),<br> search for `TeX Word Count`,
and edit **Progress Markers: Interval**.

**From `settings.json`.** Useful for a per-project value: put this in
`.vscode/settings.json` inside the project (or in your user `settings.json` to
apply everywhere).

```json
{
  "texWordCount.progressMarkers.interval": 500,
  "texWordCount.progressMarkers.enabled": true
}
```

A project value wins over your global one, and the picker respects that: if the
setting already has a value in the current workspace, the picker updates *that*
value rather than your global default. Either way the markers redraw
immediately — no reload needed.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `texWordCount.countBracedArguments` | `true` | Count the text inside command braces, such as `\section{...}`. |
| `texWordCount.showCharacters` | `true` | Also show a character count alongside the word count. |
| `texWordCount.progressMarkers.enabled` | `true` | Show the in-editor word-count milestones. |
| `texWordCount.progressMarkers.interval` | `250` | Number of words between milestones. |

## Requirements

The status bar item appears for documents whose language is set to `latex`.
VS Code recognises `.tex` files as LaTeX automatically; installing a LaTeX
extension such as **LaTeX Workshop** is recommended but not required.

## Development

```bash
npm test        # run the word-counting unit tests
npx @vscode/vsce package # prepare the package
```

Press `F5` in VS Code to launch an Extension Development Host and try the
extension against a real `.tex` file.

## License

MIT
