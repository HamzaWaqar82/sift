# 11: Optional — CI/CD with GitHub Actions

**What to build:** Only if every other slice is done. Every push is linted, type-checked and tested, and a push to the main branch deploys automatically. Hard stop at the end of the time box; if short, keep only the CI half and leave deploys manual.

**Time box:** 7:20–8:00 (40 min)

**Blocked by:** 10

**Status:** in-progress (awaiting GitHub secrets)

- [x] On every push and pull request: lint, type-check, tests against a Postgres service container, and an image build
- [ ] Fallback if time is short: the checks above only, with no deploy job (not needed: deploy job written)
- [ ] On the main branch: publish a commit-tagged image to GHCR
- [ ] Deploy over SSH using a dedicated key stored in a scoped GitHub environment; the server's production environment file is never touched by CI
- [ ] After deploy, the health endpoint is checked and the job fails if it is not healthy
- [x] README: record that there is no auto-rollback (rollback is redeploying an earlier tag) and that SSM with OIDC is the production-grade replacement for SSH


Notes: workflows pass actionlint (incl. shellcheck); typecheck + tests (105) pass locally without SEED_* vars. No lint script exists (lint step is conditional on an ESLint config). GHCR publish, SSH deploy and health check are unticked until a live run with the `production` environment secrets set.
