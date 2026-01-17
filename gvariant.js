/**
 * GVariant helper functions for type-safe variant extraction
 * Based on reference implementation
 */

import GLib from "gi://GLib";

/**
 * Extract string from GLib.Variant
 * @param {GLib.Variant|null|undefined} variant 
 * @returns {string|null}
 */
export function str(variant) {
  if (!variant) return null;
  try {
    const result = variant.get_string();
    return result ? result[0] : null;
  } catch (e) {
    return null;
  }
}

/**
 * Extract 64-bit integer from GLib.Variant
 * @param {GLib.Variant|null|undefined} variant 
 * @returns {number|null}
 */
export function i64(variant) {
  if (!variant) return null;
  try {
    return variant.get_int64();
  } catch (e) {
    return null;
  }
}

/**
 * Extract 32-bit integer from GLib.Variant
 * @param {GLib.Variant|null|undefined} variant 
 * @returns {number|null}
 */
export function i32(variant) {
  if (!variant) return null;
  try {
    return variant.get_int32();
  } catch (e) {
    return null;
  }
}

/**
 * Extract boolean from GLib.Variant
 * @param {GLib.Variant|null|undefined} variant 
 * @returns {boolean|null}
 */
export function bool(variant) {
  if (!variant) return null;
  try {
    return variant.get_boolean();
  } catch (e) {
    return null;
  }
}

/**
 * Extract double from GLib.Variant
 * @param {GLib.Variant|null|undefined} variant 
 * @returns {number|null}
 */
export function dbl(variant) {
  if (!variant) return null;
  try {
    return variant.get_double();
  } catch (e) {
    return null;
  }
}