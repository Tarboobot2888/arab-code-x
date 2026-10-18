// CodeMirror 6 editor for /submit — viewport rendering keeps huge pastes instant.
import { basicSetup, EditorView } from 'https://esm.sh/codemirror@6.0.1';
import { EditorState, Compartment } from 'https://esm.sh/@codemirror/state@6';
import { html as htmlLang } from 'https://esm.sh/@codemirror/lang-html@6';
import { css as cssLang } from 'https://esm.sh/@codemirror/lang-css@6';
import { javascript as jsLang } from 'https://esm.sh/@codemirror/lang-javascript@6';
import { oneDark } from 'https://esm.sh/@codemirror/theme-one-dark@6';
import { keymap } from 'https://esm.sh/@codemirror/view@6';
import { indentWithTab } from 'https://esm.sh/@codemirror/commands@6';

const LANGS = { html: htmlLang, css: cssLang, js: jsLang };
const state = { html: '', css: '', js: '' };     // text per tab
const saved = {};                                // EditorState per tab (keeps undo)
let tab = 'html', mode = 'unified';
const lang = new Compartment();
const host = document.getElementById('editorHost');
const counter = document.getElementById('lineCount');

function langFor(t) {
  if (mode === 'unified') {
    const v = document.querySelector('[name=language]').value;
    return LANGS[v === 'ts' ? 'js' : v] ? LANGS[v === 'ts' ? 'js' : v]() : [];
  }
  return LANGS[t]();
}
const font = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px' },
  '.cm-scroller': { fontFamily: '"JetBrains Mono", monospace', lineHeight: '1.6' },
});
function makeState(doc, t) {
  return EditorState.create({
    doc,
    extensions: [
      basicSetup, keymap.of([indentWithTab]), oneDark, font,
      lang.of(langFor(t)),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) { state[tab] = null; updateCount(); }
      }),
    ],
  });
}
const view = new EditorView({ state: makeState('', 'html'), parent: host });
function updateCount() { counter.textContent = view.state.doc.lines.toLocaleString('ar') + ' سطر'; }
function text(t) { return t === tab ? view.state.doc.toString() : (saved[t] ? saved[t].doc.toString() : state[t]); }

function switchTab(t) {
  if (t === tab) return;
  saved[tab] = view.state;
  tab = t;
  view.setState(saved[t] || makeState(state[t] || '', t));
  view.dispatch({ effects: lang.reconfigure(langFor(t)) });
  document.querySelectorAll('.ed-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  updateCount(); view.focus();
}
function setMode(m) {
  mode = m;
  document.querySelectorAll('.ed-mode').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  document.querySelectorAll('.ed-tab').forEach(b => { b.style.display = (m === 'unified' && b.dataset.tab !== 'html') ? 'none' : ''; });
  if (m === 'unified') switchTab('html');
  view.dispatch({ effects: lang.reconfigure(langFor(tab)) });
}
document.querySelectorAll('.ed-tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
document.querySelectorAll('.ed-mode').forEach(b => b.onclick = () => setMode(b.dataset.mode));
document.querySelector('[name=language]').addEventListener('change', () => {
  if (mode === 'unified') view.dispatch({ effects: lang.reconfigure(langFor(tab)) });
});

// Final code that gets submitted
function finalCode() {
  if (mode === 'unified') return view.state.doc.toString();
  const h = text('html'), c = text('css'), j = text('js');
  return `${h}${c.trim() ? `\n<style>\n${c}\n</style>` : ''}${j.trim() ? `\n<script>\n${j}\n<\/script>` : ''}`;
}
window.getEditorCode = finalCode;
window.isSplitMode = () => mode === 'split';
window.setEditorCode = (code) => {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
};

document.getElementById('previewBtn').onclick = () => {
  const code = finalCode();
  const v = document.querySelector('[name=language]').value;
  const doc = (mode === 'split' || v === 'html') ? code
    : v === 'css' ? `<style>${code}</style><p>معاينة CSS</p>`
    : v === 'js' ? `<script>${code}<\/script>` : `<pre>${code.replace(/[&<]/g, s => s === '&' ? '&amp;' : '&lt;')}</pre>`;
  document.getElementById('previewFrame').srcdoc = doc;
  document.getElementById('previewBox').style.display = 'block';
};
document.getElementById('previewClose').onclick = () => { document.getElementById('previewBox').style.display = 'none'; };
updateCount();
window.dispatchEvent(new Event('editor-ready'));
