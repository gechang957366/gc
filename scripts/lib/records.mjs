// 题录解析：把各种数据库导出的文件统一解析成 { tags: {TI, AU, ...} } 记录。
//
// 支持格式（自动识别，不看扩展名）：
//   RIS / NoteExpress / EndNote(RIS)   → `TY  - JOUR` …  `ER  - `
//   EndNote 自定义（%0 Journal Article） → `%0` `%A` `%T` `%J` `%D` `%X` `%R`
//   RefWorks                            → `RT Journal Article` / `A1` `T1` `JF` `YR` `AB`
//   Web of Science 纯文本               → `FN Clarivate …` `PT J` `AU` `TI` `SO` `AB` `DI`
//   Web of Science 制表符分隔           → 首行是 `PT\tAU\tTI…` 的表头
import { readFileSync } from 'node:fs'

const tag = (value) => (typeof value === 'string' ? value.trim() : '')

function push(tags, key, value) {
  if (!value) return
  const list = tags[key] || (tags[key] = [])
  list.push(value)
}

// ------------------------------------------------------------------ RIS ---
function parseRis(text) {
  const records = []
  let tags
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const match = /^([A-Z][A-Z0-9]) {2}- ?(.*)$/.exec(line)
    if (!match) continue
    const [, key, value] = match
    if (key === 'TY') {
      tags = {}
      continue
    }
    if (!tags) continue
    if (key === 'ER') {
      records.push(tags)
      tags = undefined
      continue
    }
    push(tags, key, tag(value))
  }
  return records
}

// ------------------------------------------------- EndNote (%0 风格) ------
function parseEndnote(text) {
  const records = []
  let tags
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const match = /^%([0-9A-Za-z@!#$&()*+,\-./:;<=>?[\]^_{|}~]) ?(.*)$/.exec(line)
    if (!match) continue
    const [, key, value] = match
    if (key === '0') {
      if (tags) records.push(tags)
      tags = { TY: [value || 'Journal Article'] }
      continue
    }
    if (!tags) tags = {}
    push(tags, key, tag(value))
  }
  if (tags) records.push(tags)
  return records
}

// ---------------------------------------------------------- RefWorks ------
function parseRefworks(text) {
  const records = []
  let tags
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    const match = /^([A-Z][A-Z0-9]) (.*)$/.exec(line)
    if (!match) continue
    const [, key, value] = match
    if (key === 'RT') {
      if (tags) records.push(tags)
      tags = {}
    }
    if (!tags) tags = {}
    push(tags, key, tag(value))
  }
  if (tags) records.push(tags)
  return records
}

// -------------------------------------------------- Web of Science 纯文本 --
// WoS 纯文本格式：两个大写字母标签 + 一个空格 + 值；续行以 3 个空格开头。
const WOS_PLAIN = /^([A-Z][A-Z0-9]) (.*)$/
function parseWosPlain(text) {
  const records = []
  let tags
  let lastKey
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (/^EF\s*$/.test(line)) {
      if (tags) records.push(tags)
      tags = undefined
      lastKey = undefined
      continue
    }
    if (/^ER\s*$/.test(line)) continue
    if (/^FN\s/.test(line) || /^VR\s/.test(line)) continue
    if (/^PT\s/.test(line)) {
      if (tags) records.push(tags)
      tags = {}
      lastKey = 'PT'
      push(tags, 'PT', tag(line.slice(3)))
      continue
    }
    if (!tags) continue
    const match = WOS_PLAIN.exec(line)
    if (match) {
      const [, key, value] = match
      // 只认为已知的两字母标签是标签，避免把正文行误当标签
      if (/^(PT|AU|AF|TI|SO|LA|DT|DE|ID|AB|C1|RP|EM|CR|NR|TC|Z9|U1|U2|PU|PI|PA|SN|EI|J9|JI|PD|PY|VL|IS|BP|EP|AR|DI|EA|PG|WC|SC|GA|UT|ER|PM|OA|HC|HP|DA|CT|CY|CL|SP|HO|SE|BS|MA|RI|OI|FU|FX|SU|SI|BN|IN|IB|CC|RP|WE|AC|ED|BZ|ES|CD|TA|US|OT|EV|EX|ST|TS|CA|AD|CS|FI|FT|RD|AX|SR)$/.test(key)) {
        lastKey = key
        push(tags, key, tag(value))
        continue
      }
    }
    // 续行：以三个空格开头，属于上一个标签（作者、机构等）
    if (lastKey && /^ {2,}\S/.test(line)) push(tags, lastKey, tag(line))
  }
  if (tags) records.push(tags)
  return records
}

