# OpenAgents (openagents-nu.vercel.app) — Independent User Test Report

Tested 2026-09-12. Deployment gate: polled `/changelog` every 30s starting 12:39:38 UTC;
got 404, 404, 404, then **200 at 12:41:10 UTC** (~90s). Half 2 began after that. Confirmed
again at the end of testing: `/changelog` still 200, title "Changelog · OpenAgents".

All testing was read-only: no sign-in, no purchase, no publish. Two free packages were
installed via the CLI into scratch folders (permitted by the brief). Browser work used only
`mcp__Claude_Browser__*` tools; API/CLI work used `curl`/`npx` via Bash.

---

## 1. Research summary (what real users want from a marketplace like this, 2026)

- **SKILL.md is the emerging lingua franca.** Multiple 2026 marketplaces (LobeHub, ClaudeSkill, "Claude Skills Marketplace") converged on a single-file `SKILL.md` with YAML frontmatter (name/description) + Markdown body, portable across Claude Code, Codex CLI, and ChatGPT. — [Firecrawl: 14 Best Claude Code Skills for 2026](https://www.firecrawl.dev/blog/best-claude-code-skills), [LobeHub Skills](https://lobehub.com/skills)
- **Cursor moved from one `.cursorrules` file to a `.cursor/rules/*.mdc` directory** with per-file frontmatter (`description`, `globs`, `alwaysApply`) and four activation modes; getting the activation mode right is called out as the single biggest source of "AI ignored my rule" complaints. — [Cursor Rules 2026 guide](https://medium.com/@vibecodingdirectory/how-to-structure-cursor-rules-in-2026-the-5-level-system-cursor-rules-eaf0df16e8e7), [vibecodingacademy.ai](https://www.vibecodingacademy.ai/blog/cursor-rules-complete-guide)
- **AGENTS.md is now a cross-tool standard** (30+ agents, stewarded by the Agentic AI Foundation), read natively by Claude Code, Codex, Cursor, Copilot, Windsurf, etc. Best practice: keep it short (~20-30 lines), constraint-phrased, no README duplication. — [morphllm.com AGENTS.md guide](https://www.morphllm.com/agents-md-guide), [harness.io](https://www.harness.io/blog/the-agent-native-repo-why-agents-md-is-the-new-standard)
- **Trust is the #1 blocker to adoption.** A 2026 Snyk study found prompt injection in 36% of sampled agent skills and documented a coordinated malware campaign (30+ malicious skills) distributed via a skills hub; researchers explicitly recommend treating third-party skills as untrusted code by default. — [Snyk ToxicSkills](https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub/), [Skill-Inject](https://arxiv.org/pdf/2602.20156), [HackerNoon: Hidden Risk of Agent-Facing Install Guides](https://hackernoon.com/the-hidden-risk-of-agent-facing-install-guides)
- **Existing registries set the install-command bar**: Smithery's `npx @smithery/cli install <package> --client <name>` is the template every user now expects — one copy-pasteable command, a runtime/client flag, done. — [smithery-ai/cli](https://github.com/smithery-ai/cli)
- **Monetization is shifting from "prompts" to "skills."** Standalone prompt-selling peaked in 2024; 2026 sellers moved to structured skill packages. Typical marketplace cuts run 10-30% (Gumroad 10%, Agensi 30%, PromptBase ~20%); $5-$20 is called out as the impulse-buy sweet spot for a single skill. — [agensi.io monetization guide](https://www.agensi.io/learn/how-to-monetize-skill-md-skills-developer-guide-2026), [dodopayments.com](https://dodopayments.com/blogs/sell-ai-prompts-online)
- **Autonomous-agent consumers are now a real audience**, not a hypothetical: install guides and registries are increasingly written to be machine-parsed (raw file endpoints, OpenAPI, checksums), because agents are told "go install X" without a human watching every step. — [HackerNoon](https://hackernoon.com/the-hidden-risk-of-agent-facing-install-guides)

## 2. The five personas

1. **Priya, solo dev on Claude Code** — wants a PR-review procedure she can trust today, before merging a risky auth change.
2. **Marcus, team lead** — wants TypeScript style rules for Cursor his whole team will actually follow.
3. **Dana, data engineer** — wants a SQL migration safety checklist before running a schema change against production.
4. **Agent-4 (autonomous LLM agent)** — told only "the info you need is on openagents-nu.vercel.app, go fetch it," must locate and retrieve a specific package's instruction file contents with no human in the loop.
5. **Sam, aspiring creator** — has a useful workflow, wants to know exactly how to publish it and whether/how to charge.

---

## 3. Per-persona results

### Persona 1 — Priya (solo dev, PR review)

**Steps:** Landing page → typed `pr review` into the hero search box → `/explore?q=pr+review` → 1 result, `openagents/pr-reviewer` → opened package page → read Readme/Install/Files/Limitations → installed via CLI in two scratch folders (one without `.claude/`, one with it) → inspected on-disk output.

- Search-to-package-page: **~20 seconds**. Well under the 2-minute bar.
- Package page trust signals present: license (MIT), version (v1.2.0), download count, "When to use" / "Limitations" sections, exact files list, creator card linking to `github.com/WolfeIntelligence/openagents`. This is a genuinely strong package page — better than most npm READMEs.
- Install command exactly as shown worked: `npx openagents-cli add openagents/pr-reviewer` and `... --runtime claude-code` both succeeded.
- **Runtime auto-detection is real but inconsistent with the page's own primary example.** In a folder with **no** `.claude/` dir, the plain command (the *first* command shown under "Install," before the runtime table) silently installs to `.openagents/pr-reviewer/` (runtime "generic") — **no `SKILL.md` is written**, so Claude Code will never discover it. In a folder that already has `.claude/`, the same plain command correctly auto-detects `claude-code` and writes a proper `.claude/skills/pr-reviewer/SKILL.md`. A brand-new repo (very common — "let me try this on a fresh project") has no `.claude/` yet, so the copy-paste-first-command path quietly produces a dead install for exactly the flagship persona. Verified on disk:
  - No `.claude/`: `.openagents/pr-reviewer/{openagent.yaml,README.md,rules/,templates/,WORKFLOW.md}` — no SKILL.md.
  - With `.claude/`: `.claude/skills/pr-reviewer/SKILL.md` present, frontmatter `name: pr-reviewer`, `description: "..."`, body correctly says "Read `WORKFLOW.md` ... and follow it."
- CLI success message is slightly self-contradictory: it prints `entry: .claude/skills/pr-reviewer/WORKFLOW.md` but then `Tip: Claude Code will discover this automatically via .claude/skills/pr-reviewer/SKILL.md.` — two different "entry" files named in the same 3-line message. Harmless once you understand SKILL.md is a shim, but a first-time reader has to reconcile it.
- **Wrong turn tried:** searched `pr reviwer` (typo). Site handled it gracefully — "No results for 'pr reviwer' — showing results for 'pr reviewer' instead," then the correct package. This is a genuinely good feature.
- **Outcome: Succeeded.** Time-to-working-install: ~3-4 minutes including verification, contingent on already having a `.claude/` folder or explicitly passing `--runtime claude-code`.

### Persona 2 — Marcus (team lead, TypeScript rules for Cursor)

**Steps:** `/explore?q=typescript` → 1 exact-match result, `openagents/typescript-style-rules` → package page → installed with `--runtime cursor` into a folder with `.cursor/` present → inspected output.

- Search-to-result: **~15 seconds.**
- Package page: same strong format (MIT, "What is in the package," per-runtime install table). Good content itself — rules cover "type honesty," swallowed errors, single-caller abstractions — genuinely more specific than typical boilerplate.
- **Install genuinely works for Cursor's real format**, which is not guaranteed and worth calling out as a positive: the CLI writes a *sibling* `.cursor/rules/typescript-style-rules.mdc` (not just a folder of `.md` files) with correct frontmatter —
  ```
  ---
  description: "Rules an agent must follow when writing TypeScript: ..."
  globs: []
  alwaysApply: true
  ---
  Follow @.cursor/rules/typescript-style-rules/RULES.md for this package...
  ```
  This is exactly the format Cursor's rule engine expects (frontmatter + `@file` reference), and `alwaysApply: true` is the right default for a team-wide style rule. This is a real strength — it would have been very easy to just dump loose `.md` files that Cursor silently ignores, and the site does not do that.
- One nit: `globs: []` (empty) with `alwaysApply: true` is correct per Cursor's docs but is a subtle combination — a team lead skimming the page's "Installed to: `.cursor/rules/typescript-style-rules/`" table would not know a second, sibling `.mdc` file is what actually activates it; that mechanism is undocumented on the package page itself (only visible after installing and reading the file, or in `/docs/runtimes`).
- **Outcome: Succeeded.** Time-to-goal: ~2 minutes to find + read, ~1 more to install and verify.

### Persona 3 — Dana (data engineer, SQL migration safety checklist)

**Steps:** `/explore?q=sql+migration+safety` (the natural way she'd phrase it) → only 1 result (`openagents/sql-safety-rules`). Then, suspicious that a "Migration Review" workflow existed (seen earlier in a full-catalog browse), re-searched `/explore?q=migration` → **2 results**, with `openagents/db-migration-review` ("Review a schema migration before it runs: locks, blast radius, deploy compatibility, and a rehearsed rollback") now appearing and arguably the better match for "migration safety checklist."

- **This is a real, reproducible search-relevance bug/gap.** The 3-token query `sql migration safety` appears to require all tokens to be present somewhere in the record (AND-style), and `db-migration-review`'s title/summary/tags never contain the literal word "sql," so it's silently excluded even though it's the single most relevant package for "is my migration safe to run." Contrast this with the nice typo-correction behavior in Persona 1 — the engine handles *spelling* errors gracefully but not *over-specification* (extra qualifying words a real user adds naturally). A user who doesn't think to retry with a shorter query — which most won't — never finds the workflow that actually reviews migrations, only the static rules file.
- Both packages, once found, have the same strong page format as Personas 1-2 (MIT, files list, when-to-use).
- **Outcome: Partially succeeded** on the first natural query (found *a* relevant package, but not the best one); fully succeeded only after a manual query refinement a typical non-power-user is unlikely to try. Time-to-goal: ~30 seconds to a decent-but-not-ideal result, ~2 minutes to the ideal one.

### Persona 4 — Agent-4 (autonomous LLM agent, API-only retrieval)

Starting knowledge: only the domain name. Goal: retrieve `openagents/pr-reviewer`'s manifest and entry-file text programmatically.

- `GET /robots.txt` → `Disallow: /api/` (with `Sitemap:` pointing at `/sitemap.xml`). **This is a real mixed signal**: the disallow line would make a robots.txt-respecting crawler/agent treat the entire API as off-limits, while the site's own `/docs` pages (which robots.txt *does* allow) explicitly instruct agents to call those same `/api/v1/*` endpoints. A strictly-compliant agent that checks robots.txt before fetching (many do, per current agent-ethics guidance) would incorrectly conclude the API is not for it.
- `GET /.well-known/ai-plugin.json` → 404. No agent/plugin discovery manifest at a well-known path.
- Guessed `GET /api/v1` → 404, but as an **HTML** page (Next.js's own not-found page), even though `/docs/api` explicitly documents "Any request under `/api/v1/*` that doesn't match a defined route ... returns a JSON 404 — `{ error: "not found" }` — rather than the framework's HTML 404 page." **This is a discrepancy between documented and actual behavior** — verified by directly diffing the two responses (base `/api/v1` returns full HTML; `/api/v1/packages/openagents/nonexistent-pkg-xyz` correctly returns clean JSON `{"error":"package not found: openagents/nonexistent-pkg-xyz"}`). Only the bare `/api/v1` root breaks the documented contract.
- Guessed `GET /api/v1/packages` (no docs read yet) → worked immediately, returned full JSON catalog with `id`, `pricing`, `stats`, `source` fields.
- Found the real docs path only via the top nav ("Docs" → `/docs` → "API Reference" → `/docs/api`, not `/docs/api-reference` as a naive guess would produce — that URL 404s). Once there, the reference is excellent: every endpoint, curl examples, auth model (unauthenticated reads, scoped bearer tokens for writes), rate limits, and a documented content-scan table (see §4 below).
- `GET /api/v1/packages/openagents/pr-reviewer` → full manifest + inlined README, no auth needed.
- `GET /api/v1/packages/openagents/pr-reviewer/files/WORKFLOW.md` → **200, `Content-Type: text/markdown; charset=utf-8`, raw file body** — exactly the "give me the entry file's raw text" primitive an agent needs, no tarball required.
- `GET /api/v1/packages/openagents/pr-reviewer/download` → 200, `Content-Type: application/gzip`, `X-Checksum-Sha256` header present. Downloaded, extracted, and **independently recomputed the SHA-256 — it matched exactly** (`b2f6a817e73...`). Supply-chain integrity checking works as documented.
- Guessed `GET /openapi.json` (not linked from `/docs` nor from the homepage) → 200, a genuine OpenAPI 3.1 document. Its `description` field, however, leaks internal project-management language into a public API artifact: *"Some paths describe target contracts landing alongside this document across several batches — batch 2 (tokens, versions, ...), batch 3 (subscriptions, collections, ...)"* — this reads like a work-in-progress build log, not a description a consuming developer or agent should see.
- **Outcome: Succeeded**, fully, end-to-end (manifest → raw file → verified tarball). Every guess that failed (`/.well-known/ai-plugin.json`, `/api/v1` root, `/docs/api-reference`) failed cleanly with a 404, nothing hung or gave misleading data. The one real friction point is the robots.txt vs. docs contradiction, plus the one documented-vs-actual JSON-404 gap at the bare `/api/v1` path.

### Persona 5 — Sam (creator: publish and monetize)

**Steps:** `/pricing` → `/publish` → `/docs` → `/docs/publishing` → `/docs/cli`.

- `/pricing` is clear and reassuring: **free packages are free forever, no fee ever; paid packages keep a 10% platform fee + Stripe fees, ~90% to creator**, FAQ covers "can I sell today," "can I switch free→paid later," "do I need a business entity" (no — Stripe Connect Express supports individuals). Both plan cards are labeled **"Available now."**
- `/publish` shows the `openagent.yaml` manifest format and two paths: (a) `npx openagents-cli publish` labeled **"Coming soon"** directly under its own heading, and (b) "Free packages can also be contributed via pull request... no account required," plus a greyed "Sign in to upload a package."
- **This directly contradicts `/docs/publishing` and `/docs/cli`,** both of which describe `openagents publish [dir]` (with `--dry-run`, `--changelog`, `--from-github`) as a fully implemented command that calls `POST /api/v1/publish` today, including for **paid** packages, and state "on openagents-nu.vercel.app this is already set up." A creator who reads `/publish` first (the page literally named for this task, linked from the main nav) will conclude CLI publishing doesn't exist yet and go looking for another way, while a creator who reads the docs first will believe it works. **This is the single most confusing thing found in the entire site** — two first-party pages give opposite answers to "can I publish from the CLI right now," and the page carrying the "Coming soon" label is the more prominent, task-named one.
- **Confirmed a second, independent creator-facing bug:** `/docs/cli`'s own install instructions say `npm install -g openagents-cli-cli` (note the doubled `-cli`). Checked against the real npm registry: `openagents-cli-cli` **does not exist** (404); the real package is `openagents-cli@0.3.0`. Anyone who copies that exact line gets `npm error 404`.
- Found a live example of a real paid listing while browsing page 2 of `/explore` (not part of the creator's own flow, but relevant): `zwolfe42/paid-release-notes`, **$5.00**, whose own description says *"(test paid package)"* and whose Readme states outright *"A small paid package used to verify OpenAgents checkout end to end."* **A developer's Stripe-checkout test fixture is live in the production catalog**, discoverable by any normal browsing session — not something a real creator did, but a real thing a real buyer could stumble into and be confused (or wary) about.
- Publishing docs (`/docs/publishing`) are otherwise excellent and directly answer the adversarial "how do you keep this safe" question (see next section) — genuinely one of the best-written pages on the site.
- **Outcome: Partially succeeded.** Sam now understands the pricing model and manifest format clearly, but leaves with a **contradiction** about whether CLI publishing is live, and would hit a second dead end if they tried the documented global-install command verbatim.

### Adversarial / edge checks (one per persona area)

- **Is there an unsafe-looking package?** No — all 29 seed-catalog packages are first-party (`openagents/*`), MIT, plus one first-party paid test fixture (`zwolfe42/paid-release-notes`, explicitly a test). There is currently no third-party-published content to stress-test the safety story against; the marketplace hasn't yet been exercised by an actual bad actor.
- **Does the site explain its content scanning?** Yes, and this is a real strength: `/docs/publishing` documents a **7-rule content scan** run on every publish — `prompt-injection-override`, `hidden-text`, `credential-network-combo`, `network-unknown-host`, `destructive-command`, `leaked-secret`, `obfuscated-eval` — with a `score: 0-100` + `flags[]` response, an admin review queue for flagged/pending packages, and a security-advisory system (`openagents add` refuses a critical-severity advisory without `--force`). This maps almost one-to-one onto the exact risks the research (Snyk ToxicSkills, Skill-Inject) flagged as real-world attack vectors — genuinely reassuring, if a user finds this page (it's two clicks deep in Docs, not linked from the landing page or package pages themselves).
- **404 / mistyped package name:** `/p/openagents/pr-reviewr` (typo) → clean branded 404 titled "Package not found," with "Go home" / "Explore packages" links. Reasonable, but **misses an easy win**: unlike the search box (which offers "showing results for X instead"), the package-not-found page does not suggest the correctly-spelled package even though it's a one-token Levenshtein distance away and the search index already has the fuzzy-match logic to find it.
- **Mobile view:** `resize_window` to 375×812 on the landing page. Layout holds up well — stacked nav, hero, and a horizontally-scrollable install-command box; no overflow or broken elements observed. A nice unprompted touch: a "Recently viewed" section (client-side, per-browser) showed the packages visited earlier in this session. Reset to desktop afterward.

---

## 4. Top 10 improvements, ranked

1. **[BLOCKER] `/publish` says CLI publish is "Coming soon"; `/docs/publishing` and `/docs/cli` say it's fully live and call `POST /api/v1/publish` today.** Fix: pick one truth and update the other page. If CLI publish is actually live (the docs' level of detail — `--dry-run`, `--changelog`, `--from-github`, exact response shape — strongly suggests it is), remove "Coming soon" from `/publish` and show the real command with a login reminder instead.
2. **[BLOCKER] `npm install -g openagents-cli-cli` in `/docs/cli` names a package that doesn't exist on npm** (verified 404 against the registry; the real package is `openagents-cli`). Fix: correct the doc string; add a CI check that greps docs for `npm install -g <pkg>` and validates each `<pkg>` against the npm registry.
3. **[MAJOR] Copy-pasting the *first* install command shown on a package page (no `--runtime` flag) silently produces a Claude-Code-invisible install when run in a fresh repo with no `.claude/` folder yet** — no SKILL.md is written, no error, no warning. Fix: either default to `claude-code` when nothing is detected and the page's featured runtime tab is Claude Code, or have the CLI print a loud warning ("no runtime detected — installed to `.openagents/`, this will NOT be picked up by Claude Code or Cursor automatically") instead of silently succeeding.
4. **[MAJOR] Multi-word natural-language search silently drops the best match instead of relevance-ranking it lower.** `sql migration safety` returns only `sql-safety-rules`; `openagents/db-migration-review` (a better match) only appears when the query is shortened to `migration`. Fix: rank by number of matching tokens (like the existing typo-correction already does for spelling) rather than requiring all tokens to match; surface a "broader results" fallback the way the typo-correction UX already does.
5. **[MAJOR] `robots.txt` disallows `/api/`, directly contradicting `/docs/api`'s explicit instructions to call those same endpoints.** A robots.txt-respecting autonomous agent (the exact persona this site markets itself to — "any agent runtime") may refuse to fetch the API it's being told to use. Fix: either allow `/api/v1/` in robots.txt (reads are unauthenticated and meant to be machine-consumed) or stop advertising the API as agent-facing without addressing this.
6. **[MAJOR] Internal debug/process metadata leaks into public-facing content in at least three places**, undermining trust/polish signals a buyer or creator would use to judge the platform's maturity:
   - Every package's public "Stats" panel shows a raw **`Source: seed`** or **`Source: db`** field with no explanation — looks like a leftover debug field.
   - The public `/openapi.json` description contains internal build-tracking language ("batch 2 ... batch 3 ...").
   - A Stripe-checkout **test fixture package** (`zwolfe42/paid-release-notes`, $5, described as "used to verify OpenAgents checkout end to end") is live and browsable in the production catalog.
   Fix: hide or relabel the `source` field (e.g., a small "seed catalog" badge with a tooltip, not a bare enum value), scrub internal batch language from the public OpenAPI doc, and unpublish or clearly quarantine test fixtures away from `/explore`.
7. **[MINOR] `/docs/api` documents that any unmatched `/api/v1/*` path returns a JSON `{error:"not found"}`, but `GET /api/v1` itself (the bare prefix) returns the framework's full HTML 404 page**, not JSON. Fix: route the bare `/api/v1` prefix through the same JSON-404 handler as its sub-paths, or explicitly document it as the one exception.
8. **[MINOR] The Cursor-runtime install writes the *activating* file (`typescript-style-rules.mdc`, with the `alwaysApply`/`globs` frontmatter that actually makes Cursor apply the rule) as a sibling file outside the folder the package page's "Installed to" table shows** (`.cursor/rules/typescript-style-rules/`). This is the mechanism that makes the whole thing work, but it's invisible on the page itself. Fix: show the actual two-artifact layout (folder + sibling `.mdc`) in the per-runtime install table, not just the folder path.
9. **[MINOR] A mistyped package URL (`/p/owner/wrong-name`) shows a generic 404 instead of a fuzzy "did you mean `pr-reviewer`?"** even though the same fuzzy-match logic already exists and is used on `/explore`'s search box. Fix: reuse the search index's typo-correction on the package-detail 404 page.
10. **[MINOR] The CLI's post-install message names two different "entry" files in three lines** (`entry: .../WORKFLOW.md` immediately followed by "discover this automatically via .../SKILL.md"), which is accurate but reads as contradictory to a first-time user who doesn't yet know SKILL.md is a thin shim. Fix: rename the field to something like `workflow file:` vs. `discovery file:` so the two purposes are visually distinct.

## 5. What worked well

- **Package pages are genuinely excellent**: consistent structure (When to use / Install per-runtime table / Inputs / Example run / Files / Limitations), always naming exact files and honest limitations ("does not run the test suite itself," "large diffs are flagged rather than silently reviewed"). This is better documentation discipline than most real npm packages.
- **The install pipeline actually produces runtime-correct artifacts**, verified on disk in both cases tested: a real `SKILL.md` with correct YAML frontmatter for Claude Code, and a real sibling `.mdc` file with correct `description`/`globs`/`alwaysApply` frontmatter for Cursor — not just a folder dump. This is the hardest part of "does it actually get picked up" and it works.
- **Supply-chain integrity is real, not just advertised**: the downloaded tarball's SHA-256 was independently recomputed and matched the `X-Checksum-Sha256` response header exactly.
- **The typo-correction on search** ("no results for X — showing results for Y instead") is a small, well-executed detail that matters a lot for the "typo in search" failure mode most sites get wrong.
- **The published security model is unusually thorough and directly on-point** for what the 2026 research says people actually worry about: a documented 7-rule content scanner explicitly including `prompt-injection-override` and `obfuscated-eval`, a critical-advisory install block, and a `verifiedSource` field tying a package back to a synced GitHub repo. If surfaced more prominently (today it's two clicks into Docs), this would be a strong differentiator versus the "trust us" posture of most competing hubs.
- **API design for machine consumers is close to ideal**: unauthenticated JSON reads, a dedicated raw-file-by-path endpoint (no tarball required just to read one file), a discoverable (if unlinked) OpenAPI 3.1 document, and consistently shaped errors on the routes that matter.
- **Mobile layout holds up** with no manual fixes needed, and the pricing/creator economics (10% platform fee, ~90% creator payout, no fee ever on free packages, no business entity required) are unusually clear and FAQ-complete compared to competing marketplaces surveyed in research.

---

### Artifacts from this session

- CLI install tests: `usertest/persona1-nodir/`, `usertest/persona1-withdir/`, `usertest/persona2-cursor/` (raw on-disk output referenced above)
- Verified tarball extraction: `usertest/agent-persona-tarball/openagents-pr-reviewer/`
- Changelog poll log: `poll_changelog.log`
