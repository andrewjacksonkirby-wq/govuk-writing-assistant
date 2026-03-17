/**
 * Phonetic Matching module (Double Metaphone).
 * Generates phonetic codes for words and maintains an index for
 * finding phonetically similar words (e.g., "fone" → "phone").
 *
 * Based on Lawrence Philips' Double Metaphone algorithm.
 */
var PhoneticMatcher = (function () {
  'use strict';

  // Phonetic index: metaphone code → array of words
  var index = {};
  var ready = false;

  var VOWELS = 'AEIOUY';

  function isVowel(c) {
    return VOWELS.indexOf(c) >= 0;
  }

  function charAt(s, i) {
    return (i >= 0 && i < s.length) ? s.charAt(i) : '';
  }

  function substr(s, start, len) {
    return s.substring(start, start + len);
  }

  function stringAt(s, start, len, list) {
    var target = substr(s, start, len);
    for (var i = 0; i < list.length; i++) {
      if (list[i] === target) return true;
    }
    return false;
  }

  /**
   * Double Metaphone algorithm.
   * Returns [primary, alternate] phonetic codes.
   */
  function doubleMetaphone(word) {
    if (!word || word.length === 0) return ['', ''];

    var primary = '';
    var secondary = '';
    var current = 0;
    var length = word.length;
    var last = length - 1;
    var original = (word + '     ').toUpperCase();

    // Skip initial silent letters
    if (stringAt(original, 0, 2, ['GN', 'KN', 'PN', 'AE', 'WR'])) {
      current += 1;
    }

    // Initial X → S
    if (charAt(original, 0) === 'X') {
      primary += 'S';
      secondary += 'S';
      current += 1;
    }

    while (primary.length < 4 || secondary.length < 4) {
      if (current >= length) break;
      var ch = charAt(original, current);

      switch (ch) {
        case 'A': case 'E': case 'I': case 'O': case 'U': case 'Y':
          // Vowels only coded at beginning
          if (current === 0) {
            primary += 'A';
            secondary += 'A';
          }
          current += 1;
          break;

        case 'B':
          primary += 'P';
          secondary += 'P';
          current += (charAt(original, current + 1) === 'B') ? 2 : 1;
          break;

        case 'C':
          // Various Germanic cases
          if (current > 1 && !isVowel(charAt(original, current - 2))
              && stringAt(original, current - 1, 3, ['ACH'])
              && charAt(original, current + 2) !== 'I'
              && (charAt(original, current + 2) !== 'E' || stringAt(original, current - 2, 6, ['BACHER', 'MACHER']))) {
            primary += 'K';
            secondary += 'K';
            current += 2;
            break;
          }

          // Special initial CH
          if (current === 0 && stringAt(original, current, 6, ['CAESAR'])) {
            primary += 'S';
            secondary += 'S';
            current += 2;
            break;
          }

          // CH
          if (stringAt(original, current, 2, ['CH'])) {
            // Italian: chianti
            if (current > 0 && stringAt(original, current, 4, ['CHAE'])) {
              primary += 'K';
              secondary += 'X';
              current += 2;
              break;
            }

            // Greek roots: chemistry, chorus
            if (current === 0 && (stringAt(original, current + 1, 5, ['HARAC', 'HARIS'])
                || stringAt(original, current + 1, 3, ['HOR', 'HYM', 'HIA', 'HEM']))
                && !stringAt(original, 0, 5, ['CHORE'])) {
              primary += 'K';
              secondary += 'K';
              current += 2;
              break;
            }

            // Germanic/Greek ch → K
            if (stringAt(original, 0, 4, ['VAN ', 'VON ']) || stringAt(original, 0, 3, ['SCH'])
                || stringAt(original, current - 2, 6, ['ORCHES', 'ARCHIT', 'ORCHID'])
                || stringAt(original, current + 2, 1, ['T', 'S'])
                || ((stringAt(original, current - 1, 1, ['A', 'O', 'U', 'E']) || current === 0)
                    && stringAt(original, current + 2, 1, ['L', 'R', 'N', 'M', 'B', 'H', 'F', 'V', 'W', ' ']))) {
              primary += 'K';
              secondary += 'K';
            } else {
              if (current > 0) {
                if (stringAt(original, 0, 2, ['MC'])) {
                  primary += 'K';
                  secondary += 'K';
                } else {
                  primary += 'X';
                  secondary += 'K';
                }
              } else {
                primary += 'X';
                secondary += 'X';
              }
            }
            current += 2;
            break;
          }

          // CZ → S (Polish)
          if (stringAt(original, current, 2, ['CZ']) && !stringAt(original, current - 2, 4, ['WICZ'])) {
            primary += 'S';
            secondary += 'X';
            current += 2;
            break;
          }

          // CIA → X
          if (stringAt(original, current + 1, 3, ['CIA'])) {
            primary += 'X';
            secondary += 'X';
            current += 3;
            break;
          }

          // CC (not initial)
          if (stringAt(original, current, 2, ['CC']) && !(current === 1 && charAt(original, 0) === 'M')) {
            if (stringAt(original, current + 2, 1, ['I', 'E', 'H']) && !stringAt(original, current + 2, 2, ['HU'])) {
              if ((current === 1 && charAt(original, current - 1) === 'A')
                  || stringAt(original, current - 1, 5, ['UCCEE', 'UCCES'])) {
                primary += 'KS';
                secondary += 'KS';
              } else {
                primary += 'X';
                secondary += 'X';
              }
              current += 3;
              break;
            } else {
              primary += 'K';
              secondary += 'K';
              current += 2;
              break;
            }
          }

          if (stringAt(original, current, 2, ['CK', 'CG', 'CQ'])) {
            primary += 'K';
            secondary += 'K';
            current += 2;
            break;
          }

          if (stringAt(original, current, 2, ['CI', 'CE', 'CY'])) {
            if (stringAt(original, current, 3, ['CIO', 'CIE', 'CIA'])) {
              primary += 'S';
              secondary += 'X';
            } else {
              primary += 'S';
              secondary += 'S';
            }
            current += 2;
            break;
          }

          primary += 'K';
          secondary += 'K';
          if (stringAt(original, current + 1, 1, [' C', ' Q', ' G'])) {
            current += 3;
          } else if (stringAt(original, current + 1, 1, ['C', 'K', 'Q'])
                     && !stringAt(original, current + 1, 2, ['CE', 'CI'])) {
            current += 2;
          } else {
            current += 1;
          }
          break;

        case 'D':
          if (stringAt(original, current, 2, ['DG'])) {
            if (stringAt(original, current + 2, 1, ['I', 'E', 'Y'])) {
              primary += 'J';
              secondary += 'J';
              current += 3;
            } else {
              primary += 'TK';
              secondary += 'TK';
              current += 2;
            }
            break;
          }

          if (stringAt(original, current, 2, ['DT', 'DD'])) {
            primary += 'T';
            secondary += 'T';
            current += 2;
          } else {
            primary += 'T';
            secondary += 'T';
            current += 1;
          }
          break;

        case 'F':
          primary += 'F';
          secondary += 'F';
          current += (charAt(original, current + 1) === 'F') ? 2 : 1;
          break;

        case 'G':
          if (charAt(original, current + 1) === 'H') {
            if (current > 0 && !isVowel(charAt(original, current - 1))) {
              primary += 'K';
              secondary += 'K';
              current += 2;
              break;
            }

            if (current === 0) {
              if (charAt(original, current + 2) === 'I') {
                primary += 'J';
                secondary += 'J';
              } else {
                primary += 'K';
                secondary += 'K';
              }
              current += 2;
              break;
            }

            if ((current > 1 && stringAt(original, current - 2, 1, ['B', 'H', 'D']))
                || (current > 2 && stringAt(original, current - 3, 1, ['B', 'H', 'D']))
                || (current > 3 && stringAt(original, current - 4, 1, ['B', 'H']))) {
              current += 2;
              break;
            } else {
              if (current > 2 && charAt(original, current - 1) === 'U'
                  && stringAt(original, current - 3, 1, ['C', 'G', 'L', 'R', 'T'])) {
                primary += 'F';
                secondary += 'F';
              } else if (current > 0 && charAt(original, current - 1) !== 'I') {
                primary += 'K';
                secondary += 'K';
              }
              current += 2;
              break;
            }
          }

          if (charAt(original, current + 1) === 'N') {
            if (current === 1 && isVowel(charAt(original, 0)) && !isSlavoGermanic(original)) {
              primary += 'KN';
              secondary += 'N';
            } else {
              if (!stringAt(original, current + 2, 2, ['EY']) && charAt(original, current + 1) !== 'Y'
                  && !isSlavoGermanic(original)) {
                primary += 'N';
                secondary += 'KN';
              } else {
                primary += 'KN';
                secondary += 'KN';
              }
            }
            current += 2;
            break;
          }

          if (stringAt(original, current + 1, 2, ['LI']) && !isSlavoGermanic(original)) {
            primary += 'KL';
            secondary += 'L';
            current += 2;
            break;
          }

          // -ges-, -gep-, -gel-, -gie- at beginning
          if (current === 0
              && (charAt(original, current + 1) === 'Y'
                  || stringAt(original, current + 1, 2, ['ES', 'EP', 'EB', 'EL', 'EY', 'IB', 'IL', 'IN', 'IE', 'EI', 'ER']))) {
            primary += 'K';
            secondary += 'J';
            current += 2;
            break;
          }

          if ((stringAt(original, current + 1, 2, ['ER']) || charAt(original, current + 1) === 'Y')
              && !stringAt(original, 0, 6, ['DANGER', 'RANGER', 'MANGER'])
              && !stringAt(original, current - 1, 1, ['E', 'I'])
              && !stringAt(original, current - 1, 3, ['RGY', 'OGY'])) {
            primary += 'K';
            secondary += 'J';
            current += 2;
            break;
          }

          if (stringAt(original, current + 1, 1, ['E', 'I', 'Y'])
              || stringAt(original, current - 1, 4, ['AGGI', 'OGGI'])) {
            if (stringAt(original, 0, 4, ['VAN ', 'VON ']) || stringAt(original, 0, 3, ['SCH'])
                || stringAt(original, current + 1, 2, ['ET'])) {
              primary += 'K';
              secondary += 'K';
            } else {
              if (stringAt(original, current + 1, 4, ['IER '])) {
                primary += 'J';
                secondary += 'J';
              } else {
                primary += 'J';
                secondary += 'K';
              }
            }
            current += 2;
            break;
          }

          primary += 'K';
          secondary += 'K';
          current += (charAt(original, current + 1) === 'G') ? 2 : 1;
          break;

        case 'H':
          if ((current === 0 || isVowel(charAt(original, current - 1)))
              && isVowel(charAt(original, current + 1))) {
            primary += 'H';
            secondary += 'H';
            current += 2;
          } else {
            current += 1;
          }
          break;

        case 'J':
          if (stringAt(original, current, 4, ['JOSE']) || stringAt(original, 0, 4, ['SAN '])) {
            if ((current === 0 && charAt(original, current + 4) === ' ') || stringAt(original, 0, 4, ['SAN '])) {
              primary += 'H';
              secondary += 'H';
            } else {
              primary += 'J';
              secondary += 'H';
            }
            current += 1;
            break;
          }

          if (current === 0) {
            primary += 'J';
            secondary += 'A';
          } else if (isVowel(charAt(original, current - 1)) && !isSlavoGermanic(original)
                     && (charAt(original, current + 1) === 'A' || charAt(original, current + 1) === 'O')) {
            primary += 'J';
            secondary += 'H';
          } else if (current === last) {
            primary += 'J';
            secondary += '';
          } else if (!stringAt(original, current + 1, 1, ['L', 'T', 'K', 'S', 'N', 'M', 'B', 'Z'])
                     && !stringAt(original, current - 1, 1, ['S', 'K', 'L'])) {
            primary += 'J';
            secondary += 'J';
          }

          current += (charAt(original, current + 1) === 'J') ? 2 : 1;
          break;

        case 'K':
          primary += 'K';
          secondary += 'K';
          current += (charAt(original, current + 1) === 'K') ? 2 : 1;
          break;

        case 'L':
          if (charAt(original, current + 1) === 'L') {
            // Spanish: cabrillo, gallegos
            if ((current === length - 3 && stringAt(original, current - 1, 4, ['ILLO', 'ILLA', 'ALLE']))
                || ((stringAt(original, last - 1, 2, ['AS', 'OS']) || stringAt(original, last, 1, ['A', 'O']))
                    && stringAt(original, current - 1, 4, ['ALLE']))) {
              primary += 'L';
              secondary += '';
              current += 2;
              break;
            }
            current += 2;
          } else {
            current += 1;
          }
          primary += 'L';
          secondary += 'L';
          break;

        case 'M':
          primary += 'M';
          secondary += 'M';
          if (stringAt(original, current - 1, 3, ['UMB'])
              && (current + 1 === last || stringAt(original, current + 2, 2, ['ER']))) {
            current += 2;
          } else {
            current += (charAt(original, current + 1) === 'M') ? 2 : 1;
          }
          break;

        case 'N':
          primary += 'N';
          secondary += 'N';
          current += (charAt(original, current + 1) === 'N') ? 2 : 1;
          break;

        case 'P':
          if (charAt(original, current + 1) === 'H') {
            primary += 'F';
            secondary += 'F';
            current += 2;
            break;
          }
          primary += 'P';
          secondary += 'P';
          current += (stringAt(original, current + 1, 1, ['P', 'B'])) ? 2 : 1;
          break;

        case 'Q':
          primary += 'K';
          secondary += 'K';
          current += (charAt(original, current + 1) === 'Q') ? 2 : 1;
          break;

        case 'R':
          // French final R
          if (current === last && !isSlavoGermanic(original)
              && stringAt(original, current - 2, 2, ['IE'])
              && !stringAt(original, current - 4, 2, ['ME', 'MA'])) {
            secondary += 'R';
          } else {
            primary += 'R';
            secondary += 'R';
          }
          current += (charAt(original, current + 1) === 'R') ? 2 : 1;
          break;

        case 'S':
          // Special cases: island, isle, Carlisle
          if (stringAt(original, current - 1, 3, ['ISL', 'YSL'])) {
            current += 1;
            break;
          }

          // Special initial SH
          if (current === 0 && stringAt(original, current, 5, ['SUGAR'])) {
            primary += 'X';
            secondary += 'S';
            current += 1;
            break;
          }

          if (stringAt(original, current, 2, ['SH'])) {
            if (stringAt(original, current + 1, 4, ['HEIM', 'HOEK', 'HOLM', 'HOLZ'])) {
              primary += 'S';
              secondary += 'S';
            } else {
              primary += 'X';
              secondary += 'X';
            }
            current += 2;
            break;
          }

          if (stringAt(original, current, 3, ['SIO', 'SIA']) || stringAt(original, current, 4, ['SIAN'])) {
            if (!isSlavoGermanic(original)) {
              primary += 'S';
              secondary += 'X';
            } else {
              primary += 'S';
              secondary += 'S';
            }
            current += 3;
            break;
          }

          if ((current === 0 && stringAt(original, current + 1, 1, ['M', 'N', 'L', 'W']))
              || stringAt(original, current + 1, 1, ['Z'])) {
            primary += 'S';
            secondary += 'X';
            current += (stringAt(original, current + 1, 1, ['Z'])) ? 2 : 1;
            break;
          }

          if (stringAt(original, current, 2, ['SC'])) {
            if (charAt(original, current + 2) === 'H') {
              // Schoenberg
              if (stringAt(original, current + 3, 2, ['OO', 'ER', 'EN', 'UY', 'ED', 'EM'])) {
                if (stringAt(original, current + 3, 2, ['ER', 'EN'])) {
                  primary += 'X';
                  secondary += 'SK';
                } else {
                  primary += 'SK';
                  secondary += 'SK';
                }
                current += 3;
                break;
              } else {
                if (current === 0 && !isVowel(charAt(original, 3)) && charAt(original, 3) !== 'W') {
                  primary += 'X';
                  secondary += 'S';
                } else {
                  primary += 'X';
                  secondary += 'X';
                }
                current += 3;
                break;
              }
            }

            if (stringAt(original, current + 2, 1, ['I', 'E', 'Y'])) {
              primary += 'S';
              secondary += 'S';
              current += 3;
              break;
            }

            primary += 'SK';
            secondary += 'SK';
            current += 3;
            break;
          }

          // French final: e.g. Thomas, Thames
          if (current === last && stringAt(original, current - 2, 2, ['AI', 'OI'])) {
            secondary += 'S';
          } else {
            primary += 'S';
            secondary += 'S';
          }

          current += (stringAt(original, current + 1, 1, ['S', 'Z'])) ? 2 : 1;
          break;

        case 'T':
          if (stringAt(original, current, 4, ['TION'])) {
            primary += 'X';
            secondary += 'X';
            current += 3;
            break;
          }

          if (stringAt(original, current, 3, ['TIA', 'TCH'])) {
            primary += 'X';
            secondary += 'X';
            current += 3;
            break;
          }

          if (stringAt(original, current, 2, ['TH']) || stringAt(original, current, 3, ['TTH'])) {
            if (stringAt(original, current + 2, 2, ['OM', 'AM'])
                || stringAt(original, 0, 4, ['VAN ', 'VON ']) || stringAt(original, 0, 3, ['SCH'])) {
              primary += 'T';
              secondary += 'T';
            } else {
              primary += '0';  // theta
              secondary += 'T';
            }
            current += 2;
            break;
          }

          primary += 'T';
          secondary += 'T';
          current += (stringAt(original, current + 1, 1, ['T', 'D'])) ? 2 : 1;
          break;

        case 'V':
          primary += 'F';
          secondary += 'F';
          current += (charAt(original, current + 1) === 'V') ? 2 : 1;
          break;

        case 'W':
          // WR → R
          if (stringAt(original, current, 2, ['WR'])) {
            primary += 'R';
            secondary += 'R';
            current += 2;
            break;
          }

          if (current === 0 && (isVowel(charAt(original, current + 1)) || stringAt(original, current, 2, ['WH']))) {
            if (isVowel(charAt(original, current + 1))) {
              primary += 'A';
              secondary += 'F';
            } else {
              primary += 'A';
              secondary += 'A';
            }
          }

          // Arnow → nothing, but not Wasser
          if ((current === last && isVowel(charAt(original, current - 1)))
              || stringAt(original, current - 1, 5, ['EWSKI', 'EWSKY', 'OWSKI', 'OWSKY'])
              || stringAt(original, 0, 3, ['SCH'])) {
            secondary += 'F';
            current += 1;
            break;
          }

          if (stringAt(original, current, 4, ['WICZ', 'WITZ'])) {
            primary += 'TS';
            secondary += 'FX';
            current += 4;
            break;
          }

          current += 1;
          break;

        case 'X':
          // French: breaux
          if (!(current === last
                && (stringAt(original, current - 3, 3, ['IAU', 'EAU'])
                    || stringAt(original, current - 2, 2, ['AU', 'OU'])))) {
            primary += 'KS';
            secondary += 'KS';
          }

          current += (stringAt(original, current + 1, 1, ['C', 'X'])) ? 2 : 1;
          break;

        case 'Z':
          if (charAt(original, current + 1) === 'H') {
            // Chinese
            primary += 'J';
            secondary += 'J';
            current += 2;
            break;
          } else if (stringAt(original, current + 1, 2, ['ZO', 'ZI', 'ZA'])
                     || (isSlavoGermanic(original) && current > 0 && charAt(original, current - 1) !== 'T')) {
            primary += 'S';
            secondary += 'TS';
          } else {
            primary += 'S';
            secondary += 'S';
          }

          current += (charAt(original, current + 1) === 'Z') ? 2 : 1;
          break;

        default:
          current += 1;
          break;
      }
    }

    primary = primary.substring(0, 4);
    secondary = secondary.substring(0, 4);

    return [primary, secondary === primary ? '' : secondary];
  }

  function isSlavoGermanic(s) {
    return s.indexOf('W') >= 0 || s.indexOf('K') >= 0
        || s.indexOf('CZ') >= 0 || s.indexOf('WITZ') >= 0;
  }

  /**
   * Build a phonetic index from a Set of words.
   * Maps each metaphone code to the list of words that produce it.
   */
  function buildIndex(wordSet) {
    index = {};
    var iter = wordSet.values();
    var entry;
    while ((entry = iter.next()) && !entry.done) {
      var w = entry.value;
      if (w.length < 3 || w.length > 15) continue;
      var codes = doubleMetaphone(w);
      var p = codes[0];
      var s = codes[1];
      if (p) {
        if (!index[p]) index[p] = [];
        index[p].push(w);
      }
      if (s) {
        if (!index[s]) index[s] = [];
        index[s].push(w);
      }
    }
    ready = true;
    console.log('[PhoneticMatcher] Phonetic index built: ' + Object.keys(index).length + ' codes');
  }

  /**
   * Find phonetically similar words for a given input.
   * Returns array of candidate words (not ranked).
   */
  function getSuggestions(word, limit) {
    if (!ready) return [];
    limit = limit || 10;
    var codes = doubleMetaphone(word.toLowerCase());
    var seen = {};
    var results = [];
    var lower = word.toLowerCase();

    for (var ci = 0; ci < 2; ci++) {
      var code = codes[ci];
      if (!code || !index[code]) continue;
      var candidates = index[code];
      for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        if (c === lower) continue;
        if (seen[c]) continue;
        seen[c] = true;
        results.push(c);
        if (results.length >= limit) return results;
      }
    }

    return results;
  }

  return {
    doubleMetaphone: doubleMetaphone,
    buildIndex: buildIndex,
    getSuggestions: getSuggestions,
    isReady: function () { return ready; }
  };
})();
