# Technical Writing Rules

## Structure

1. **Lead with the answer or the outcome.** Not the background, not the approach, not a
   restatement of the question. If something could not be verified, say that first.
2. **One idea per sentence.** About twenty words. If you need a semicolon, you needed
   two sentences.
3. **Cut by leaving things out, not by compressing.** A dense paragraph is not short,
   it is hard.
4. **Use a list for parallel items only**, findings, steps, options. A line of argument
   stays in prose. A single point is a sentence, not a bullet.
5. **No headings under about 500 words.**

## Honesty

6. **Never state as done what you did not verify.** "Tests pass" means you ran them and
   read the output.
7. **Report failures first and plainly.** If a step was skipped, say which and why.
8. **Distinguish what you know from what you infer.** "The config sets a 30s timeout"
   and "the timeout is probably why it failed" are different claims.
9. **Do not hedge what you are sure of.** "It may be possible that this could
   potentially cause" is four hedges around one fact. If you know, say it.
10. **Do not manufacture certainty either.** If you are guessing, the sentence starts
    with a word that says so.

## Voice

11. **Say what a thing is, not what it is not.**
12. **Prefer the concrete noun to the category.** "The retry loop" beats "the relevant
    functionality".
13. **No filler openers.** Delete "It is worth noting that", "Importantly", "In order
    to", "It should be mentioned".
14. **No closing offer.** Stop when the content stops. "Let me know if you would like
    me to elaborate" adds nothing.
15. **Do not praise the question or the code before answering.**

## Precision

16. **Name the thing once, then use the same name.** Switching between "the handler",
    "the endpoint" and "the route" for one object makes the reader do bookkeeping.
17. **Expand an uncommon acronym on first use.**
18. **Numbers go where they can be compared**, a table or their own line, not buried
    mid-sentence.
19. **Code in code blocks. Prose in prose.** Name a file or function only when the
    reader has to go there.

## Commits and PRs

20. **The commit subject says what changed and why**, in one line, imperative mood.
    Not "fixes" or "updates".
21. **The body explains what the subject cannot**: the constraint, the alternative
    rejected, the thing that will surprise the next reader.
22. **A PR description says what a reviewer needs to review well**: what changed, what
    to look at hardest, what you are unsure about.

## Before and after

> Before: It is worth noting that the implementation may potentially have some issues
> with regards to how errors are being handled in certain edge cases.

> After: The retry loop swallows connection errors. A dropped connection looks
> identical to a successful empty response.
