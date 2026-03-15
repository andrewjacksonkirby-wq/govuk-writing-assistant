/**
 * InlinePopup module
 * Floating suggestion card that appears next to a clicked inline underline.
 */
const InlinePopup = (function () {
  'use strict';

  var popupEl = null;
  var onApplyCb = null;
  var onDismissCb = null;
  var onDismissOnceCb = null;

  // Shared category helpers — reuse from Suggestions to avoid divergence
  var STYLE_RULES = ['contractions', 'numbers', 'date-format', 'govuk-style',
    'number-formatting', 'time-formatting', 'govuk-punctuation', 'govuk-capitalisation'];
  var CLARITY_RULES = ['sentence-length', 'passive-voice', 'overused-word', 'tone',
    'email-tone', 'chat-length'];

  function getCat(suggestion) {
    if (STYLE_RULES.indexOf(suggestion.ruleId) !== -1) return 'style';
    if (CLARITY_RULES.indexOf(suggestion.ruleId) !== -1) return 'clarity';
    if (suggestion.category === 'Plain English') return 'clarity';
    if (suggestion.group === 'style') return 'style';
    if (suggestion.group === 'clarity') return 'clarity';
    return 'correctness';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function init(callbacks) {
    onApplyCb = callbacks.onApply;
    onDismissCb = callbacks.onDismiss;
    onDismissOnceCb = callbacks.onDismissOnce;
    popupEl = document.getElementById('inline-popup');

    // Dismiss on click outside (capture phase so it fires before the underline click)
    document.addEventListener('click', function (e) {
      if (!popupEl || popupEl.hidden) return;
      if (popupEl.contains(e.target)) return;
      if (e.target.closest && (e.target.closest('.issue-underline') || e.target.closest('.structural-mark'))) return;
      hide();
    });
  }

  function show(suggestion, anchorEl) {
    if (!popupEl) return;

    var cat = getCat(suggestion);
    popupEl.className = 'inline-popup ' + cat;
    popupEl.innerHTML = '';

    // Header: category badge + close button
    var header = document.createElement('div');
    header.className = 'ip-header';

    var badge = document.createElement('span');
    badge.className = 'ip-badge';
    badge.textContent = suggestion.category || (cat.charAt(0).toUpperCase() + cat.slice(1));
    header.appendChild(badge);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'ip-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '\u00d7';
    closeBtn.addEventListener('click', hide);
    header.appendChild(closeBtn);

    popupEl.appendChild(header);

    // Title
    var titleText = suggestion.title || suggestion.message;
    if (titleText) {
      var titleEl = document.createElement('div');
      titleEl.className = 'ip-title';
      titleEl.textContent = titleText;
      popupEl.appendChild(titleEl);
    }

    // Replacement preview
    if (suggestion.replacement != null && suggestion.original) {
      var preview = document.createElement('div');
      preview.className = 'ip-preview';
      preview.innerHTML =
        '<span class="ip-original">' + escapeHtml(suggestion.original) + '</span>' +
        '<span class="ip-arrow">\u2192</span>' +
        '<span class="ip-replacement">' + escapeHtml(suggestion.replacement) + '</span>';
      popupEl.appendChild(preview);
    }

    // Actions
    var actions = document.createElement('div');
    actions.className = 'ip-actions';

    if (suggestion.replacement != null) {
      var fixBtn = document.createElement('button');
      fixBtn.type = 'button';
      fixBtn.className = 'btn btn-primary btn-sm';
      fixBtn.textContent = 'Fix';
      fixBtn.addEventListener('click', function () {
        if (onApplyCb) onApplyCb(suggestion);
        hide();
      });
      actions.appendChild(fixBtn);
    }

    var ignoreOnceBtn = document.createElement('button');
    ignoreOnceBtn.type = 'button';
    ignoreOnceBtn.className = 'btn btn-secondary btn-sm';
    ignoreOnceBtn.textContent = 'Ignore once';
    ignoreOnceBtn.addEventListener('click', function () {
      if (onDismissOnceCb) onDismissOnceCb(suggestion);
      hide();
    });
    actions.appendChild(ignoreOnceBtn);

    var ignoreBtn = document.createElement('button');
    ignoreBtn.type = 'button';
    ignoreBtn.className = 'btn btn-secondary btn-sm';
    ignoreBtn.textContent = 'Ignore always';
    ignoreBtn.addEventListener('click', function () {
      if (onDismissCb) onDismissCb(suggestion);
      hide();
    });
    actions.appendChild(ignoreBtn);

    popupEl.appendChild(actions);

    // Show and position
    popupEl.hidden = false;
    position(anchorEl);
  }

  function position(anchorEl) {
    var rect = anchorEl.getBoundingClientRect();
    var margin = 8;
    var width = popupEl.offsetWidth || 268;

    var left = rect.left;
    if (left + width > window.innerWidth - margin) {
      left = window.innerWidth - width - margin;
    }
    if (left < margin) left = margin;

    var top = rect.bottom + margin;
    popupEl.style.left = left + 'px';
    popupEl.style.top = top + 'px';

    // Flip above if it would go off-screen at the bottom
    requestAnimationFrame(function () {
      if (!popupEl || popupEl.hidden) return;
      var popRect = popupEl.getBoundingClientRect();
      if (popRect.bottom > window.innerHeight - margin) {
        popupEl.style.top = (rect.top - popupEl.offsetHeight - margin) + 'px';
      }
    });
  }

  function hide() {
    if (popupEl) popupEl.hidden = true;
  }

  return { init: init, show: show, hide: hide };
})();
