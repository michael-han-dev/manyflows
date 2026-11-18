# Repository instructions

## Testing

- Strictly use end-to-end (E2E) tests. Do not add unit tests, isolated component tests, or unit-test frameworks.
- Add feature and regression coverage to the Playwright suite in `tests/e2e/`. Exercise behavior through the running application and its HTTP endpoints.
- Run `npm run test:e2e` for application changes. The suite builds the frontend and starts a local Worker with isolated D1 storage and simulated Meta API responses.
- Run `npm run check` for TypeScript validation. Type checking does not replace E2E coverage.

## Local files and privacy

- Keep credentials, personal information, local deployment configuration, and audit artifacts out of source control.
- Use placeholder values in checked-in examples. Keep real secrets in ignored `.dev.vars` or `.env` files.
- Keep `.audit/` and `audit/` ignored. Commit source code, migrations, and E2E test fixtures.
