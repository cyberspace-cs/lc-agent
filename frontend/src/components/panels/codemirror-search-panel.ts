import { EditorView, type Panel } from '@codemirror/view'
import {
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  closeSearchPanel,
} from '@codemirror/search'

interface MatchOptions {
  caseSensitive: boolean
  regexp: boolean
  wholeWord: boolean
}

function makeButton(text: string, title: string, className: string): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = `lc-search-btn ${className}`
  btn.textContent = text
  btn.title = title
  btn.tabIndex = -1
  return btn
}

/**
 * 中文搜索/替换面板，替代 @codemirror/search 默认的无样式英文面板。
 * 查询状态仍走官方的 setSearchQuery / SearchQuery，查找替换全部复用官方命令，
 * 面板只负责 UI 与命中计数。
 */
export function createSearchPanel(view: EditorView): Panel {
  const writable = view.state.facet(EditorView.editable)

  const dom = document.createElement('div')
  dom.className = 'lc-search-panel'

  const findRow = document.createElement('div')
  findRow.className = 'lc-search-row'

  const queryInput = document.createElement('input')
  queryInput.className = 'lc-search-input'
  queryInput.type = 'text'
  queryInput.placeholder = '查找'
  queryInput.spellcheck = false
  queryInput.autocomplete = 'off'
  // 官方约定：打开面板时需要聚焦的字段必须标 main-field
  queryInput.setAttribute('main-field', 'true')

  const countLabel = document.createElement('span')
  countLabel.className = 'lc-search-count'

  const prevBtn = makeButton('↑', '上一个匹配 (Shift+Enter)', 'is-icon')
  const nextBtn = makeButton('↓', '下一个匹配 (Enter)', 'is-icon')
  const caseBtn = makeButton('Aa', '区分大小写', 'is-toggle')
  const reBtn = makeButton('.*', '正则表达式', 'is-toggle is-monospace')
  const wordBtn = makeButton('ab', '整词匹配', 'is-toggle')
  const closeBtn = makeButton('✕', '关闭 (Esc)', 'is-icon is-close')

  findRow.append(queryInput, countLabel, prevBtn, nextBtn, caseBtn, reBtn, wordBtn, closeBtn)
  dom.append(findRow)

  let replaceInput: HTMLInputElement | null = null
  let replaceBtn: HTMLButtonElement | null = null
  let replaceAllBtn: HTMLButtonElement | null = null
  if (writable) {
    const replaceRow = document.createElement('div')
    replaceRow.className = 'lc-search-row'
    replaceInput = document.createElement('input')
    replaceInput.className = 'lc-search-input'
    replaceInput.type = 'text'
    replaceInput.placeholder = '替换'
    replaceInput.spellcheck = false
    replaceInput.autocomplete = 'off'
    replaceBtn = makeButton('替换', '替换当前匹配', 'is-text')
    replaceAllBtn = makeButton('全部替换', '替换全部匹配', 'is-text')
    replaceRow.append(replaceInput, replaceBtn, replaceAllBtn)
    dom.append(replaceRow)
  }

  const options: MatchOptions = { caseSensitive: false, regexp: false, wholeWord: false }

  function buildQuery(): SearchQuery {
    return new SearchQuery({
      search: queryInput.value,
      replace: replaceInput?.value ?? '',
      caseSensitive: options.caseSensitive,
      regexp: options.regexp,
      wholeWord: options.wholeWord,
    })
  }

  function commit() {
    view.dispatch({ effects: setSearchQuery.of(buildQuery()) })
  }

  function paintToggles() {
    caseBtn.classList.toggle('is-active', options.caseSensitive)
    reBtn.classList.toggle('is-active', options.regexp)
    wordBtn.classList.toggle('is-active', options.wholeWord)
  }

  // 大结果集计数可能耗时，用 rAF 合并同一帧内的多次状态变化
  let rafId = 0
  function scheduleRecount() {
    cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(recount)
  }

  function recount() {
    const q = getSearchQuery(view.state)
    const invalid = q.regexp && q.search.length > 0 && !q.valid
    queryInput.classList.toggle('is-invalid', invalid)
    countLabel.classList.toggle('is-empty', false)
    if (!q.search) {
      countLabel.textContent = ''
      return
    }
    if (invalid) {
      countLabel.textContent = '正则无效'
      countLabel.classList.add('is-empty')
      return
    }
    let total = 0
    let current = -1
    const head = view.state.selection.main.head
    const cursor = q.getCursor(view.state)
    for (let step = cursor.next(); !step.done; step = cursor.next()) {
      if (current === -1 && step.value.from <= head && head <= step.value.to) current = total
      total++
      // 保险：近乎无限匹配时不再数下去，面板只给量级提示
      if (total >= 100000) {
        countLabel.textContent = '100000+'
        return
      }
    }
    countLabel.textContent = total ? `${current + 1}/${total}` : '0/0'
    countLabel.classList.toggle('is-empty', total === 0)
  }

  // 外部状态（打开面板时用选区预填、其他扩展派发的 query）同步回控件
  function syncFromState() {
    const q = getSearchQuery(view.state)
    if (document.activeElement !== queryInput && queryInput.value !== q.search) {
      queryInput.value = q.search
    }
    if (replaceInput && document.activeElement !== replaceInput && replaceInput.value !== q.replace) {
      replaceInput.value = q.replace
    }
    options.caseSensitive = q.caseSensitive
    options.regexp = q.regexp
    options.wholeWord = q.wholeWord
    paintToggles()
    scheduleRecount()
  }

  queryInput.addEventListener('input', commit)
  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) findPrevious(view)
      else findNext(view)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      view.focus()
      closeSearchPanel(view)
    }
  })

  prevBtn.addEventListener('click', () => findPrevious(view))
  nextBtn.addEventListener('click', () => findNext(view))
  closeBtn.addEventListener('click', () => {
    view.focus()
    closeSearchPanel(view)
  })

  for (const [btn, key] of [
    [caseBtn, 'caseSensitive'],
    [reBtn, 'regexp'],
    [wordBtn, 'wholeWord'],
  ] as const) {
    btn.addEventListener('click', () => {
      options[key] = !options[key]
      paintToggles()
      commit()
      queryInput.focus()
    })
  }

  replaceInput?.addEventListener('input', commit)
  replaceInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      replaceNext(view)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      view.focus()
      closeSearchPanel(view)
    }
  })
  replaceBtn?.addEventListener('click', () => replaceNext(view))
  replaceAllBtn?.addEventListener('click', () => replaceAll(view))

  return {
    dom,
    mount() {
      syncFromState()
      queryInput.focus()
      queryInput.select()
    },
    update(u) {
      // 选区移动（上/下一个匹配）、文档变更（替换）、query effect 都要刷新计数
      if (
        u.selectionSet
        || u.docChanged
        || u.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)))
      ) {
        syncFromState()
      }
    },
    destroy() {
      cancelAnimationFrame(rafId)
    },
  }
}
