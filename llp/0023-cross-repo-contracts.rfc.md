# LLP 0023: Cross-repo coordination — a shared corpus, a scope axis, and the contract type

**Type:** RFC
**Status:** Draft
**Systems:** Core, Engine, Designer
**Author:** Phil / Claude
**Date:** 2026-07-03
**Related:** 0000, 0001, 0002, 0003, 0007, 0008, 0015, 0016

## Summary

Neutral, and LLP itself, are single-repo by construction. But real products span
repos that are *not* a monorepo and must still agree — an API surface, a feature set,
a shared vocabulary. The running example: [`lifebot`](../../lifebot) (server) and
[`lifebot-iphone`](../../lifebot-iphone) (client) must hold one API contract between
them, and today nothing keeps it honest across the two trees.

This RFC proposes three moves, each cheap on its own and separable:

1. **Corpus location is a config pointer, not architecture.** `llpDir`
   ([`src/config.js`](../src/config.js), default `'llp'`) generalises to name a
   *shared* corpus — a host repo that carries all LLPs for a suite, or a separate
   "DNA" repo. "Where do the docs live" stops being a design question and becomes
   one config value.
2. **`Scope` — a third axis, orthogonal to type and role.** Which repo(s) an LLP
   governs: `Scope: lifebot` · `Scope: lifebot, lifebot-iphone` · `Scope: *`. Type
   carries a *default* scope-cardinality; a `contract` supports section-level `@repo`
   clauses so a per-party obligation is covered by that party's code.
3. **`contract` — a new LLP type in the *background* role.** A contract is **not** a
   request neutral builds. It is a shared, cross-repo **constraint** — authored in a
   human+LLM design discussion, immutable, and **cited** by other LLPs (`@ref …
   [constrained-by]`), exactly as a `decision` is. It carries the **canonical schema**
   (the shared shape). What neutral builds is the **per-repo requests** that cite it; the
   shared schema is what makes their independent implementations agree.

## Motivation — the repo is the cheap part; multi-repo awareness is the tax

The instinct is to fear "another repo." That's the wrong thing to fear. LLP types are
already open — [`src/llp.js`](../src/llp.js) parses the type straight out of the
filename (`FILE_RE`, no enum), so a `contract` type is a config line, not a code
change. And the canonical home is a config pointer (move 1). Both are nearly free.

The real cost *looks* like it sits elsewhere: **neutral has no multi-repo machinery at
all.** Every git op in [`src/git.js`](../src/git.js) takes one `repo` path; `@ref` is a
bare LLP number with no repo qualifier ([`src/refs.js`](../src/refs.js) `REF_RE`); config
has no field that reaches outside the local tree. The surprise of this design is that a
cross-repo contract needs **none** of that machinery. Because a contract is a *cited
background constraint* (move 3), not a work item, the only builds are ordinary **per-repo
requests** that reference it — each handled by that repo's own single-repo loop. Nothing
writes across a boundary; nothing needs a second git tree at write time. The whole
cross-repo problem reduces to **single-repo neutral + a shared corpus + a background
contract**.

The `Scope` axis is what lets one shared corpus serve many repos without confusing them
(move 2); the `contract` type is what carries the shared shape they agree on (move 3).

## Proposal

### 1. Corpus location is a config pointer

`llpDir` accepts a location that may sit outside the repo (an external path today; a
`remote#ref` later — OQ1). Default stays `'llp'`, so existing single-repo repos are
unchanged. A "host repo hosts all the LLPs for the suite" and "a separate DNA repo"
are then the *same mechanism* with a different pointer value — the choice no longer
belongs in the architecture.

### 2. `Scope` — an axis orthogonal to type and role

Today an LLP has a **type** (`contract`/`spec`/…) and a **role** (request / design /
background, via `config.roles`). `Scope` is a third, independent property: which
repo(s) the doc governs. Expressed in the metadata header, mirroring how role is
config-driven:

