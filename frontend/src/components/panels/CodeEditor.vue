<template>
  <div ref="hostRef" class="code-editor-host" :class="{ 'is-readonly': !editable }" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { search as searchExt, openSearchPanel } from '@codemirror/search'
import { createSearchPanel } from './codemirror-search-panel'
import { python } from '@codemirror/lang-python'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown as langMarkdown } from '@codemirror/lang-markdown'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { java } from '@codemirror/lang-java'
import { cpp } from '@codemirror/lang-cpp'
import { rust } from '@codemirror/lang-rust'

const props = defineProps<{
  code: string
  language: string
  editable: boolean
  /** 超大文件：关闭语法高亮，保证打开速度 */
  heavy?: boolean
}>()

const emit = defineEmits<{ (e: 'update:code', value: string): void }>()

const hostRef = ref<HTMLDivElement | null>(null)
let view: EditorView | null = null

function languageExtension(): Extension | null {
  if (props.heavy) return null
  switch (props.language) {
    case 'python': return python()
    case 'javascript': return javascript()
    case 'typescript': return javascript({ typescript: true })
    case 'json': return json()
    case 'markdown': return langMarkdown()
    case 'html': case 'xml': case 'vue': return html()
    case 'css': return css()
    case 'java': return java()
    case 'c': case 'cpp': return cpp()
    case 'rust': return rust()
    default: return null
  }
}

// 与原 hljs 代码区同一套深色视觉：底色跟随 --md-code-bg，字号/行高/字体保持一致
const themeExt = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12px',
    backgroundColor: 'var(--md-code-bg, #0d1117)',
  },
  '.cm-scroller': {
    fontFamily: "'Cascadia Code', 'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
    lineHeight: '1.65',
    overflow: 'auto',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'color-mix(in srgb, var(--md-code-text, #d8fff0) 34%, transparent)',
  },
  '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.045)' },
  '.cm-activeLineGutter': { backgroundColor: 'rgba(255, 255, 255, 0.06)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { paddingBottom: '28px', caretColor: '#34d399' },
  '.cm-selectionBackground': { backgroundColor: 'rgba(52, 211, 153, 0.22) !important' },
})

onMounted(() => {
  const langExt = languageExtension()
  const extensions: Extension[] = [
    basicSetup,
    // 自定义中文搜索面板：命中计数、大小写/正则/整词、替换，Ctrl+F 唤起
    searchExt({ top: true, createPanel: createSearchPanel }),
    ...(langExt ? [langExt] : []),
    oneDark,
    themeExt,
    EditorState.readOnly.of(!props.editable),
    EditorView.editable.of(props.editable),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) emit('update:code', u.state.doc.toString())
    }),
  ]
  view = new EditorView({
    state: EditorState.create({ doc: props.code, extensions }),
    parent: hostRef.value!,
  })
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

// 外部内容变化（刷新/冲突后重载）同步进编辑器；自身输入回流时内容相同则跳过，避免死循环
watch(() => props.code, (next) => {
  if (!view) return
  const current = view.state.doc.toString()
  if (next !== current) {
    view.dispatch({ changes: { from: 0, to: current.length, insert: next } })
  }
})

function jumpToLine(line: number) {
  if (!view) return
  const total = view.state.doc.lines
  const target = Math.min(Math.max(1, line), total)
  const info = view.state.doc.line(target)
  view.dispatch({
    selection: { anchor: info.from },
    effects: EditorView.scrollIntoView(info.from, { y: 'center' }),
  })
  view.focus()
}

/** 当前选区信息：文本与首尾行号（1 起）。无选区或全空白返回 null */
function getSelectionInfo(): { text: string; startLine: number; endLine: number } | null {
  if (!view) return null
  const sel = view.state.selection.main
  if (sel.empty) return null
  const text = view.state.sliceDoc(sel.from, sel.to)
  if (!text.trim()) return null
  const startLine = view.state.doc.lineAt(sel.from).number
  let endLine = view.state.doc.lineAt(sel.to).number
  // 选区恰好停在末行行首（选中了整行含换行符）时，不该把下一行算进来
  if (endLine > startLine && view.state.doc.lineAt(sel.to).from === sel.to) endLine--
  return { text, startLine, endLine }
}

/** 打开内置中文搜索面板（Ctrl+F / 工具栏查找按钮） */
function openSearch() {
  if (view) openSearchPanel(view)
}

defineExpose({
  jumpToLine,
  openSearch,
  getSelectionInfo,
  focus: () => view?.focus(),
})
</script>

