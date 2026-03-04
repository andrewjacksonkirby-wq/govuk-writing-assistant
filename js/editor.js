/**
 * Editor module
 * Manages the contentEditable editor, text model, and document versioning.
 */
const Editor = (function () {
  let editorEl = null;
  let documentVersion = 0;
  let onChangeCallbacks = [];

  function init(elementId) {
    editorEl = document.getElementById(elementId);
    if (!editorEl) throw new Error('Editor element not found: ' + elementId);

    editorEl.addEventListener('input', handleInput);
    editorEl.addEventListener('paste', handlePaste);
  }

  function handleInput() {
    clearHighlights();
    clearInlineMarks();
    currentUnderlines = []; // Clear stale underlines; new ones arrive after debounce
    documentVersion++;
    notifyChange();
  }

  function handlePaste(e) {
    // Force plain text paste to keep the editor clean
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  }

  function notifyChange() {
    const text = getText();
    const version = documentVersion;
    onChangeCallbacks.forEach(function (cb) {
      cb(text, version);
    });
  }

  function getText() {
    if (!editorEl) return '';
    return editorEl.innerText || '';
  }

  function setText(text) {
    if (!editorEl) return;
    editorEl.textContent = text;
    documentVersion++;
  }

  function getVersion() {
    return documentVersion;
  }

  /**
   * Register a callback for content changes.
   * Callback receives (text, version).
   */
  function onChange(cb) {
    onChangeCallbacks.push(cb);
  }

  /**
   * Get the editor DOM element.
   */
  function getElement() {
    return editorEl;
  }

  /**
   * Apply a text replacement at a specific offset range.
   * Uses Selection API + execCommand to preserve browser undo.
   * Returns true if successful.
   */
  function applyReplacement(startOffset, endOffset, replacement) {
    clearHighlights();
    const text = getText();
    if (startOffset < 0 || endOffset > text.length || startOffset > endOffset) {
      return false;
    }

    // Use Selection API to select the range, then execCommand to replace
    // This preserves the browser undo stack
    editorEl.focus();
    const textNode = findTextNodeAtOffset(editorEl, startOffset);
    if (!textNode) {
      // Fallback: direct replacement (loses undo)
      const newText = text.substring(0, startOffset) + replacement + text.substring(endOffset);
      editorEl.textContent = newText;
      documentVersion++;
      notifyChange();
      return true;
    }

    const sel = window.getSelection();
    const range = document.createRange();

    const startInfo = getNodeOffset(editorEl, startOffset);
    const endInfo = getNodeOffset(editorEl, endOffset);

    if (startInfo && endInfo) {
      range.setStart(startInfo.node, startInfo.offset);
      range.setEnd(endInfo.node, endInfo.offset);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, replacement);
      return true;
    }

    // Fallback
    const newText = text.substring(0, startOffset) + replacement + text.substring(endOffset);
    editorEl.textContent = newText;
    documentVersion++;
    notifyChange();
    return true;
  }

  /**
   * Find the text node and local offset for a given global character offset.
   */
  function getNodeOffset(root, globalOffset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    let remaining = globalOffset;
    let node;
    while ((node = walker.nextNode())) {
      if (remaining <= node.textContent.length) {
        return { node: node, offset: remaining };
      }
      remaining -= node.textContent.length;
    }
    return null;
  }

  /**
   * Find the text node at a given offset (used as a quick check).
   */
  function findTextNodeAtOffset(root, offset) {
    const result = getNodeOffset(root, offset);
    return result ? result.node : null;
  }

  /**
   * Scroll to and highlight a text range in the editor.
   * Uses a temporary mark element for visual highlighting.
   */
  function highlightRange(startOffset, endOffset, groupClass) {
    clearHighlights();
    const text = getText();
    if (startOffset < 0 || endOffset > text.length) return;

    const before = text.substring(0, startOffset);
    const target = text.substring(startOffset, endOffset);
    const after = text.substring(endOffset);

    // Build highlighted content
    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));

    const mark = document.createElement('mark');
    mark.className = 'highlight ' + (groupClass || '');
    mark.textContent = target;
    frag.appendChild(mark);

    if (after) frag.appendChild(document.createTextNode(after));

    editorEl.innerHTML = '';
    editorEl.appendChild(frag);

    // Scroll to the highlight
    mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function clearHighlights() {
    if (!editorEl) return;
    // Restore plain text content if highlights are present
    const marks = editorEl.querySelectorAll('mark');
    if (marks.length > 0) {
      // Get text before clearing to avoid losing content
      const text = editorEl.innerText || '';
      editorEl.textContent = text;
    }
  }

  // ===== Inline marks overlay (for spacing issues etc.) =====
  let overlayEl = null;
  let inlineMarkCallback = null;

  /**
   * Show inline underline marks in the editor overlay.
   * marks: array of {start, end, replacement, title}
   * onClick: callback(mark) when user clicks a mark
   */
  function showInlineMarks(marks, onClick) {
    if (!overlayEl) {
      overlayEl = document.getElementById('inlineMarksOverlay');
    }
    if (!overlayEl || !editorEl) return;
    inlineMarkCallback = onClick;
    overlayEl.innerHTML = '';

    if (!marks || marks.length === 0) return;

    const text = getText();
    if (!text) return;

    // We need to map text offsets to screen positions using Range API
    // First, ensure editor has a single text node (no marks)
    clearHighlights();

    marks.forEach(function (m) {
      if (m.start < 0 || m.end > text.length) return;

      const startInfo = getNodeOffset(editorEl, m.start);
      const endInfo = getNodeOffset(editorEl, m.end);
      if (!startInfo || !endInfo) return;

      const range = document.createRange();
      range.setStart(startInfo.node, startInfo.offset);
      range.setEnd(endInfo.node, endInfo.offset);

      const rects = range.getClientRects();
      const editorRect = editorEl.getBoundingClientRect();

      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        const span = document.createElement('span');
        span.className = 'inline-mark';
        span.style.left = (rect.left - editorRect.left + editorEl.scrollLeft) + 'px';
        span.style.top = (rect.top - editorRect.top + editorEl.scrollTop) + 'px';
        span.style.width = rect.width + 'px';
        span.style.height = rect.height + 'px';
        span.title = m.title || 'Click to fix';
        span.addEventListener('click', function () {
          if (inlineMarkCallback) inlineMarkCallback(m);
        });
        overlayEl.appendChild(span);
      }
    });
  }

  /**
   * Clear inline marks overlay.
   */
  function clearInlineMarks() {
    if (!overlayEl) {
      overlayEl = document.getElementById('inlineMarksOverlay');
    }
    if (overlayEl) overlayEl.innerHTML = '';
  }

  // ===== Inline underlines for all detected issues =====
  let currentUnderlines = [];
  let underlineCallback = null;

  /**
   * Show persistent underlines for all detected issues directly in the editor.
   * Uses mark elements inserted into the editor content.
   * marks: array of {start, end, ruleId, group, category, replacement, title, original, id}
   * onClick: callback(mark) when user clicks an underlined word
   */
  function showUnderlines(marks, onClick) {
    underlineCallback = onClick;
    currentUnderlines = marks || [];
    renderUnderlines();
  }

  /**
   * Rules that flag large structural ranges (whole sentences/paragraphs)
   * should only appear in the sidebar, not as inline underlines.
   * Underlining an entire sentence is visually useless — it looks like
   * the whole paragraph is one error.
   */
  var STRUCTURAL_RULES = ['sentence-length'];

  /**
   * Render underline marks into the editor content.
   * Splits text into segments and wraps flagged ranges with <mark> elements.
   * Only word/phrase-level issues get underlined; structural issues (e.g.
   * sentence length) are excluded so they don't swallow the whole paragraph.
   */
  function renderUnderlines() {
    if (!editorEl) return;
    var text = getText();
    if (!text || currentUnderlines.length === 0) {
      // If content has marks, restore to plain text
      if (editorEl.querySelector('.issue-underline')) {
        editorEl.textContent = text;
      }
      return;
    }

    // 1. Filter out structural/sentence-level rules — they should not
    //    produce inline underlines (they still appear in the sidebar).
    var wordLevel = currentUnderlines.filter(function (m) {
      return STRUCTURAL_RULES.indexOf(m.ruleId) === -1;
    });

    if (wordLevel.length === 0) {
      if (editorEl.querySelector('.issue-underline')) {
        editorEl.textContent = text;
      }
      return;
    }

    // 2. Sort marks by start position, then shortest first so that
    //    small word-level marks are preferred over any remaining wide marks.
    var marks = wordLevel.slice().sort(function (a, b) {
      return a.start - b.start || (a.end - a.start) - (b.end - b.start);
    });

    // 3. Remove overlapping marks — keep the more specific (shorter) one.
    //    Because we sorted shortest-first at each position, the first
    //    mark we encounter at a position is the most specific.
    var filtered = [];
    var lastEnd = -1;
    marks.forEach(function (m) {
      if (m.start >= lastEnd) {
        filtered.push(m);
        lastEnd = m.end;
      }
    });

    // Build fragments
    var frag = document.createDocumentFragment();
    var pos = 0;

    filtered.forEach(function (m) {
      if (m.start < pos || m.start >= text.length || m.end > text.length) return;

      // Text before this mark
      if (m.start > pos) {
        frag.appendChild(document.createTextNode(text.substring(pos, m.start)));
      }

      // The underlined mark
      var mark = document.createElement('mark');
      var catClass = getCategoryClass(m);
      mark.className = 'issue-underline ' + catClass;
      mark.textContent = text.substring(m.start, m.end);
      mark.title = m.title || m.message || '';
      mark.dataset.issueId = m.id || '';

      mark.addEventListener('click', function (e) {
        e.stopPropagation();
        if (underlineCallback) underlineCallback(m);
      });

      frag.appendChild(mark);
      pos = m.end;
    });

    // Remaining text after last mark
    if (pos < text.length) {
      frag.appendChild(document.createTextNode(text.substring(pos)));
    }

    // Save cursor position
    var savedOffset = saveCaretOffset();

    // Replace editor content
    editorEl.innerHTML = '';
    editorEl.appendChild(frag);

    // Restore cursor position
    if (savedOffset !== null) {
      restoreCaretOffset(savedOffset);
    }
  }

  function getCategoryClass(mark) {
    var ruleId = mark.ruleId;

    // Fine-grained colours per issue type
    if (ruleId === 'spelling' || ruleId === 'missing-letter') return 'underline-spelling';
    if (ruleId === 'passive-voice') return 'underline-passive';
    if (ruleId === 'sentence-length') return 'underline-sentence-length';
    if (ruleId === 'tone' || ruleId === 'email-tone') return 'underline-tone';
    if (ruleId === 'repeated-word' || ruleId === 'confused-words') return 'underline-grammar';
    if (ruleId === 'capitalisation' || ruleId === 'common-grammar') {
      // Check if it's a plain English suggestion
      if (mark.category === 'Plain English') return 'underline-plain-english';
      if (mark.category === 'GOV.UK style') return 'underline-style';
      return 'underline-grammar';
    }

    // Fall back to group-level colours
    var group = mark.group;
    if (group === 'correctness') return 'underline-correctness';
    if (group === 'clarity') return 'underline-clarity';
    if (group === 'style') return 'underline-style';

    // Default
    return 'underline-correctness';
  }

  /**
   * Save the caret offset as a character position.
   */
  function saveCaretOffset() {
    var sel = window.getSelection();
    if (!sel.rangeCount || !editorEl.contains(sel.anchorNode)) return null;
    var range = sel.getRangeAt(0);
    var preRange = document.createRange();
    preRange.selectNodeContents(editorEl);
    preRange.setEnd(range.startContainer, range.startOffset);
    return preRange.toString().length;
  }

  /**
   * Restore the caret to a character offset position.
   */
  function restoreCaretOffset(offset) {
    var info = getNodeOffset(editorEl, offset);
    if (!info) return;
    var sel = window.getSelection();
    var range = document.createRange();
    range.setStart(info.node, info.offset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function clearUnderlines() {
    currentUnderlines = [];
    if (!editorEl) return;
    if (editorEl.querySelector('.issue-underline')) {
      var text = editorEl.innerText || '';
      editorEl.textContent = text;
    }
  }

  return {
    init: init,
    getText: getText,
    setText: setText,
    getVersion: getVersion,
    onChange: onChange,
    getElement: getElement,
    applyReplacement: applyReplacement,
    highlightRange: highlightRange,
    clearHighlights: clearHighlights,
    showInlineMarks: showInlineMarks,
    clearInlineMarks: clearInlineMarks,
    showUnderlines: showUnderlines,
    clearUnderlines: clearUnderlines
  };
})();
