# Docs

| File | What it holds |
|---|---|
| [architecture.md](architecture.md) | Where the code lives, how a request flows, the data model, the seams |
| [user-flows.md](user-flows.md) | The screens, a package's life, the shipping and receiving flows |
| [production-readiness.md](production-readiness.md) | What is still missing before this runs on the company network, and the question that decides each gap |
| [../DESIGN.md](../DESIGN.md) | The product design doc — requirements, decisions, open questions, changelog |

**DESIGN.md is the source of truth.** It holds *what* is being built and *why*,
including every decision's reasoning and the running changelog. The files here
describe *how the current code is arranged*, which is a different question and
goes stale in a different way.

When they disagree, DESIGN.md is right and something here needs fixing.

Diagrams are Mermaid in fenced code blocks — they render on GitHub with no
build step and no image files to regenerate.

## Keeping these current

Documentation is step 6 of the workflow in
[../CONTRIBUTING.md](../CONTRIBUTING.md), not an afterthought. A change that
alters behavior updates DESIGN.md's changelog; a change that moves code, adds a
route, or changes the data model updates `architecture.md`; a change to what a
screen does updates `user-flows.md`. Most changes touch one of
the three, some touch none — but the question gets asked before work is called
done.
