# CLAUDE.md

This project turns a client inquiry (PDF/DOCX) plus supplied screenshots into a
priced offer. **You (Claude Code) are the analyst.** The TypeScript code never
calls an LLM API: it only extracts text, validates what you write, and does the
deterministic work (IDs, quote verification, stats, and later estimates).

Hard rules:

- Do **not** add any LLM SDK or HTTP call to an LLM provider (Anthropic, OpenAI or
  any other). No API keys, no `LLM_*` env vars. If a step needs judgement, you do it
  and write a JSON file; if it needs determinism, it goes in TypeScript.
- Never hand-edit derived fields (`id`, `ordinal`, `stats`, `source.page`,
  `source.quoteVerified`, `screenshots.json`). Fix the input and re-run the tool.
- Every JSON file you write must pass its validator before you move on.

## Layout

```
data/inquiry/                 client documents (.pdf / .docx)
data/screenshots/desktop/     screenshots of the desktop design/site
data/screenshots/mobile/      screenshots of the mobile design/site
data/output/                  every generated artifact (see pipeline)
src/ingestion/                PDF (pdf-parse) and DOCX (mammoth) text extraction
src/requirements/             schema.ts (Zod), pipeline.ts (draft -> requirements),
                              validate.ts, ids.ts, sourceIndex.ts, text.ts
src/screenshots/manifest.ts   screenshot scan + manifest schema
src/coverage/                 schema.ts (Zod) and validate.ts for coverage.json
src/index.ts                  CLI (all npm scripts go through it)
```

Commands: `npm run typecheck` after any code change. All commands accept
`--flag <path>` overrides; run `npx tsx src/index.ts` for usage.

## Pipeline

| # | Who | Command / action | Output (in `data/output/`) |
|---|-----|------------------|----------------------------|
| 1 | TS | `npm run extract -- --input data/inquiry/<file>` | `requirements.source-text.json`, `requirements.source-text.txt` |
| 2 | You | read the source text (and image-only pages of the original) | — |
| 3 | You | write the draft | `requirements.draft.json` |
| 3b | TS | `npm run requirements:build` | `requirements.json` |
| 4 | TS | `npm run requirements:validate` | (report) |
| 5a | TS | `npm run screenshots` | `screenshots.json` |
| 5b | You | view each screenshot, compare against requirements | — |
| 6 | You | write coverage | `coverage.json` |
| 7 | TS | `npm run coverage:validate` (estimates: not implemented yet) | (report) |
| 8 | You | write the offer | `offer.md` |

Why a draft: you author the requirements' content, but the stable `REQ-xxxxxxxx`
IDs (hash of section + verbatim quote), page/section provenance, quote
verification and stats must be computed, not written by hand.
`requirements:build` does that and writes `requirements.json`.

---

## Step 1: Extract

```
npm run extract -- --input data/inquiry/fitme.pdf
```

- PDF: one segment per physical page (`page` = page number). Repeated
  headers/footers are stripped.
- DOCX: paragraph-aligned chunks of ≤ 8000 chars, `page: null`.
- Read `requirements.source-text.txt`: it has the same text as the JSON with
  `===== segmentIndex N | page P =====` markers, so you can quote exactly without
  JSON escaping. The `sha256` in its header goes into your draft.

## Step 2: Read the material

- Read the whole `.txt` before writing anything. Note section headings
  (e.g. `6. Karta produktu — kluczowy zakres`) and platform parts
  (e.g. `CZĘŚĆ B — WERSJA MOBILNA`), because they set section and platform scope
  for everything under them.
- **Pages with little or no text** (the build reports them as `PAGE_WITHOUT_TEXT`;
  for `fitme.pdf` these are pages 7–10) are usually mockups or scans. Open the
  original PDF on those pages with the Read tool (`pages: "7-10"`) and look at them.
  Requirements that exist only in images cannot be quote-verified; see step 3.

## Step 3: Write `requirements.draft.json`

Schema: `RequirementsDraftSchema` in `src/requirements/schema.ts`.

```json
{
  "draftVersion": 1,
  "documentSha256": "<sha256 from the source text>",
  "author": "claude-code",
  "segments": [
    {
      "segmentIndex": 1,
      "requirements": [
        {
          "title": "…",
          "description": "…",
          "type": "visual",
          "area": "global",
          "priority": "required",
          "platforms": ["all"],
          "visualVerification": "possible",
          "conditions": null,
          "section": "1. Cel projektu",
          "sourceQuote": "exact fragment from this segment"
        }
      ]
    }
  ]
}
```

Group requirements under the `segmentIndex` their quote comes from, in document
order. Every field is required; use `null` where allowed instead of omitting.

### Extraction rules

1. **Atomic.** One requirement is one thing that can be delivered and estimated on its own.
   - Split enumerations: "Icons: search, account, wishlist (optional), cart with
     counter" is **four** requirements.
   - Split compound sentences joined by "and", commas or slashes when each part
     could be built, priced or dropped on its own.
   - Never merge independent requirements, even similar or adjacent ones.
   - Every table row describing a section/feature yields at least one requirement;
     split further if the row lists independent features.
