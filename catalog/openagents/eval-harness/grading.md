# Choosing and trusting a grader

Match the grader to the claim. Reach for the cheapest one that can actually decide.

| Case asks | Grader | Notes |
|---|---|---|
| Exact value | string or JSON equality | Normalize whitespace and key order first. |
| Structure | schema validation | Validate, do not regex. Report which field failed. |
| Code works | run it | Compile, run the test, check the exit code. Strongest grader there is. |
| A property holds | assertion in code | Cited path exists, no secret in output, under N tool calls. |
| Judgment | LLM grader | Weakest. Use only when the three above genuinely cannot decide. |

## Keeping an LLM grader honest

An LLM grader is a model with an opinion, and it will happily agree with whatever it
is shown. Constrain it:

1. **Give it the rubric, not the goal.** "Does the answer cite a file that exists?"
   beats "is this a good answer?"
2. **Make it output a verdict token plus a reason**, one of `pass`, `fail`, `unknown`,
   and one sentence. Parse the token. Read the reasons when triaging.
3. **Never show it which output came from the new version.** Order-swap A/B pairs.
4. **Calibrate it against humans.** Hand-label 20 cases yourself. If the grader
   disagrees with you on more than 2, fix the grader before trusting a single score.
5. **Re-calibrate when you change the grader model.** It is a dependency like any other.

## The unknown bucket

Any grader may return `unknown`: the output was malformed, a tool errored, the case
was ambiguous. Treat it as a defect in the harness, not a neutral result.

- `unknown` never counts as a pass.
- A suite over about 10% unknown is not measuring anything yet. Fix that before
  reading scores.
