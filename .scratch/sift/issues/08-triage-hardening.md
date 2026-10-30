# 08: Triage hardening (daily cap, redaction, regenerate, list badges)

**What to build:** Make triage safe and cheap: a daily call cap, redaction of personal data before it leaves the app, admin-only regenerate, and category and urgency badges in the list for triaged tickets. This is the first slice to trim if time runs short.

**Time box:** 5:15–6:00 (45 min)

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] A daily cap on provider calls from configuration; at the cap, triage is refused with a clear message and replying still works
- [ ] Customer email addresses and phone numbers are removed from the text before it is sent to the provider
- [ ] Only admins can regenerate a triage; an agent attempting it gets 403
- [ ] The list shows category and urgency for tickets that have a stored valid result
- [ ] API-level tests cover: cap reached, cap resets next day, redaction applied to the text passed to the provider, agent 403 on regenerate, admin regenerate replaces the stored result
- [ ] README: known problem documented — two simultaneous triage requests can overshoot the cap because the check and the count are not atomic; fix is a single atomic counter update that reserves a slot before calling
- [ ] README: note that on a free-tier Gemini key prompts may be used by the provider, so production should use a paid key
