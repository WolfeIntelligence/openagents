# Accessibility Rules

## Semantics first

1. **Use the element that means what you mean.** A `button` for an action, an `a[href]`
   for navigation, `input` for input. Every native element brings keyboard behavior,
   focus handling and a role for free.
2. **Never put a click handler on a div or span.** It is unreachable by keyboard and
   invisible to assistive technology. If you catch yourself adding `tabindex`, `role`
   and `onKeyDown` to a div, you wanted a button.
3. **ARIA is a last resort, not a garnish.** The first rule of ARIA is not to use ARIA.
   A wrong role is worse than no role, because it overrides what was correct.
4. **Headings describe structure, not size.** One `h1` per page, no skipped levels.
   Use CSS for the size you want.

## Names

5. **Every control needs an accessible name.** A `label` tied to the input by `for`, or
   `aria-label` where no visible label exists.
6. **Icon-only buttons need a name.** An SVG is not a name. Add `aria-label` and mark
   the icon `aria-hidden="true"`.
7. **Link text must make sense alone.** Screen reader users navigate by a list of
   links; "click here" and "read more" are useless in that list.
8. **Every meaningful image needs alt text describing its content.** Every decorative
   image needs `alt=""`, not a missing alt.

## Keyboard

9. **Everything doable with a mouse must be doable with a keyboard.** Tab to it, Enter
   or Space to activate it, Escape to dismiss it.
10. **Never remove the focus outline without replacing it.** `outline: none` with no
    replacement makes the page unusable for keyboard users. A visible, high-contrast
    focus style is not optional.
11. **Tab order follows visual order.** Do not reorder with positive `tabindex`. Fix the
    DOM order instead.
12. **Trap focus inside a modal while it is open**, restore it to the trigger on close.

## Visual

13. **Text contrast is at least 4.5:1**, or 3:1 for large text. Check it, do not
    estimate it. Placeholder and disabled text are the usual failures.
14. **Never use color as the only signal.** Pair it with text, an icon, or a pattern.
15. **The interface must work at 200% zoom** and at 320px wide without horizontal
    scrolling.
16. **Respect `prefers-reduced-motion`.** Disable non-essential animation when it is set.

## Dynamic content

17. **Announce important changes** with a live region. A result that appears silently
    does not exist for a screen reader user.
18. **Move focus deliberately** after a navigation or a modal opens, so the next Tab
    lands somewhere sensible.
19. **Form errors are associated with their field** by `aria-describedby`, and are text,
    not just a red border.
