/**
 * Suggestions module
 * Manages the sidebar: score circle, category tabs, collapsible cards,
 * apply/dismiss actions.
 *
 * Layout follows Grammarly pattern:
 *   - Score circle at top
 *   - Category tabs: All, Correctness, Clarity, Style
 *   - Flat list of collapsible suggestion cards
 *   - Duplicate issues merged into one card
 */
const Suggestions = (function () {
  'use strict';

  var correctnessSuggestions = [];
  var claritySuggestions = [];
  var dismissedIds = new Set();
  var sessionDismissedIds = new Set(); // "Ignore this time" — cleared on page reload
  var activeFilter = 'all';
  var activeSuggestionId = null;
  var expandedCardId = null;
  var hasRunFullCheck = false;

  // Callbacks
  var onApply = null;
  var onApplyAll = null;
  var onSelect = null;
  var onSuggestFix = null;
  var onDismiss = null;

  // DOM refs
  var listEl;
  var scoreNumber, scoreRingFill, scoreReadability;
  var countAll, countCorrectness, countClarity, countStyle;

  var DISMISSED_KEY = 'govuk-wa-dismissed';

  /**
   * Category-based explanation lookup.
   * Compact map — one explanation per category instead of duplicating across ~348 rules.
   */
  var CATEGORY_EXPLANATIONS = {
    'Spelling':           'Check spelling using the Oxford Dictionary for Writers and Editors.',
    'Grammar':            'Use correct grammar so your meaning is clear first time.',
    'Punctuation':        'GOV.UK uses minimal punctuation — no Oxford commas, semicolons only when necessary.',
    'Capitalisation':     'GOV.UK avoids unnecessary capitals. Only capitalise proper nouns and specific titles.',
    'Style':              'Follow the GOV.UK style guide for consistent, user-friendly language.',
    'GOV.UK style':       'Follow the GOV.UK style guide for words and formatting that users expect on government services.',
    'Plain English':      'Use plain English. Replace jargon and formal language with simpler alternatives.',
    'Contractions':       'GOV.UK uses contractions like "you\u2019re" and "can\u2019t" to keep the tone conversational.',
    'Numbers':            'Spell out one to nine. Use digits for 10 and above, following GOV.UK number style.',
    'Number formatting':  'Format numbers consistently — use commas for thousands and write units in full.',
    'Date format':        'Write dates as "1 January 2024" — no st/nd/rd/th, no leading zeros.',
    'Time formatting':    'Use "am" and "pm" (no full stops), for example "9:30am" or "5pm".',
    'Abbreviations':      'Spell out abbreviations the first time you use them, unless they are well known.',
    'Lists':              'Use bullet points for lists. Start each item with a lowercase letter; no full stops unless they are sentences.',
    'Custom rule':        'This rule was added by your organisation\u2019s custom style settings.',
    'Passive voice':      'Use active sentences — they are clearer and more direct than passive ones.',
    'Sentence length':    'Keep sentences short. Aim for an average of 15 to 20 words per sentence.',
    'Tone':               'Write in a tone that is direct, informative and suited to your audience.',
    'Word choice':        'Choose simpler, more familiar words so all users can understand your content.',
    'Readability':        'Write at a reading level that your whole audience can follow — aim for age 9 reading level.',
    'Links':              'Make link text descriptive. Avoid "click here" — say where the link goes.',
    'Length':             'Keep your content concise. Remove anything that does not help the user.'
  };

  /**
   * Map ruleIds/groups to display categories.
   */
  function getCardCategory(suggestion) {
    var group = suggestion.group;
    var ruleId = suggestion.ruleId;

    // Style category: GOV.UK style, contractions, numbers, date format, time, punctuation, capitalisation
    if (['contractions', 'numbers', 'date-format', 'govuk-style', 'number-formatting', 'time-formatting', 'govuk-punctuation', 'govuk-capitalisation'].indexOf(ruleId) !== -1) {
      return 'style';
    }
    // Clarity: sentence length, passive voice, overused words, tone, plain English
    if (['sentence-length', 'passive-voice', 'overused-word', 'tone', 'email-tone', 'chat-length'].indexOf(ruleId) !== -1) {
      return 'clarity';
    }
    if (suggestion.category === 'Plain English') return 'clarity';
    // Respect explicit group from pattern definitions
    if (group === 'style') return 'style';
    if (group === 'correctness') return 'correctness';
    if (group === 'clarity') return 'clarity';
    return 'correctness';
  }

  function init(callbacks) {
    onApply = callbacks.onApply;
    onApplyAll = callbacks.onApplyAll;
    onSelect = callbacks.onSelect;
    onSuggestFix = callbacks.onSuggestFix || null;
    onDismiss = callbacks.onDismiss || null;

    listEl = document.getElementById('suggestionsList');
    scoreNumber = document.getElementById('scoreNumber');
    scoreRingFill = document.getElementById('scoreRingFill');
    scoreReadability = document.getElementById('scoreReadability');
    countAll = document.getElementById('countAll');
    countCorrectness = document.getElementById('countCorrectness');
    countClarity = document.getElementById('countClarity');
    countStyle = document.getElementById('countStyle');

    loadDismissed();

    // Category tab listeners
    var catTabs = document.querySelectorAll('.cat-tab');
    catTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        catTabs.forEach(function (t) { t.classList.remove('active'); });
        tab.classList.add('active');
        activeFilter = tab.dataset.filter;
        render();
      });
    });
  }

  function loadDismissed() {
    try {
      var stored = JSON.parse(localStorage.getItem(DISMISSED_KEY)) || [];
      // Clean out any old spelling/missing-letter dismiss keys that were
      // permanently stored before we switched them to session-only
      var cleaned = stored.filter(function (key) {
        return key.indexOf('spelling:') !== 0 && key.indexOf('missing-letter:') !== 0;
      });
      if (cleaned.length !== stored.length) {
        console.log('[WritingAssistant] Cleaned ' + (stored.length - cleaned.length) + ' stale spelling dismiss keys from localStorage');
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(cleaned));
      }
      dismissedIds = new Set(cleaned);
    } catch (e) {
      dismissedIds = new Set();
    }
  }

  function saveDismissed() {
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(dismissedIds)));
    } catch (e) {
      console.warn('[WritingAssistant] Could not save dismissed items:', e.message);
    }
  }

  function makeDismissKey(s) {
    return s.ruleId + ':' + (s.original || '').toLowerCase();
  }

  function isDismissed(s) {
    var key = makeDismissKey(s);
    return dismissedIds.has(key) || sessionDismissedIds.has(key);
  }

  function setCorrectness(suggestions) {
    correctnessSuggestions = suggestions.filter(function (s) { return !isDismissed(s); });
    render();
  }

  function areSuggestionsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].start !== b[i].start || a[i].end !== b[i].end ||
          a[i].ruleId !== b[i].ruleId || a[i].message !== b[i].message) return false;
    }
    return true;
  }

  function setClarity(suggestions) {
    var filtered = suggestions.filter(function (s) { return !isDismissed(s); });
    // Skip re-render if results haven't changed (avoids flicker on auto-check)
    if (hasRunFullCheck && areSuggestionsEqual(claritySuggestions, filtered)) return;
    hasRunFullCheck = true;
    claritySuggestions = filtered;
    render();
  }

  function markFullCheckRun() {
    hasRunFullCheck = true;
    render();
  }

  /**
   * Spelling dismissals are session-only to prevent one "ignore" from
   * silently blocking that misspelling across all future documents.
   */
  var SESSION_ONLY_RULES = ['spelling', 'missing-letter'];

  function dismiss(suggestion) {
    var key = makeDismissKey(suggestion);
    if (SESSION_ONLY_RULES.indexOf(suggestion.ruleId) !== -1) {
      sessionDismissedIds.add(key);
    } else {
      dismissedIds.add(key);
      saveDismissed();
    }

    correctnessSuggestions = correctnessSuggestions.filter(function (s) { return s.id !== suggestion.id; });
    claritySuggestions = claritySuggestions.filter(function (s) { return s.id !== suggestion.id; });

    if (activeSuggestionId === suggestion.id) activeSuggestionId = null;
    if (expandedCardId === suggestion.id) expandedCardId = null;
    render();
    if (onDismiss) onDismiss();
  }

  /**
   * Dismiss a suggestion for this session only (comes back next time).
   */
  function dismissOnce(suggestion) {
    var key = makeDismissKey(suggestion);
    sessionDismissedIds.add(key);

    correctnessSuggestions = correctnessSuggestions.filter(function (s) { return s.id !== suggestion.id; });
    claritySuggestions = claritySuggestions.filter(function (s) { return s.id !== suggestion.id; });

    if (activeSuggestionId === suggestion.id) activeSuggestionId = null;
    if (expandedCardId === suggestion.id) expandedCardId = null;
    render();
    if (onDismiss) onDismiss();
  }

  function getSiblings(suggestion) {
    var key = makeDismissKey(suggestion);
    var all = correctnessSuggestions.concat(claritySuggestions);
    return all.filter(function (s) { return makeDismissKey(s) === key; });
  }

  function applyAll(suggestion) {
    var siblings = getSiblings(suggestion);
    siblings.sort(function (a, b) { return b.start - a.start; });

    if (onApplyAll) onApplyAll(siblings);

    var siblingIds = new Set(siblings.map(function (s) { return s.id; }));
    // Don't permanently dismiss — the text is being changed so issues resolve naturally
    correctnessSuggestions = correctnessSuggestions.filter(function (s) { return !siblingIds.has(s.id); });
    claritySuggestions = claritySuggestions.filter(function (s) { return !siblingIds.has(s.id); });

    if (siblingIds.has(activeSuggestionId)) activeSuggestionId = null;
    if (siblingIds.has(expandedCardId)) expandedCardId = null;
    render();
    if (onDismiss) onDismiss();
  }

  function dismissAll(suggestion) {
    var siblings = getSiblings(suggestion);
    var siblingIds = new Set(siblings.map(function (s) { return s.id; }));

    var isSessionOnly = SESSION_ONLY_RULES.indexOf(suggestion.ruleId) !== -1;
    siblings.forEach(function (s) {
      var key = makeDismissKey(s);
      if (isSessionOnly) { sessionDismissedIds.add(key); }
      else { dismissedIds.add(key); }
    });
    if (!isSessionOnly) saveDismissed();

    correctnessSuggestions = correctnessSuggestions.filter(function (s) { return !siblingIds.has(s.id); });
    claritySuggestions = claritySuggestions.filter(function (s) { return !siblingIds.has(s.id); });

    if (siblingIds.has(activeSuggestionId)) activeSuggestionId = null;
    if (siblingIds.has(expandedCardId)) expandedCardId = null;
    render();
    if (onDismiss) onDismiss();
  }

  function getAll() {
    return correctnessSuggestions.concat(claritySuggestions);
  }

  // ===== Score calculation =====

  // Score deduction weights per category
  var DEDUCTION_CORRECTNESS = 4;
  var DEDUCTION_CLARITY = 2;
  var DEDUCTION_STYLE = 1;

  function calculateScore(allSuggestions) {
    if (allSuggestions.length === 0) return 100;
    var deductions = 0;
    allSuggestions.forEach(function (s) {
      var cat = getCardCategory(s);
      if (cat === 'correctness') deductions += DEDUCTION_CORRECTNESS;
      else if (cat === 'clarity') deductions += DEDUCTION_CLARITY;
      else deductions += DEDUCTION_STYLE;
    });
    return Math.max(0, Math.min(100, 100 - deductions));
  }

  function updateScore(allSuggestions) {
    var score = calculateScore(allSuggestions);
    scoreNumber.textContent = score;

    // Animate ring
    var circumference = 213.6; // 2 * PI * 34
    var offset = circumference - (score / 100) * circumference;
    scoreRingFill.style.strokeDashoffset = offset;

    // Color
    scoreRingFill.setAttribute('class', 'score-ring-fill');
    var scoreLabel;
    if (score >= 80) { scoreRingFill.classList.add('score-good'); scoreLabel = 'Good'; }
    else if (score >= 60) { scoreRingFill.classList.add('score-ok'); scoreLabel = 'OK'; }
    else if (score >= 40) { scoreRingFill.classList.add('score-poor'); scoreLabel = 'Needs work'; }
    else { scoreRingFill.classList.add('score-bad'); scoreLabel = 'Poor'; }

    // Update aria-label on score circle
    var scoreCircle = document.getElementById('scoreCircle');
    if (scoreCircle) {
      scoreCircle.setAttribute('aria-label', 'Writing score: ' + score + ' out of 100 — ' + scoreLabel);
    }
  }

  function updateReadabilityDisplay() {
    if (!scoreReadability) return;
    try {
      var grade = Stats.getGradeLevel();
      if (grade === null) {
        scoreReadability.textContent = '';
        return;
      }
      var label, cls;
      if (grade <= 6) { label = 'Grade ' + grade + ' \u00b7 Good'; cls = 'readability-easy'; }
      else if (grade <= 9) { label = 'Grade ' + grade + ' \u00b7 OK'; cls = 'readability-ok'; }
      else if (grade <= 12) { label = 'Grade ' + grade + ' \u00b7 Hard to read'; cls = 'readability-hard'; }
      else { label = 'Grade ' + grade + ' \u00b7 Very hard to read'; cls = 'readability-vhard'; }
      scoreReadability.textContent = label;
      scoreReadability.className = 'score-readability ' + cls;
    } catch (e) {
      scoreReadability.textContent = '';
    }
  }

  // ===== Deduplication =====

  function deduplicateSuggestions(suggestions) {
    var groups = {};
    var order = [];
    suggestions.forEach(function (s) {
      var key = makeDismissKey(s);
      if (!groups[key]) {
        groups[key] = [];
        order.push(key);
      }
      groups[key].push(s);
    });
    return order.map(function (key) {
      return { suggestion: groups[key][0], siblings: groups[key] };
    });
  }

  // ===== Rendering =====

  var renderTimer = null;
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = requestAnimationFrame(function () {
      renderTimer = null;
      renderNow();
    });
  }

  function render() {
    scheduleRender();
  }

  function renderNow() {
    var all = correctnessSuggestions.concat(claritySuggestions);

    // Sort by document position (reading order)
    all.sort(function (a, b) { return a.start - b.start; });

    // Count by category
    var corrCount = 0, clarCount = 0, styleCount = 0;
    all.forEach(function (s) {
      var cat = getCardCategory(s);
      if (cat === 'correctness') corrCount++;
      else if (cat === 'clarity') clarCount++;
      else if (cat === 'style') styleCount++;
    });

    countAll.textContent = all.length;
    countCorrectness.textContent = corrCount;
    countClarity.textContent = clarCount;
    countStyle.textContent = styleCount;

    updateScore(all);
    updateReadabilityDisplay();

    // Filter suggestions
    var filtered;
    if (activeFilter === 'all') {
      filtered = all;
    } else {
      filtered = all.filter(function (s) { return getCardCategory(s) === activeFilter; });
    }

    // Render cards
    listEl.innerHTML = '';

    if (filtered.length === 0) {
      var emptyP = document.createElement('p');
      emptyP.className = 'empty-state';
      if (all.length === 0) {
        emptyP.textContent = 'No issues found';
      } else {
        emptyP.textContent = 'No issues in this category.';
      }
      listEl.appendChild(emptyP);
      return;
    }

    var deduped = deduplicateSuggestions(filtered);

    // Sort: correctness first, then clarity, then style.
    // Within each category, most frequent issues first, then by document position.
    var CATEGORY_ORDER = { 'correctness': 0, 'clarity': 1, 'style': 2 };
    deduped.sort(function (a, b) {
      var catKeyA = getCardCategory(a.suggestion);
      var catA = catKeyA in CATEGORY_ORDER ? CATEGORY_ORDER[catKeyA] : 1;
      var catKeyB = getCardCategory(b.suggestion);
      var catB = catKeyB in CATEGORY_ORDER ? CATEGORY_ORDER[catKeyB] : 1;
      if (catA !== catB) return catA - catB;
      // Within same category: most occurrences first
      if (b.siblings.length !== a.siblings.length) return b.siblings.length - a.siblings.length;
      // Tiebreak: document position
      return a.suggestion.start - b.suggestion.start;
    });

    deduped.forEach(function (d) {
      listEl.appendChild(createCard(d.suggestion, d.siblings));
    });
  }

  // ===== Context snippets =====

  function getEditorText() {
    try { return Editor.getText() || ''; } catch (e) { return ''; }
  }

  function buildContextSnippet(suggestion) {
    var text = getEditorText();
    if (!text || suggestion.start === undefined) return null;

    var start = suggestion.start;
    var end = suggestion.end !== undefined ? suggestion.end : (start + (suggestion.original || '').length);
    if (start < 0 || end > text.length) return null;

    var ctxBefore = text.substring(Math.max(0, start - 80), start);
    var ctxTarget = text.substring(start, end);
    var ctxAfter = text.substring(end, Math.min(text.length, end + 80));

    if (start - 80 > 0) {
      var spaceIdx = ctxBefore.indexOf(' ');
      if (spaceIdx !== -1) ctxBefore = ctxBefore.substring(spaceIdx + 1);
      ctxBefore = '...' + ctxBefore;
    }
    if (end + 80 < text.length) {
      var lastSpace = ctxAfter.lastIndexOf(' ');
      if (lastSpace !== -1) ctxAfter = ctxAfter.substring(0, lastSpace);
      ctxAfter = ctxAfter + '...';
    }

    ctxBefore = ctxBefore.replace(/\n/g, ' ');
    ctxTarget = ctxTarget.replace(/\n/g, ' ');
    ctxAfter = ctxAfter.replace(/\n/g, ' ');

    return { before: ctxBefore, target: ctxTarget, after: ctxAfter };
  }

  // ===== Card creation =====

  function createCard(suggestion, siblings) {
    var cat = getCardCategory(suggestion);
    var card = document.createElement('div');
    card.className = 'suggestion-card ' + cat;
    card.dataset.id = suggestion.id;

    if (!siblings) siblings = [suggestion];
    var hasSiblings = siblings.length > 1;

    if (suggestion.id === activeSuggestionId) card.classList.add('active');
    if (suggestion.id === expandedCardId) card.classList.add('expanded');

    // --- Header (always visible, compact) ---
    var header = document.createElement('div');
    header.className = 'card-header';

    var dot = document.createElement('span');
    dot.className = 'card-dot ' + cat;
    header.appendChild(dot);

    var headerText = document.createElement('div');
    headerText.className = 'card-header-text';

    // Category badge (e.g. "Spelling", "Capitalisation", "Plain English")
    var catBadge = document.createElement('span');
    catBadge.className = 'card-category-badge ' + cat;
    catBadge.textContent = suggestion.category || cat;
    headerText.appendChild(catBadge);

    // AI badge for AI-enhanced suggestions
    if (suggestion.aiEnhanced || (suggestion.source === 'ai' && suggestion.ruleId && suggestion.ruleId.indexOf('ai-') === 0)) {
      var aiBadge = document.createElement('span');
      aiBadge.className = 'ai-badge';
      aiBadge.textContent = 'AI';
      headerText.appendChild(aiBadge);
    }

    var titleEl = document.createElement('div');
    titleEl.className = 'card-title';
    titleEl.textContent = suggestion.title || suggestion.message;
    headerText.appendChild(titleEl);

    // Show the flagged word in compact view
    var wordEl = document.createElement('div');
    wordEl.className = 'card-word';
    var original = suggestion.original || '';
    wordEl.textContent = original.length > 50 ? original.substring(0, 50) + '...' : original;
    headerText.appendChild(wordEl);

    header.appendChild(headerText);

    if (hasSiblings) {
      var badge = document.createElement('span');
      badge.className = 'occurrence-badge';
      badge.textContent = siblings.length + '\u00d7';
      header.appendChild(badge);
    }

    // Chevron
    var chevron = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chevron.setAttribute('viewBox', '0 0 16 16');
    chevron.setAttribute('class', 'card-chevron');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 6l4 4 4-4');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    chevron.appendChild(path);
    header.appendChild(chevron);

    card.appendChild(header);

    // Click header to expand/collapse
    header.addEventListener('click', function (e) {
      if (e.target.closest('.suggestion-actions')) return;
      if (expandedCardId === suggestion.id) {
        expandedCardId = null;
      } else {
        expandedCardId = suggestion.id;
        activeSuggestionId = suggestion.id;
        if (onSelect) onSelect(suggestion);
      }
      render();
    });

    // --- Body (shown when expanded) ---
    var body = document.createElement('div');
    body.className = 'card-body';

    // Context snippet
    var ctx = buildContextSnippet(suggestion);
    if (ctx) {
      var ctxEl = document.createElement('div');
      ctxEl.className = 'suggestion-context';
      ctxEl.innerHTML =
        escapeHtml(ctx.before) +
        '<mark class="context-highlight">' + escapeHtml(ctx.target) + '</mark>' +
        escapeHtml(ctx.after);
      body.appendChild(ctxEl);
    }

    // Message
    var msgEl = document.createElement('div');
    msgEl.className = 'suggestion-message';
    msgEl.textContent = suggestion.message;
    body.appendChild(msgEl);

    // Category explanation (GOV.UK style block-quote)
    var explanationText = CATEGORY_EXPLANATIONS[suggestion.category];
    if (explanationText) {
      var explEl = document.createElement('blockquote');
      explEl.className = 'suggestion-explanation';
      explEl.textContent = explanationText;
      body.appendChild(explEl);
    }

    // Replacement preview — alternatives or single
    var hasAlternatives = suggestion.alternatives && suggestion.alternatives.length > 1;
    if (hasAlternatives && suggestion.original) {
      var altContainer = document.createElement('div');
      altContainer.className = 'suggestion-alternatives';
      var origSpan = document.createElement('span');
      origSpan.className = 'original';
      origSpan.textContent = suggestion.original;
      altContainer.appendChild(origSpan);
      var arrowSpan = document.createElement('span');
      arrowSpan.className = 'arrow';
      arrowSpan.textContent = ' \u2192 ';
      altContainer.appendChild(arrowSpan);
      suggestion.alternatives.forEach(function (alt, idx) {
        var altBtn = document.createElement('button');
        altBtn.type = 'button';
        altBtn.className = idx === 0 ? 'btn btn-primary btn-sm alt-btn' : 'btn btn-secondary btn-sm alt-btn';
        altBtn.textContent = alt;
        altBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          suggestion.replacement = alt;
          if (onApply) onApply(suggestion);
          correctnessSuggestions = correctnessSuggestions.filter(function (s) { return s.id !== suggestion.id; });
          claritySuggestions = claritySuggestions.filter(function (s) { return s.id !== suggestion.id; });
          if (activeSuggestionId === suggestion.id) activeSuggestionId = null;
          if (expandedCardId === suggestion.id) expandedCardId = null;
          render();
          if (onDismiss) onDismiss();
        });
        altContainer.appendChild(altBtn);
      });
      body.appendChild(altContainer);
    } else if (suggestion.replacement != null && suggestion.original) {
      var preview = document.createElement('div');
      preview.className = 'suggestion-preview';
      preview.innerHTML =
        '<span class="original">' + escapeHtml(suggestion.original) + '</span>' +
        '<span class="arrow"> \u2192 </span>' +
        '<span class="replacement">' + escapeHtml(suggestion.replacement) + '</span>';
      body.appendChild(preview);
    }

    // Read aloud button for this suggestion's sentence
    var readBtn = document.createElement('button');
    readBtn.type = 'button';
    readBtn.className = 'btn btn-secondary btn-sm card-read-btn';
    readBtn.title = 'Read this sentence aloud';
    readBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 5.5h2l4-3v11l-4-3H3a1 1 0 01-1-1v-3a1 1 0 011-1z" fill="currentColor"/><path d="M11 5.5a3 3 0 010 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg> Hear it';
    readBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      readSuggestionSentence(suggestion);
    });
    body.appendChild(readBtn);

    // Actions
    var actions = document.createElement('div');
    actions.className = 'suggestion-actions';

    if (suggestion.replacement != null && !hasAlternatives) {
      if (hasSiblings) {
        var applyAllBtn = document.createElement('button');
        applyAllBtn.type = 'button';
        applyAllBtn.className = 'btn btn-primary btn-sm';
        applyAllBtn.textContent = 'Fix all (' + siblings.length + ')';
        applyAllBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (applyAllBtn.disabled) return;
          applyAllBtn.disabled = true;
          applyAll(suggestion);
        });
        actions.appendChild(applyAllBtn);
      } else {
        var applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'btn btn-primary btn-sm';
        applyBtn.textContent = 'Fix';
        applyBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (onApply) onApply(suggestion);
          // Remove from arrays without permanently dismissing the rule
          // (dismiss() would add to dismissedIds, silencing future occurrences)
          correctnessSuggestions = correctnessSuggestions.filter(function (s) { return s.id !== suggestion.id; });
          claritySuggestions = claritySuggestions.filter(function (s) { return s.id !== suggestion.id; });
          if (activeSuggestionId === suggestion.id) activeSuggestionId = null;
          if (expandedCardId === suggestion.id) expandedCardId = null;
          render();
          if (onDismiss) onDismiss();
        });
        actions.appendChild(applyBtn);
      }
    } else if (suggestion.source === 'ai' && onSuggestFix) {
      // "Suggest fix" button — requests an AI-generated rewrite on demand
      var suggestBtn = document.createElement('button');
      suggestBtn.type = 'button';
      suggestBtn.className = 'btn btn-secondary btn-sm';
      suggestBtn.textContent = 'Suggest fix';
      suggestBtn.title = 'Ask AI to suggest a rewrite';
      suggestBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        suggestBtn.textContent = 'Thinking...';
        suggestBtn.disabled = true;
        onSuggestFix(suggestion, function (replacement) {
          if (replacement) {
            suggestion.replacement = replacement;
            render(); // Re-render to show the Fix button
          } else {
            suggestBtn.textContent = 'No suggestion';
            setTimeout(function () {
              suggestBtn.textContent = 'Suggest fix';
              suggestBtn.disabled = false;
            }, 2000);
          }
        });
      });
      actions.appendChild(suggestBtn);
    }

    // "Ignore this time" — session-only dismiss (comes back next document)
    var ignoreOnceBtn = document.createElement('button');
    ignoreOnceBtn.type = 'button';
    ignoreOnceBtn.className = 'btn btn-secondary btn-sm';
    ignoreOnceBtn.textContent = 'Ignore once';
    ignoreOnceBtn.title = 'Dismiss for this session only — will come back next time';
    ignoreOnceBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      dismissOnce(suggestion);
    });
    actions.appendChild(ignoreOnceBtn);

    // "Ignore always" — permanent dismiss (localStorage)
    var dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'btn btn-secondary btn-sm';
    dismissBtn.textContent = hasSiblings ? 'Ignore all' : 'Ignore always';
    dismissBtn.title = 'Dismiss permanently — will not come back';
    dismissBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (hasSiblings) dismissAll(suggestion);
      else dismiss(suggestion);
    });
    actions.appendChild(dismissBtn);

    body.appendChild(actions);
    card.appendChild(body);

    return card;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Select and expand a suggestion by its ID (used when clicking inline underlines).
   */
  function selectById(id) {
    // Find the suggestion
    var all = correctnessSuggestions.concat(claritySuggestions);
    var found = null;
    for (var i = 0; i < all.length; i++) {
      if (all[i].id === id) { found = all[i]; break; }
    }
    if (!found) return;

    // Find the deduplication group key for this suggestion
    var groupKey = makeDismissKey(found);

    // Find the representative (first in group) which is what the card is keyed on
    var representative = null;
    for (var j = 0; j < all.length; j++) {
      if (makeDismissKey(all[j]) === groupKey) { representative = all[j]; break; }
    }
    if (!representative) return;

    activeSuggestionId = representative.id;
    expandedCardId = representative.id;
    render();

    // Scroll the card into view
    var cardEl = listEl.querySelector('[data-id="' + CSS.escape(representative.id) + '"]');
    if (cardEl) {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  /**
   * Read aloud the sentence containing a suggestion using TTS.
   * Finds the sentence boundaries around the flagged text.
   */
  function readSuggestionSentence(suggestion) {
    if (!window.speechSynthesis) return;
    var text = getEditorText();
    if (!text || suggestion.start === undefined) return;

    // Find sentence boundaries around the suggestion
    var start = suggestion.start;
    // Walk backwards to find sentence start (period, newline, or text start)
    var sentStart = start;
    while (sentStart > 0 && !/[.!?\n]/.test(text[sentStart - 1])) sentStart--;

    // Walk forwards from end of the flagged text to find sentence end
    var end = suggestion.end !== undefined ? suggestion.end : (start + (suggestion.original || '').length);
    var sentEnd = end;
    while (sentEnd < text.length && !/[.!?\n]/.test(text[sentEnd])) sentEnd++;
    if (sentEnd < text.length && /[.!?]/.test(text[sentEnd])) sentEnd++; // include the punctuation

    var sentence = text.substring(sentStart, sentEnd).trim();
    if (!sentence) return;

    // Stop any current speech first
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
    }

    var utterance = new SpeechSynthesisUtterance(sentence);
    utterance.lang = 'en-GB';
    utterance.rate = 0.9;
    utterance.onerror = function () { /* TTS is best-effort — ignore failures */ };
    window.speechSynthesis.speak(utterance);
  }

  function clearAll() {
    correctnessSuggestions = [];
    claritySuggestions = [];
    sessionDismissedIds = new Set();
    activeSuggestionId = null;
    expandedCardId = null;
    hasRunFullCheck = false;
    render();
  }

  return {
    init: init,
    setCorrectness: setCorrectness,
    setClarity: setClarity,
    markFullCheckRun: markFullCheckRun,
    dismiss: dismiss,
    dismissOnce: dismissOnce,
    isDismissed: isDismissed,
    getAll: getAll,
    clearAll: clearAll,
    selectById: selectById,
    render: render
  };
})();
