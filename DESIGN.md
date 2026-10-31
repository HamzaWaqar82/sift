---
name: Sift
description: The jet-age ticket wallet. Every customer ticket is a coupon; every reply is a stamp a human applies.
colors:
  ground: "#f2f2f0"
  panel: "#ffffff"
  panel-2: "#f6f7f9"
  ink: "#0d1b3d"
  ink-2: "#34405e"
  ink-3: "#4a5370"
  rule: "#0d1b3d"
  rule-soft: "#c8ccd8"
  navy-tint: "#e3e7f1"
  navy-hover: "#eceff5"
  navy-press: "#1c2d5a"
  band-ink: "#c3cbe0"
  band-field: "#16264d"
  band-field-line: "#3a4a75"
  band-tab: "#172751"
  band-tab-line: "#2c3d68"
  band-tab-hover: "#22356a"
  jet: "#d7262d"
  jet-press: "#b31d23"
  jet-ink: "#b01c22"
  jet-tint: "#fbe8e8"
  carbon: "#4b2e83"
  lilac: "#d9cfee"
  lilac-soft: "#eee9f8"
  warn-ink: "#7a4b00"
  warn-tint: "#fbf0d6"
  ok-ink: "#19613f"
  ok-tint: "#e1f0e8"
typography:
  display:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "3.5rem"
    fontWeight: 700
    lineHeight: 0.9
    letterSpacing: "0.01em"
    fontFeature: "\"tnum\""
  headline:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.62rem"
    fontWeight: 600
    lineHeight: 1.375
  title:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 500
    lineHeight: 1.375
  body:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: "1.5rem"
    fontFeature: "\"kern\", \"liga\""
  body-sm:
    fontFamily: "Barlow, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  label:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: "1.1rem"
    letterSpacing: "0.08em"
  label-micro:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: "1rem"
    letterSpacing: "0.08em"
  stamp-word:
    fontFamily: "Barlow Condensed, Barlow, ui-sans-serif, sans-serif"
    fontSize: "1.35rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.12em"
  numeral:
    fontFamily: "JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    letterSpacing: "0"
    fontFeature: "\"tnum\", \"zero\""
rounded:
  stamp: "2px"
  control: "3px"
  coupon: "4px"
  pill: "999px"
spacing:
  hair: "4px"
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  band: "56px"
  views-bar: "44px"
components:
  button:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 15px"
    height: "36px"
  button-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
  button-sm:
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "30px"
  button-navy:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    rounded: "{rounded.control}"
    height: "36px"
  button-navy-hover:
    backgroundColor: "{colors.navy-press}"
  button-send:
    backgroundColor: "{colors.jet}"
    textColor: "{colors.panel}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "0 22px"
    height: "40px"
  button-send-hover:
    backgroundColor: "{colors.jet-press}"
  button-ghost-hover:
    backgroundColor: "{colors.navy-hover}"
    textColor: "{colors.ink}"
  button-disabled:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.ink-2}"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "40px"
  input-band:
    backgroundColor: "{colors.band-field}"
    textColor: "{colors.panel}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    height: "36px"
  coupon:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.coupon}"
  coupon-stub:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.carbon}"
  tab:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "0 14px"
    height: "26px"
  tab-navy:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
  tab-red:
    backgroundColor: "{colors.jet}"
    textColor: "{colors.panel}"
  tab-band:
    backgroundColor: "{colors.band-tab}"
    textColor: "{colors.band-ink}"
    height: "36px"
  tab-band-active:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
  stamp-open:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.stamp}"
    padding: "1px 6px"
  stamp-replied:
    textColor: "{colors.carbon}"
  stamp-closed:
    backgroundColor: "{colors.jet-tint}"
    textColor: "{colors.jet-ink}"
  urgency-high:
    backgroundColor: "{colors.jet}"
    textColor: "{colors.panel}"
    typography: "{typography.label-micro}"
    height: "20px"
  urgency-medium:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    height: "20px"
  urgency-low:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-2}"
    height: "20px"
  filter-chip:
    backgroundColor: "{colors.navy-tint}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.control}"
    height: "28px"
  filter-chip-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
  list-row:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.coupon}"
  list-row-selected:
    backgroundColor: "{colors.navy-tint}"
  carbon-copy:
    backgroundColor: "{colors.lilac}"
    textColor: "{colors.ink}"
    rounded: "{rounded.coupon}"
    padding: "16px"
  band:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    height: "56px"
---

# Design System: Sift

## Overview

**Creative North Star: "The Jet-Age Ticket Wallet"**

Sift is a wallet of airline coupons. Each customer ticket is a white coupon ruled in carrier-navy hairlines, with a stub that carries its number, perforations that tear it into sections, and tabs that sit on its top edge like folder tabs. A reply is not a toast or a checkmark: it is a rotated rubber stamp (SENT, with who and when) on a lilac carbon copy. State is applied to the paper, never hidden: closed tickets are stamped VOID, errors and 404s are void coupons, and disabled controls go dashed rather than vanishing.

