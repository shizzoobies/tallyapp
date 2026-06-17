# KICKOFF

Paste the block below as your first message to Claude Code once this folder is a repo and open in the editor.

---

Read `CLAUDE.md` and `SPEC.md` in full before writing any code.

Then do this and nothing more:

1. Summarize back to me in under 10 bullets: the locked stack, the phase order, and the five design decisions from SPEC section 3. Flag anything in the spec that is ambiguous or that you would push back on.
2. Do not write any code yet. Wait for me to reply "go".

When I say "go", build Phase 0 only. Stop at the Phase 0 acceptance criteria in SPEC section 10, tell me exactly how to verify it, and wait. Repeat this loop for each phase. Never build ahead of the current phase.

Hard rules for everything you produce: no em dashes anywhere, bodyweight and height stored metric and converted only in the UI, the Anthropic API key never reaches the client, all model calls go through a Pages Function, and user-confirmed food values drive the math while raw AI output is stored separately.
