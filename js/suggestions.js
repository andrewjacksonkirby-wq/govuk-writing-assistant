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
  var correctnessSuggestions = [];
  var claritySuggestions = [];
  var dismissedIds = new Set();
  var activeFilter = 'all';
  var activeSuggestionId = null;
  var expandedCardId = null;
  var hasRunFullCheck = false;

  // Callbacks
  var onApply = null;
  var onApplyAll = null;
  var onSelect = null;

  // DOM refs
  var listEl;
  var scoreNumber, scoreRingFill, scoreReadability;
  var countAll, countCorrectness, countClarity, countStyle;

  var DISMISSED_KEY = 'govuk-wa-dismissed';

  /**
   * Map ruleIds/groups to display categories.
   */
  function getCardCategory(suggestion) {
    var group = suggestion.group;
    var ruleId = suggestion.ruleId;

    // Style category: GOV.UK style, contractions, numbers, date format
    if (['contractions', 'numbers', 'date-format', 'govuk-style'].indexOf(ruleId) !== -1) {
      return 'style';
    }
    // Clarity: sentence length, passive voice, overused words, tone
    if (['sentence-length', 'passive-voice', 'overused-word', 'tone', 'email-tone', 'chat-length'].indexOf(ruleId) !== -1) {
      return 'clarity';
    }
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
      dismissedIds = new Set(stored);
    } catch (e) {
      dismissedIds = new Set();
    }
  }

  function saveDismissed() {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(dismissedIds)));
  }

  function setCorrectness(suggestions) {
    correctnessSuggestions = suggestions.filter(function (s) {
      return !dismissedIds.has(s.ruleId + ':' + s.start + ':' + s.original);
    });
    render();
  }

  function setClarity(suggestions) {
    hasRunFullCheck = true;
    claritySuggestions = suggestions.filter(function (s) {
      return !dismissedIds.has(s.ruleId + ':' + s.start + ':' + (s.original || ''));
    });
    render();
  }

  function markFullCheckRun() {
    hasRunFullCheck = true;
    render();
  }

  function dismiss(suggestion) {
    var key = suggestion.ruleId + ':' + suggestion.start + ':' + (suggestion.original || '');
    dismissedIds.add(key);
    saveDismissed();

    correctnessSuggestions = correctnessSuggestions.filter(function (s) { return s.id !== suggestion.id; });
    claritySuggestions = claritySuggestions.filter(function (s) { return s.id !== suggestion.id; });

    if (activeSuggestionId === suggestion.id) activeSuggestionId = null;
    if (expandedCardId === suggestion.id) expandedCardId = null;
    render();
  }

  function getSiblingKey(suggestion) {
    return suggestion.ruleId + ':' + (suggestion.original || '').toLowerCase();
  }

  function getSiblings(suggestion) {
    var key = getSiblingKey(suggestion);
    var all = correctnessSuggestions.concat(claritySuggestions);
    return all.filter(function (s) { return getSiblingKey(s) === key; });
  }

  function applyAll(suggestion) {
    var siblings = getSiblings(suggestion);
    siblings.sort(function (a, b) { return b.start - a.start; });

    if (onApplyAll) onApplyAll(siblings);

    var siblingIds = new Set(siblings.map(function (s) { return s.id; }));
    siblings.forEach(function (s) {
      var key = s.ruleId + ':' + s.start + ':' + (s.original || '');
      dismissedIds.add(key);
    });
    saveDismissed();

    correctnessSuggestions = correctnessSuggestions.filter(function (s) { return !siblingIds.has(s.id); });
    claritySuggestions = claritySuggestions.filter(function (s) { return !siblingIds.has(s.id); });

    if (siblingIds.has(activeSuggestionId)) activeSuggestionId = null;
    if (siblingIds.has(expandedCardId)) expandedCardId = null;
    render();
  }

  function dismissAll(suggestion) {
    var siblings = getSiblings(suggestion);
    var siblingIds = new Set(siblings.map(function (s) { return s.id; }));

    siblings.forEach(function (s) {
      var key = s.ruleId + ':' + s.start + ':' + (s.original || '');
      dismissedIds.add(key);
    });
    saveDismissed();

    correctnessSuggestions = correctnessSuggestions.filter(function (s) { return !siblingIds.has(s.id); });
    claritySuggestions = claritySuggestions.filter(function (s) { return !siblingIds.has(s.id); });

    if (siblingIds.has(activeSuggestionId)) activeSuggestionId = null;
    if (siblingIds.has(expandedCardId)) expandedCardId = null;
    render();
  }

  function getAll() {
    return correctnessSuggestions.concat(claritySuggestions);
  }

  // ===== Score calculation =====

  function calculateScore(allSuggestions) {
    if (allSuggestions.length === 0) return 100;
    // Deduct points per issue, weighted by type
    var deductions = 0;
    allSuggestions.forEach(function (s) {
      var cat = getCardCategory(s);
      if (cat === 'correctness') deductions += 4;
      else if (cat === 'clarity') deductions += 2;
      else deductions += 1;
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
    scoreRingFill.className = 'score-ring-fill';
    if (score >= 80) scoreRingFill.classList.add('score-good');
    else if (score >= 60) scoreRingFill.classList.add('score-ok');
    else if (score >= 40) scoreRingFill.classList.add('score-poor');
    else scoreRingFill.classList.add('score-bad');
  }

  function updateReadabilityDisplay() {
    if (!scoreReadability) return;
    try {
      var score = Stats.getReadabilityScore();
      if (score === null) {
        scoreReadability.textContent = '';
        return;
      }
      var label, cls;
      if (score >= 70) { label = 'Readability: Easy (' + score + ')'; cls = 'readability-easy'; }
      else if (score >= 50) { label = 'Readability: OK (' + score + ')'; cls = 'readability-ok'; }
      else if (score >= 30) { label = 'Readability: Hard (' + score + ')'; cls = 'readability-hard'; }
      else { label = 'Readability: Very hard (' + score + ')'; cls = 'readability-vhard'; }
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
      var key = getSiblingKey(s);
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

  function render() {
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
        emptyP.textContent = 'No issues found. Looking good!';
      } else {
        emptyP.textContent = 'No issues in this category';
      }
      listEl.appendChild(emptyP);
      return;
    }

    var deduped = deduplicateSuggestions(filtered);
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
    var end = suggestion.end || (start + (suggestion.original || '').length);
    if (start < 0 || end > text.length) return null;

    var ctxBefore = text.substring(Math.max(0, start - 40), start);
    var ctxTarget = text.substring(start, end);
    var ctxAfter = text.substring(end, Math.min(text.length, end + 40));

    if (start - 40 > 0) {
      var spaceIdx = ctxBefore.indexOf(' ');
      if (spaceIdx !== -1) ctxBefore = ctxBefore.substring(spaceIdx + 1);
      ctxBefore = '...' + ctxBefore;
    }
    if (end + 40 < text.length) {
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

    // Replacement preview
    if (suggestion.replacement !== undefined && suggestion.original) {
      var preview = document.createElement('div');
      preview.className = 'suggestion-preview';
      preview.innerHTML =
        '<span class="original">' + escapeHtml(suggestion.original) + '</span>' +
        '<span class="arrow"> \u2192 </span>' +
        '<span class="replacement">' + escapeHtml(suggestion.replacement) + '</span>';
      body.appendChild(preview);
    }

    // Actions
    var actions = document.createElement('div');
    actions.className = 'suggestion-actions';

    if (suggestion.replacement !== undefined) {
      if (hasSiblings) {
        var applyAllBtn = document.createElement('button');
        applyAllBtn.type = 'button';
        applyAllBtn.className = 'btn btn-primary btn-sm';
        applyAllBtn.textContent = 'Accept all (' + siblings.length + ')';
        applyAllBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          applyAll(suggestion);
        });
        actions.appendChild(applyAllBtn);
      } else {
        var applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'btn btn-primary btn-sm';
        applyBtn.textContent = 'Accept';
        applyBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (onApply) onApply(suggestion);
          dismiss(suggestion);
        });
        actions.appendChild(applyBtn);
      }
    }

    var dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'btn btn-secondary btn-sm';
    dismissBtn.textContent = hasSiblings ? 'Dismiss all' : 'Dismiss';
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

  function clearAll() {
    correctnessSuggestions = [];
    claritySuggestions = [];
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
    getAll: getAll,
    clearAll: clearAll,
    render: render
  };
})();
