/**
 * Reports module
 * Sentence-level analysis reports in the sidebar.
 * Inspired by ProWritingAid's data, styled like Grammarly.
 */
const Reports = (function () {
  'use strict';

  var containerEl;
  var onHighlight = null;
  var lastSentences = [];

  // GOV.UK recommends sentences under 25 words
  var TARGET_MAX = 25;
  var WARN_MAX = 35;

  function init(callbacks) {
    onHighlight = callbacks && callbacks.onHighlight;
    containerEl = document.getElementById('reportsPanel');
  }

  /**
   * Common abbreviations that end with a period but don't end a sentence.
   */
  var ABBREVS = /(?:e\.g|i\.e|etc|vs|Dr|Mr|Mrs|Ms|Prof|Sr|Jr|No|Vol|dept|govt|approx|Inc|Ltd|St|Ave|Ref|Fig|Gen|Corp|Est|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\./gi;

  /**
   * Split text into sentences with their start/end offsets.
   * Handles abbreviations (e.g., Dr., etc.) and decimal numbers (3.5) without
   * treating their periods as sentence boundaries.
   */
  /**
   * Detect if a line is a list item (bullet, numbered, or lettered).
   */
  var LIST_ITEM_RE = /^[\s]*(?:[-*•–—]|\d+[.):]|[a-zA-Z][.):])\s+/;

  function parseSentences(text) {
    var sentences = [];

    // First, split text into blocks: list items get treated individually,
    // prose paragraphs go through normal sentence splitting.
    var lines = text.split('\n');
    var proseBuffer = '';
    var proseStart = 0;
    var offset = 0;

    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      var lineStart = offset;
      offset += line.length + 1; // +1 for the \n

      if (LIST_ITEM_RE.test(line)) {
        // Flush any accumulated prose first
        if (proseBuffer.length > 0) {
          parseProse(proseBuffer, proseStart, sentences);
          proseBuffer = '';
        }
        // Treat this list item as its own sentence
        var trimmedLine = line.trim();
        var wordCount = (trimmedLine.match(/\b[a-zA-Z0-9']+\b/g) || []).length;
        if (wordCount > 0) {
          sentences.push({
            text: trimmedLine,
            start: lineStart + (line.length - line.trimStart().length),
            end: lineStart + line.trimEnd().length,
            words: wordCount
          });
        }
      } else {
        // Accumulate prose lines
        if (proseBuffer.length === 0) {
          proseStart = lineStart;
        }
        proseBuffer += (proseBuffer.length > 0 ? '\n' : '') + line;
      }
    }

    // Flush remaining prose
    if (proseBuffer.length > 0) {
      parseProse(proseBuffer, proseStart, sentences);
    }

    return sentences;
  }

  /**
   * Parse prose text into sentences using punctuation-based splitting.
   */
  function parseProse(text, baseOffset, sentences) {
    var PLACEHOLDER = '\x00';
    var safeText = text
      // Protect decimal numbers like 3.5, £12.50
      .replace(/(\d)\.(\d)/g, '$1' + PLACEHOLDER + '$2')
      // Protect known abbreviations
      .replace(ABBREVS, function (m) { return m.replace(/\./g, PLACEHOLDER); })
      // Protect ellipsis
      .replace(/\.{2,}/g, function (m) { return m.replace(/\./g, PLACEHOLDER); });

    // Split on sentence-ending punctuation followed by whitespace or end-of-string
    var regex = /[^\s][^.!?]*[.!?]+[\s]?|[^\s][^.!?]*$/g;
    var match;
    while ((match = regex.exec(safeText)) !== null) {
      var raw = match[0];
      var trimmed = raw.trim();
      if (trimmed.length < 2) continue;
      // Use the original text for the actual sentence content
      var originalRaw = text.substring(match.index, match.index + raw.length);
      var originalTrimmed = originalRaw.trim();
      var wordCount = (originalTrimmed.match(/\b[a-zA-Z0-9']+\b/g) || []).length;
      if (wordCount === 0) continue;
      sentences.push({
        text: originalTrimmed,
        start: baseOffset + match.index,
        end: baseOffset + match.index + originalRaw.trimEnd().length,
        words: wordCount
      });
    }
  }

  /**
   * Compute sentence variety: standard deviation of word counts.
   * Higher = more varied (good for readability).
   */
  function sentenceVariety(sentences) {
    if (sentences.length < 2) return 0;
    var total = 0;
    sentences.forEach(function (s) { total += s.words; });
    var mean = total / sentences.length;
    var variance = 0;
    sentences.forEach(function (s) {
      variance += (s.words - mean) * (s.words - mean);
    });
    return Math.round(Math.sqrt(variance / sentences.length) * 10) / 10;
  }

  /**
   * Get colour class for a sentence based on word count.
   */
  function barClass(wordCount) {
    if (wordCount <= TARGET_MAX) return 'bar-good';
    if (wordCount <= WARN_MAX) return 'bar-warn';
    return 'bar-over';
  }

  /**
   * Update the report from text. Called by app.js on every stats update.
   */
  function update(text) {
    if (!containerEl) return;
    lastSentences = parseSentences(text);
    render();
  }

  function render() {
    if (!containerEl) return;
    containerEl.innerHTML = '';

    if (lastSentences.length === 0) {
      containerEl.innerHTML = '<p class="report-empty">Write some text to see sentence analysis.</p>';
      return;
    }

    var sentences = lastSentences;
    var total = 0;
    var longest = 0;
    var overCount = 0;
    sentences.forEach(function (s) {
      total += s.words;
      if (s.words > longest) longest = s.words;
      if (s.words > TARGET_MAX) overCount++;
    });
    var avg = Math.round((total / sentences.length) * 10) / 10;
    var variety = sentenceVariety(sentences);

    // Summary cards
    var summary = document.createElement('div');
    summary.className = 'report-summary';

    summary.appendChild(makeStat(avg, 'Avg length', avg <= TARGET_MAX ? 'good' : (avg <= WARN_MAX ? 'warn' : 'over')));
    summary.appendChild(makeStat(sentences.length, 'Sentences', 'neutral'));
    summary.appendChild(makeStat(variety, 'Variety', variety >= 5 ? 'good' : (variety >= 3 ? 'warn' : 'over')));
    summary.appendChild(makeStat(overCount, 'Over ' + TARGET_MAX, overCount === 0 ? 'good' : 'over'));

    containerEl.appendChild(summary);

    // Target line label
    var targetLabel = document.createElement('div');
    targetLabel.className = 'report-target-label';
    targetLabel.innerHTML = '<span class="report-target-line-key"></span> ' + TARGET_MAX + ' word target (GOV.UK)';
    containerEl.appendChild(targetLabel);

    // Bar chart
    var chart = document.createElement('div');
    chart.className = 'report-chart';

    // Calculate the max bar width based on the longest sentence
    var maxWords = Math.max(longest, TARGET_MAX + 10);

    sentences.forEach(function (s, i) {
      var row = document.createElement('div');
      row.className = 'report-bar-row';

      var num = document.createElement('span');
      num.className = 'report-bar-num';
      num.textContent = (i + 1);

      var track = document.createElement('div');
      track.className = 'report-bar-track';

      // Target line
      var targetLine = document.createElement('div');
      targetLine.className = 'report-target-line';
      targetLine.style.left = (TARGET_MAX / maxWords * 100) + '%';
      track.appendChild(targetLine);

      var bar = document.createElement('div');
      bar.className = 'report-bar ' + barClass(s.words);
      bar.style.width = Math.max(2, (s.words / maxWords) * 100) + '%';

      var count = document.createElement('span');
      count.className = 'report-bar-count';
      count.textContent = s.words;
      bar.appendChild(count);

      track.appendChild(bar);

      row.appendChild(num);
      row.appendChild(track);

      // Tooltip preview on hover
      row.title = truncate(s.text, 80);

      // Click to highlight in editor
      row.addEventListener('click', function () {
        // Remove active from all rows
        var rows = chart.querySelectorAll('.report-bar-row');
        rows.forEach(function (r) { r.classList.remove('active'); });
        row.classList.add('active');
        if (onHighlight) onHighlight(s.start, s.end);
      });

      chart.appendChild(row);
    });

    containerEl.appendChild(chart);

    // Long sentences list
    var longOnes = sentences.filter(function (s) { return s.words > TARGET_MAX; });
    if (longOnes.length > 0) {
      var section = document.createElement('div');
      section.className = 'report-long-section';

      var heading = document.createElement('h4');
      heading.className = 'report-section-title';
      heading.textContent = longOnes.length + ' sentence' + (longOnes.length > 1 ? 's' : '') + ' over ' + TARGET_MAX + ' words';
      section.appendChild(heading);

      longOnes.forEach(function (s) {
        var card = document.createElement('div');
        card.className = 'report-long-card';

        var preview = document.createElement('div');
        preview.className = 'report-long-preview';
        preview.textContent = truncate(s.text, 120);
        card.appendChild(preview);

        var badgeRow = document.createElement('div');
        badgeRow.className = 'report-long-badge-row';

        var badge = document.createElement('span');
        badge.className = 'report-long-badge ' + barClass(s.words);
        badge.textContent = s.words + ' words';
        badgeRow.appendChild(badge);
        card.appendChild(badgeRow);

        card.addEventListener('click', function () {
          if (onHighlight) onHighlight(s.start, s.end);
        });

        section.appendChild(card);
      });

      containerEl.appendChild(section);
    }
  }

  function makeStat(value, label, status) {
    var el = document.createElement('div');
    el.className = 'report-stat';
    var valEl = document.createElement('div');
    valEl.className = 'report-stat-value report-stat-' + status;
    valEl.textContent = value;
    var labelEl = document.createElement('div');
    labelEl.className = 'report-stat-label';
    labelEl.textContent = label;
    el.appendChild(valEl);
    el.appendChild(labelEl);
    return el;
  }

  function truncate(text, max) {
    if (text.length <= max) return text;
    return text.substring(0, max - 1) + '\u2026';
  }

  return {
    init: init,
    update: update
  };
})();
