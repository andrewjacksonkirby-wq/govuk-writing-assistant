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
  function renderUnderlines() {
    if (!editorEl) return;
    var text = getText();
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
        (function (issueRef) {
          structEl.addEventListener('click', function (e) {
            // Only fire if the click wasn't caught by a nested word-mark
            if (underlineCallback) underlineCallback(issueRef);
          });
        })(sm);

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
    editorEl.innerHTML = '';
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

  function clearUnderlines() {
    currentUnderlines = [];
    if (!editorEl) return;
    if (editorEl.querySelector('.issue-underline') || editorEl.querySelector('.structural-mark')) {
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
    showUnderlines: showUnderlines,
    clearUnderlines: clearUnderlines
  };
})();
