import * as React from 'react';
import { cn } from './cn';
import { markdownToSafeHtml } from './markdown';

/**
 * Renders an assistant answer's markdown (Product-review decision 1).
 *
 * The owner reads the same answers their customers got — in Conversations and
 * in the "Test it here" preview — so those surfaces must not show the literal
 * `**` and `-` markers the widget bubble already renders properly.
 *
 * `dangerouslySetInnerHTML` is safe here *by construction*, not by convention:
 * markdownToSafeHtml escapes every `<`, `>`, `&`, `"` and `'` BEFORE any pattern
 * runs and then only emits tags it generates itself from a fixed whitelist, with
 * link schemes restricted to http/https/mailto. Model output can never survive
 * as markup. Only ever feed this component through that function — visitor and
 * human-operator text stays a plain text node.
 */
export interface AssistantTextProps {
  text: string;
  className?: string;
}

export function AssistantText({ text, className }: AssistantTextProps) {
  const html = React.useMemo(() => markdownToSafeHtml(text), [text]);
  // A div, not a span: the renderer emits <p>/<ul>/<ol>, and a <p> nested in a
  // <span> is invalid HTML the browser re-parses out of place.
  return (
    <div
      className={cn('vm-assistant-text', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
