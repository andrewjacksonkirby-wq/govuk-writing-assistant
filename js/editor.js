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

  return {
    init: init,
    getText: getText,
    setText: setText,
    getVersion: getVersion,
    onChange: onChange,
    getElement: getElement,
    applyReplacement: applyReplacement,
    highlightRange: highlightRange,
    clearHighlights: clearHighlights
  };
})();
