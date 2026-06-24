// @ts-check
// Coverage invariant: every live REQUEST LLP must be @ref'd by a DESIGN LLP
// (planned) or by code (already realized). Uncovered requests are the Designer
// reconciler's backlog. Roles are config-driven so this fits any project.
// @ref LLP 0003#coverage-invariant [implements] — inverse-of-ref-check coverage
import { needsCoverage, isDesignType } from './llp.js'
import { DEFAULT_CONFIG } from './config.js'

/** @import { Llp, CoverageResult, NeutralConfig } from './types.d.ts' */

/**
 * @param {Llp[]} llps
 * @param {Set<number>} [codeRefs]  LLP numbers referenced by source (realized)
 * @param {NeutralConfig} [config]
 * @returns {CoverageResult}
 */
export function coverage(llps, codeRefs = new Set(), config = DEFAULT_CONFIG) {
  const designs = llps.filter(l => isDesignType(l, config))

  /** @type {Map<number, string[]>} request LLP number -> design LLP ids covering it */
  const refMap = new Map()
  for (const d of designs) {
    const id = String(d.number).padStart(4, '0')
    for (const n of d.refs) {
      const arr = refMap.get(n)
      if (arr) arr.push(id)
      else refMap.set(n, [id])
    }
  }

  const eligible = llps.filter(l => needsCoverage(l, config))
  /** @type {CoverageResult['covered']} */
  const covered = []
  /** @type {Llp[]} */
  const uncovered = []
  for (const llp of eligible) {
    const designedBy = refMap.get(llp.number)
    const by = designedBy ? [...designedBy] : []
    if (codeRefs.has(llp.number)) by.push('code')
    if (by.length) covered.push({ llp, by })
    else uncovered.push(llp)
  }
  return { eligible, covered, uncovered, designs }
}
