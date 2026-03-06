# Agents

## Context Setup

When working on this Dittofeed project, load the Dittofeed documentation context from Context7 at the start of each session:

```
Use context7-query-docs with libraryId: /dittofeed/dittofeed
```

This provides access to Dittofeed documentation, code examples, and API references.

## Commands

The following are useful commands for the agents:

```bash
# Lint a specific file in the backend-lib package. A similar command can be used for other packages.
yarn workspace backend-lib eslint src/resources.test.ts --fix

# Run tests for a specific file. A similar command can be used for other packages.
yarn jest packages/backend-lib/src/resources.test.ts

# Run tests and pipe output to a timestamped file in .tmp for debugging.
# Prefer this for large tests to avoid inflating context. The output file can be
# searched and explored more efficiently using Read, Grep, etc.
yarn test:file packages/backend-lib/src/resources.test.ts

# Run tests with jest flags (e.g., -t to filter by test name).
yarn test:file packages/backend-lib/src/resources.test.ts -t "specific test name"

# Reduces the log levels before running tests, providing more verbose log output.
LOG_LEVEL=debug yarn jest packages/backend-lib/src/resources.test.ts

# Run type checking for the backend-lib package. A similar command can be used for other packages.
yarn workspace backend-lib check
```

## Upstream Policy — DO NOT modify core Dittofeed packages

This project is a fork/overlay on top of the upstream **Dittofeed** codebase.
Core packages are pulled from upstream and will be updated in the future.
**Never modify files in upstream packages** — changes will be lost on the next update and may cause merge conflicts.

### Upstream (read-only) packages — do NOT edit:

- `packages/api/`
- `packages/backend-lib/`
- `packages/dashboard/`
- `packages/isomorphic-lib/`
- `packages/lite/`
- `packages/worker/`
- `packages/admin-cli/`

### Custom packages — safe to edit:

- `packages/auth-keycloak/` — our Keycloak OIDC multi-tenant auth module
- `nginx/` — our nginx configuration
- `docker-compose.keycloak.yaml` — Keycloak-specific compose overlay

When a feature requires changes to upstream behavior, implement it as a **wrapper, hook, or middleware** inside our custom packages (e.g., `auth-keycloak`). If upstream modification is truly unavoidable, discuss with the user first.

## Key Files and Directories

- packages/backend-lib/src/config.ts: Where the majority of our applications' environment variables and configuration values are resolved. (upstream — read-only)
- packages/auth-keycloak/: Our custom Keycloak OIDC authentication module.
- .tmp/: this directory can be used output disposable files for debugging purposes