- `Scope: lifebot` — a request/design that **one** repo's loop builds.
- `Scope: lifebot, lifebot-iphone` — a **contract**: the repos it *governs* (informational
  — a contract is a constraint, not a work item, so this is applicability, not a build
  obligation).
- `Scope: *` — suite-wide (a principle/explainer/contract that binds everything).

**Type carries a default scope-cardinality:** a `contract` names ≥2 repos (a *shared*
constraint); a `spec`/`design` defaults to one (a single repo builds it); a `principle`
defaults to `*`. A default the header can always override.

`Scope` is what lets one shared corpus serve many repos: each repo's loop **filters to
`Scope ⊇ self` (or `*`)** and builds only *its own* requests, while every repo can read a
shared contract that governs it. No coverage is ever computed *over* a contract — it is
background; coverage is computed only over the per-repo requests that cite it, in their own
repos, by the ordinary single-repo invariant (LLP 0003).

### 3. `contract` — a shared background constraint (not a request)

A contract is **not** a multi-party request neutral builds. It is a **background** LLP —
LLP 0003's third role, alongside `decision`/`principle`: shared context that a
request/design `@ref`s as a **constraint**, never built directly. Concretely:

- **Authored in discussion, not by a tick.** A contract lands the way a `decision` does —
  through a human+LLM design session — and is **immutable** once accepted (LLP 0015). It
  is not minted by neutral and never appears in a backlog.
- **Cited, not covered.** Other LLPs reference it with `@ref … [constrained-by]`. Coverage
  is **never** computed over a contract (background is not built); it is computed only over
  the per-repo **requests** that cite it, in their own repos, by the existing single-repo
  invariant (LLP 0003).
- **It carries the canonical schema.** Its distinctive content — what makes it a `contract`
  and not a `decision` — is the **shared shape** (the OpenAPI schema, §Primary workflow):
  decided-content the citing requests generate from.

**"Neutral won't build them" needs no special-casing.** Background *never triggers* — LLP
0015 already notes "a decision is background, so the work is invisible," and a contract
inherits exactly that. It is invisible to `neutral backlog` and to design-first intake
(LLP 0016 fires on a `design`, never on a background type) purely by virtue of its role.

**What neutral builds is the per-repo requests that cite the contract.** A `lifebot`
feature request and a `lifebot-iphone` feature request — each `Scope:` its own repo, each
`@ref [constrained-by]` the contract — are picked up by their *own* repo's loop through the
ordinary single-repo pipeline. Because both cite the **same** contract schema, their
independent implementations agree by construction (§Primary workflow). No document is
duplicated, no tick writes across a boundary, and there is **no "contract reconciler"** —
the only thing that ever spans repos is a constraint that gets *read*.

### 4. Staged rollout — and why there is no expensive tier

| Level | What | Cost |
|---|---|---|
| **0 (today)** | Corpus in-repo; every LLP governs this repo. | — |
| **1** | Shared corpus; each repo's loop **filters to `Scope ⊇ self`** and builds *its own* requests against its own code — including requests that `@ref` a shared **contract**. | Almost free: an external read + a scope filter. **The single-repo write path is untouched.** |

There is **no Level 2.** An earlier draft posited a cross-repo "contract reconciler"; the
grill removed it. Because a contract is a *cited background constraint* (§3), the cross-repo
case is just Level-1 per-repo requests that happen to reference a shared doc. The only thing
that ever spans repos is an **optional, read-only adoption report** — "which repos' requests
have covered contract C" — computable wherever the parties are checked out, and never a
precondition for any build.

**No tick writes across a repo boundary.** Each repo's loop reads the passive shared corpus,
builds its own `Scope`-matched requests in-repo on the existing single-repo `reconcilePR`,
and never reaches into another tree. This is what keeps LLP 0008's authorization model
intact: a repo opts in by pointing *its own* config at the shared corpus; neutral never acts
on a repo that didn't. A separate "DNA" repo's only *job* beyond storage is hosting the
human+LLM contract discussions and the optional adoption report — a coordinator-by-observation,
never a cross-repo actor.

