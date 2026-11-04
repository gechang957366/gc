// GB/T 7714 风格的一行引用。周更脚本与现场检索共用。
/**
 * @param {{authorsText?: string, authors?: string[], title?: string, venue?: string, year?: number,
 *          kind?: string, volume?: string, issue?: string, pages?: string, arxivId?: string}} item
 * @returns {string}
 */
export function buildCitation(item) {
  const authors = (item.authorsText || (item.authors || []).slice(0, 3).join(', ')).replace(/\.$/, '')
  const prefix = authors ? `${authors}. ` : ''
  const year = item.year || ''
  const title = item.title || ''
  if (item.kind === 'conference') {
    return `${prefix}${title}[C]//${item.venue || ''}. ${year}.`
  }
  if (item.kind === 'preprint') {
    return `${prefix}${title}[EB/OL]. arXiv:${item.arxivId || ''}, ${year}.`
  }
  const volume = item.volume ? `, ${year}, ${item.volume}` : `, ${year}`
  const issue = item.issue ? `(${item.issue})` : ''
  const pages = item.pages ? `: ${item.pages}` : ''
  return `${prefix}${title}[J]. ${item.venue || ''}${volume}${issue}${pages}.`
}