2. **No invention.** Extract only what the document states or directly asks for.
   No best practices, implied tasks or assumptions. Keep vague text vague.
3. **Keep non-visual requirements.** Constraints, assumptions, process
   expectations (e.g. "design approved in Figma before implementation"), SEO
   preservation, integrations, performance targets, testing expectations and
   "must not" rules are requirements too.
4. **Optional scope vs optional user behaviour.** Words such as "opcjonalnie" or
   "optional" alone do not make a requirement optional. Distinguish:
   - **Optional project scope**: the client says implementing the feature itself
     is optional, separately priced, nice-to-have or may be omitted ("ulubione
     (opcjonalnie)", "if possible", "jeśli możliwe", "nice to have", "to be
     priced separately as an option") -> `priority: "optional"`.
   - **Optional user behaviour**: the feature must support an optional action or
     value for the end user (optional account creation, optional review photo,
     optional company details, …) -> `priority: "required"`. Keep the optional
     behaviour in `description` or `conditions`.

   Otherwise `"required"`.
5. **Conditions:** if it depends on something ("only when stock is low", "if the
   system supports it", "range to be agreed based on WooCommerce attributes"),
   put that condition in `conditions`, else `null`.
6. Skip the document title, metadata, marketing descriptions of the client and
   instructions on how to format the quote, unless they state something to be
   built or a constraint on the work. An instruction on how the quote must be
   broken down (e.g. "UX/UI, desktop, mobile, optional items") is not a
   requirement, but **the offer must follow it** (step 8).

### Field guide

- `title`: short imperative name, in the document's language.
- `description`: 1–3 self-contained sentences in the document's language, with
  concrete values (numbers, labels, lists) from the source.
- `type` (dominant one):
  - `visual`: look & feel, layout, styling, hierarchy, imagery, design deliverables.
  - `functional`: user-facing behaviour or feature logic.
  - `technical`: platform, architecture, CMS editability, code/plugin constraints,
    SEO mechanics, accessibility, testing.
  - `integration`: payment, shipping, analytics, ERP/warehouse, third-party
    services, preserving existing integrations.
  - `content`: copy, editorial content, blog/guides, texts to be provided or structured.
  - `performance`: speed, Core Web Vitals, image optimization, lazy loading, layout shift.
- `area`: one of `RequirementAreaSchema`. Use `mobile` only for mobile-wide concerns
  with no more specific area: a mobile product-page requirement is
  `area: "product"`, `platforms: ["mobile"]`. Use `process` for design approval,
  reporting, testing scope.
- `platforms`: `["desktop"]`, `["mobile"]` or `["all"]`. Respect "desktop version"
  / "mobile version" parts; global assumptions are `["all"]`.
- `visualVerification`: can it be checked on a mockup/screenshot?
  `possible` (fully), `partial` (look yes, behaviour no), `impossible` (backend,
  SEO, integration, process).
- `section`: nearest heading, or `null`. The build overrides it with the numbered
  heading found around the verified quote.
- `sourceQuote`: the **shortest exact contiguous fragment** of that segment that
  expresses the requirement, copied character for character. Do not fix typos,
  translate or paraphrase, and do not join fragments with "...". Stay within one
  line of the `.txt` where possible (line breaks and bullets are normalized, but
  a fragment spanning a page break will not match). When several requirements
  come from one sentence, each gets its own specific fragment
  (e.g. `"ulubione (opcjonalnie)"`).
- Requirements that appear only in images (image-only pages): put them under
  that page's `segmentIndex`, and use a short literal description of the visible
  label as `sourceQuote`. They will be reported as `QUOTE_NOT_FOUND`, which is
  expected. List them for the user in your summary.

### Build and fix loop

```
npm run requirements:build
npm run requirements:validate
```

Review every warning from the build:

- `QUOTE_NOT_FOUND`: the quote is not verbatim. Fix `sourceQuote` in the draft
  unless it is an image-only requirement.
- `QUOTE_FOUND_ON_OTHER_PAGE`: move the item to the correct `segmentIndex`.
- `DUPLICATE_REQUIREMENT_DROPPED`: remove the duplicate from the draft.
- `UNKNOWN_SEGMENT`: wrong `segmentIndex`.
- `PAGE_WITHOUT_TEXT`: confirm you looked at that page visually.

Repeat until the build has no warnings except the ones you can justify, and
`requirements:validate` prints `OK`. Then tell the user the totals and anything
left unverified.

## Step 5: Screenshots

1. Put images in `data/screenshots/desktop/` and `data/screenshots/mobile/`
   (subfolders below those are fine; `.png .jpg .jpeg .webp .gif`). Files outside
   a `desktop`/`mobile` folder get `platform: "unknown"`; ask the user or move them.
2. `npm run screenshots` writes `screenshots.json`. Each screenshot gets a
   content-derived ID `SCR-xxxxxxxx`, plus platform, size and sha256. Re-run it
   whenever screenshots are added, removed or changed.
3. Open every screenshot with the Read tool and compare it against
   `requirements.json`, requirement by requirement. For each one, check what the
   screenshots actually show; don't infer behaviour you can't see.

### Project rule (fitme): design direction and desktop-to-mobile

- **Design direction: pattern 01 "Minimal elegance"** ("Czysta forma. Maksimum
  spokoju."). Inquiry page 6 shows the same layout in 10 colour variants
  (01 Minimal elegance … 10 Artistic); the client keeps the layout "z małymi
  zmianami" but changes the colours. The user chose 01. Judge colour/palette/mood
  requirements against 01, and base all design work (desktop tweaks and mobile)
  on it.
- The supplied screenshots are the **desktop** design (they match inquiry
  pages 7–10). **No mobile screenshots are supplied.** The mobile version is
  designed later from the desktop screenshots, the inquiry's mobile requirements
  and the desktop visual language.
- Mobile-only requirements (`platforms: ["mobile"]`) are therefore
  `not_verifiable` (mobile design still to be done), never `missing` just because
  no mobile screenshot exists, and never `covered`/`partial` from desktop
  screenshots. Desktop screenshots may be cited in `notes` as design context.
  `coverage:validate` enforces this while there are no mobile screenshots.
- Mobile functional requirements (sticky add-to-cart, bottom-sheet filters,
  responsive navigation, touch targets, scroll behaviour, …) stay separate
  requirements. Do not invent mobile functionality the inquiry does not state.

## Step 6: Write `coverage.json`

Schema: `CoverageDocumentSchema` in `src/coverage/schema.ts`.

```json
{
  "schemaVersion": 1,
  "documentSha256": "<document.sha256 from requirements.json>",
  "author": "claude-code",
  "assessedAt": "2026-09-29",
  "assessments": [
    {
      "requirementId": "REQ-1939E374",
      "status": "partial",
      "confidence": "medium",
      "evidence": [{ "screenshotId": "SCR-BAA33A06", "note": "hero section, top of page" }],
      "gaps": "No Pilates/yoga imagery; palette reads as generic fitness.",
      "notes": null
    }
  ]
}
```

Rules, enforced by `coverage:validate`:

- Exactly one assessment for **every** requirement, with no unknown IDs.
- `covered`: fully shown. `partial`: shown but incomplete or different.
  `missing`: visually checkable but not in any screenshot. `not_verifiable`: cannot
  be judged from images.
- `covered` and `partial` need ≥ 1 `evidence` entry with a concrete `note` (which
  element/region).
- `partial` and `missing` need `gaps`.
- `visualVerification: "impossible"` means the status must be `not_verifiable`.
  For `possible`, prefer `missing` over `not_verifiable`.
- Evidence should match the requirement's platform (a mobile requirement is not
  `covered` by desktop screenshots alone; the validator warns). If there are
  **no** screenshots for that platform at all, the validator errors on
  `covered`/`partial`/`missing` and expects `not_verifiable`.
- `confidence`: `low` when the screenshot is ambiguous, cropped or low-resolution.

Run `npm run coverage:validate` until it prints `OK`. It also fails if a
screenshot file changed or disappeared since `screenshots.json` was built.

## Step 7: Estimates

Deterministic estimation is **not implemented yet**. When it is, it must live in
TypeScript (e.g. `src/estimation/`), read `requirements.json` + `coverage.json`,
and write `estimate.json`. Until then, do not present hours or prices as if a
tool computed them. If the user supplies rates or hours, cite them as the
user's figures.

## Step 8: Write the offer (`data/output/offer.md`)

Build it only from validated artifacts:

- Follow any breakdown the inquiry asks for (for `fitme.pdf`: UX/UI design,
  desktop implementation, mobile implementation, optional items priced separately).
- Scope: list requirements grouped by that breakdown, then by `area`. Reference
  IDs (`REQ-…`). Put `priority: "optional"` items in their own section.
- Use coverage status to describe work: `covered` means the design exists
  (implementation only), `partial` or `missing` means design work is still needed,
  and `not_verifiable` is backend/process work, except mobile-only items with no
  mobile screenshots, which are mobile design + implementation work.
- Mobile UX/UI design (from the desktop design, direction 01) is its own scope
  item.
- Assumptions and open questions: every `conditions` value, every unverified
  quote, every image-only requirement, low-confidence assessments.
- Pricing: from `estimate.json` once it exists; otherwise leave clearly marked
  placeholders.
- Write in the inquiry's language unless the user says otherwise.
- Don't add scope that isn't in `requirements.json`.

## Changing the code

- Schemas are the contract. If you change one, update this file and bump
  `INSTRUCTIONS_VERSION` in `src/requirements/pipeline.ts` when the authoring
  rules change.
- Keep ID derivation (`src/requirements/ids.ts`) and text normalization
  (`src/requirements/text.ts`) stable, because changing them changes every `REQ-` ID.
- Run `npm run typecheck` before finishing.