**Shipped is re-derived, not flipped (resolves OQ4).** LLP 0016 flips a design
`Accepted → Active` on build so the reconciler knows it shipped. That flip is a
*write into the tree the design lives in* — fine when design and code are co-located,
but in a shared corpus the code lands in the party repo while the design lives in the
corpus, so the flip would be a **cross-repo write-back**, defeating Level-1's cheapness.
Resolution: **for shared-corpus designs, do not write the flip — re-derive "shipped"
from party-repo coverage.** A shared design stays `Accepted` permanently in the corpus;
whether it is built is *computed* from whether the party's code `@ref`s it (which
`coverage.js` already does, LLP 0003). This keeps Level-1 writes strictly single-repo
(the impl PR writes only code + `@ref` into its own repo, and neutral never writes the
corpus), and it is *more* faithful to LLP 0002 — "re-derive the fact, never trust a
status field" — than the stored flip ever was. The design-first off-switch (LLP 0016,
"edge-true exactly once between approved and built") becomes **"covered in the party"**
rather than **"flipped to `Active`."** Cost banked: 0016's *shipped-is-Active* no longer
holds for shared designs — `Active` is vestigial / human-editorial for them; 0016 is
forward-ref'd on acceptance, not edited (LLP 0015).

### 5. Single shared corpus, not mixed local + shared

All suite LLPs live in **one** corpus, one number space, so `@ref LLP 0042` stays
globally unambiguous and the bare-number grammar (`REF_RE`) is untouched. A
lifebot-only spec just carries `Scope: lifebot`. The corpus is the DNA; `Scope` is
which organism expresses which gene. (The mixed alternative is in Rejected.)

## Primary workflow — a feature that needs a new endpoint

The use this must serve, end to end:

1. **Intent.** A human: "Feature X needs a new endpoint — `POST /foo` taking `{a, b}`,
   returning `{c}`."
2. **Discussion produces two kinds of doc in the corpus.** A human+LLM design session
   mints: **(a)** a **`contract`** (background), `Scope: lifebot, lifebot-iphone`, whose
   decided-content is the **canonical schema** for `/foo` (OpenAPI) — the shape, written
   **once**; and **(b)** a **per-repo request** for each side — a `lifebot` request "serve
   `/foo`" and a `lifebot-iphone` request "call `/foo`", each `Scope:` its own repo and each
   `@ref [constrained-by]` the contract. Neutral builds neither the contract nor the
   discussion — it builds the requests.
3. **Each loop builds its own request, in-repo.** lifebot's tick sees its uncovered request
   → the ordinary pipeline → implements the handler, **generating request/response types
   from the contract schema** → in-repo PR → covered. lifebot-iphone's tick does the same
   for its request, **generating Swift types from the same schema** (vendored). Neither
   writes the other; each is a normal single-repo build (Level 1).
4. **The shapes match by construction — not by agreement.** Both requests cite the **same**
   contract, and both implementations are **generated from its single canonical schema**, so
   a field rename or an added field is impossible to get half-right. There is one shape, in
   one place, and both sides are functions of it.

Change later is a new versioned schema + a new `contract` (LLP 0015), cited by new per-repo
requests; each side regenerates as part of covering its request. **Precision:** generation
guarantees *shape* — exactly what the ask needs — not *behaviour* (that the server populates
`c`, that the client handles errors). The **optional** add-on for behaviour is a **shared
conformance test derived from the schema** (server responses validated against it; a client
fixture checked) — the same optional-verifier pattern as the generated-artifact hash (OQ2).

This is what earns the `contract` a distinct **type**: it is the `decision`-like background
doc that *carries a canonical shared schema its citing requests generate from* — a listable
category (`llp-list contract`) surfacing every API shape the suite has agreed.

## Open questions

- **OQ1 — corpus distribution.** Single-source-by-reference (config points at one
  checkout / `remote#ref`; no copies) or vendored copies of the corpus in each repo?
  Leaning single-source: vendoring duplicates the docs and forces each copy to be kept
  current, for no gain. What *presents* the corpus at tick time (a sibling checkout? a
  fetch?) needs pinning.
