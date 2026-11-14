# Agent team

Who works on this repo, what each role takes in and hands on, and where the
results live. The process itself is in [`../process.md`](../process.md).

## Team

| Role | Responsibility | Inputs | Outputs | Must not |
| --- | --- | --- | --- | --- |
| **Maintainer** (human) | Owns the product and the repo. Makes product decisions, approves criterion amendments, merges PRs, closes issues, files issues. | Orchestrator reports, PRs, issue comments | Decisions recorded on the issue, merged PRs, closed issues, new issues | — |
| **Orchestrator** (main session) | Picks the next issue, launches the role agents with a written brief, relays results to the maintainer, verifies each handoff (branch, authorship, CI). | Backlog, issue state, agent reports | Briefs for each role, reports and recommendations to the maintainer | Groom, implement or test itself; merge PRs or close issues |
| **PM** — [`pm.md`](pm.md) | Grooms one issue so it can be built and checked. Proposes amendments when criteria conflict. | Issue as filed, `_docs/plan.md`, `_docs/tasks.md` | Issue body in [`../task-template.md`](../task-template.md) form; follow-ups listed under Out of scope | Write code; change criteria without maintainer approval |
| **Engineer** — [`software-engineer.md`](software-engineer.md) | Implements one groomed issue against its criteria, with tests. | Groomed issue (and the QA comment on a fix round) | `feat/<n>-<slug>` branch, commits, PR with `Resolves #<n>`, green CI, summary comment on the issue | Change criteria; close the issue; push to `main` |
| **QA** — [`qa-engineer.md`](qa-engineer.md) | Checks the result against every criterion and the running code. | Issue criteria, the branch or PR | Verdict comment `## QA: PASS` / `## QA: FAIL` | Change code; judge against anything but the criteria |

## Handoffs

1. **Issue** — filed by the maintainer (or a follow-up filed while grooming).
2. **PM** — rewrites the issue body into the template.
3. **Engineer** — branch, commits, PR, green CI, summary comment on the issue.
4. **QA** — verdict comment on the issue. On FAIL, back to 3 with that comment
   as input, then QA re-verifies.
5. **Maintainer** — merges the PR and closes the issue with its criteria
   ticked.

The orchestrator sits between every step: it briefs the next role, checks
the handoff, and reports to the maintainer.

## Artifacts and where they live

| Artifact | Where | Shape |
| --- | --- | --- |
| Groomed task | Issue body | Goal / Acceptance criteria / Out of scope / Constraints ([template](../task-template.md)) |
| Engineer summary | Issue comment | Branch and commits, what changed, checks run, manual checks, open points |
| Pull request | GitHub PR | Titled for the change, body says `Resolves #<n>` |
| QA verdict | Issue comment | Starts `## QA: PASS` or `## QA: FAIL`, a verdict per criterion, the commands run and their results |
| Done | Issue body | Criteria ticked on PASS, issue closed after the merge |
| Product decision | Issue comment, then `_docs/plan.md` / `_docs/tasks.md` | The rule chosen and where it was recorded |
