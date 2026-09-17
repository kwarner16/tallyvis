# tests

Reserved for cross-package and end-to-end tests (e.g. a future Playwright
suite covering the estimator workflow across `apps/app` and `services/api`).

Unit tests for individual packages are colocated with their source instead —
see `packages/pricing/src/__tests__` for the current example. Keep that
convention: a test that only exercises one package belongs next to that
package, not here.