// ---------------------------------------- Web of Science 制表符分隔 ------
function splitTsvLine(line) {
  // WoS 的 TSV 用引号包住含制表符/换行的字段
  const fields = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"'
        i += 1
      } else quoted = !quoted
      continue
    }
    if (char === '\t' && !quoted) {
      fields.push(current)
      current = ''
      continue
    }
    current += char
  }
  fields.push(current)
  return fields
}

function parseWosTsv(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '')
  if (lines.length < 2) return []
  const header = splitTsvLine(lines[0])
  if (!header.includes('PT') || !header.includes('TI')) return []
  const records = []
  for (const line of lines.slice(1)) {
    const cells = splitTsvLine(line)
    if (cells.every((cell) => cell.trim() === '') || cells[0] === 'ER') continue
    const tags = {}
    header.forEach((key, index) => {
      const value = tag(cells[index] || '')
      if (value) push(tags, key, value)
    })
    records.push(tags)
  }
  return records
}

// -------------------------------------------------------------- 统一入口 --
/** 识别格式并解析；返回 { format, records }，records 里的 tags 用统一键名。 */
export function parseRecords(input) {
  const text = String(input || '').replace(/^\uFEFF/, '')
  const head = text.slice(0, 4000)

  if (/^FN\s/m.test(head) || (/^PT /m.test(head) && /^ER\s*$/m.test(head) && !/^TY {2}- /m.test(head))) {
    return { format: 'wos-plain', records: parseWosPlain(text) }
  }
  if (head.split(/\r?\n/)[0].includes('\t') && /^PT\t/m.test(head)) {
    return { format: 'wos-tsv', records: parseWosTsv(text) }
  }
  if (/^TY {2}- /m.test(head)) {
    return { format: 'ris', records: parseRis(text) }
  }
  if (/^%0 /m.test(head)) {
    return { format: 'endnote', records: parseEndnote(text) }
  }
  if (/^RT /m.test(head)) {
    return { format: 'refworks', records: parseRefworks(text) }
  }
  return { format: 'unknown', records: [] }
}

export function readRecords(path) {
  return parseRecords(readFileSync(path, 'utf8'))
}

/** 把不同格式的标签名归一到同一套键。 */
export function normalizeRecord(tags) {
  const first = (key) => (Array.isArray(tags[key]) ? tag(tags[key][0]) : '')
  const all = (key) => (Array.isArray(tags[key]) ? tags[key].map(tag).filter(Boolean) : [])

  const type = (first('TY') || first('PT') || first('RT') || '').toUpperCase()
  const kind =
    /CPAPER|CONF|C\b|PROCEEDING/.test(type) ? 'conference' : /JOUR|J\b|ARTICLE/.test(type) ? 'journal' : 'journal'

  const authors = [...all('AU'), ...all('A1'), ...all('AF'), ...all('A')]
  const seen = new Set()
  const uniqueAuthors = authors.filter((name) => {
    const key = name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return {
    title: first('TI') || first('T1') || first('T') || first('CT') || '',
    authors: uniqueAuthors,
    venue:
      first('T2') || first('JO') || first('JA') || first('JF') || first('SO') || first('J2') || first('J') || '',
    date: first('PY') || first('Y1') || first('DA') || first('YR') || first('D') || '',
    doi: (first('DO') || first('DI') || first('R') || first('DOI') || first('UT') || '').replace(
      /^https?:\/\/(dx\.)?doi\.org\//i,
      '',
    ),
    abstract: first('AB') || first('N2') || first('X') || '',
    volume: first('VL') || first('V'),
    issue: first('IS') || first('N'),
    pages:
      (first('SP') || first('BP')) && (first('EP'))
        ? `${first('SP') || first('BP')}-${first('EP')}`
        : first('SP') || first('BP') || first('P') || '',
    url: first('UR') || first('U') || first('L2') || '',
    keywords: [...all('KW'), ...all('DE'), ...all('K1'), ...all('K')]
      .flatMap((value) => value.split(/[;,]/))
      .map((v) => v.trim())
      .filter(Boolean),
    kind,
    raw: tags,
  }
}
