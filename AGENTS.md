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
yarn workspace backend-lib eslint src/resources.test.ts

# Run tests for a specific file. A similar command can be used for other packages.
yarn jest packages/backend-lib/src/resources.test.ts

# Run type checking for the backend-lib package. A similar command can be used for other packages.
yarn workspace backend-lib check
```