- **OQ2 — artifact distribution & codegen scope.** The primary path is **settled**: an
  API contract is schema-backed with a single-source canonical schema both sides generate
  from (Primary workflow); prose contracts (feature-sets with no machine shape) are the
  secondary case. Still open: (a) per-party, does a side read the schema **by-reference**
  (a TS server at build time) or **vendor** a generated copy (a native iOS client)? —
  leaning per-party since toolchains differ; (b) the optional `hash(generated) ==
  hash(canonical)` conformance verifier — build it, or leave conformance to coverage +
  review + the optional shared test?; (c) is running the generator **in neutral's scope**,
  or does neutral only drive a human-authored generator's output?
- **OQ3 — how a request cites a contract. RESOLVED-ish (grill).** A contract is background
  and is **not** covered, so the earlier section-level `@repo`-coverage question dissolves —
  there are no per-clause obligations *inside* the contract to attribute. What remains for
  the spec: the citing per-repo request uses `@ref LLP <contract> [constrained-by]` (bare
  number, no `REF_RE` change), and — for a schema-backed contract — how that request points
  its codegen at the schema artifact in the corpus.
- **OQ4 — observe-source ≠ act-target. RESOLVED (grill).** Design-first intake
  (LLP 0016) fires on an `Accepted` design that now lives in the corpus while the PR
  lands in the party repo. Resolved by **re-derived-shipped** (§4): neutral never
  writes the corpus — a shared design stays `Accepted`, and "built" is re-derived from
  party coverage, so the "which tick writes the `Active` flip under immutability"
  problem dissolves (nobody does). Residual detail for the spec: where the
  `integration/<slug>` branch lives when the design is remote (leaning: in the party
  repo, since that is where the code and the branch protection are).
- **OQ5 — party discovery.** How does the host tick learn the set of party repos and
  where they are checked out? A new config surface (siblings), and its trust model.
- **OQ6 — adoption visibility.** A contract is not "covered," but it is useful to *see*
  which repos' requests have adopted a given contract (server done, client pending). That
  is the optional read-only **adoption report** (§4) — observability, not a gate. Build it
  now or defer? And does it live in the corpus/"DNA" tick or a standalone command?
- **OQ7 — cross-party atomicity.** A breaking change is a new `contract` + new per-repo
  requests; each side adopts independently, so there is a window where the server has
  covered its request and the client has not. neutral *surfaces* the skew (the adoption
  report) but cannot make adoption atomic — inherent to not-a-monorepo. Mitigation is
  compat discipline (backward-compatible schema changes, versioned endpoints). Accept as a
  stated limitation, or add a coordination primitive (hold every side's PR until all are
  green — which *would* reintroduce a cross-repo read/hold)?

## Rejected

- **Mixed local + shared corpora.** A local `llp/` per repo *plus* a shared one is
  more faithful to "cross-repo vs repo-specific live in different places," but yields
  two number spaces, so `@ref` needs a qualifier (`@ref DNA-0003`, `@ref LLP 0003@shared`)
  — a change to `REF_RE` and every tool that parses it, plus resolution ambiguity.
  Settled against: the `Scope` axis gives the *distinction* without a second number
  space. **Cost banked:** every suite LLP shares one number line, including repo-local
  ones.
- **Contract-as-package only.** Publish the contract as a semver'd artifact; consumers
  bump a version; neutral stays out of sync entirely. Battle-tested, but the design
  *rationale* stays homeless, and "in sync" becomes a version *range* — a weaker,
  fuzzier fact than an ancestry. Not chosen as the primary mechanism; may coexist as
  the distribution of a schema-backed contract (OQ2).
- **A shared sync ledger / a self-reported "in sync" flag.** The exact LLP 0002
  violation. The signal is the parties' live git state, re-derived each tick.
