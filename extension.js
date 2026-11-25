'use strict';

const vscode = require('vscode');
const {
  analyse,
  wordMilestones,
  findLuaBlocks,
  describeLuaProblem,
} = require('./wordcount');

/** How long to wait after the last edit before redrawing the markers. */
const MARKER_DEBOUNCE_MS = 300;

/** Maps the severity names of the word counter to the ones of VS Code. */
const LUA_SEVERITY = {
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
};

/** @type {vscode.StatusBarItem} */
let statusBarItem;

/** @type {vscode.TextEditorDecorationType} */
let markerDecorationType;

/** @type {NodeJS.Timeout | undefined} */
let markerTimer;

/** @type {vscode.DiagnosticCollection} */
let luaDiagnostics;

/**
 * Returns true when the given document is a LaTeX document.
 * @param {vscode.TextDocument | undefined} document
 */
function isTexDocument(document) {
  return !!document && document.languageId === 'latex';
}

/**
 * Reads the extension's options from the workspace configuration.
 */
function getOptions() {
  const config = vscode.workspace.getConfiguration('texWordCount');
  return {
    countBracedArguments: config.get('countBracedArguments', true),
    showCharacters: config.get('showCharacters', true),
    markersEnabled: config.get('progressMarkers.enabled', true),
    markerInterval: config.get('progressMarkers.interval', 250),
    luaWarnings: config.get('luaWarnings', true),
  };
}

/**
 * Returns the text to count for the active editor: the current selection when
 * one (non-empty) exists, otherwise the whole document. The boolean flags
 * whether we are in "selection mode".
 * @param {vscode.TextEditor} editor
 * @returns {{ text: string, isSelection: boolean }}
 */
function getTextToCount(editor) {
  const selections = editor.selections.filter((s) => !s.isEmpty);
  if (selections.length > 0) {
    const text = selections
      .map((s) => editor.document.getText(s))
      .join('\n');
    return { text, isSelection: true };
  }
  return { text: editor.document.getText(), isSelection: false };
}

/**
 * Recomputes the counts for the active editor and updates the status bar.
 */
function updateStatusBar() {
  const editor = vscode.window.activeTextEditor;

  if (!editor || !isTexDocument(editor.document)) {
    statusBarItem.hide();
    return;
  }

  const options = getOptions();
  const { text, isSelection } = getTextToCount(editor);
  // Only strip \begin{comment}...\end{comment} blocks when counting the whole
  // document, not when counting an explicit selection.
  const { words, characters } = analyse(text, {
    ...options,
    ignoreCommentEnvironment: !isSelection,
  });

  const parts = [`${words} ${words === 1 ? 'word' : 'words'}`];
  if (options.showCharacters) {
    parts.push(`${characters} ${characters === 1 ? 'char' : 'chars'}`);
  }

  statusBarItem.text = `$(book) ${parts.join(', ')}${isSelection ? ' (selection)' : ''}`;
  const scope = isSelection ? 'selection' : 'document';
  statusBarItem.tooltip =
    `LaTeX word count of the ${scope} (commands and comments excluded)\n` +
    'Click for the word count and the progress marker settings';
  statusBarItem.show();
}

/**
 * Draws the progress markers for the active editor: a faint label at the end of
 * the line where the running count reaches each multiple of the configured
 * interval. Markers always describe the whole document, so they stay put while
 * the user selects text.
 */
function updateMarkers() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTexDocument(editor.document)) {
    return;
  }

  const options = getOptions();
  if (!options.markersEnabled) {
    editor.setDecorations(markerDecorationType, []);
    return;
  }

  const document = editor.document;
  const milestones = wordMilestones(
    document.getText(),
    options.markerInterval,
    { ...options, ignoreCommentEnvironment: true }
  );

  // Two milestones can land on the same line; label it with both.
  /** @type {Map<number, number[]>} */
  const byLine = new Map();
  for (const { count, offset } of milestones) {
    const line = document.positionAt(offset).line;
    const counts = byLine.get(line);
    if (counts) {
      counts.push(count);
    } else {
      byLine.set(line, [count]);
    }
  }

  const decorations = [];
  for (const [line, counts] of byLine) {
    const end = document.lineAt(line).range.end;
    decorations.push({
      range: new vscode.Range(end, end),
      renderOptions: {
        after: { contentText: counts.map((n) => `· ${n}`).join(' ') },
      },
    });
  }

  editor.setDecorations(markerDecorationType, decorations);
}

