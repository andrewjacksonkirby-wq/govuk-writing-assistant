/**
 * Stats module
 * Computes word count, sentence count, paragraph count, reading time,
 * and Flesch-Kincaid readability score. Updates live as user types.
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
      var score = fleschReadingEase(trimmed, words, sentences);
      setReadability(score);
    } else {
      setReadability(null);
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

  /**
   * Flesch Reading Ease score.
   * 90-100 = Very easy, 60-70 = Standard, 30-50 = Difficult, 0-30 = Very difficult
   */
  function fleschReadingEase(text, wordCount, sentenceCount) {
    var words = text.match(/\b[a-zA-Z']+\b/g) || [];
    var totalSyllables = 0;
    words.forEach(function (w) {
      totalSyllables += countSyllables(w);
    });

    var score = 206.835 -
      (1.015 * (wordCount / sentenceCount)) -
      (84.6 * (totalSyllables / wordCount));

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  function setReadability(score) {
    if (score === null) {
      els.readability.textContent = '--';
      els.readability.className = 'stat-value';
      if (els.readabilityBar) els.readabilityBar.style.width = '0%';
      return;
    }

    var label, cls;
    if (score >= 70) {
      label = score + ' Easy';
      cls = 'readability-easy';
    } else if (score >= 50) {
      label = score + ' OK';
      cls = 'readability-ok';
    } else if (score >= 30) {
      label = score + ' Hard';
      cls = 'readability-hard';
    } else {
      label = score + ' V.Hard';
      cls = 'readability-vhard';
    }

    els.readability.textContent = label;
    els.readability.className = 'stat-value ' + cls;
    if (els.readabilityBar) {
      els.readabilityBar.style.width = score + '%';
      els.readabilityBar.className = 'readability-bar-fill ' + cls;
    }
  }

  return {
    init: init,
    update: update,
    countWords: countWords
  };
})();
