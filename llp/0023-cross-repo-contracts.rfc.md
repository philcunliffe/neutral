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
3. **`contract` — a new LLP type: a multi-party request.** Its coverage must be
   satisfied *per party*, and its cross-repo sync is a **re-derivable ground-truth
   fact** (ancestry / content hash), not a self-reported ledger — a direct
   generalisation of LLP 0002 and the LLP 0003 coverage invariant.

## Motivation — the repo is the cheap part; multi-repo awareness is the tax

The instinct is to fear "another repo." That's the wrong thing to fear. LLP types are
already open — [`src/llp.js`](../src/llp.js) parses the type straight out of the
filename (`FILE_RE`, no enum), so a `contract` type is a config line, not a code
change. And the canonical home is a config pointer (move 1). Both are nearly free.

The real cost sits elsewhere: **neutral has no multi-repo machinery at all.** Every
git op in [`src/git.js`](../src/git.js) takes one `repo` path; `@ref` is a bare LLP
number with no repo qualifier ([`src/refs.js`](../src/refs.js) `REF_RE`); config has
no field that reaches outside the local tree. Whatever the canonical home, neutral
must learn to *read a second tree*. So the design must (a) make the doc-sharing cheap
things cheap, and (b) concentrate the expensive multi-repo logic in one place and pay
for it only when a genuine cross-repo contract needs it.

The `Scope` axis is what lets us do both, because it draws the exact line between the
cheap case and the expensive one (see move 4).

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

- `Scope: lifebot` — repo-specific (a normal spec/design; governs one app).
- `Scope: lifebot, lifebot-iphone` — cross-repo (a contract; has **parties**).
- `Scope: *` — suite-wide (a principle/explainer that binds everything).

**Type carries a default scope-cardinality:** a `contract` *must* name ≥2 repos; a
`spec`/`design` defaults to exactly one; a `principle`/`explainer` defaults to `*`.
"Some types are cross-repo, some are repo-specific" falls out of this default — it is
not a hard property, and the header can always be explicit.

**Section-level scope (contracts only).** A contract has a server-side clause and a
client-side clause, covered by *different* repos' code. A `@repo lifebot` marker on a
heading scopes that clause; the contract is fully realised when *each* scoped section
is `@ref`'d by code in its own repo — the per-party coverage invariant, resolved at
the section level.

### 3. `contract` — a multi-party request

A contract generalises the two things neutral already does:

- **Coverage, per party.** A live request is covered iff code/design `@ref`s it
  (LLP 0003). A contract is covered iff *every party* `@ref`s it — server code
  fulfils the server clause, client code the client clause. A party that hasn't is a
  backlog item, exactly as today.
- **Sync, as ground truth.** Each party holds a pinned reference; "in sync" is the
  re-derivable fact `is-ancestor(canonical, party-copy)` or a content-hash match —
  the *same shape* as neutral's "done = `git merge-base --is-ancestor`" (LLP 0002).
  Drift → open a sync PR into the lagging party. That is a textbook reconciler, and
  it never trusts a stored "in sync" flag.

Both invariants are pure functions of git state; nothing about contracts violates
LLP 0002. That is the test of whether this belongs in neutral at all — and it passes.

### 4. Staged rollout — `Scope` draws the cost line

| Level | What | Cost |
|---|---|---|
| **0 (today)** | Corpus in-repo, every LLP governs this repo. | — |
| **1** | Shared corpus; **repo-specific** LLPs. Each tick reads the shared corpus, **filters to `Scope ⊇ self` (or `*`)**, runs the existing coverage/intake against its own code. | Almost free: an external read + a scope filter. **The single-repo write path is untouched.** |
| **2** | **Contracts** — per-party coverage + drift → sync PR. | The only case needing a cross-repo *read* and a cross-repo *write*. |

