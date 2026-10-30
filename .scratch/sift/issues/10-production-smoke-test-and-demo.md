# 10: Production smoke test and demo rehearsal

**What to build:** Confirm the whole flow works on the public URL, finish the README, and rehearse the 15-minute walkthrough.

**Time box:** 6:40–7:20 (40 min)

**Blocked by:** 04, 05, 07, 08, 09

**Status:** ready-for-agent

- [ ] Latest code deployed by hand to the server; health endpoint is green
- [ ] On the public URL: sign in as agent and admin; post two sample emails through the webhook; triage one live; edit and send a reply; confirm the sender and time are recorded
- [ ] Agent gets 403 on reassign and admin succeeds, shown on the live URL
- [ ] A few seeded tickets are pre-triaged so the demo does not depend on provider latency
- [ ] README completed: what was built, what was left out, trade-offs, free-tier data risk, one known problem and its fix, how to run locally, how to deploy, production path (SSM with OIDC instead of SSH, a secrets manager, managed database)
- [ ] A written demo script covering the 15 minutes is in the repo
- [ ] A full run-through of the demo is done once end to end
