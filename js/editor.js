/**
 * Editor module
 * Manages the contentEditable editor, text model, and document versioning.
 */
const Editor = (function () {
  'use strict';

  let editorEl = null;
  let documentVersion = 0;
  let onChangeCallbacks = [];

  // IME composition handling — prevent text corruption during CJK/accent input
  var isComposing = false;

  function init(elementId) {
    editorEl = document.getElementById(elementId);
    if (!editorEl) throw new Error('Editor element not found: ' + elementId);

    editorEl.addEventListener('input', handleInput);
    editorEl.addEventListener('paste', handlePaste);
    editorEl.addEventListener('compositionstart', function () { isComposing = true; });
    editorEl.addEventListener('compositionend', function () {
      isComposing = false;
      handleInput(); // Process the completed composition
    });
  }

  function handleInput() {
    if (isComposing) return; // Skip during IME composition
    var savedOffset = saveCaretOffset();
    clearHighlights();
    currentUnderlines = []; // Clear stale underlines; new ones arrive after debounce
    if (savedOffset !== null) restoreCaretOffset(savedOffset);
    documentVersion++;
    notifyChange();
  }

  let onPasteCallbacks = [];

  /**
   * Insert text at the current selection, preserving browser undo if possible.
   * Falls back to Selection API if execCommand is unavailable.
   */
  function insertTextAtSelection(text) {
    if (typeof document.execCommand === 'function') {
      var result = document.execCommand('insertText', false, text);
      if (result) return;
    }
    // Fallback: Selection API (loses undo history but works everywhere)
    var sel = window.getSelection();
    if (!sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    range.deleteContents();
    var textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function handlePaste(e) {
    // Force plain text paste to keep the editor clean
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    insertTextAtSelection(text);
    // Notify paste listeners with the pasted text length
    onPasteCallbacks.forEach(function (cb) { cb(text); });
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
    editorEl.innerText = text;
    documentVersion++;
    notifyChange();
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
  function applyReplacement(startOffset, endOffset, replacement, expectedOriginal) {
    clearHighlights();
    const text = getText();
    if (startOffset < 0 || endOffset > text.length || startOffset > endOffset) {
      return false;
    }

    // Verify text at offsets still matches what the suggestion expects
    if (expectedOriginal) {
      var actual = text.substring(startOffset, endOffset);
      if (actual !== expectedOriginal) {
        console.warn('[Editor] Stale offset — expected "' + expectedOriginal + '" but found "' + actual + '". Skipping replacement.');
        return false;
      }
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
      insertTextAtSelection(replacement);
      documentVersion++;
      notifyChange();
      // Flash the replaced text green so the user sees what changed
      showFixFlash(startOffset, replacement.length);
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
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL, {
      acceptNode: function (node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        if (node.nodeName === 'BR') return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      }
    });
    let remaining = globalOffset;
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeName === 'BR') {
        // A <br> represents a newline character
        if (remaining <= 1) {
          // Position just after the BR — find the next text node
          var nextNode = walker.nextNode();
          return nextNode ? { node: nextNode, offset: 0 } : null;
        }
        remaining -= 1;
        continue;
      }
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

    editorEl.textContent = '';
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
   * Rules that flag large structural ranges (whole sentences/paragraphs).
   * These render as background tints, not underlines.
   */
  var STRUCTURAL_RULES = ['sentence-length'];

  /**
   * Return a CSS class for a structural mark's rule.
   */
  function getStructuralClass(mark) {
    if (mark.ruleId === 'sentence-length') return 'struct-sentence-length';
    return 'struct-default';
  }

  /**
   * Render two-layer marks into the editor content:
   *  Layer 1 — structural marks rendered as background-tinted <mark> wrappers
   *  Layer 2 — word-level marks rendered as underlined <mark> elements nested inside
   */
  var lastMarkFingerprint = '';

  function renderUnderlines() {
    if (!editorEl) return;
    var text = getText();
    if (!text || currentUnderlines.length === 0) {
      lastMarkFingerprint = '';
    }
    // Skip re-render if marks haven't changed (avoids flicker on auto-check)
    var fp = currentUnderlines.map(function (m) {
      return m.start + ':' + m.end + ':' + m.ruleId;
    }).join('|');
    if (fp === lastMarkFingerprint && fp !== '') return;
    lastMarkFingerprint = fp;

    if (!text || currentUnderlines.length === 0) {
      if (editorEl.querySelector('.issue-underline') || editorEl.querySelector('.structural-mark')) {
        editorEl.textContent = text;
      }
      return;
    }

    // Split marks into structural (background) and word-level (underline)
    var structuralMarks = [];
    var wordLevelMarks = [];
    currentUnderlines.forEach(function (m) {
      if (STRUCTURAL_RULES.indexOf(m.ruleId) !== -1) {
        structuralMarks.push(m);
      } else {
        wordLevelMarks.push(m);
      }
    });

    // Sort word-level: start asc, then shortest first
    wordLevelMarks.sort(function (a, b) {
      return a.start - b.start || (a.end - a.start) - (b.end - b.start);
    });

    // De-overlap word-level marks (keep shorter/earlier)
    var filteredWord = [];
    var wEnd = -1;
    wordLevelMarks.forEach(function (m) {
      if (m.start >= wEnd) {
        filteredWord.push(m);
        wEnd = m.end;
      }
    });

    // Sort structural by start
    structuralMarks.sort(function (a, b) {
      return a.start - b.start;
    });

    // Build a list of "segments" — each is either a structural range
    // (which may contain word-level marks) or a standalone word-level mark.
    // We iterate through the text left-to-right using both lists.

    var frag = document.createDocumentFragment();
    var pos = 0;
    var si = 0; // structural index
    var wi = 0; // word-level index

    while (si < structuralMarks.length || wi < filteredWord.length) {
      var sm = si < structuralMarks.length ? structuralMarks[si] : null;
      var wm = wi < filteredWord.length ? filteredWord[wi] : null;

      // Determine which comes first
      if (sm && (!wm || sm.start <= wm.start)) {
        // Emit text before this structural mark
        if (sm.start > pos) {
          frag.appendChild(document.createTextNode(text.substring(pos, sm.start)));
        }

        // Create the structural background wrapper
        var structEl = document.createElement('mark');
        structEl.className = 'structural-mark ' + getStructuralClass(sm);
        structEl.title = sm.title || sm.message || '';
        structEl.dataset.issueId = sm.id || '';
        (function (issueRef, el) {
          el.addEventListener('click', function (e) {
            // Only fire if the click wasn't caught by a nested word-mark
            if (underlineCallback) underlineCallback(issueRef, e.currentTarget);
          });
        })(sm, structEl);

        // Fill the structural mark with text + nested word-level marks
        var innerPos = sm.start;
        while (wi < filteredWord.length && filteredWord[wi].start < sm.end) {
          var w = filteredWord[wi];
          // Clamp to structural boundaries
          var wStart = Math.max(w.start, sm.start);
          var wEndClamped = Math.min(w.end, sm.end);

          // Text before this word mark (inside structural)
          if (wStart > innerPos) {
            structEl.appendChild(document.createTextNode(text.substring(innerPos, wStart)));
          }

          // The word-level underline mark
          var wordEl = document.createElement('mark');
          wordEl.className = 'issue-underline ' + getCategoryClass(w);
          wordEl.textContent = text.substring(wStart, wEndClamped);
          wordEl.title = w.title || w.message || '';
          wordEl.dataset.issueId = w.id || '';
          (function (issueRef) {
            wordEl.addEventListener('click', function (e) {
              e.stopPropagation();
              if (underlineCallback) underlineCallback(issueRef, e.currentTarget);
            });
          })(w);
          structEl.appendChild(wordEl);

          innerPos = wEndClamped;
          wi++;
        }

        // Remaining text inside structural mark
        if (innerPos < sm.end) {
          structEl.appendChild(document.createTextNode(text.substring(innerPos, sm.end)));
        }

        frag.appendChild(structEl);
        pos = sm.end;
        si++;
      } else {
        // Word-level mark outside any structural range
        if (wm.start > pos) {
          frag.appendChild(document.createTextNode(text.substring(pos, wm.start)));
        }
        if (wm.start >= pos) {
          var wordEl2 = document.createElement('mark');
          wordEl2.className = 'issue-underline ' + getCategoryClass(wm);
          wordEl2.textContent = text.substring(wm.start, wm.end);
          wordEl2.title = wm.title || wm.message || '';
          wordEl2.dataset.issueId = wm.id || '';
          (function (issueRef) {
            wordEl2.addEventListener('click', function (e) {
              e.stopPropagation();
              if (underlineCallback) underlineCallback(issueRef, e.currentTarget);
            });
          })(wm);
          frag.appendChild(wordEl2);
          pos = wm.end;
        }
        wi++;
      }
    }

    // Remaining text
    if (pos < text.length) {
      frag.appendChild(document.createTextNode(text.substring(pos)));
    }

    // Save cursor, replace content, restore cursor
    var savedOffset = saveCaretOffset();
    editorEl.textContent = '';
    editorEl.appendChild(frag);
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

  /**
   * Briefly flash a green highlight over newly inserted replacement text.
   */
  function showFixFlash(offset, length) {
    if (!editorEl) return;
    try {
      var startInfo = getNodeOffset(editorEl, offset);
      var endInfo = getNodeOffset(editorEl, offset + length);
      if (!startInfo || !endInfo) return;

      var flashRange = document.createRange();
      flashRange.setStart(startInfo.node, startInfo.offset);
      flashRange.setEnd(endInfo.node, endInfo.offset);

      var span = document.createElement('span');
      span.className = 'fix-flash';
      flashRange.surroundContents(span);

      // Remove the wrapper after animation completes (keep text)
      setTimeout(function () {
        if (span.parentNode) {
          var parent = span.parentNode;
          while (span.firstChild) parent.insertBefore(span.firstChild, span);
          parent.removeChild(span);
          parent.normalize(); // Merge adjacent text nodes
        }
      }, 1300);
    } catch (e) {
      // Flash is cosmetic — don't break if it fails
    }
  }

  function clearUnderlines() {
    currentUnderlines = [];
    if (!editorEl) return;
    if (editorEl.querySelector('.issue-underline') || editorEl.querySelector('.structural-mark')) {
      var text = editorEl.innerText || '';
      editorEl.textContent = text;
    }
  }

  /**
   * Register a callback for paste events.
   * Callback receives (pastedText).
   */
  function onPaste(cb) {
    onPasteCallbacks.push(cb);
  }

  /**
   * Get the currently selected text in the editor.
   */
  function getSelectedText() {
    var sel = window.getSelection();
    if (!sel.rangeCount || !editorEl || !editorEl.contains(sel.anchorNode)) return '';
    return sel.toString();
  }

  /**
   * Get character offsets of the current selection within the editor.
   * Returns { start, end } or null if no selection.
   */
  function getSelectionOffsets() {
    var sel = window.getSelection();
    if (!sel.rangeCount || !editorEl || !editorEl.contains(sel.anchorNode)) return null;
    var range = sel.getRangeAt(0);

    var preStart = document.createRange();
    preStart.selectNodeContents(editorEl);
    preStart.setEnd(range.startContainer, range.startOffset);
    var start = preStart.toString().length;

    var preEnd = document.createRange();
    preEnd.selectNodeContents(editorEl);
    preEnd.setEnd(range.endContainer, range.endOffset);
    var end = preEnd.toString().length;

    if (start === end) return null;
    return { start: start, end: end };
  }

  return {
    init: init,
    getText: getText,
    setText: setText,
    getVersion: getVersion,
    onChange: onChange,
    onPaste: onPaste,
    getElement: getElement,
    applyReplacement: applyReplacement,
    highlightRange: highlightRange,
    clearHighlights: clearHighlights,
    showUnderlines: showUnderlines,
    clearUnderlines: clearUnderlines,
    getSelectedText: getSelectedText,
    getSelectionOffsets: getSelectionOffsets
  };
})();
