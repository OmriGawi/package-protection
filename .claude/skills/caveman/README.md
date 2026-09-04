# caveman (vendored)

Third-party skill, not written for this project.

- **Source**: https://github.com/JuliusBrussee/caveman
- **Pinned to**: tag `v2.6.0`, file `skills/caveman/SKILL.md`
- **License**: MIT (the repo's BSL-1.1 parts — `engine/`, `proxy/`, `rewriter/`
  and friends — are *not* vendored here)

`SKILL.md` is byte-for-byte upstream. Don't edit it in place; to update, re-pull
the file at a newer tag so the diff stays reviewable.

## Why it's here and not installed properly

Upstream's Claude Code path is `claude plugin install caveman@caveman`, which
installs **user-wide** and would apply to every project on this machine. This
copy is scoped to this repo only, which is what was wanted while trying it out.

Only the core `caveman` skill is here. The upstream project also ships a proxy
that sits between the agent and the model provider, and a set of extra skills
(`caveman-commit`, `caveman-review`, …) — none of which are installed.

## What it does

Compresses assistant *chat* output (`/caveman lite|full|ultra|off`). Its own
Boundaries section exempts commits, code, comments and docs, so it should not
conflict with `git-conventions` (commit bodies still explain why in prose) or
with DESIGN.md. It also drops the style automatically for security warnings and
irreversible-action confirmations.

Remove by deleting this directory.
