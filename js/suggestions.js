/**
 * Suggestions module
 * Manages the sidebar: rendering, filtering, grouping, apply/dismiss actions.
 */
const Suggestions = (function () {
  var correctnessSuggestions = [];
  var claritySuggestions = [];
  var dismissedIds = new Set();
  var activeFilter = 'all'; // 'all', 'correctness', 'clarity'
  var activeSuggestionId = null;
  var hasRunFullCheck = false;

  // Callbacks
  var onApply = null;
  var onApplyAll = null;
  var onSelect = null;

  // DOM refs (set during init)
  var listEl, correctnessBody, clarityBody;
  var correctnessCount, clarityCount;
  var summaryTotal, summaryCorrectness, summaryClarity;
  var clarityGroup, clarityEmpty;
  var correctnessGroup;

  // Dismissed storage key
  var DISMISSED_KEY = 'govuk-wa-dismissed';

  function init(callbacks) {
    onApply = callbacks.onApply;
    onApplyAll = callbacks.onApplyAll;
    onSelect = callbacks.onSelect;

    listEl = document.getElementById('suggestionsList');
    correctnessBody = document.getElementById('correctnessBody');
    clarityBody = document.getElementById('clarityBody');
    correctnessCount = document.getElementById('correctnessCount');
    clarityCount = document.getElementById('clarityCount');
    summaryTotal = document.getElementById('summaryTotal');
    summaryCorrectness = document.getElementById('summaryCorrectness');
    summaryClarity = document.getElementById('summaryClarity');
    clarityGroup = document.getElementById('clarityGroup');
    clarityEmpty = document.getElementById('clarityEmpty');
    correctnessGroup = document.getElementById('correctnessGroup');

    // Load dismissed
    loadDismissed();

    // Set up filter buttons
    var filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        filterBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activeFilter = btn.dataset.filter;
        render();
      });
    });

    // Set up group collapse toggles
    var groupHeaders = document.querySelectorAll('.group-header');
    groupHeaders.forEach(function (header) {
      header.addEventListener('click', function () {
        var expanded = header.getAttribute('aria-expanded') === 'true';
        header.setAttribute('aria-expanded', expanded ? 'false' : 'true');
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

  /**
   * Update correctness suggestions (from quick checks).
   */
  function setCorrectness(suggestions) {
    correctnessSuggestions = suggestions.filter(function (s) {
      return !dismissedIds.has(s.ruleId + ':' + s.start + ':' + s.original);
    });
    render();
  }

  /**
   * Update clarity suggestions (from full check).
   */
  function setClarity(suggestions) {
    hasRunFullCheck = true;
    claritySuggestions = suggestions.filter(function (s) {
      return !dismissedIds.has(s.ruleId + ':' + s.start + ':' + (s.original || ''));
    });
    render();
  }

  /**
   * Mark full check as run (even if no results yet).
   */
  function markFullCheckRun() {
    hasRunFullCheck = true;
    render();
  }

  /**
   * Dismiss a suggestion.
   */
  function dismiss(suggestion) {
    var key = suggestion.ruleId + ':' + suggestion.start + ':' + (suggestion.original || '');
    dismissedIds.add(key);
    saveDismissed();

    // Remove from arrays
    correctnessSuggestions = correctnessSuggestions.filter(function (s) { return s.id !== suggestion.id; });
    claritySuggestions = claritySuggestions.filter(function (s) { return s.id !== suggestion.id; });

    if (activeSuggestionId === suggestion.id) {
      activeSuggestionId = null;
    }

    render();
  }

  /**
   * Get the grouping key for a suggestion (same rule + same original text).
   */
  function getSiblingKey(suggestion) {
    return suggestion.ruleId + ':' + (suggestion.original || '').toLowerCase();
  }

  /**
   * Find all suggestions that match the same rule and original text.
   */
  function getSiblings(suggestion) {
    var key = getSiblingKey(suggestion);
    var all = correctnessSuggestions.concat(claritySuggestions);
    return all.filter(function (s) {
      return getSiblingKey(s) === key;
    });
  }

  /**
   * Apply fix to all matching suggestions (same rule + original text).
   * Applies in reverse document order so offsets stay valid.
   */
  function applyAll(suggestion) {
    var siblings = getSiblings(suggestion);
    // Sort by position descending for safe replacement
    siblings.sort(function (a, b) { return b.start - a.start; });

    if (onApplyAll) {
      onApplyAll(siblings);
    }

    // Dismiss all siblings
    var siblingIds = new Set(siblings.map(function (s) { return s.id; }));
    siblings.forEach(function (s) {
      var key = s.ruleId + ':' + s.start + ':' + (s.original || '');
      dismissedIds.add(key);
    });
    saveDismissed();

    correctnessSuggestions = correctnessSuggestions.filter(function (s) { return !siblingIds.has(s.id); });
    claritySuggestions = claritySuggestions.filter(function (s) { return !siblingIds.has(s.id); });

    if (siblingIds.has(activeSuggestionId)) {
      activeSuggestionId = null;
    }
    render();
  }

  /**
   * Dismiss all matching suggestions (same rule + original text).
   */
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

    if (siblingIds.has(activeSuggestionId)) {
      activeSuggestionId = null;
    }
    render();
  }

  /**
   * Get all current suggestions.
   */
  function getAll() {
    return correctnessSuggestions.concat(claritySuggestions);
  }

  /**
   * Render the full sidebar.
   */
  function render() {
    var corr = correctnessSuggestions;
    var clar = claritySuggestions;

    // Update counts
    correctnessCount.textContent = corr.length;
    clarityCount.textContent = clar.length;
    summaryTotal.textContent = (corr.length + clar.length) + ' suggestions';
    summaryCorrectness.textContent = corr.length + ' correctness';
    summaryClarity.textContent = clar.length + ' clarity';

    // Filter visibility
    correctnessGroup.classList.toggle('hidden', activeFilter === 'clarity');
    clarityGroup.classList.toggle('hidden', activeFilter === 'correctness');

    // Render correctness
    renderGroup(correctnessBody, corr, 'correctness');

    // Render clarity
    renderClarityGroup(clarityBody, clar);
  }

  /**
   * Deduplicate suggestions: merge items with the same ruleId + original text
   * into a single representative item with a siblings count.
   * Returns array of { suggestion, siblings } objects.
   */
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

  function renderGroup(container, suggestions, groupClass) {
    container.innerHTML = '';

    if (suggestions.length === 0) {
      var emptyP = document.createElement('p');
      emptyP.className = 'empty-state';
      emptyP.textContent = 'No issues found';
      container.appendChild(emptyP);
      return;
    }

    // Deduplicate: group same rule+original into single cards
    var deduped = deduplicateSuggestions(suggestions);

    // Group by category
    var categories = {};
    deduped.forEach(function (d) {
      var cat = d.suggestion.category || 'Other';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(d);
    });

    var catKeys = Object.keys(categories);
    var singleCategory = catKeys.length === 1;

    catKeys.forEach(function (cat) {
      var items = categories[cat];

      if (singleCategory) {
        items.forEach(function (d) {
          container.appendChild(createCard(d.suggestion, groupClass, d.siblings));
        });
        return;
      }

      container.appendChild(buildCategoryGroup(cat, items, groupClass));
    });
  }

  /**
   * Build a collapsible category sub-group.
   * Starts collapsed — click the header to expand.
   */
  function buildCategoryGroup(cat, items, groupClass) {
    var catGroup = document.createElement('div');
    catGroup.className = 'category-group';

    // Count total individual issues (items are deduped groups)
    var totalIssues = 0;
    items.forEach(function (d) {
      totalIssues += d.siblings.length;
    });

    // Peek text: first item's title, e.g. "Missing capital letter, ..."
    var peekTitles = [];
    var seen = {};
    items.forEach(function (d) {
      var t = d.suggestion.title || '';
      if (t && !seen[t]) { seen[t] = true; peekTitles.push(t); }
    });
    var peek = peekTitles.slice(0, 2).join(', ');
    if (peekTitles.length > 2) peek += ', ...';

    var catHeader = document.createElement('button');
    catHeader.type = 'button';
    catHeader.className = 'category-header';
    catHeader.setAttribute('aria-expanded', 'false');
    catHeader.innerHTML =
      '<span class="category-label">' +
        '<span class="category-name">' + escapeHtml(cat) + '</span>' +
        '<span class="category-peek">' + escapeHtml(peek) + '</span>' +
      '</span>' +
      '<span class="category-count">' + totalIssues + '</span>';
    catHeader.addEventListener('click', function () {
      var expanded = catHeader.getAttribute('aria-expanded') === 'true';
      catHeader.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    });
    catGroup.appendChild(catHeader);

    var catBody = document.createElement('div');
    catBody.className = 'category-body';

    items.forEach(function (d) {
      catBody.appendChild(createCard(d.suggestion, groupClass, d.siblings));
    });

    catGroup.appendChild(catBody);
    return catGroup;
  }

  function renderClarityGroup(container, suggestions) {
    container.innerHTML = '';

    if (!hasRunFullCheck) {
      var emptyP = document.createElement('p');
      emptyP.className = 'empty-state';
      emptyP.textContent = 'Run "Check now" to see AI suggestions';
      container.appendChild(emptyP);
      return;
    }

    if (suggestions.length === 0) {
      var emptyP2 = document.createElement('p');
      emptyP2.className = 'empty-state';
      emptyP2.textContent = 'No issues found';
      container.appendChild(emptyP2);
      return;
    }

    // Deduplicate
    var deduped = deduplicateSuggestions(suggestions);

    // Group by category
    var categories = {};
    deduped.forEach(function (d) {
      var cat = d.suggestion.category || 'Other';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(d);
    });

    var catKeys = Object.keys(categories);
    var singleCategory = catKeys.length === 1;

    catKeys.forEach(function (cat) {
      var items = categories[cat];

      if (singleCategory) {
        items.forEach(function (d) {
          container.appendChild(createCard(d.suggestion, 'clarity', d.siblings));
        });
        return;
      }

      container.appendChild(buildCategoryGroup(cat, items, 'clarity'));
    });
  }

  /**
   * Get the full editor text for context snippets.
   */
  function getEditorText() {
    try {
      return Editor.getText() || '';
    } catch (e) {
      return '';
    }
  }

  /**
   * Build a context snippet showing surrounding text with the flagged word highlighted.
   * Shows ~30 chars either side, trimmed to word boundaries.
   */
  function buildContextSnippet(suggestion) {
    var text = getEditorText();
    if (!text || suggestion.start === undefined) return null;

    var start = suggestion.start;
    var end = suggestion.end || (start + (suggestion.original || '').length);
    if (start < 0 || end > text.length) return null;

    // Grab context: up to 40 chars before and after
    var ctxBefore = text.substring(Math.max(0, start - 40), start);
    var ctxTarget = text.substring(start, end);
    var ctxAfter = text.substring(end, Math.min(text.length, end + 40));

    // Trim to word boundaries and add ellipsis
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

    // Trim newlines to keep it single-line
    ctxBefore = ctxBefore.replace(/\n/g, ' ');
    ctxTarget = ctxTarget.replace(/\n/g, ' ');
    ctxAfter = ctxAfter.replace(/\n/g, ' ');

    return { before: ctxBefore, target: ctxTarget, after: ctxAfter };
  }

  function createCard(suggestion, groupClass, siblings) {
    var card = document.createElement('div');
    card.className = 'suggestion-card ' + groupClass;
    card.dataset.id = suggestion.id;

    // siblings is the deduped group (defaults to just this suggestion)
    if (!siblings) siblings = [suggestion];
    var hasSiblings = siblings.length > 1;

    if (suggestion.id === activeSuggestionId) {
      card.classList.add('active');
    }

    // Click card to select suggestion
    card.addEventListener('click', function (e) {
      if (e.target.closest('.suggestion-actions')) return;
      activeSuggestionId = suggestion.id;
      render();
      if (onSelect) onSelect(suggestion);
    });

    // Title row with occurrence count badge
    var titleEl = document.createElement('div');
    titleEl.className = 'suggestion-title';
    titleEl.innerHTML = escapeHtml(suggestion.title);
    if (hasSiblings) {
      titleEl.innerHTML += ' <span class="occurrence-badge">' + siblings.length + ' occurrences</span>';
    }
    card.appendChild(titleEl);

    // Context snippet — shows where in the text this issue is
    var ctx = buildContextSnippet(suggestion);
    if (ctx) {
      var ctxEl = document.createElement('div');
      ctxEl.className = 'suggestion-context';
      ctxEl.innerHTML =
        escapeHtml(ctx.before) +
        '<mark class="context-highlight">' + escapeHtml(ctx.target) + '</mark>' +
        escapeHtml(ctx.after);
      card.appendChild(ctxEl);
    }

    var msgEl = document.createElement('div');
    msgEl.className = 'suggestion-message';
    msgEl.textContent = suggestion.message;
    card.appendChild(msgEl);

    // Preview (if replacement exists)
    if (suggestion.replacement !== undefined && suggestion.original) {
      var preview = document.createElement('div');
      preview.className = 'suggestion-preview';
      preview.innerHTML =
        '<span class="original">' + escapeHtml(suggestion.original) + '</span>' +
        '<span class="arrow"> → </span>' +
        '<span class="replacement">' + escapeHtml(suggestion.replacement) + '</span>';
      card.appendChild(preview);
    }

    // Actions
    var actions = document.createElement('div');
    actions.className = 'suggestion-actions';

    if (suggestion.replacement !== undefined) {
      if (hasSiblings) {
        // For grouped cards, primary action is "Apply all"
        var applyAllBtn = document.createElement('button');
        applyAllBtn.type = 'button';
        applyAllBtn.className = 'btn btn-primary btn-sm';
        applyAllBtn.textContent = 'Apply all (' + siblings.length + ')';
        applyAllBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          applyAll(suggestion);
        });
        actions.appendChild(applyAllBtn);
      } else {
        var applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'btn btn-primary btn-sm';
        applyBtn.textContent = 'Apply';
        applyBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (onApply) onApply(suggestion);
          dismiss(suggestion);
        });
        actions.appendChild(applyBtn);
      }
    } else {
      var reviewBtn = document.createElement('button');
      reviewBtn.type = 'button';
      reviewBtn.className = 'btn btn-secondary btn-sm';
      reviewBtn.textContent = 'Review';
      reviewBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        activeSuggestionId = suggestion.id;
        render();
        if (onSelect) onSelect(suggestion);
      });
      actions.appendChild(reviewBtn);
    }

    var dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'btn btn-secondary btn-sm';
    dismissBtn.textContent = hasSiblings ? 'Dismiss all' : 'Dismiss';
    dismissBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (hasSiblings) {
        dismissAll(suggestion);
      } else {
        dismiss(suggestion);
      }
    });
    actions.appendChild(dismissBtn);

    card.appendChild(actions);
    return card;
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Clear all suggestions (e.g., when switching documents).
   */
  function clearAll() {
    correctnessSuggestions = [];
    claritySuggestions = [];
    activeSuggestionId = null;
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