The room is stock-white and navy, dense and calm, built for an agent who keeps it open all shift. A navy header band with a jet-red speed stripe frames everything; below it, the work surface is flat paper with one quiet coupon shadow. Colour is rationed: navy is the voice, carbon purple speaks only for real data (numbers, times, counts), and jet red is the alarm and the send. Condensed airline caps label every tab, stamp and field; one grotesk body carries the prose; a mono face carries the numerals.

It explicitly rejects the grey SaaS sidebar-and-feed helpdesk: no left nav column of icons, no card soup, no gradient chrome, no spinners.

**Key Characteristics:**
- Navy hairline coupons on a warm stock-white ground; flat, with one soft coupon shadow.
- Chamfered tabs on coupon heads and on the header band.
- Dashed perforations with half-circle notches split coupon sections and stubs.
- Rubber stamps (rotated, double-ruled) for status; small ruled stamps for status in lists.
- Carbon-purple tabular mono numerals for every ticket number, age, time and count.
- Jet red rationed to send, HIGH urgency, VOID/closed, and the band's speed identity.
- Lucide line icons at 1.5 stroke, 14-16px.

## Colors

A navy-on-paper palette: one dominant ink, one rationed alarm red, one data purple, and a lilac reserved for carbon copies.

### Primary
- **Carrier Navy** (ink): the voice of the whole system. Body text, hairline coupon rules, the header band, filled navy buttons and tabs, focus outlines. Also the primary rule colour, so text and structure are the same ink.

### Secondary
- **Jet Red** (jet): the send button, HIGH urgency chips and tabs, the CLOSED board column tab, the 404/error code tab, the speed stripe on the band, the active view tab's 3px underline, the logomark's last sieve bar, the unsaved-view dot, and the focus outline inside the band. Pressed/busy state uses **Jet Press**. Red text on light grounds always uses **Jet Ink** (never jet itself); **Jet Tint** backs the CLOSED list stamp.

### Tertiary
- **Carbon Purple** (carbon): numerals only (ticket numbers, ages, times, counts, character counters, article slugs), the REPLIED stamp, the DRAFT rubber stamp, and the "AI draft, edited" label on carbon copies.
- **Carbon Lilac** (lilac): sent replies (carbon copies), the SENT stamp backing, text selection. **Lilac Soft** is the lighter companion.

### Neutral
- **Stock White** (ground): the page.
- **Coupon White** (panel): every coupon, input and popover.
- **Rail Grey** (panel-2): coupon stubs, table heads, the saved-views bar, board columns, disabled buttons.
- **Ink 2 / Ink 3** (ink-2, ink-3): secondary text, and tertiary text plus placeholders and input borders.
- **Soft Rule** (rule-soft): in-coupon row dividers and quiet list-row borders (non-text).
- **Navy Tint / Navy Hover** (navy-tint, navy-hover): selected row and active filter chip; row hover.
- **Band Ink** (band-ink): secondary text on the navy band. The band also uses deeper navies for its search field, inactive tabs and their lines (band-field, band-field-line, band-tab, band-tab-line, band-tab-hover); these are hardcoded in components, not theme tokens.
- **Semantic**: warn-ink on warn-tint (ungrounded draft notice), ok-ink on ok-tint (success), info reuses ink on navy-tint.

### Named Rules
**The Rationed Red Rule.** Jet red marks what must happen now (send, HIGH, VOID) and the band's identity. Never use it for decoration, links, generic primary actions or hover states.

**The Real Numbers Rule.** Carbon purple in tabular mono is reserved for real data. If a value is not a number, id, time or count, it is not carbon.

**The AA Pair Rule.** Every text/background pair is documented at WCAG AA or better in globals.css. Red text on light grounds uses jet-ink; white text on jet is 5.0:1.

## Typography

**Display Font:** Barlow Condensed (600, 700; with Barlow, ui-sans-serif)
**Body Font:** Barlow (400, 500, 600; with ui-sans-serif, system-ui)
**Label/Mono Font:** JetBrains Mono (400, 500; with ui-monospace) for numerals

All three are self-hosted via @fontsource. The scale is a fixed rem scale (ratio about 1.2) around a 15px body: 11, 12, 13, 15, 18, 21.6, 25.9, 31.1px.

**Character:** Condensed airline caps for anything that labels (tabs, stamps, buttons, field labels) against a plain, readable grotesk for anything a human wrote; mono numerals make every ticket number look printed.

