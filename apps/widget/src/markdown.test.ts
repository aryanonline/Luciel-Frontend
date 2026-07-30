import { describe, it, expect } from 'vitest';
import { markdownToPlainText, markdownToSafeHtml } from './markdown';

describe('markdownToSafeHtml', () => {
  it('formats bold, italic, code and paragraphs instead of leaving raw markers', () => {
    expect(markdownToSafeHtml('We are **open** until *5pm*.')).toBe(
      '<p>We are <strong>open</strong> until <em>5pm</em>.</p>',
    );
    expect(markdownToSafeHtml('First line.\n\nSecond line.')).toBe(
      '<p>First line.</p><p>Second line.</p>',
    );
    expect(markdownToSafeHtml('Line one\nline two')).toBe('<p>Line one<br />line two</p>');
    expect(markdownToSafeHtml('Use `npm run dev`')).toBe('<p>Use <code>npm run dev</code></p>');
  });

  it('renders bullet and numbered lists', () => {
    expect(markdownToSafeHtml('- oil change\n- tire rotation')).toBe(
      '<ul><li>oil change</li><li>tire rotation</li></ul>',
    );
    expect(markdownToSafeHtml('1. call us\n2. book online')).toBe(
      '<ol><li>call us</li><li>book online</li></ol>',
    );
    expect(markdownToSafeHtml('Services:\n- brakes\n\nCall us.')).toBe(
      '<p>Services:</p><ul><li>brakes</li></ul><p>Call us.</p>',
    );
  });

  it('renders headings as emphasis, not <h*>, so the host page heading order is untouched', () => {
    expect(markdownToSafeHtml('### Hours')).toBe('<p><strong>Hours</strong></p>');
    expect(markdownToSafeHtml('### Hours')).not.toContain('<h3');
  });

  it('escapes HTML in the model output — no tag survives as markup', () => {
    expect(markdownToSafeHtml('<img src=x onerror="alert(1)">')).toBe(
      '<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>',
    );
    expect(markdownToSafeHtml('<script>alert(1)</script>')).not.toContain('<script');
    expect(markdownToSafeHtml('**<b>hi</b>**')).toBe(
      '<p><strong>&lt;b&gt;hi&lt;/b&gt;</strong></p>',
    );
    expect(markdownToSafeHtml('5 > 3 && 2 < 4')).toBe('<p>5 &gt; 3 &amp;&amp; 2 &lt; 4</p>');
  });

  it('allows only http/https/mailto links and cannot break out of the href attribute', () => {
    expect(markdownToSafeHtml('[our hours](https://example.com/hours)')).toBe(
      '<p><a href="https://example.com/hours" target="_blank" rel="noopener noreferrer nofollow">our hours</a></p>',
    );
    expect(markdownToSafeHtml('[mail](mailto:hi@example.com)')).toContain(
      'href="mailto:hi@example.com"',
    );
    // Dangerous schemes degrade to plain label text.
    expect(markdownToSafeHtml('[click](javascript:alert)')).toBe('<p>click</p>');
    expect(markdownToSafeHtml('[click](data:text/html;base64,AAAA)')).toBe('<p>click</p>');
    expect(markdownToSafeHtml('[click](JavaScript:alert)')).not.toContain('<a ');
    // A quote in the URL is escaped, so it cannot open a new attribute.
    const quoteBreakout = markdownToSafeHtml('[x](https://e.com/"onmouseover="alert)');
    expect(quoteBreakout).not.toContain('onmouseover="');
    expect(quoteBreakout).toContain('&quot;onmouseover=&quot;');
  });

  it('leaves snake_case identifiers alone', () => {
    expect(markdownToSafeHtml('send_email_tool')).toBe('<p>send_email_tool</p>');
  });
});

describe('markdownToPlainText', () => {
  it('strips markers so the aria-live announcement is prose', () => {
    expect(markdownToPlainText('We are **open** until *5pm*.')).toBe('We are open until 5pm.');
    expect(markdownToPlainText('### Hours\n- Mon: 9-5\n- Tue: 9-5')).toBe(
      'Hours\nMon: 9-5\nTue: 9-5',
    );
    expect(markdownToPlainText('See [our hours](https://example.com/hours).')).toBe(
      'See our hours.',
    );
    expect(markdownToPlainText('Run `npm test`')).toBe('Run npm test');
  });

  it('never emits markup', () => {
    expect(markdownToPlainText('**<b>hi</b>**')).not.toContain('<strong>');
  });
});
