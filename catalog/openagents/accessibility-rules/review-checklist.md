# Accessibility review

A five-minute pass, in a real browser. No tooling required beyond what is listed.

## Keyboard only

Put the mouse away.

- [ ] Can you reach every interactive element with Tab?
- [ ] Can you see where focus is, at every step?
- [ ] Does Tab order match what you see on screen?
- [ ] Can you activate everything with Enter or Space?
- [ ] Can you close every dialog or menu with Escape?
- [ ] Does focus go somewhere sensible after a dialog closes?

## Names

- [ ] Does every button have text or an `aria-label`?
- [ ] Does every input have a label?
- [ ] Read the links aloud with no surrounding context. Do they still mean anything?
- [ ] Does every image have alt text, or an explicit empty alt if decorative?

## Structure

- [ ] Is there exactly one `h1`?
- [ ] Do heading levels descend without skipping?
- [ ] Are lists marked up as lists and tables as tables?

## Visual

- [ ] Contrast at 4.5:1 for body text. Check the lightest text on the page.
- [ ] Zoom to 200%. Is anything cut off or overlapping?
- [ ] Narrow to 320px. Does it scroll horizontally?
- [ ] Turn on reduced motion. Does anything still animate?

## Dynamic

- [ ] Does a form error say what is wrong, in text, next to the field?
- [ ] Does anything appear or update without announcing itself?
