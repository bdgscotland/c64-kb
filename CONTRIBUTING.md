# Contributing

The rules for content (evidence ladder, corrections recorded, metadata
lines) are in [CLAUDE.md](CLAUDE.md); they apply to people as much as to
agents. This page covers the code.

## Setup

    nvm use                 # Node 24.12+, from .nvmrc
    npm ci
    npx lefthook install    # git hooks on commit: typecheck, lint, format, listings, unit tests, build
    npm run services        # Qdrant and FalkorDB (pinned digests in docker-compose.yml)

## Before a commit

The git hooks run the fast gates on what you staged. CI (`.github/workflows/ci.yml`)
runs all of them. By hand:

    npm run typecheck       # src, scripts and test
    npm run lint            # ESLint, typescript-eslint strict, complexity budget
    npm run format:check    # Prettier (TypeScript, JSON, YAML; not markdown)
    npm test                # unit + integration; integration needs `npm run services`
    npm run check:listings  # every code listing in docs/ builds

## The complexity budget

`eslint.config.js` fails a function over cyclomatic 15, cognitive 15,
nesting depth 4, four parameters or 80 lines, and a file over 500 lines.
Split the code; do not raise the limit or add an `eslint-disable` without
a comment saying why that one line is the exception.

## Code conventions

- Data from outside (MCP input, FalkorDB rows, JSON files, environment) is
  validated with zod where it enters. Do not cast it.
- Nothing the MCP server reaches writes to stdout; that is the protocol
  stream. Use `console.error`.
- Relative imports end in `.ts`; Node runs the sources directly.
