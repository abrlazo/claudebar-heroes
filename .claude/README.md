# .claude Project Configuration

This folder contains Claude Code project-specific skills and agents for Claudebar Heroes.

## Skills

- **run-app**: Start the app (`npm start` or `npm run dev`) and test features

## Agents

- **performance-auditor**: Audit codebase for memory leaks, performance bottlenecks, bundle concerns
- **feature-planner**: Review new features for correctness, performance, and consistency; saves its findings to `.claude/review.md` (temporary, git-ignored) and tells you to run `/feature-implementer .claude/review.md`
- **feature-implementer**: Builds features (give it a request) and applies the output of `feature-planner` (give it the findings as text or a file path). Runs typecheck, build and the simulation after each; skips review findings that are wrong, already fixed or need a decision
- **gitama**: Git steward. Creates the repo if there is none, writes and refreshes the main README (project purpose and how to run it), splits changes into clean commits or branches, and handles pull and push (never force-pushes, never writes git config)

## Quick Start

1. When you want to test a feature, invoke the `/run-app` skill
2. When you suspect performance issues, invoke the `performance-auditor` agent
3. When you add a feature, invoke the `feature-planner` agent
4. To build a feature: `/feature-implementer <what you want>`, then `/feature-planner` on it, then `/feature-implementer <report, or a file path such as .claude/review.md>` to apply the review (it deletes `.claude/review.md` when done)
5. When you want your work committed, pulled or pushed, ask for the `gitama` agent (for example: "run gitama to commit these changes")

These are project-specific tools to keep work aligned with Claudebar Heroes conventions and performance requirements.
