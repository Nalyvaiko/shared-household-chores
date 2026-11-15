- Tasks are GitHub issues, one at a time
- Read the acceptance criteria before starting and before closing
- Commit regularly

Roles

The team, with inputs and outputs per role, is in _docs/team/README.md.

- Maintainer - the human owner. Makes product decisions, approves criterion
  amendments, opens and merges PRs and closes issues
- PM - grooms a task before anyone implements it, follows _docs/team/pm.md
- Engineer - implements one groomed task, follows _docs/team/software-engineer.md
- QA - checks the result against the acceptance criteria, follows _docs/team/qa-engineer.md

Orchestrator

The main session is the orchestrator. It launches the PM, the engineer
and QA as subagents, each with a written brief, and verifies each handoff
(branch, authorship, CI). It does not groom, implement or test itself.
It recommends merging and closing; the maintainer does both.

Lifecycle

1. Pick the next open issue from the backlog
2. PM grooms it
3. Engineer implements it
4. QA verifies it
5. On FAIL, back to step 3 with the QA comment as input; QA re-verifies the fix
6. On PASS, the maintainer merges the PR and closes the issue
7. Repeat until the backlog is empty

Criteria conflicts

When two criteria conflict or one is impossible, the engineer comments on
the issue. The PM proposes an amendment, the maintainer approves it, and QA
re-judges against the amended text.

Decisions

Product questions the spec does not answer (e.g. #23, #27) go to the
maintainer before work starts. The decision is recorded on the issue and in
_docs/plan.md / _docs/tasks.md.

Verification depth

- Full - PM grooms; the engineer adds manual checks; QA runs against a real
  Postgres and a real browser
- Lean - the PM step is skipped when the issue is already groomed and
  current; the engineer runs lint, typecheck, test and build; QA does the
  tests and a code review, plus one short real-database check only for
  race-prone or transactional work
- Step 2 is skipped only on the lean path

Conventions

- One issue per branch, `feat/<n>-<slug>` from `main`
- Never commit to or push `main`. Check the current branch before every
  commit; `main` can move while PRs are merged
- The engineer pushes the branch; CI must be green
- One PR per issue, with `Resolves #<n>`, opened by the maintainer, or by
  the engineer when the maintainer asks
- Commits use the maintainer's git identity, with no extra trailers
- Follow-up work goes to new issues filed by the maintainer, listed under
  Out of scope
- Small improvements outside the backlog may go straight to a PR (as #53
  onward did)
- A merge to `main` deploys to dev automatically once CI passes; production
  deploys only by a manual, approved "Deploy to production" run (README, CI/CD)

Environment

- Temporary Postgres containers for checks get unique names and ports, and
  are removed with their volumes
- Never create or edit `.env`
- Leave Docker as you found it

Rules

- The engineer does not close the issue
- QA does not fix the code, only outputs PASS or FAIL
- The issue is closed only after QA outputs PASS
