/**
 * Minimal, dependency-free markdown renderer for assistant replies in the
 * widget bubble (Product-review decision 1 — answers rendered raw showed
 * literal `**` and `-` markers).
 *
 * Security posture: this runs INSIDE A THIRD-PARTY HOST PAGE, so model output is
 * treated as untrusted. The renderer escapes the input FIRST and then only ever
 * inserts tags it generates itself, from a fixed whitelist:
 *   p, br, strong, em, code, ul, ol, li, a
 * Because every `<`, `>`, `&`, `"` and `'` is escaped before any pattern runs,
 * no markup in the model's text can survive as markup, and link hrefs cannot
 * break out of their attribute. Link schemes are additionally restricted to
 * http/https/mailto, so `javascript:` and `data:` URLs are dropped to plain text.
 *
 * No markdown library is pulled in: the widget bundle ships from
 * embed.vantagemind.ai and stays tiny (Space Instructions §6.3).
 *
 * Deliberately NOT supported: raw HTML (escaped), images, tables, code fences,
 * and `_single underscore_` emphasis (it would mangle snake_case identifiers).
 */

const ALLOWED_HREF = /^(?:https?:\/\/|mailto:)/i;

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Inline spans. Input MUST already be HTML-escaped. */
function inlineHtml(escaped: string): string {
  return (
    escaped
      // Code first, so emphasis markers inside code are left alone.
      .replace(/`([^`\n]+)`/g, (_m: string, code: string) => `<code>${code}</code>`)
      .replace(
        /\[([^\]\n]*)\]\(([^)\s]+)\)/g,
        (_m: string, label: string, href: string) =>
          ALLOWED_HREF.test(href)
            ? `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${label}</a>`
            : label,
      )
      .replace(/\*\*([^\n]+?)\*\*/g, (_m: string, text: string) => `<strong>${text}</strong>`)
      .replace(/__([^\n]+?)__/g, (_m: string, text: string) => `<strong>${text}</strong>`)
      .replace(/\*([^*\n]+?)\*/g, (_m: string, text: string) => `<em>${text}</em>`)
  );
}

/**
 * Render markdown to a sanitized HTML string safe to assign as innerHTML.
 */
export function markdownToSafeHtml(markdown: string): string {
  const lines = escapeHtml(markdown.replace(/\r\n?/g, '\n')).split('\n');

  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    out.push(`<p>${paragraph.map(inlineHtml).join('<br />')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list === null) return;
    const items = list.items.map((item) => `<li>${inlineHtml(item)}</li>`).join('');
    out.push(`<${list.type}>${items}</${list.type}>`);
    list = null;
  };
  const addItem = (type: 'ul' | 'ol', item: string) => {
    flushParagraph();
    const open = list !== null && list.type === type ? list : null;
    if (open !== null) {
      open.items.push(item);
      return;
    }
    flushList();
    list = { type, items: [item] };
  };

  for (const line of lines) {
    const text = line.trim();

    // Blank line, or a horizontal rule (which has no place in a chat bubble).
    if (text === '' || /^(?:-{3,}|\*{3,}|_{3,})$/.test(text)) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(text);
    if (heading) {
      flushParagraph();
      flushList();
      // Rendered as emphasized text, not <h*>: a heading level inside a host
      // page we don't control would break that page's heading order (Arch §5.16).
      out.push(`<p><strong>${inlineHtml(heading[1] ?? '')}</strong></p>`);
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(text);
    if (bullet) {
      addItem('ul', bullet[1] ?? '');
      continue;
    }

    const ordered = /^\d{1,3}[.)]\s+(.*)$/.exec(text);
    if (ordered) {
      addItem('ol', ordered[1] ?? '');
      continue;
    }

    flushList();
    paragraph.push(text);
  }

  flushParagraph();
  flushList();
  return out.join('');
}

/**
 * Strip markdown to readable prose for the aria-live announcement — screen
 * readers get the words, never the markers (Arch §5.16).
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, '$1')
    .replace(/\*\*([^\n]+?)\*\*/g, '$1')
    .replace(/__([^\n]+?)__/g, '$1')
    .replace(/\*([^*\n]+?)\*/g, '$1')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+/gm, '')
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
