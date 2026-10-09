import { computed, nextTick, ref, watch } from 'vue'

interface UseDomSearchOptions {
  /** 打开期间用 MutationObserver 监听容器内容变化（流式输出、懒加载历史、异步渲染）自动重新标记 */
  observe?: boolean
  /** 命中计数为 0 时的文案 */
  emptyLabel?: string
}

/**
 * 通用 DOM 文本查找：在给定容器里给命中文本包 <mark>，支持计数与上下跳转。
 * 适用于 Markdown 预览、只读代码、docx、聊天消息等非 CodeMirror 视图。
 * rootGetter 允许搜索容器在多个 ref 之间切换（如文档容器 / 代码容器）。
 */
export function useDomSearch(rootGetter: () => HTMLElement | null, options: UseDomSearchOptions = {}) {
  const { observe = false, emptyLabel = '0/0' } = options

  const open = ref(false)
  const query = ref('')
  const inputRef = ref<HTMLInputElement | null>(null)
  const activeIndex = ref(0)
  const matchCount = ref(0)

  let observer: MutationObserver | null = null
  let observerTimer: ReturnType<typeof setTimeout> | undefined
  // applyMarks 自身会改写 DOM，期间必须忽略 observer，否则互相触发死循环
  let applying = false

  function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /** 拆掉上一轮的命中标记，用文本节点还原，避免连续输入时 mark 嵌套 */
  function clearHits(el: HTMLElement) {
    applying = true
    try {
      el.querySelectorAll('mark.code-search-hit').forEach((m) => {
        m.replaceWith(document.createTextNode(m.textContent))
      })
    } finally {
      applying = false
    }
  }

  function applyMarks(resetActive = true) {
    const el = rootGetter()
    matchCount.value = 0
    if (!el) return
    clearHits(el)
    const keyword = query.value.trim()
    if (!keyword) return
    const regex = new RegExp(escapeRegExp(keyword), 'gi')
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const textNodes: Text[] = []
    let n: Node | null
    while ((n = walker.nextNode())) textNodes.push(n as Text)
    applying = true
    try {
      for (const tn of textNodes) {
        const text = tn.textContent || ''
        regex.lastIndex = 0
        const hits: { s: number; e: number }[] = []
        let m: RegExpExecArray | null
        while ((m = regex.exec(text)) && m[0]) hits.push({ s: m.index, e: m.index + m[0].length })
        if (!hits.length) continue
        const frag = document.createDocumentFragment()
        let last = 0
        for (const h of hits) {
          if (h.s > last) frag.appendChild(document.createTextNode(text.slice(last, h.s)))
          const mark = document.createElement('mark')
          mark.className = 'code-search-hit'
          mark.textContent = text.slice(h.s, h.e)
          frag.appendChild(mark)
          last = h.e
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
        tn.parentNode!.replaceChild(frag, tn)
      }
    } finally {
      applying = false
      // MutationObserver 异步派发：applyMarks 自身改写 DOM 的记录要立刻清掉，
      // 否则 200ms 后会被当成"外部变更"再触发一轮 applyMarks
      observer?.takeRecords()
    }
    matchCount.value = el.querySelectorAll('mark.code-search-hit').length
    // 外部内容变化（流式输出、懒加载历史）重标时保持当前命中位置，新查询才归零
    activeIndex.value = resetActive ? 0 : Math.min(activeIndex.value, Math.max(matchCount.value - 1, 0))
    syncActiveMatch()
  }

  function syncActiveMatch() {
    const el = rootGetter()
    if (!el) return
    const marks = el.querySelectorAll('mark.code-search-hit')
    marks.forEach((m, i) => m.classList.toggle('is-active', i === activeIndex.value))
    ;(marks[activeIndex.value] as HTMLElement | undefined)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  function goNext() {
    if (!matchCount.value) return
    activeIndex.value = (activeIndex.value + 1) % matchCount.value
    syncActiveMatch()
  }

  function goPrev() {
    if (!matchCount.value) return
    activeIndex.value = (activeIndex.value - 1 + matchCount.value) % matchCount.value
    syncActiveMatch()
  }

  function scheduleObserve() {
    clearTimeout(observerTimer)
    observerTimer = setTimeout(() => {
      if (open.value) applyMarks(false)
    }, 200)
  }

  function startObserver() {
    if (!observe || typeof MutationObserver === 'undefined') return
    const el = rootGetter()
    if (!el) return
    observer = new MutationObserver(() => {
      if (applying) return
      scheduleObserve()
    })
    observer.observe(el, { childList: true, subtree: true, characterData: true })
  }

  function stopObserver() {
    observer?.disconnect()
    observer = null
    clearTimeout(observerTimer)
  }

  function openSearch(prefill?: string) {
    open.value = true
    if (prefill) query.value = prefill
    void nextTick(() => {
      applyMarks()
      inputRef.value?.focus()
      inputRef.value?.select()
      startObserver()
    })
  }

  function closeSearch() {
    open.value = false
    stopObserver()
    const el = rootGetter()
    if (el) clearHits(el)
    matchCount.value = 0
  }

  /** 容器可能切换（如换文件）：清掉旧容器高亮并在新容器上重新挂载监听 */
  function reset() {
    closeSearch()
    query.value = ''
  }

  const label = computed(() => {
    if (!query.value.trim()) return ''
    if (!matchCount.value) return emptyLabel
    return `${activeIndex.value + 1}/${matchCount.value}`
  })

  watch(query, () => {
    if (open.value) void nextTick(applyMarks)
  })

  return {
    open,
    query,
    inputRef,
    activeIndex,
    matchCount,
    label,
    applyMarks,
    openSearch,
    closeSearch,
    reset,
    goNext,
    goPrev,
  }
}
