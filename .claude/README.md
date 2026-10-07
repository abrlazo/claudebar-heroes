# .claude Project Configuration

This folder contains Claude Code project-specific skills and agents for Claudebar Heroes.

## Skills

- **run-app**: Start the app (`npm start` or `npm run dev`) and test features
- **fix-performance**: Guidance on fixing the 5 critical performance issues identified in the audit

## Agents

- **performance-auditor**: Audit codebase for memory leaks, performance bottlenecks, bundle concerns
- **feature-reviewer**: Review new features for correctness, performance, and consistency
- **gitama**: Git steward. Creates the repo if there is none, writes and refreshes the main README (project purpose and how to run it), splits changes into clean commits or branches, and handles pull and push (never force-pushes, never writes git config)

## Quick Start

1. When you want to test a feature, invoke the `/run-app` skill
2. When you suspect performance issues, invoke the `performance-auditor` agent
3. When you add a feature, invoke the `feature-reviewer` agent
4. When you want your work committed, pulled or pushed, ask for the `gitama` agent (for example: "run gitama to commit these changes")

These are project-specific tools to keep work aligned with Claudebar Heroes conventions and performance requirements.
