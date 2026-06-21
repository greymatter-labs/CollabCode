import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/java/java.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/php/php.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/go/go.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/swift/swift.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/kotlin/kotlin.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/scala/scala.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/r/r.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/perl/perl.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/lua/lua.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/elixir/elixir.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/dart/dart.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/html/html.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/css/css.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';
import 'monaco-editor/esm/vs/language/json/monaco.contribution.js';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution.js';
import 'monaco-editor/min/vs/editor/editor.main.css';
import { MonacoBinding } from 'y-monaco';

const WORKER_VERSION = '1';
const MODEL_SCHEME = 'opencall-collab';
const THEME_NAME = 'opencall-dark';

const languageMap = {
  javascript: 'javascript',
  typescript: 'typescript',
  python: 'python',
  java: 'java',
  c_cpp: 'cpp',
  csharp: 'csharp',
  php: 'php',
  ruby: 'ruby',
  go: 'go',
  rust: 'rust',
  swift: 'swift',
  kotlin: 'kotlin',
  scala: 'scala',
  r: 'r',
  perl: 'perl',
  lua: 'lua',
  elixir: 'elixir',
  dart: 'dart',
  html: 'html',
  css: 'css',
  sql: 'sql',
  json: 'json',
  yaml: 'yaml',
  xml: 'xml',
  markdown: 'markdown'
};

const lightThemes = new Set(['github', 'textmate', 'solarized_light']);

function setupWorkers() {
  window.MonacoEnvironment = {
    getWorker(_workerId, label) {
      const query = `?v=${WORKER_VERSION}`;
      if (label === 'json') return new Worker(`scripts/json.worker.bundle.js${query}`);
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new Worker(`scripts/css.worker.bundle.js${query}`);
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new Worker(`scripts/html.worker.bundle.js${query}`);
      }
      if (label === 'typescript' || label === 'javascript') {
        return new Worker(`scripts/ts.worker.bundle.js${query}`);
      }
      return new Worker(`scripts/editor.worker.bundle.js${query}`);
    }
  };
}

function defineTheme() {
  monaco.editor.defineTheme(THEME_NAME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '7b818a' },
      { token: 'keyword', foreground: '8ea0ff' },
      { token: 'string', foreground: 'b7e38b' },
      { token: 'number', foreground: 'f4c27a' },
      { token: 'type', foreground: '79d7cf' },
      { token: 'function', foreground: 'd7dbff' }
    ],
    colors: {
      'editor.background': '#080909',
      'editor.foreground': '#e6e8eb',
      'editorLineNumber.foreground': '#6d737c',
      'editorLineNumber.activeForeground': '#c7cace',
      'editorGutter.background': '#0f1011',
      'editorCursor.foreground': '#7c87e8',
      'editor.lineHighlightBackground': '#ffffff08',
      'editor.selectionBackground': '#5e6ad244',
      'editor.inactiveSelectionBackground': '#5e6ad224',
      'editorIndentGuide.background1': '#ffffff12',
      'editorIndentGuide.activeBackground1': '#ffffff24',
      'editorWidget.background': '#151619',
      'editorWidget.border': '#ffffff18',
      'input.background': '#0f1011',
      'input.foreground': '#e6e8eb',
      'dropdown.background': '#151619',
      'dropdown.border': '#ffffff18'
    }
  });
}

function toMonacoLanguage(language) {
  return languageMap[language] || 'plaintext';
}

function toMonacoTheme(theme) {
  return lightThemes.has(theme) ? 'vs' : THEME_NAME;
}

function sanitizeFilePath(path) {
  return String(path || 'file.txt').replace(/[?#]/g, '_');
}

function getModelUri(file) {
  const id = encodeURIComponent(String(file?.id || 'scratch'));
  return monaco.Uri.parse(`${MODEL_SCHEME}:/${id}/${sanitizeFilePath(file?.path)}`);
}

function normalizeFontSize(value) {
  const numeric = Number.parseInt(String(value || '14').replace('px', ''), 10);
  return Number.isFinite(numeric) ? numeric : 14;
}

function sanitizeColor(color) {
  const value = String(color || '').trim();
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value)) return value;
  if (/^rgb(a)?\([^)]+\)$/.test(value)) return value;
  return '#7c87e8';
}