/**
 * Marks the Lua blocks of the active editor that need attention: blocks without
 * a word count, with an unconfirmed one or with code that changed since the
 * count was confirmed. Only the first line of a block is marked, so a long
 * environment does not light up as a whole.
 */
function updateLuaDiagnostics() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTexDocument(editor.document)) {
    return;
  }

  const document = editor.document;
  if (!getOptions().luaWarnings) {
    luaDiagnostics.delete(document.uri);
    return;
  }

  const diagnostics = [];
  for (const block of findLuaBlocks(document.getText())) {
    const problem = describeLuaProblem(block);
    if (!problem) {
      continue;
    }
    const start = document.positionAt(block.start);
    const end = document.positionAt(block.end);
    const markedEnd =
      end.line === start.line ? end : document.lineAt(start.line).range.end;
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(start, markedEnd),
      problem.message,
      LUA_SEVERITY[problem.severity]
    );
    diagnostic.source = 'TeX Word Count';
    diagnostics.push(diagnostic);
  }
  luaDiagnostics.set(document.uri, diagnostics);
}

/**
 * Redraws the markers and refreshes the Lua diagnostics once the user pauses,
 * so that typing does not trigger a full re-scan of the document on every
 * keystroke.
 */
function scheduleMarkerUpdate() {
  if (markerTimer) {
    clearTimeout(markerTimer);
  }
  markerTimer = setTimeout(() => {
    markerTimer = undefined;
    updateMarkers();
    updateLuaDiagnostics();
  }, MARKER_DEBOUNCE_MS);
}

/**
 * Shows the counts for the active editor in a notification.
 */
function showCount() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isTexDocument(editor.document)) {
    vscode.window.showInformationMessage(
      'Open a LaTeX (.tex) file to see its word count.'
    );
    return;
  }
  const { text, isSelection } = getTextToCount(editor);
  const { words, characters } = analyse(text, {
    ...getOptions(),
    ignoreCommentEnvironment: !isSelection,
  });
  const scope = isSelection ? 'The selection' : 'This LaTeX document';
  vscode.window.showInformationMessage(
    `${scope} has ${words} ${words === 1 ? 'word' : 'words'} ` +
      `and ${characters} ${characters === 1 ? 'character' : 'characters'}.`
  );
}

/**
 * Where each configuration target keeps its JSON file, and the command that
 * opens it. Used to point the user at the right file when a write fails.
 */
const SETTINGS_FILE = new Map([
  [vscode.ConfigurationTarget.Global, ['user settings', 'workbench.action.openSettingsJson']],
  [vscode.ConfigurationTarget.Workspace, ['workspace settings', 'workbench.action.openWorkspaceSettingsFile']],
  [vscode.ConfigurationTarget.WorkspaceFolder, ['folder settings', 'workbench.action.openFolderSettingsFile']],
]);

/**
 * Writes a setting back where the user already keeps it: if it has a value in
 * the workspace (or folder), that is the one updated, so a per-project choice
 * is not silently overridden by a global one. Otherwise the global value is
 * used, which is also the case when no folder is open.
 *
 * VS Code refuses to write a settings file that it cannot parse, and the error
 * it raises does not say which file is at fault, so failures are reported here
 * with a way to open the offending file.
 *
 * @param {string} key    Setting name, without the `texWordCount.` prefix.
 * @param {any} value
 * @returns {Promise<boolean>} Whether the setting was stored.
 */
async function updateSetting(key, value) {
  const config = vscode.workspace.getConfiguration('texWordCount');
  const current = config.inspect(key);

  let target = vscode.ConfigurationTarget.Global;
  if (current && current.workspaceFolderValue !== undefined) {
    target = vscode.ConfigurationTarget.WorkspaceFolder;
  } else if (current && current.workspaceValue !== undefined) {
    target = vscode.ConfigurationTarget.Workspace;
  }

  try {
    await config.update(key, value, target);
    return true;
  } catch (error) {
    const [name, command] = SETTINGS_FILE.get(target);
    const open = 'Open Settings (JSON)';
    const choice = await vscode.window.showErrorMessage(
      `TeX Word Count could not save its setting: your ${name} file could not be ` +
        'updated, usually because it contains a JSON error. Open it, fix the ' +
        'problem reported there, and try again.',
      open
    );
    if (choice === open) {
      await vscode.commands.executeCommand(command);
    }
    return false;
  }
}

