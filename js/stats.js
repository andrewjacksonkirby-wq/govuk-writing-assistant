/**
 * Stats module
 * Computes word count, sentence count, paragraph count, reading time,
 * and Hemingway-style readability grade level. Updates live as user types.
 */
const Stats = (function () {
  'use strict';

  var els = {};

  function init() {
    els.words = document.getElementById('statWords');
    els.sentences = document.getElementById('statSentences');
    els.paragraphs = document.getElementById('statParagraphs');
    els.readingTime = document.getElementById('statReadingTime');
    els.readability = document.getElementById('statReadability');
    els.readabilityBar = document.getElementById('readabilityBar');
  }

  /**
   * Update all stats from the given text.
   */
  function update(text) {
    if (!els.words) return;

    var trimmed = text.trim();
    if (trimmed.length === 0) {
      els.words.textContent = '0';
      els.sentences.textContent = '0';
      els.paragraphs.textContent = '0';
      els.readingTime.textContent = '0 min';
      setReadability(null);
      return;
    }

    var words = countWords(trimmed);
    var sentences = countSentences(trimmed);
    var paragraphs = countParagraphs(trimmed);
    var minutes = Math.max(1, Math.ceil(words / 200));

    els.words.textContent = words;
    els.sentences.textContent = sentences;
    els.paragraphs.textContent = paragraphs;
    els.readingTime.textContent = minutes + ' min';

    if (words >= 10 && sentences >= 1) {
      var grade = fleschKincaidGrade(trimmed, words, sentences);
      var ease = fleschReadingEase(trimmed, words, sentences);
      setReadability(grade, ease);
      setReadingAge(grade);
    } else {
      setReadability(null, null);
      setReadingAge(null);
    }
  }

  function countWords(text) {
    var matches = text.match(/\b[a-zA-Z0-9']+\b/g);
    return matches ? matches.length : 0;
  }

  function countSentences(text) {
    var matches = text.match(/[.!?]+(\s|$)/g);
    return matches ? matches.length : (text.length > 0 ? 1 : 0);
  }

  function countParagraphs(text) {
    var paras = text.split(/\n\s*\n/).filter(function (p) { return p.trim().length > 0; });
    return Math.max(1, paras.length);
  }

  /**
   * Count syllables in a word (approximation).
   */
  function countSyllables(word) {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 2) return 1;

    // Remove trailing silent e
    word = word.replace(/e$/, '');

    // Count vowel groups
    var matches = word.match(/[aeiouy]+/g);
    var count = matches ? matches.length : 1;
    return Math.max(1, count);
  }

  function getTotalSyllables(text) {
    var words = text.match(/\b[a-zA-Z']+\b/g) || [];
    var total = 0;
    words.forEach(function (w) {
      total += countSyllables(w);
    });
    return total;
  }

  /**
   * Flesch-Kincaid Grade Level.
   * Returns a US school grade level (e.g. 5 = 5th grade, 10 = 10th grade).
   * Lower = simpler. GOV.UK recommends Grade 6-8 (age 11-14).
   */
  function fleschKincaidGrade(text, wordCount, sentenceCount) {
    var totalSyllables = getTotalSyllables(text);
    var grade = (0.39 * (wordCount / sentenceCount)) +
      (11.8 * (totalSyllables / wordCount)) - 15.59;
    return Math.round(Math.max(1, Math.min(18, grade)));
  }

  /**
   * Flesch Reading Ease (kept for internal use / sidebar readability display).
   */
  function fleschReadingEase(text, wordCount, sentenceCount) {
    var totalSyllables = getTotalSyllables(text);
    var score = 206.835 -
      (1.015 * (wordCount / sentenceCount)) -
      (84.6 * (totalSyllables / wordCount));
    return Math.round(Math.max(0, Math.min(100, score)));
  }

  /**
   * Set readability display using Hemingway-style grade levels.
   * Grade 1-6: Good (green) - most people can read this easily
   * Grade 7-9: OK (amber) - fairly readable
   * Grade 10-12: Hard (orange) - complex
   * Grade 13+: Very hard (red) - postgraduate level
   */
  function setReadability(grade, ease) {
    lastReadabilityScore = ease;
    lastGradeLevel = grade;

    if (grade === null) {
      els.readability.textContent = '--';
      els.readability.className = 'stat-value';
      if (els.readabilityBar) {
        els.readabilityBar.style.width = '0%';
        els.readabilityBar.className = 'readability-bar-fill';
      }
      return;
    }

    var label, cls;
    if (grade <= 6) {
      label = 'Grade ' + grade + ' \u00b7 Good';
      cls = 'readability-easy';
    } else if (grade <= 9) {
      label = 'Grade ' + grade + ' \u00b7 OK';
      cls = 'readability-ok';
    } else if (grade <= 12) {
      label = 'Grade ' + grade + ' \u00b7 Hard';
      cls = 'readability-hard';
    } else {
      label = 'Grade ' + grade + ' \u00b7 Very hard';
      cls = 'readability-vhard';
    }

    els.readability.textContent = label;
    els.readability.className = 'stat-value ' + cls;
    if (els.readabilityBar) {
      // Invert: lower grade = fuller bar (better)
      var barPercent = Math.max(5, Math.min(100, ((18 - grade) / 17) * 100));
      els.readabilityBar.style.width = barPercent + '%';
      els.readabilityBar.className = 'readability-bar-fill ' + cls;
    }
  }

  /**
   * Reading age display — converts grade level to approximate reading age.
   * GOV.UK recommends content readable by a 9-year-old.
   */
  function setReadingAge(grade) {
    var ageEl = document.getElementById('statReadingAge');
    var targetEl = document.getElementById('readingAgeTarget');
    if (!ageEl) return;

    if (grade === null) {
      ageEl.textContent = '--';
      ageEl.className = 'stat-value';
      if (targetEl) {
        targetEl.textContent = 'Target: age 9';
        targetEl.className = 'reading-age-target';
      }
      return;
    }

    // Reading age ≈ grade + 5 (US grade 1 = age 6)
    var age = Math.max(5, grade + 5);
    ageEl.textContent = 'Age ' + age;

    if (age <= 9) {
      ageEl.className = 'stat-value readability-easy';
      if (targetEl) {
        targetEl.textContent = 'On target';
        targetEl.className = 'reading-age-target';
      }
    } else if (age <= 11) {
      ageEl.className = 'stat-value readability-ok';
      if (targetEl) {
        targetEl.textContent = 'Close (target: 9)';
        targetEl.className = 'reading-age-target near-target';
      }
    } else {
      ageEl.className = 'stat-value readability-hard';
      if (targetEl) {
        targetEl.textContent = 'Over target (age ' + age + ' vs 9)';
        targetEl.className = 'reading-age-target over-target';
      }
    }
  }

  var lastReadabilityScore = null;
  var lastGradeLevel = null;

  function getReadabilityScore() {
    return lastReadabilityScore;
  }

  function getGradeLevel() {
    return lastGradeLevel;
  }

  return {
    init: init,
    update: update,
    countWords: countWords,
    getReadabilityScore: getReadabilityScore,
    getGradeLevel: getGradeLevel
  };
})();
