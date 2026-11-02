import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Logo } from './Logo';

// WCAG 2.5.3 Label in Name: a link wrapping the logo carries an aria-label, and that
// name has to contain the words the logo shows. The layouts link it as "VantageMind
// home" and "VantageMind dashboard"; a typed "V" in the mark made the visible text
// "V VantageMind", which failed axe 4.14 on every page.
describe('Logo', () => {
  it.each(['VantageMind home', 'VantageMind dashboard'])(
    'shows only words the link name "%s" contains',
    (name) => {
      render(
        <a href="/" aria-label={name}>
          <Logo />
        </a>,
      );
      const link = screen.getByRole('link', { name });
      expect(link.textContent).toBe('VantageMind');
      expect(name).toContain(link.textContent);
    },
  );

  it('draws the mark as a graphic hidden from assistive technology', () => {
    const { container } = render(<Logo />);
    const mark = container.querySelector('svg');
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark?.textContent).toBe('');
  });
});
