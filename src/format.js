// @ts-check
// Tiny formatting helpers, isolated so rendering stays testable and uniform.

/**
 * @param {string} s
 * @param {number} width
 * @param {string} [fill]
 * @returns {string}
 */
export function padStart(s, width, fill = ' ') {
  return s.padStart(width, fill)
}
