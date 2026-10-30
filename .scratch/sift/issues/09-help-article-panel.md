# 09: Stretch — help article shown next to the reply

**What to build:** Next to the reply editor, the agent sees the help article the draft is based on, so they can check the draft against its source. A draft with no article is clearly labelled as ungrounded.

**Time box:** 6:00–6:40 (40 min)

**Blocked by:** 06, 07

**Status:** ready-for-agent

- [ ] The article's title and full text appear beside the reply editor when the triage result references one
- [ ] When the reference is null, the panel shows "Not grounded — review carefully"
- [ ] An invalid article reference never reaches this panel (already rejected in slice 06)
- [ ] API-level test covers: ticket detail returns the referenced article, and the ungrounded case
- [ ] README: note that the whole article set is placed in the prompt, and that retrieval with embeddings is the scaling path