<style scoped>
.code-editor-host {
  height: 100%;
  min-height: 0;
}

/* 只读文件整体降一点亮度，与可编辑状态形成区分 */
.code-editor-host.is-readonly :deep(.cm-content) {
  color: color-mix(in srgb, var(--md-code-text, #d8fff0) 80%, transparent);
}

/* 深色代码底上全局灰色滚动条几乎不可见，改用明亮天蓝色（滚动容器是 .cm-scroller） */
.code-editor-host :deep(.cm-scroller) {
  scrollbar-color: #38bdf8 rgba(56, 189, 248, 0.1);
}

.code-editor-host :deep(.cm-scroller)::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

.code-editor-host :deep(.cm-scroller)::-webkit-scrollbar-track {
  background: rgba(56, 189, 248, 0.1);
  border-radius: 999px;
}

.code-editor-host :deep(.cm-scroller)::-webkit-scrollbar-thumb {
  background: #38bdf8;
  border-radius: 999px;
  min-height: 40px;
}

.code-editor-host :deep(.cm-scroller)::-webkit-scrollbar-thumb:hover {
  background: #7dd3fc;
}

.code-editor-host :deep(.cm-scroller)::-webkit-scrollbar-thumb:active {
  background: #0ea5e9;
}

.code-editor-host :deep(.cm-scroller)::-webkit-scrollbar-corner {
  background: transparent;
}

/* ---- 自定义搜索面板（Ctrl+F） ---- */
.code-editor-host :deep(.cm-panels.cm-panels-top) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.09);
  background: transparent;
  padding: 0;
}

.code-editor-host :deep(.lc-search-panel) {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 12px;
  background: #161b22;
  font-size: 12px;
  color: #e6edf3;
}

.code-editor-host :deep(.lc-search-row) {
  display: flex;
  align-items: center;
  gap: 6px;
}

.code-editor-host :deep(.lc-search-input) {
  height: 28px;
  min-width: 0;
  flex: 0 1 280px;
  padding: 0 10px;
  border: 1px solid #30363d;
  border-radius: 6px;
  background: #0d1117;
  color: #e6edf3;
  font-size: 12px;
  font-family: inherit;
  outline: none;
}

.code-editor-host :deep(.lc-search-input::placeholder) {
  color: #6e7681;
}

.code-editor-host :deep(.lc-search-input:focus) {
  border-color: #38bdf8;
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.15);
}

.code-editor-host :deep(.lc-search-input.is-invalid) {
  border-color: #f87171;
  box-shadow: 0 0 0 2px rgba(248, 113, 113, 0.15);
}

.code-editor-host :deep(.lc-search-count) {
  min-width: 46px;
  text-align: center;
  color: #8b949e;
  font-variant-numeric: tabular-nums;
  user-select: none;
}

.code-editor-host :deep(.lc-search-count.is-empty) {
  color: #f87171;
}

.code-editor-host :deep(.lc-search-btn) {
  height: 28px;
  min-width: 28px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #9da7b3;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.code-editor-host :deep(.lc-search-btn:hover) {
  background: rgba(255, 255, 255, 0.08);
  color: #e6edf3;
}

.code-editor-host :deep(.lc-search-btn.is-icon) {
  font-size: 13px;
}

.code-editor-host :deep(.lc-search-btn.is-toggle) {
  border-color: #30363d;
  font-weight: 600;
}

.code-editor-host :deep(.lc-search-btn.is-monospace) {
  font-family: 'Cascadia Code', Consolas, monospace;
}

.code-editor-host :deep(.lc-search-btn.is-toggle.is-active) {
  border-color: rgba(56, 189, 248, 0.55);
  background: rgba(56, 189, 248, 0.14);
  color: #7dd3fc;
}

.code-editor-host :deep(.lc-search-btn.is-text) {
  border-color: #30363d;
}

.code-editor-host :deep(.lc-search-close) {
  margin-left: auto;
  font-size: 12px;
  color: #6e7681;
}

/* 搜索命中配色：oneDark 默认偏紫，换成与滚动条/焦点一致的天蓝，当前命中更深 */
.code-editor-host :deep(.cm-searchMatch) {
  background-color: rgba(56, 189, 248, 0.28);
  outline: 1px solid rgba(56, 189, 248, 0.35);
}

.code-editor-host :deep(.cm-searchMatch-selected) {
  background-color: rgba(56, 189, 248, 0.55);
  outline: 1px solid #38bdf8;
}
</style>
