# 01: Deployed skeleton (app, Compose, HTTPS on AWS)

**What to build:** A hello-world version of the app that runs locally with one command and is live on a public HTTPS URL on AWS, deployed by hand. This surfaces hosting and certificate problems while there is still time to fix them. A README stub is started here.

**Time box:** 0:00–1:15 (75 min)

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] One command starts the app and database locally via Docker Compose; a migration step completes before the app starts
- [ ] A health endpoint reports the app is up and the database is connected
- [ ] `.env.example` documents every variable; the real `.env` (including the Gemini key) is gitignored and never committed
- [ ] An AWS EC2 instance with an Elastic IP runs the same Compose setup behind a reverse proxy; the public HTTPS URL serves the app and the certificate is valid (checked now, not later)
- [ ] The URL survives a reboot of the instance
- [ ] Deploying is documented as: pull the latest code and rebuild with Compose on the server
- [ ] README stub created with sections for: what was built, what was left out, known problem and fix, how to run locally, how to deploy
- [ ] README "left out" already lists: SES/real email delivery, threading, claiming, managed database, auto-rollback