/**
 * Asks for the number of words between progress markers and stores it.
 */
async function setMarkerInterval() {
  const current = getOptions().markerInterval;
  const presets = [100, 250, 500, 1000];

  const picked = await vscode.window.showQuickPick(
    [
      ...presets.map((n) => ({
        label: `${n} words`,
        description: n === current ? 'current' : undefined,
        value: n,
      })),
      { label: 'Custom…', description: 'Type any number of words', value: 0 },
    ],
    { title: 'Words between progress markers', placeHolder: `Currently ${current}` }
  );

  if (!picked) {
    return;
  }

  let interval = picked.value;
  if (interval === 0) {
    const typed = await vscode.window.showInputBox({
      title: 'Words between progress markers',
      value: String(current),
      validateInput: (input) => {
        const n = Number(input);
        return Number.isInteger(n) && n >= 1
          ? undefined
          : 'Enter a whole number of words (1 or more).';
      },
    });
    if (typed === undefined) {
      return;
    }
    interval = Number(typed);
  }

  const stored = await updateSetting('progressMarkers.interval', interval);
  // Turning the interval up or down is a good sign the user wants to see them.
  // A second write is pointless (and a second error) if the first one failed.
  if (stored && !getOptions().markersEnabled) {
    await updateSetting('progressMarkers.enabled', true);
  }
}

/**
 * Turns the in-editor progress markers on or off.
 */
async function toggleMarkers() {
  await updateSetting('progressMarkers.enabled', !getOptions().markersEnabled);
}

/**
 * The menu behind the status bar item: the counts, plus the two marker
 * settings, without a trip to the Settings editor.
 */
async function showMenu() {
  const options = getOptions();

  const picked = await vscode.window.showQuickPick(
    [
      { label: '$(book) Show word count', action: showCount },
      {
        label: '$(settings) Set marker interval…',
        description: `currently every ${options.markerInterval} words`,
        action: setMarkerInterval,
      },
      {
        label: options.markersEnabled
          ? '$(eye-closed) Hide progress markers'
          : '$(eye) Show progress markers',
        action: toggleMarkers,
      },
    ],
    { title: 'TeX Word Count' }
  );

  if (picked) {
    await picked.action();
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'texWordCount.showMenu';
  context.subscriptions.push(statusBarItem);

  luaDiagnostics = vscode.languages.createDiagnosticCollection('texWordCount');
  context.subscriptions.push(luaDiagnostics);

  // The milestone labels: dimmed, italic ghost text after the line's own text.
  // The colour comes from the theme (the same one CodeLens uses), so the
  // markers stay readable but recessive in both light and dark themes.
  markerDecorationType = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      fontStyle: 'italic',
      margin: '0 0 0 2em',
      // `textDecoration` is passed through as CSS, which is the only way to
      // fade the label further than the theme colour already does.
      textDecoration: 'none; opacity: 0.55',
    },
  });
  context.subscriptions.push(markerDecorationType);

  context.subscriptions.push(
    vscode.commands.registerCommand('texWordCount.showCount', showCount),
    vscode.commands.registerCommand('texWordCount.showMenu', showMenu),
    vscode.commands.registerCommand(
      'texWordCount.setMarkerInterval',
      setMarkerInterval
    ),
    vscode.commands.registerCommand('texWordCount.toggleMarkers', toggleMarkers)
  );

  // Recompute when the editor, its selection, its contents, or the settings
  // change.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => {
      updateStatusBar();
      // A newly revealed editor has no decorations yet: draw them at once.
      updateMarkers();
      updateLuaDiagnostics();
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor === vscode.window.activeTextEditor) {
        updateStatusBar();
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && event.document === editor.document) {
        updateStatusBar();
        scheduleMarkerUpdate();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('texWordCount')) {
        updateStatusBar();
        updateMarkers();
        updateLuaDiagnostics();
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      luaDiagnostics.delete(document.uri);
    })
  );

  updateStatusBar();
  updateMarkers();
  updateLuaDiagnostics();
}

function deactivate() {
  if (markerTimer) {
    clearTimeout(markerTimer);
    markerTimer = undefined;
  }
  if (markerDecorationType) {
    markerDecorationType.dispose();
  }
  if (luaDiagnostics) {
    luaDiagnostics.dispose();
  }
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}

module.exports = { activate, deactivate };