The Level-2 logic has a natural home: the **host / DNA tick**. Repo-A's tick stays
strictly single-repo (reads shared docs, writes only A). The corpus repo's own tick
is the one context that legitimately sees all parties checked out side by side, so it
runs the cross-repo coverage/sync reconciler. That also gives a separate DNA repo a
*job* — coordinator, not folder — which is the real answer to "why a second repo."

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

## Open questions

- **OQ1 — corpus distribution.** Single-source-by-reference (config points at one
  checkout / `remote#ref`; no copies, so nothing to drift) or vendored copies + a
  drift reconciler on the corpus itself? Leaning single-source: it dodges a
  second-order drift problem. What presents the corpus at tick time (a sibling
  checkout? a fetch?) needs pinning.
- **OQ2 — the contract's body.** Is a contract prose (a feature-set / behavioural
  agreement, sync = the doc), or does it wrap a machine artifact (OpenAPI / JSON
  Schema, sync = the schema file, and is codegen of clients/types in scope)? The type
  likely supports both; which is the *first* target — lifebot's API is schema-backed.
- **OQ3 — section-level attribution.** How does coverage attribute a code `@ref` in
  repo B to a contract *section* scoped to B? The `@repo` marker grammar, and how
  `refs.js`/`coverage.js` resolve per-clause rather than per-doc, need spec.
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
- **OQ6 — partial realisation.** Is a contract binary (covered only when *all* parties
  cover it), or does neutral track per-party partial state (server done, client
  pending) so a half-built contract is legible rather than just "uncovered"?

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
  scope-cardinality; contracts carry section-level `@repo`.
- **decision** — the `contract` type: a multi-party request; per-party coverage; sync
  as a re-derived ground-truth fact.
- **decision** — the staged rollout: Level-1 (repo-specific in a shared corpus, no new
  write path) precedes Level-2 (the contract reconciler on the host tick).
- **decision** — for shared-corpus designs, "shipped" is **re-derived from party
  coverage**; 0016's `Active`-flip write-back is dropped (a single-repo optimization),
  keeping Level-1 writes single-repo and staying closer to LLP 0002.
- **spec** — the `Scope:` header grammar and section-level `@repo`; the `llpDir`
  external/shared config change and party-discovery surface (OQ5); scope-filtered
  coverage/intake; and the Level-2 cross-repo observe / sync predicate (OQ1, OQ3, OQ4,
  OQ6). Changes to `config.js`, `llp.js`, `refs.js`, `coverage.js`, and the
  observe/act split are implementation detail for the spawned plan.

## Constraints

- `@ref LLP 0002 [constrained-by]` — cross-repo sync is a re-derived ancestry/hash
  fact, never a stored "in sync" flag or shared ledger.
- `@ref LLP 0003 [constrained-by]` — generalises the coverage invariant from
  single-repo to per-party, and adds `Scope` as a filter over the
  request/design/background sets; the change-set DAG and ready-queue are untouched.
- `@ref LLP 0007 [constrained-by]` — generalises `llpDir` to an external/shared corpus
  and adds `Scope` + (Level-2) a party-discovery config surface; today config reaches
  nothing outside the local tree.
- `@ref LLP 0008 [constrained-by]` — `Scope` is orthogonal to the
  request/design/background role taxonomy and the reconciler families; the contract
  reconciler is a new family member, run from the host tick.
- `@ref LLP 0016 [constrained-by]` — design-first intake's `Accepted` trigger fires
  from the shared corpus while the PR lands in the party repo (observe-source ≠
  act-target). For shared designs, 0016's stored `Active`-flip is **replaced by
  re-derived coverage** (§4, more faithful to LLP 0002); its "shipped is Active" gets a
  forward-ref on acceptance, not an edit.
- `@ref LLP 0015 [constrained-by]` — this RFC is the new request; on acceptance its
  decisions/spec forward-ref the parts of 0003/0007/0008 they extend, rather than
  editing what those decided.
- `@ref LLP 0001 [constrained-by]` — the contract reconciler follows the same
  Observe → Diff → Act → Verify loop as every other reconciler.