- **Qualified cross-repo `@ref` for every LLP from day one.** Pays the grammar cost
  for the 90% (repo-specific) case that never needs it. `Scope` + a single number
  space defers any ref-grammar change until a real need appears.

## Spawns on acceptance

Per house rules an `rfc` stays an `rfc` and spawns its decisions + spec:

- **decision** — corpus location is a config pointer; one shared corpus, one number
  space (generalise `llpDir`; the mixed alternative is rejected).
- **decision** — `Scope` is an axis orthogonal to type and role; type sets a default
  scope-cardinality; each repo's loop filters to `Scope ⊇ self`.
- **decision** — the `contract` type is **background** (a cited constraint), **not** a
  request: neutral never builds it; it carries the canonical schema; the per-repo requests
  that `@ref … [constrained-by]` it are what get built, each in its own repo.
- **decision** — **there is no cross-repo reconciler.** The cross-repo case reduces to
  Level-1 per-repo requests against a shared corpus plus a background contract; the only
  thing spanning repos is an optional read-only adoption report.
- **decision** — for corpus-hosted designs, "shipped" is **re-derived from the building
  repo's coverage**; 0016's `Active`-flip write-back is dropped (a single-repo
  optimization), keeping writes single-repo and staying closer to LLP 0002.
- **decision** — LLP 0015 immutability **extends to a contract's canonical schema**
  (decided-content): a schema change is a new versioned artifact + a new `contract`, cited
  by new per-repo requests. Shape agreement is by single-source generation; a
  `hash(generated) == hash(canonical)` verifier is at most optional (OQ2).
- **spec** — the `Scope:` header grammar; the `llpDir` external/shared config change;
  scope-filtered intake/coverage; the `contract` type + `config.roles` background mapping;
  and the optional adoption report + party discovery (OQ5, OQ6). Changes to `config.js`,
  `llp.js`, `refs.js`, `coverage.js`, and the observe/act split are implementation detail
  for the spawned plan.

## Constraints

- `@ref LLP 0002 [constrained-by]` — conformance is re-derived from coverage each tick,
  never a stored "in sync" flag or shared ledger; the optional generated-artifact hash
  check is likewise re-derived, not stored.
- `@ref LLP 0003 [constrained-by]` — `contract` is a **background** type (cited as a
  constraint, never covered); `Scope` filters the request/design/background sets so each
  repo builds only its own requests. The coverage invariant, change-set DAG, and
  ready-queue are untouched — coverage stays per-repo.
- `@ref LLP 0007 [constrained-by]` — generalises `llpDir` to an external/shared corpus
  and adds a `Scope` header; an optional party-discovery surface is needed only for the
  adoption report, not for any build. Today config reaches nothing outside the local tree.
- `@ref LLP 0008 [constrained-by]` — `Scope` is orthogonal to the
  request/design/background role taxonomy. Authorization is preserved: neutral never
  writes across a boundary, so "the label is the authorization" generalises to "a repo
  opts in by pointing *its own* config at the shared corpus"; the adoption report is
  read-only. No cross-repo *actor* is introduced at all.
- `@ref LLP 0016 [constrained-by]` — design-first intake's `Accepted` trigger fires
  from the shared corpus while the PR lands in the party repo (observe-source ≠
  act-target). For shared designs, 0016's stored `Active`-flip is **replaced by
  re-derived coverage** (§4, more faithful to LLP 0002); its "shipped is Active" gets a
  forward-ref on acceptance, not an edit.
- `@ref LLP 0015 [constrained-by]` — this RFC is the new request; on acceptance its
  decisions/spec forward-ref the parts of 0003/0007/0008 they extend. Immutability also
  **extends to a contract's canonical schema** (decided-content): schema change = new
  versioned artifact + new request — which is what structurally rules out drift.
- `@ref LLP 0001 [constrained-by]` — **no new reconciler is introduced**; per-repo
  requests ride the existing Observe → Diff → Act → Verify loop unchanged. Fewer moving
  parts, per 0001.
