/**
 * Keyboard-Proximity Weighting module.
 * Uses QWERTY key positions to compute weighted Levenshtein distance,
 * treating adjacent-key substitutions as cheaper than distant ones.
 * Used for ranking spelling suggestions — NOT for candidate generation
 * (which would break BK-tree triangle inequality).
 */
var KeyboardProximity = (function () {
  'use strict';

  // QWERTY layout: [row, col] with row offsets to reflect staggered keys
  var POSITIONS = {
    q: [0, 0],    w: [0, 1],    e: [0, 2],    r: [0, 3],    t: [0, 4],
    y: [0, 5],    u: [0, 6],    i: [0, 7],    o: [0, 8],    p: [0, 9],
    a: [1, 0.25], s: [1, 1.25], d: [1, 2.25], f: [1, 3.25], g: [1, 4.25],
    h: [1, 5.25], j: [1, 6.25], k: [1, 7.25], l: [1, 8.25],
    z: [2, 0.75], x: [2, 1.75], c: [2, 2.75], v: [2, 3.75], b: [2, 4.75],
    n: [2, 5.75], m: [2, 6.75]
  };

  // Adjacent threshold: keys within this Euclidean distance are "adjacent"
  var ADJACENT_THRESHOLD = 1.5;

  /**
   * Euclidean distance between two keys on the keyboard.
   * Returns Infinity if either key is not in the layout.
   */
  function keyDistance(a, b) {
    var posA = POSITIONS[a];
    var posB = POSITIONS[b];
    if (!posA || !posB) return Infinity;
    var dr = posA[0] - posB[0];
    var dc = posA[1] - posB[1];
    return Math.sqrt(dr * dr + dc * dc);
  }

  /**
   * Substitution cost based on keyboard proximity.
   * Adjacent keys: 0.5, distant keys: 1.0, smooth interpolation in between.
   */
  function substitutionCost(a, b) {
    if (a === b) return 0;
    var dist = keyDistance(a, b);
    if (dist === Infinity) return 1.0;
    if (dist <= ADJACENT_THRESHOLD) {
      // Linearly interpolate: distance 0 → cost 0.3, distance 1.5 → cost 0.7
      return 0.3 + (dist / ADJACENT_THRESHOLD) * 0.4;
    }
    return 1.0;
  }

  /**
   * Weighted Levenshtein distance using keyboard-proximity substitution costs.
   * Insertions and deletions remain cost 1.0.
   */
  function weightedLevenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;

    var prev = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) prev[j] = j;

    for (var i = 1; i <= a.length; i++) {
      var curr = [i];
      for (var j = 1; j <= b.length; j++) {
        var cost = substitutionCost(a[i - 1], b[j - 1]);
        curr[j] = Math.min(
          curr[j - 1] + 1,        // insertion
          prev[j] + 1,            // deletion
          prev[j - 1] + cost      // substitution (weighted)
        );
      }
      prev = curr;
    }
    return prev[b.length];
  }

  return {
    keyDistance: keyDistance,
    substitutionCost: substitutionCost,
    weightedLevenshtein: weightedLevenshtein
  };
})();
