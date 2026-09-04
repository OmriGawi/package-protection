---
name: git-conventions
description: Use for any git or GitHub action in this repo — committing, branching, staging, opening a PR. Defines branch flow, commit scope vocabulary, staging discipline and PR shape. Message format is delegated to the caveman-commit skill and review-comment format to caveman-review; AI attribution is blocked by .claude/settings.json's attribution config.
---

# Git & GitHub conventions

Repo-specific rules only. Format is delegated:

- Commit messages — `caveman-commit`. Don't hand-write them here.
- Review comments — `caveman-review` for wording; `code-review` is what
  actually reads the diff (see `dev-workflow` step 5).
- AI attribution — `.claude/settings.json` sets `attribution.commit` and
  `attribution.pr` to empty strings. Nothing to restate; don't add a
  trailer or footer back manually.

General safety rules (never force-push `main`, never `--no-verify`, check
`git status` before any destructive command) are project-wide policy and
are deliberately not repeated here.

## Branch flow (GitHub flow)

- `main` is always deployable. No `develop`/`release`/`hotfix` branches.
- One short-lived branch per unit of work: `feat/<slice-or-feature>` or
  `fix/<bug>` — e.g. `feat/slice-1-create-delivery`.
- A branch is mergeable once it has been through the full `dev-workflow`
  loop. Merging to `main` is a separate, explicit checkpoint — confirm
  with the user, never as the silent last step of a slice.
- Delete the branch after merging.

## Commits

- One logical change per commit. Don't bundle an unrelated fix into a
  feature commit just because you noticed it along the way.
- Stage deliberately (`git add <specific files>`), never a blind
  `git add -A`/`.` without reviewing `git status` first — this repo has
  caught a stray install landing at the wrong path before.
- Scopes follow the repo layout: `backend`, `frontend`, `db`, `skills`,
  `hooks`, `docs`, `ci`. Pass these to `caveman-commit`; it can't guess
  them.
- Body caps at ~8 lines. One paragraph per non-obvious decision, three
  max. Code-review fixes are not a commit-body section — the diff and
  the PR carry them.

## Pull requests

This repo has no GitHub remote yet (`git remote -v` is empty), so these
apply from the day one is added:

- Title under ~70 characters.
- Body in normal prose: a short **Summary** (bulleted) and a **Test plan**
  (what was actually run — tests, typecheck, manual browser check).
  A PR body is read by humans outside this session, so it is not written
  in caveman register. Inline review *comments* are the exception, and
  follow `caveman-review`.
- Only open a PR or push when the user asks.

## History note

Conventional Commits adopted 2026-09-05. Commits before that point have
prose subjects ("Slice 3: receiving and the dummy tamper-check API"). The
switch point is deliberate — don't reformat history to match.
