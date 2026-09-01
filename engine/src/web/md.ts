export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Replace inline link placeholders (LINK_SENTINEL_RE) with real anchors. */
export function inlineLinksToHtml(
  html: string,
  linkById: (id: string) => { label: string } | undefined,
): string {
  return html.replace(/[\uE000](L\d+)[\uE001]/g, (m, id: string) => {
    const link = linkById(id);
    const label = link ? link.label : id;
    return `<a href="#" class="link" data-link="${id}">${escapeHtml(label)}</a>`;
  });
}

export function mdToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };
  for (const raw of lines) {
    let l = escapeHtml(raw);
    // Inline code must be shielded before bold/italic run, otherwise emphasis
    // markers inside a code span (e.g. `**x**`) get turned into formatting.
    const codeSpans: string[] = [];
    l = l.replace(/`([^`]+)`/g, (m, body: string) => {
      const placeholder = `\uE100${codeSpans.length}\uE101`;
      codeSpans.push(`<code>${body}</code>`);
      return placeholder;
    });
    l = l.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    l = l.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    l = l.replace(/\uE100(\d+)\uE101/g, (_, idx: string) => codeSpans[Number(idx)]);

    const h = l.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      out.push(`<h${level}>${h[2]}</h${level}>`);
      continue;
    }
    // escapeHtml ran above, so a leading `>` became `&gt;`.
    if (/^&gt;\s?/.test(l)) {
      closeList();
      out.push(`<blockquote>${l.replace(/^&gt;\s?/, '')}</blockquote>`);
      continue;
    }
    const li = l.match(/^\s*[-*]\s+(.+)$/);
    if (li) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${li[1]}</li>`);
      continue;
    }
    if (/^\s*---+\s*$/.test(l)) {
      closeList();
      out.push('<hr>');
      continue;
    }
    closeList();
    if (l.trim()) out.push(`<p>${l}</p>`);
  }
  closeList();
  return out.join('\n');
}
