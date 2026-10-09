import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js'

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function normalizeLanguage(lang: string): string {
  return lang.trim().split(/\s+/)[0]?.toLowerCase() || ''
}

function renderCodeBlock(source: string, lang: string): string {
  const language = normalizeLanguage(lang)
  const knownLanguage = language && hljs.getLanguage(language)
  const highlighted = knownLanguage
    ? hljs.highlight(source, { language }).value
    : md.utils.escapeHtml(source)
  const label = language || 'text'
  const languageClass = language ? ` language-${escapeAttr(language)}` : ''
  const encodedSource = escapeAttr(encodeURIComponent(source))

  return [
    `<div class="markdown-code-block" data-language="${escapeAttr(label)}">`,
    '<div class="markdown-code-toolbar">',
    '<span class="markdown-code-window" aria-hidden="true"><i></i><i></i><i></i></span>',
    `<span class="markdown-code-language">${escapeAttr(label)}</span>`,
    `<button class="markdown-code-expand" type="button" data-code="${encodedSource}" data-lang="${escapeAttr(label)}" aria-label="展开源码">⛶</button>`,
    `<button class="markdown-code-copy" type="button" data-code="${encodedSource}" aria-label="复制代码">复制</button>`,
    '</div>',
    `<pre class="hljs"><code class="hljs${languageClass}">${highlighted}</code></pre>`,
    '</div>',
  ].join('')
}

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(str: string, lang: string): string {
    try {
      return renderCodeBlock(str, lang)
    } catch {
      return renderCodeBlock(str, '')
    }
  },
})

const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

function getProjectMarkdownLinkPath(tokens: any[], idx: number, href: string): string | null {
  const token = tokens[idx]
  const explicitPath = href.split(/[?#]/, 1)[0]

  if (
    explicitPath
    && !/^[a-z][a-z0-9+.-]*:/i.test(explicitPath)
    && !explicitPath.startsWith('/')
    && !explicitPath.startsWith('\\')
    && /\.md(?:own)?$/i.test(explicitPath)
  ) {
    return explicitPath
  }

  if (token.markup !== 'linkify') return null

  const label = tokens[idx + 1]?.content?.trim()
  if (!label || !/\.md(?:own)?$/i.test(label)) return null

  try {
    const parsed = new URL(href)
    if (
      parsed.protocol === 'http:'
      && parsed.pathname === '/'
      && !parsed.search
      && !parsed.hash
      && parsed.hostname.toLowerCase() === label.toLowerCase()
    ) {
      return label
    }
  } catch {
    return null
  }

  return null
}

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || ''
  const projectFilePath = getProjectMarkdownLinkPath(tokens, idx, href)

  if (projectFilePath) {
    tokens[idx].attrSet('href', '#')
    tokens[idx].attrSet('data-lc-file-path', projectFilePath)
    tokens[idx].attrSet('title', `在文件区打开 ${projectFilePath}`)
    return defaultLinkOpen(tokens, idx, options, env, self)
  }

  let isExternal = false
  if (/^https?:\/\//i.test(href) || href.startsWith('//')) {
    try {
      const base = globalThis.location?.origin
      isExternal = !base || new URL(href, base).origin !== base
    } catch {
      isExternal = true
    }
  }

  if (isExternal) {
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noopener noreferrer')
  }

  return defaultLinkOpen(tokens, idx, options, env, self)
}

// YAML frontmatter：文件首行的 --- 块。必须首行开始、有闭合的 ---，
// 且能解析出至少一个 key: value，才当作 frontmatter，避免误吞正文里的分隔线
const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

interface FrontmatterField {
  key: string
  value: string
}

function parseFrontmatterFields(block: string): FrontmatterField[] {
  const collected: { key: string; parts: string[] }[] = []

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const keyed = /^\s/.test(rawLine) ? null : /^([A-Za-z0-9_.-]+)\s*:\s*([\s\S]*)$/.exec(rawLine)
    if (keyed) {
      const rest = keyed[2].trim()
      // `>-` / `|` 这类块标量：值写在后续缩进行里
      collected.push({ key: keyed[1], parts: /^[>|][+-]?$/.test(rest) ? [] : [rest] })
      continue
    }

    // 缩进续行：块标量正文、列表项等，去掉列表符号后并进当前键
    const last = collected[collected.length - 1]
    if (last) last.parts.push(line.replace(/^-\s+/, ''))
  }

  return collected
    .map(field => ({ key: field.key, value: field.parts.filter(Boolean).join(' ').trim() }))
    .filter(field => field.key)
}

function renderFrontmatterCard(fields: FrontmatterField[]): string {
  const rows = fields.map(({ key, value }) => [
    '<div class="md-frontmatter-row">',
    `<span class="md-frontmatter-key">${md.utils.escapeHtml(key)}</span>`,
    `<span class="md-frontmatter-value">${md.utils.escapeHtml(value)}</span>`,
    '</div>',
  ].join('')).join('')

  return `<div class="md-frontmatter">${rows}</div>`
}

/**
 * 渲染 Markdown。
 * frontmatterCard 开启时，文件首行的 YAML frontmatter 不再被当成正文
 * （否则整块会被拼成一段、还被尾行 --- 升成二级标题），改为渲染成元信息卡片。
 */
export function renderMarkdown(text: string, options: { frontmatterCard?: boolean } = {}): string {
  if (options.frontmatterCard) {
    const match = FRONTMATTER_RE.exec(text)
    if (match) {
      const fields = parseFrontmatterFields(match[1])
      if (fields.length > 0) {
        return renderFrontmatterCard(fields) + md.render(text.slice(match[0].length))
      }
    }
  }
  return md.render(text)
}
