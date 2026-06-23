// @ts-check
// Coverage invariant: every live REQUEST LLP must be @ref'd by a DESIGN LLP
// (planned) or by code (already realized). Uncovered requests are the Designer
// reconciler's backlog. Design LLPs never need coverage themselves — no regress.
// @ref LLP 0003#coverage-invariant [implements]
import { needsCoverage, isDesignType } from './llp.js'

/** @import { Llp, CoverageResult } from './types.d.ts' */

/**
 * @param {Llp[]} llps
 * @param {Set<number>} [codeRefs]  LLP numbers referenced by source (realized)
 * @returns {CoverageResult}
 */
export function coverage(llps, codeRefs = new Set()) {
  const designs = llps.filter(isDesignType)

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

  const eligible = llps.filter(needsCoverage)
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