function alphaColor(color, alpha) {
  const safe = sanitizeColor(color);
  if (!safe.startsWith('#')) return safe;
  const hex = safe.length === 4
    ? safe.slice(1).split('').map(char => `${char}${char}`).join('')
    : safe.slice(1);
  const value = Number.parseInt(hex, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getAwarenessStyleElement() {
  let style = document.getElementById('collab-awareness-styles');
  if (!style) {
    style = document.createElement('style');
    style.id = 'collab-awareness-styles';
    document.head.appendChild(style);
  }
  return style;
}

class CollabEditorAdapter {
  constructor(options) {
    this.container = options.container;
    this.binding = null;
    this.awareness = null;
    this.awarenessDisposer = null;
    this.activeFile = null;
    this.readOnlyBase = options.readOnly === true;
    this.projectSnapshotProvider = options.getProjectSnapshot || null;
    this.selectionDisposers = [];
    this.layoutListener = () => this.layoutSoon();

    this.editor = monaco.editor.create(this.container, {
      automaticLayout: true,
      fontFamily: '"JetBrains Mono", "SF Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: normalizeFontSize(options.fontSize || 14),
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'all',
      roundedSelection: false,
      padding: { top: 12, bottom: 12 },
      tabSize: 2,
      insertSpaces: true,
      detectIndentation: true,
      wordWrap: 'on',
      theme: toMonacoTheme(options.theme || 'monokai'),
      readOnly: this.readOnlyBase,
      lineNumbersMinChars: 3,
      overviewRulerLanes: 2,
      fixedOverflowWidgets: true,
      scrollbar: {
        useShadows: false,
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10
      }
    });

    if (typeof options.onSelectionChange === 'function') {
      this.selectionDisposers.push(this.editor.onDidChangeCursorPosition(options.onSelectionChange));
      this.selectionDisposers.push(this.editor.onDidChangeCursorSelection(options.onSelectionChange));
    }

    window.addEventListener('collab:layout-resize', this.layoutListener);
  }

  getOrCreateModel(file, content) {
    const uri = getModelUri(file);
    const language = toMonacoLanguage(file?.language);
    let model = monaco.editor.getModel(uri);
    if (!model || model.isDisposed()) {
      model = monaco.editor.createModel(String(content || ''), language, uri);
    } else {
      monaco.editor.setModelLanguage(model, language);
    }
    return model;
  }

  openFile(file, snapshot = {}, collabContext = {}) {
    if (!file) return;

    this.binding?.destroy();
    this.binding = null;
    this.activeFile = file;

    const content = typeof snapshot?.content === 'string'
      ? snapshot.content
      : typeof file?.content === 'string'
        ? file.content
        : '';
    const readOnly = this.readOnlyBase
      || collabContext.readOnly === true
      || file.readonly === true
      || file.role === 'runtime'
      || file.hidden === true;
    const model = this.getOrCreateModel(file, collabContext.ytext ? collabContext.ytext.toString() : content);

    if (collabContext.ytext) {
      this.binding = new MonacoBinding(
        collabContext.ytext,
        model,
        new Set([this.editor]),
        collabContext.awareness || null
      );
      this.bindAwarenessStyles(collabContext.awareness || null);
    } else if (model.getValue() !== content) {
      model.setValue(content);
      this.bindAwarenessStyles(null);
    } else {
      this.bindAwarenessStyles(null);
    }

    this.editor.setModel(model);
    this.setLanguage(file.language);
    this.setReadOnly(readOnly);
    this.layoutSoon();
  }

  bindAwarenessStyles(awareness) {
    if (this.awareness === awareness) {
      this.refreshAwarenessStyles();
      return;
    }

    if (this.awareness && this.awarenessDisposer) {
      this.awareness.off('update', this.awarenessDisposer);
    }

    this.awareness = awareness;
    this.awarenessDisposer = null;

    if (awareness) {
      this.awarenessDisposer = () => this.refreshAwarenessStyles();
      awareness.on('update', this.awarenessDisposer);
    }

    this.refreshAwarenessStyles();
  }

  refreshAwarenessStyles() {
    const style = getAwarenessStyleElement();
    if (!this.awareness) {
      style.textContent = '';
      return;
    }

    const rules = [];
    this.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.awareness.clientID) return;
      const color = sanitizeColor(state?.user?.color);
      rules.push(`
        .yRemoteSelection-${clientId} { background-color: ${alphaColor(color, 0.24)}; }
        #firepad-container .yRemoteSelectionHead-${clientId} {
          border-left: 2px solid ${color};
          border-top: 2px solid ${color};
          border-bottom: 2px solid ${color};
          box-sizing: border-box;
          pointer-events: auto;
        }
        #firepad-container .yRemoteSelectionHead-${clientId}::after {
          content: "${String(state?.user?.name || 'Collaborator').replace(/["\\]/g, '')}";
          position: absolute;
          top: -18px;
          left: -2px;
          padding: 1px 6px;
          border-radius: 4px;
          background: ${color};
          color: #080909;
          font: 600 11px/15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          white-space: nowrap;
          pointer-events: auto;
          transition: opacity .14s ease, transform .14s ease;
        }
        #firepad-container .yRemoteSelectionHead-${clientId}:hover::after {
          opacity: .16;
          transform: translateY(-1px);
        }
      `);
    });
    style.textContent = rules.join('\n');
  }

  getValue() {
    return this.editor.getValue();
  }

  setValue(value) {
    const model = this.editor.getModel();
    if (model && model.getValue() !== String(value || '')) {
      model.setValue(String(value || ''));
    }
  }

  getProjectSnapshot() {
    return this.projectSnapshotProvider?.() || null;
  }

  setLanguage(language) {
    const model = this.editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, toMonacoLanguage(language));
    }
  }

  setTheme(theme) {
    monaco.editor.setTheme(toMonacoTheme(theme));
  }

  setFontSize(size) {
    this.editor.updateOptions({ fontSize: normalizeFontSize(size) });
    this.layoutSoon();
  }

  setReadOnly(readOnly) {
    this.editor.updateOptions({ readOnly: readOnly === true, domReadOnly: readOnly === true });
  }

  getReadOnly() {
    return this.editor.getOption(monaco.editor.EditorOption.readOnly);
  }

  focus() {
    this.editor.focus();
  }

  getCursorPosition() {
    const position = this.editor.getPosition() || { lineNumber: 1, column: 1 };
    return {
      row: Math.max(0, position.lineNumber - 1),
      column: Math.max(0, position.column - 1)
    };
  }

  layoutSoon() {
    window.requestAnimationFrame(() => this.editor.layout());
  }

  destroy() {
    this.binding?.destroy();
    this.bindAwarenessStyles(null);
    this.selectionDisposers.forEach(disposer => disposer.dispose?.());
    window.removeEventListener('collab:layout-resize', this.layoutListener);
    this.editor.dispose();
  }
}

setupWorkers();
defineTheme();

window.CollabEditor = {
  create(options) {
    return new CollabEditorAdapter(options || {});
  },
  monaco
};