### Hierarchy
- **Display** (Barlow Condensed 700, 2.75rem mobile / 3.5rem desktop, 0.9): the ticket number on the coupon stub only, carbon purple, with a shrunken raised "#".
- **Headline** (Barlow 600, 1.35rem to 1.62rem, snug): ticket subject on the open coupon. Void-coupon titles use the caps role at 1.62rem instead.
- **Title** (Barlow 500, 15px, snug): row subjects in the wallet list, table and board cards.
- **Body** (Barlow 400, 15px / 24px, kern + liga): customer messages, replies, drafts. Carbon copies cap at 72ch.
- **Body small** (Barlow 400, 13px / 20px): customer / owner lines, table cells, hints.
- **Label** (Barlow Condensed 600-700, 11-13px, uppercase, 0.05-0.08em tracking): tabs, buttons, stamps, field labels ("RECEIVED", "OWNER"), section heads. Field labels use 11px in ink-3.
- **Stamp word** (Barlow Condensed 700, 1.125-1.62rem, 0.12em tracking, uppercase): SENT, OPEN, REPLIED, VOID on rubber stamps.
- **Numeral** (JetBrains Mono 400-500, 11-12px, tabular + slashed zero, carbon): every number.

### Named Rules
**The Caps Label, Sentence Body Rule.** If it names a thing, it is condensed caps; if a person wrote it, it is sentence-case Barlow. Do not set prose in caps or labels in body type.

## Layout

A sticky navy band (56px on md+, wrapping taller on mobile with search on its own row and view tabs below) sits over everything. On list pages a 44px saved-views bar sticks under it (rail grey, horizontally scrollable with fade + chevron cue at the edges).

The inbox is a split pane: the wallet list on the left (minmax(22rem, 28rem), 30rem at xl), sticky and independently scrolling with a sticky pager footer, separated by a soft rule from the open coupon on the right (padding 24-32px). On narrow screens the pane is hidden and opening a ticket replaces the list, with a ghost "back" button. Table and board views sit in a centered container capped at 110rem with 12-24px gutters. The ticket view puts the reply composer and its source article side by side (1.2fr / 1fr) from lg (xl when embedded in the pane).

Spacing follows Tailwind's 4px grid, kept tight: list coupons are 6px apart with 6px vertical padding; coupon interiors use 16-24px; sections in the ticket view stack 20px apart. Popovers become bottom sheets under 40rem. The board is a horizontal snap-scroller of 85vw columns on mobile and a grid on lg.

## Elevation & Depth

Flat paper with a single, very soft lift. Depth comes from hairline navy rules and tonal stubs, not shadow. Only full coupons and the selected list row carry the coupon shadow; quiet coupons, rows and cards are flat with a soft rule. Popovers and tooltips (the only floating layers) get the stronger pop shadow.

### Shadow Vocabulary
- **Coupon** (`box-shadow: 0 1px 2px rgb(13 27 61 / 0.06), 0 3px 10px -4px rgb(13 27 61 / 0.12)`): resting coupons and the selected wallet row.
- **Pop** (`box-shadow: 0 4px 10px -2px rgb(13 27 61 / 0.14), 0 14px 32px -8px rgb(13 27 61 / 0.22)`): filter popovers and tooltips.

### Named Rules
**The One Lift Rule.** Paper does not float. Hover changes border and tint, never shadow; only popovers rise.

## Shapes

Near-square, printed-paper geometry: coupons at 4px, controls at 3px, small stamps at 2px. The only full circles are perforation notches, the avatar and radio marks. Distinctive silhouettes are cut, not rounded: tabs have 7px chamfered top corners (clip-path), urgency chips have a single 4px chamfer at top-left, and the logomark is a coupon with side notches.

Borders are structural: 1px navy for coupons, 1.5px for buttons and stamps, 2px plus a 1px offset outline for rubber stamps. Dashed lines mean a tear or an absence: 1.5px dashed perforations, dashed stub dividers, dashed disabled buttons, and dashed "no article yet" placeholders.

## Components

### Buttons
Tactile and square, labelled in condensed caps.
- **Shape:** gently squared (3px), 1.5px navy border, 36px tall (30px small).
- **Default:** coupon white with navy label; hover inverts to filled navy with white text; active nudges down 1px.
- **Navy:** filled navy, hover deepens to navy-press.
- **Send:** jet red, 40px tall, 700 weight, wider padding; hover jet-press. The only red button.
- **Ghost:** borderless; hover takes navy-hover.
- **Disabled:** rail grey with dashed ink-3 border and ink-2 label (stays readable). Busy filled buttons keep their hue.
- **On the band:** small outlined white button that fills white on hover.
- **Motion:** colour transitions 160ms ease-out, transform 120ms.

### Chips
- **Active filter chip:** navy-tint with navy border, 28px, 13px medium text and an X; hover fills navy.
- **Filter trigger:** 32px outlined control with condensed caps label, summary and chevron; opens a native popover listing options with square (multi) or round (single) marks.
- **Urgency tab:** 20px chamfered chip in condensed caps: HIGH red filled, MEDIUM navy outline, LOW soft outline in ink-2.

