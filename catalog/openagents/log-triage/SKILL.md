# Log Triage

## 0. Write down the symptom before reading anything

One sentence, in observable terms: what happened, to whom, starting when. "Checkout
returned 500 for about 3% of requests starting 14:20 UTC." Not "the database broke",
which is already a hypothesis.

If you skip this, every log line will look like evidence for whatever you read first.

## 1. Establish the timeline

Before interpreting anything, get the sequence:

- **First occurrence.** Not the first one you noticed. Search backwards until you find
  a window with none.
- **Rate over time.** Constant, growing, spiky, or a step change? A step change points
  at a deploy or a config change. A slow ramp points at a leak or a filling queue.
- **What else happened at that moment.** Deploys, config changes, feature flags, traffic
  shifts, upstream incidents, certificate expiries, cron jobs, month boundaries.

The first occurrence and what coincided with it usually contain the answer.

## 2. Separate signal from background

Most logs are always noisy. Get a baseline from a healthy window of the same length,
ideally the same hour on a previous day.

- Errors present in both windows are background. Set them aside, do not explain them.
- Errors only in the bad window are signal.
- Errors whose *rate* changed are signal even if present in both.

This one step removes most wrong turns. The scary-looking warning that has fired every
minute for a year is not your incident.

## 3. Group before you read

Do not read chronologically. Normalize away request ids, timestamps and other varying
parts, then count by shape. Twenty thousand lines usually collapse into six distinct
errors, and the counts tell you which matters.

Then, for each group: first seen, last seen, count, and whether it is background.

## 4. Follow one request end to end

Pick a single failing request and trace it across every service by its correlation id.
One complete trace beats a thousand fragments. You are looking for the first thing that
went wrong, not the loudest.

Note where the error is *first* raised, and what the caller did with it. Errors get
re-wrapped and re-logged at every layer, so the same failure appears five times with
five different messages, and the last one is usually the least informative.

## 5. Form hypotheses, ranked

At least three. Fewer than three means you anchored.

For each: what it claims, the evidence for it, the evidence against it, and the
cheapest test that would distinguish it from the others.

Rank by evidence, not by how satisfying the story is. Note explicitly when a hypothesis
explains the timing but not the shape, or the shape but not the timing. A hypothesis
that explains only some of the facts is not yet the answer.

## 6. Test the cheapest discriminating test first

Cheapest, not most likely. A test that takes 30 seconds and rules out two hypotheses
beats one that takes an hour and confirms one.

Write down what you expect to see before running it. If the result is what you
expected, that is weak evidence. If it is not, that is strong evidence, and update.

## Mistakes this exists to prevent

- **Anchoring on the first stack trace.** It is usually a symptom several layers from
  the cause.
- **Explaining background noise.** See step 2.
- **Confusing correlation with the deploy.** A deploy at 14:19 and errors at 14:20 is
  strong evidence, not proof. Check whether the deploy touched anything on the path.
- **Stopping at the first plausible cause.** Plausible is not confirmed. Run the test.
- **Reporting a guess as a finding.** Say which it is.
