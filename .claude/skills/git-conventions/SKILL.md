---
name: git-conventions
description: Use for any git or GitHub action in this repo — committing, branching, opening a PR, writing a commit message. Defines this project's git flow, branch naming, commit message style, and PR conventions, and states explicitly that AI attribution is never added (enforced via .claude/settings.json's attribution config, but restated here as the rule to follow even if that config is ever missing).
---

# Git & GitHub conventions

This repo's standing rules for git and GitHub, not a general git tutorial.
Apply these on every commit, branch, and PR — don't ask each time.

## No AI attribution, ever

Never add a "Co-Authored-By: Claude" trailer to commits, and never add a
"Generated with Claude Code" (or similar) footer to PR descriptions. This
repo's `.claude/settings.json` sets `attribution.commit` and
`attribution.pr` to empty strings to enforce this — if that file is ever
missing or reverted, the rule still stands: don't add it back manually.
The user owns every commit in their own name; keep history clean.

## Branch flow (GitHub flow, not git-flow)

- `main` is always deployable. No `develop`/`release`/`hotfix` branches —
  that's overhead this project doesn't need.
- One short-lived branch per unit of work, named `feat/<slice-or-feature>`
  or `fix/<bug>` — e.g. `feat/slice-1-create-delivery`,
  `fix/erp-validation-race`.
- A branch is mergeable once it's been through the full dev-workflow
  loop (plan, implement, tests written and passing, code review done —
  see the `dev-workflow` skill). Merging to `main` is a separate,
  explicit checkpoint — confirm with the user before merging, don't do
  it silently as the last step of a slice.
- Delete the branch after merging; don't let merged branches pile up.

## Commit messages

- Imperative summary line ("Add X", "Fix Y", not "Added X" or "Adds X"),
  under ~70 characters, no trailing period.
- Body explains **why**, not what the diff already shows — the reasoning,
  the tradeoff, the bug being fixed. Wrap around 72 chars.
- One logical change per commit. Don't bundle an unrelated fix into a
  feature commit just because you noticed it along the way.
- Stage deliberately (`git add <specific files>`), never a blind `git add
  -A`/`.` without reviewing `git status` first — this repo has caught a
  stray install landing at the wrong path before (see `.gitignore` and
  the backend/frontend split); a careless add would have committed it.

## Pull requests (once this repo has a GitHub remote)

- Title under ~70 characters.
- Body: a short **Summary** (what changed, bulleted) and a **Test plan**
  (what was actually run/verified — tests, manual browser check, curl).
  No AI-generated footer (see above).
- Only open a PR / push when the user asks for it — same rule as any
  other action visible to others.

## Safety defaults (restated, already project-wide policy)

Never force-push `main`, never `--no-verify`/skip hooks, never
`git reset --hard`/`git clean` without checking `git status` first and
confirming with the user. These aren't special to this repo — just worth
having in one place alongside the rest of the git conventions.
