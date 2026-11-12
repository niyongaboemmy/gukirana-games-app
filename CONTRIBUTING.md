# Contributing

1. Pick a task ID from [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md) and open an issue titled with it.
2. Branch: `feat/<TASK-ID>-short-name`.
3. Implement only that task, with tests (coverage gates in plan §4.5).
4. Run `pnpm verify` and `pnpm build`.
5. Open a PR using the template. Money / fairness changes need two approvals.
6. Commit messages follow Conventional Commits and include the task ID.

Architecture changes need an ADR in `docs/adr/`.
