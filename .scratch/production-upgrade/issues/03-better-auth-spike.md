# 03: Better Auth spike

**What to build:** A time-boxed (about 2 hours) throwaway experiment answering one question: can Better Auth's user model map onto the existing integer-id `users` table? Record the outcome as a decision in the spec. The alternative is a separate auth user table with a text id, linked one-to-one to `users`.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] A seeded user signs in through Better Auth in the spike, or the specific blocker is identified
- [ ] Confirms existing bcrypt hashes can be verified
- [ ] Decision and the chosen mapping are written into the spec's identity section; spike code is not merged
