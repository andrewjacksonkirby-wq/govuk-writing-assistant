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

  function renderGroup(container, suggestions, groupClass) {
    container.innerHTML = '';

    if (suggestions.length === 0) {
      var emptyP = document.createElement('p');
      emptyP.className = 'empty-state';
      emptyP.textContent = 'No issues found';
      container.appendChild(emptyP);
      return;
    }

    // Group by category
    var categories = {};
    suggestions.forEach(function (s) {
      var cat = s.category || 'Other';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(s);
    });

    Object.keys(categories).forEach(function (cat) {
      var items = categories[cat];
      var catGroup = document.createElement('div');
      catGroup.className = 'category-group';

      var catHeader = document.createElement('button');
      catHeader.type = 'button';
      catHeader.className = 'category-header';
      catHeader.setAttribute('aria-expanded', 'true');
      catHeader.innerHTML =
        '<span>' + escapeHtml(cat) + '</span>' +
        '<span class="category-count">' + items.length + '</span>';
      catHeader.addEventListener('click', function () {
        var expanded = catHeader.getAttribute('aria-expanded') === 'true';
        catHeader.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      });
      catGroup.appendChild(catHeader);

      var catBody = document.createElement('div');
      catBody.className = 'category-body';

      items.forEach(function (s) {
        catBody.appendChild(createCard(s, groupClass));
      });

      catGroup.appendChild(catBody);
      container.appendChild(catGroup);
    });
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

    // Group by category
    var categories = {};
    suggestions.forEach(function (s) {
      var cat = s.category || 'Other';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(s);
    });

    Object.keys(categories).forEach(function (cat) {
      var items = categories[cat];
      var catGroup = document.createElement('div');
      catGroup.className = 'category-group';

      var catHeader = document.createElement('button');
      catHeader.type = 'button';
      catHeader.className = 'category-header';
      catHeader.setAttribute('aria-expanded', 'true');
      catHeader.innerHTML =
        '<span>' + escapeHtml(cat) + '</span>' +
        '<span class="category-count">' + items.length + '</span>';
      catHeader.addEventListener('click', function () {
        var expanded = catHeader.getAttribute('aria-expanded') === 'true';
        catHeader.setAttribute('aria-expanded', expanded ? 'false' : 'true');
      });
      catGroup.appendChild(catHeader);

      var catBody = document.createElement('div');
      catBody.className = 'category-body';

      items.forEach(function (s) {
        catBody.appendChild(createCard(s, 'clarity'));
      });

      catGroup.appendChild(catBody);
      container.appendChild(catGroup);
    });
  }

  function createCard(suggestion, groupClass) {
    var card = document.createElement('div');
    card.className = 'suggestion-card ' + groupClass;
    card.dataset.id = suggestion.id;

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

    var titleEl = document.createElement('div');
    titleEl.className = 'suggestion-title';
    titleEl.textContent = suggestion.title;
    card.appendChild(titleEl);

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
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      dismiss(suggestion);
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