### Cards / Containers (Coupons)
- **Corner Style:** 4px.
- **Background:** coupon white; stub in rail grey.
- **Shadow Strategy:** coupon shadow on full coupons; quiet coupons are flat with a soft rule.
- **Border:** 1px navy (soft rule for quiet coupons and list rows).
- **Internal Padding:** 16px mobile, 20-24px desktop.

### Inputs / Fields
- **Style:** coupon white, 1px ink-3 border, 3px radius, 40px min height, 15px text.
- **Focus:** border goes navy with a 1px navy ring (box-shadow), no outline glow.
- **Error:** jet-ink border and ring. **Disabled:** rail grey, ink-3 text.
- **Labels:** 12px condensed caps in ink-2 above the field.
- **Band search:** deep-navy field with a slate line, white text, a "/" kbd hint; focus turns the border white with a white ring.

### Navigation
- **Header band:** navy, wordmark left, view tabs, search, New ticket, avatar and sign-out right; a jet speed stripe (three white slashes then a red bar, 6px tall) runs along the top right edge.
- **View tabs:** chamfered band tabs in deep navy with band-ink labels and Lucide icons; the active tab turns stock white (joining the page like a wallet folder) with a 3px jet underline.
- **Status tabs:** coupon tabs over a navy rule with carbon counts; active is navy filled.
- **Saved-views bar:** rail grey, 44px, pinned and saved views as quiet 32px items, "Save view" outlined.

### Coupon Tab (signature)
A 26px chamfered tab sitting on a coupon's top rule (tabs overlap the rule by 1px). Tones: white (default), navy, red (HIGH urgency, CLOSED, error codes), ground (not triaged), band. Outline is drawn with layered pseudo-elements so the chamfer keeps a crisp 1px navy edge.

### Perforation (signature)
A 1.5px dashed navy rule with two half-circle notches (16px) cut into the coupon edges in the ground colour. Horizontal between coupon sections; vertical between stub and body from md up.

### Stamps (signature)
- **List stamp:** small ruled stamp in condensed caps, 1.5px border in currentColor: OPEN navy, REPLIED carbon, CLOSED jet-ink on jet-tint.
- **Rubber stamp:** rotated -3 to -7 degrees, 2px border plus 1px outline offset 2px, word plus mono meta line. Variants: SENT/OPEN navy, DRAFT/REPLIED carbon, VOID jet-ink.
- **Landing:** the one authored motion. A just-sent SENT stamp lands from 1.55x scale and -14 degrees to rest over 240ms on an expo-out curve (cubic-bezier(0.16, 1, 0.3, 1)). Reduced motion shows it in place.

### Carbon Copy
A sent reply on lilac with a carbon-tinted border, a dashed carbon divider under the header (sender, and "Written by hand" / "AI draft, edited" / "AI draft, unedited"), body capped at 72ch, and the SENT rubber stamp at right.

### Wallet Row
A mini coupon: 4rem stub (number + age in carbon mono, rail grey) behind a dashed divider, then subject with status stamp and customer / owner with the triage marker. Hover: navy border and navy-hover tint. Selected: navy-tint with coupon shadow, and the stub inverts to navy with white numerals. Untriaged rows show a hollow 8px dot rather than chips.

### Feedback
Loading is a gentle 1.4s shimmer skeleton (never a spinner). Errors and 404s are Void coupons: a red code tab, the wordmark, a VOID rubber stamp and actions. Iconography is Lucide at stroke 1.5 throughout.

## Do's and Don'ts

### Do:
- **Do** put every ticket in a coupon: navy hairline, 4px corners, tabs on top, perforation between sections.
- **Do** set every number, id, time and count in carbon tabular mono (`.num`).
- **Do** show state as a stamp: ruled stamps in lists, rotated rubber stamps on the open coupon, VOID for closed and errors.
- **Do** keep red to send, HIGH, VOID/closed and the band identity, and use jet-ink for red text.
- **Do** label in condensed caps (0.06-0.08em) and write prose in sentence-case Barlow.
- **Do** keep transitions to 150-160ms ease-out colour changes; the stamp landing is the only authored motion, and reduced motion removes it.
- **Do** use Lucide icons at 1.5 stroke, 14-16px.

### Don't:
- **Don't** build a grey SaaS sidebar-and-feed helpdesk layout.
- **Don't** use spinners; use the skeleton shimmer.
- **Don't** hide unavailable actions; show them dashed with a reason.
- **Don't** add shadows on hover or new elevation levels beyond coupon and pop.
- **Don't** round corners past 4px or use pill buttons.
- **Don't** use carbon purple or mono for non-data text.
- **Don't** make it dark-only; the paper world is the default.
