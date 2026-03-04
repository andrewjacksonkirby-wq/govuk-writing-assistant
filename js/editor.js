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
    clearInlineMarks: clearInlineMarks
  };
})();
