/**
 * App module
 * Wires together editor, documents, quick checks, full check, suggestions,
 * stats, mode selector, upload, export, and keyboard shortcuts.
 */
(function () {
  'use strict';

  // Feature flag — dynamically set based on whether API is configured
  var AI_ENABLED = FullCheck.hasValidConfig();

  // DOM elements
  var saveStatusEl = document.getElementById('saveStatus');
  var sensitivityToggle = document.getElementById('sensitivityToggle');
  var sensitivityText = document.getElementById('sensitivityText');
  var draftsBtn = document.getElementById('draftsBtn');
  var newDraftBtn = document.getElementById('newDraftBtn');
  var historyBtn = document.getElementById('historyBtn');
  var documentsView = document.getElementById('documentsView');
  var documentsList = document.getElementById('documentsList');
  var docsNewDraftBtn = document.getElementById('docsNewDraftBtn');
  var historyModal = document.getElementById('historyModal');
  var restoreConfirmModal = document.getElementById('restoreConfirmModal');
  var closeHistoryModal = document.getElementById('closeHistoryModal');
  var cancelRestore = document.getElementById('cancelRestore');
  var confirmRestore = document.getElementById('confirmRestore');
  var historyList = document.getElementById('historyList');
  var modeSelect = document.getElementById('modeSelect');
  var uploadFile = document.getElementById('uploadFile');
  var exportBtn = document.getElementById('exportBtn');
  var editorPane = document.querySelector('.editor-pane');
  var sidebar = document.getElementById('sidebar');

  var lastCheckVersion = -1;
  var pendingRestore = null;
  var autoCheckTimer = null;
  var AUTO_CHECK_DEBOUNCE_MS = 2000;
  var autoCheckDirty = false;
  var ttsUtterance = null;
  var ttsBtn = document.getElementById('ttsBtn');
  var ttsIcon = document.getElementById('ttsIcon');
  var dictBtn = document.getElementById('dictBtn');
  var dictionaryModal = document.getElementById('dictionaryModal');
  var closeDictModal = document.getElementById('closeDictModal');
  var dictInput = document.getElementById('dictInput');
  var dictAddBtn = document.getElementById('dictAddBtn');
  var dictWordList = document.getElementById('dictWordList');
  var clearBtn = document.getElementById('clearBtn');
  var settingsBtn = document.getElementById('settingsBtn');
  var settingsModal = document.getElementById('settingsModal');
  var closeSettingsModal = document.getElementById('closeSettingsModal');
  var customRulesBtn = document.getElementById('customRulesBtn');
  var customRulesModal = document.getElementById('customRulesModal');
  var closeRulesModal = document.getElementById('closeRulesModal');
  var rulePhrase = document.getElementById('rulePhrase');
  var ruleReplacement = document.getElementById('ruleReplacement');
  var ruleMessage = document.getElementById('ruleMessage');
  var ruleAddBtn = document.getElementById('ruleAddBtn');
  var rulesList = document.getElementById('rulesList');
  var aiAllowanceBar = document.getElementById('aiAllowanceBar');
  var aiAllowanceValue = document.getElementById('aiAllowanceValue');
  var aiAllowanceFill = document.getElementById('aiAllowanceFill');
  var aiAllowanceTrack = document.getElementById('aiAllowanceTrack');
  var aiAllowanceReset = document.getElementById('aiAllowanceReset');
  var aiAllowanceWarning = document.getElementById('aiAllowanceWarning');
  var allowanceIntervalId = null;

  // AI settings elements
  var settingsProvider = document.getElementById('settingsProvider');
  var settingsApiEndpoint = document.getElementById('settingsApiEndpoint');
  var settingsApiKey = document.getElementById('settingsApiKey');
  var settingsModel = document.getElementById('settingsModel');
  var settingsSaveAI = document.getElementById('settingsSaveAI');
  var settingsSaveStatus = document.getElementById('settingsSaveStatus');
  var toggleApiKeyVisibility = document.getElementById('toggleApiKeyVisibility');

  // Tone elements
  var toneBtn = document.getElementById('toneBtn');
  var toneModal = document.getElementById('toneModal');
  var closeToneModal = document.getElementById('closeToneModal');
  var toneRewriteBtn = document.getElementById('toneRewriteBtn');
  var toneApplyBtn = document.getElementById('toneApplyBtn');
  var toneCancelBtn = document.getElementById('toneCancelBtn');
  var tonePreview = document.getElementById('tonePreview');
  var toneLoading = document.getElementById('toneLoading');
  var toneError = document.getElementById('toneError');
  var toneSourceInfo = document.getElementById('toneSourceInfo');
  var toneOriginalText = document.getElementById('toneOriginalText');
  var toneRewrittenText = document.getElementById('toneRewrittenText');
  var toneOptions = document.getElementById('toneOptions');

  // AI rule elements
  var aiRuleSection = document.getElementById('aiRuleSection');
  var ruleDescription = document.getElementById('ruleDescription');
  var ruleGenerateBtn = document.getElementById('ruleGenerateBtn');
  var ruleGenerateStatus = document.getElementById('ruleGenerateStatus');

  // Pending tone rewrite state
  var pendingToneRewrite = null;

  // ========== Init ==========

  function init() {
    // Init editor
    Editor.init('editor');

    // Init documents
    Documents.init(updateSaveStatus);

    // Init stats
    Stats.init();

    // Dictionary loading indicator
    var statsBar = document.getElementById('statsBar');
    var dictLoadingEl = document.createElement('span');
    dictLoadingEl.className = 'stat-item dict-loading';
    dictLoadingEl.textContent = 'Loading dictionary\u2026';
    dictLoadingEl.style.color = 'var(--color-text-muted)';
    dictLoadingEl.style.fontSize = '11px';
    dictLoadingEl.style.fontStyle = 'italic';
    if (statsBar) statsBar.querySelector('.stats-left').appendChild(dictLoadingEl);
    document.addEventListener('typo-dictionary-loaded', function (e) {
      if (dictLoadingEl.parentNode) dictLoadingEl.parentNode.removeChild(dictLoadingEl);
      if (e.detail && e.detail.failed) {
        showToast('Dictionary failed to load \u2014 spell check may be limited.', 'warning');
      }
    });

    // Init reports
    Reports.init({
      onHighlight: function (start, end) {
        Editor.highlightRange(start, end, 'report-highlight');
      }
    });

    // Sidebar view toggle
    var viewSuggestionsBtn = document.getElementById('viewSuggestions');
    var viewReportsBtn = document.getElementById('viewReports');
    var suggestionsView = document.getElementById('suggestionsView');
    var reportsView = document.getElementById('reportsView');

    viewSuggestionsBtn.addEventListener('click', function () {
      viewSuggestionsBtn.classList.add('active');
      viewReportsBtn.classList.remove('active');
      suggestionsView.hidden = false;
      reportsView.hidden = true;
    });
    viewReportsBtn.addEventListener('click', function () {
      viewReportsBtn.classList.add('active');
      viewSuggestionsBtn.classList.remove('active');
      reportsView.hidden = false;
      suggestionsView.hidden = true;
    });

    // Init suggestions
    Suggestions.init({
      onApply: handleApply,
      onApplyAll: handleApplyAll,
      onSelect: handleSelect,
      onSuggestFix: handleSuggestFix,
      onDismiss: function () {
        // Re-render underlines so dismissed items disappear from the editor
        var visible = Suggestions.getAll();
        Editor.showUnderlines(visible, function (mark, markEl) {
          if (markEl) InlinePopup.show(mark, markEl);
          Suggestions.selectById(mark.id);
        });
      }
    });

    // Init inline popup
    InlinePopup.init({
      onApply: function (suggestion) {
        handleApply(suggestion);
      },
      onDismiss: function (suggestion) {
        Suggestions.dismiss(suggestion);
      },
      onDismissOnce: function (suggestion) {
        Suggestions.dismissOnce(suggestion);
      }
    });

    // Load current document
    var doc = Documents.loadCurrent();
    if (doc && doc.text) {
      Editor.setText(doc.text);
    }

    // Show/hide AI-dependent UI based on config
    updateAIEnabledUI();

    // Set sensitivity state (AI only)
    if (AI_ENABLED) {
      var sensitivity = Documents.getSensitivity();
      updateSensitivityUI(sensitivity);
      sensitivityToggle.checked = sensitivity === 'safe';
    }

    // Set writing mode
    var mode = Documents.getMode();
    updateModeUI(mode);

    // Start autosave (skips email/chat modes — scratchpad behaviour)
    Documents.startAutosave(function () {
      return Editor.getText();
    }, function () {
      return Documents.getMode();
    });

    // ========== Event listeners ==========

    // Debounced stats/reports update (300ms)
    var statsDebounceTimer = null;
    function debouncedStatsUpdate(text) {
      if (statsDebounceTimer) clearTimeout(statsDebounceTimer);
      statsDebounceTimer = setTimeout(function () {
        Stats.update(text);
        Reports.update(text);
      }, 300);
    }

    // Editor changes -> trigger quick checks + update stats
    Editor.onChange(function (text, version) {
      updateSaveStatus('unsaved');
      debouncedStatsUpdate(text);
      QuickChecks.scheduleCheck(text, version, function (results, checkedVersion) {
        if (checkedVersion >= lastCheckVersion) {
          lastCheckVersion = checkedVersion;
          processQuickCheckResults(results);
        }
      });
      // Auto-trigger full check after typing pauses (debounced 2s)
      if (AI_ENABLED) scheduleAutoCheck();
    });

    // Sensitivity toggle (always listen, visibility controlled by updateAIEnabledUI)
    sensitivityToggle.addEventListener('change', function () {
      var isSafe = sensitivityToggle.checked;
      var value = isSafe ? 'safe' : 'sensitive';
      Documents.setSensitivity(value);
      updateSensitivityUI(value);
      if (AI_ENABLED) updateAllowanceMeter();
      // Update tone button visibility based on sensitivity
      if (toneBtn) toneBtn.hidden = !AI_ENABLED || value !== 'safe';
    });

    // Mode selector
    modeSelect.addEventListener('change', function () {
      var oldMode = Documents.getMode();
      var newMode = modeSelect.value;

      // If switching away from scratchpad mode with text, prompt to save
      if ((oldMode === 'email' || oldMode === 'chat') && newMode !== oldMode) {
        promptSaveIfNeeded();
      }

      Documents.setMode(newMode);
      updateModeUI(newMode);
      // Re-run quick checks with new mode
      var text = Editor.getText();
      QuickChecks.scheduleCheck(text, Editor.getVersion(), function (results, v) {
        if (v >= lastCheckVersion) {
          lastCheckVersion = v;
          processQuickCheckResults(results);
        }
      });
    });

    // Upload handler
    uploadFile.addEventListener('change', handleUpload);

    // Export handler
    exportBtn.addEventListener('click', handleExport);

    // Shortcuts modal
    var shortcutsModal = document.getElementById('shortcutsModal');
    var closeShortcutsModal = document.getElementById('closeShortcutsModal');
    if (closeShortcutsModal) {
      closeShortcutsModal.addEventListener('click', function () { shortcutsModal.hidden = true; releaseFocus(); });
    }
    if (shortcutsModal) {
      shortcutsModal.addEventListener('click', function (e) {
        if (e.target === shortcutsModal) { shortcutsModal.hidden = true; releaseFocus(); }
      });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      // Escape = close modals and inline popup
      if (e.key === 'Escape') {
        if (!restoreConfirmModal.hidden) { restoreConfirmModal.hidden = true; releaseFocus(); pendingRestore = null; return; }
        if (!historyModal.hidden) { historyModal.hidden = true; releaseFocus(); return; }
        if (!dictionaryModal.hidden) { dictionaryModal.hidden = true; releaseFocus(); return; }
        if (!settingsModal.hidden) { settingsModal.hidden = true; releaseFocus(); return; }
        if (toneModal && !toneModal.hidden) { toneModal.hidden = true; releaseFocus(); return; }
        if (!customRulesModal.hidden) { customRulesModal.hidden = true; releaseFocus(); cancelEditRule(); return; }
        if (shortcutsModal && !shortcutsModal.hidden) { shortcutsModal.hidden = true; releaseFocus(); return; }
        InlinePopup.hide();
        return;
      }
      // ? = show keyboard shortcuts (only when not typing in editor or input)
      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        var tag = document.activeElement ? document.activeElement.tagName : '';
        var isEditable = document.activeElement && (document.activeElement.contentEditable === 'true' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT');
        if (!isEditable && shortcutsModal) {
          shortcutsModal.hidden = false;
          trapFocus(shortcutsModal);
        }
      }
      // Ctrl+S / Cmd+S = save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        Documents.saveText(Editor.getText());
      }
    });

    // Documents view
    draftsBtn.addEventListener('click', showDocumentsView);
    newDraftBtn.addEventListener('click', createNewDraftAndEdit);
    docsNewDraftBtn.addEventListener('click', createNewDraftAndEdit);

    // History modal
    historyBtn.addEventListener('click', openHistoryModal);
    closeHistoryModal.addEventListener('click', function () { historyModal.hidden = true; releaseFocus(); });
    historyModal.addEventListener('click', function (e) {
      if (e.target === historyModal) { historyModal.hidden = true; releaseFocus(); }
    });

    // Restore confirm
    cancelRestore.addEventListener('click', function () {
      restoreConfirmModal.hidden = true;
      releaseFocus();
      pendingRestore = null;
    });
    confirmRestore.addEventListener('click', function () {
      if (pendingRestore !== null) {
        var restoredText = Documents.restoreVersion(pendingRestore, Editor.getText());
        if (restoredText !== null) {
          Editor.setText(restoredText);
          Suggestions.clearAll();
          Stats.update(restoredText);
          Reports.update(restoredText);
          // Trigger quick checks on restored text
          QuickChecks.scheduleCheck(restoredText, Editor.getVersion(), function (results, v) {
            if (v >= lastCheckVersion) {
              lastCheckVersion = v;
              processQuickCheckResults(results);
            }
          });
        }
        pendingRestore = null;
      }
      restoreConfirmModal.hidden = true;
      historyModal.hidden = true;
      releaseFocus();
    });

    // Paste & check: auto-trigger full check on large pastes (AI only)
    if (AI_ENABLED) {
      Editor.onPaste(function (pastedText) {
        var words = pastedText.trim().split(/\s+/).length;
        if (words >= 50 && Documents.getSensitivity() === 'safe' && !FullCheck.getIsRunning()) {
          // Short delay so the editor onChange fires first (quick checks run)
          setTimeout(function () { handleCheckNow(); }, 300);
        }
      });
    }

    // Re-run checks when dictionary finishes loading
    document.addEventListener('typo-dictionary-loaded', function () {
      var text = Editor.getText();
      if (text && text.trim().length > 0) {
        QuickChecks.scheduleCheck(text, Editor.getVersion(), function (results, v) {
          if (v >= lastCheckVersion) {
            lastCheckVersion = v;
            processQuickCheckResults(results);
          }
        });
      }
    });

    // Save version on significant actions (before closing, switching docs)
    window.addEventListener('beforeunload', function (e) {
      var text = Editor.getText();
      var mode = Documents.getMode();
      if (text.trim().length > 0) {
        if (mode === 'email' || mode === 'chat') {
          // In scratchpad modes, warn before losing unsaved work
          e.preventDefault();
          e.returnValue = '';
        } else {
          Documents.saveText(text);
        }
      }
    });

    // ========== Clear button (scratchpad modes) ==========
    if (clearBtn) {
      clearBtn.addEventListener('click', handleClear);
    }

    // ========== Text-to-speech ==========
    ttsBtn.addEventListener('click', handleTTS);

    // ========== Custom dictionary ==========
    dictBtn.addEventListener('click', function () {
      dictionaryModal.hidden = false;
      renderDictionary();
      trapFocus(dictionaryModal);
    });
    closeDictModal.addEventListener('click', function () { dictionaryModal.hidden = true; releaseFocus(); });
    dictionaryModal.addEventListener('click', function (e) {
      if (e.target === dictionaryModal) { dictionaryModal.hidden = true; releaseFocus(); }
    });
    dictAddBtn.addEventListener('click', addDictWord);
    dictInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addDictWord(); }
    });

    // ========== Settings modal ==========
    settingsBtn.addEventListener('click', function () {
      if (AI_ENABLED) updateAllowanceMeter();
      populateAISettings();
      settingsModal.hidden = false;
      trapFocus(settingsModal);
    });
    closeSettingsModal.addEventListener('click', function () { settingsModal.hidden = true; releaseFocus(); });
    settingsModal.addEventListener('click', function (e) {
      if (e.target === settingsModal) { settingsModal.hidden = true; releaseFocus(); }
    });

    // AI settings handlers
    if (settingsProvider) {
      settingsProvider.addEventListener('change', function () {
        updateModelOptions(settingsProvider.value);
        updateEndpointPlaceholder(settingsProvider.value);
      });
    }
    if (toggleApiKeyVisibility) {
      toggleApiKeyVisibility.addEventListener('click', function () {
        var isPassword = settingsApiKey.type === 'password';
        settingsApiKey.type = isPassword ? 'text' : 'password';
        toggleApiKeyVisibility.textContent = isPassword ? 'Hide' : 'Show';
      });
    }
    if (settingsSaveAI) {
      settingsSaveAI.addEventListener('click', saveAISettings);
    }

    // ========== Tone rewrite modal ==========
    if (toneBtn) {
      toneBtn.addEventListener('click', openToneModal);
    }
    if (closeToneModal) {
      closeToneModal.addEventListener('click', function () { toneModal.hidden = true; releaseFocus(); });
    }
    if (toneModal) {
      toneModal.addEventListener('click', function (e) {
        if (e.target === toneModal) { toneModal.hidden = true; releaseFocus(); }
      });
    }
    if (toneOptions) {
      toneOptions.addEventListener('change', function () {
        toneRewriteBtn.disabled = false;
      });
    }
    if (toneRewriteBtn) {
      toneRewriteBtn.addEventListener('click', handleToneRewrite);
    }
    if (toneApplyBtn) {
      toneApplyBtn.addEventListener('click', handleToneApply);
    }
    if (toneCancelBtn) {
      toneCancelBtn.addEventListener('click', function () { toneModal.hidden = true; releaseFocus(); });
    }

    // ========== AI rule generation ==========
    if (ruleGenerateBtn) {
      ruleGenerateBtn.addEventListener('click', handleGenerateRule);
    }

    // Load custom dictionary into QuickChecks
    loadCustomDictionary();

    // ========== Custom style rules ==========
    customRulesBtn.addEventListener('click', function () {
      customRulesModal.hidden = false;
      renderCustomRules();
      trapFocus(customRulesModal);
    });
    closeRulesModal.addEventListener('click', function () { customRulesModal.hidden = true; releaseFocus(); cancelEditRule(); });
    customRulesModal.addEventListener('click', function (e) {
      if (e.target === customRulesModal) { customRulesModal.hidden = true; releaseFocus(); cancelEditRule(); }
    });
    ruleAddBtn.addEventListener('click', addCustomRule);
    rulePhrase.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); addCustomRule(); }
    });

    // Load custom rules into QuickChecks
    loadCustomRules();

    // Init AI allowance meter (AI only)
    if (AI_ENABLED) {
      updateAllowanceMeter();
      startAllowanceCountdown();
    }

    // Run initial quick check + stats if there's text
    var initialText = Editor.getText();
    if (initialText.trim().length > 0) {
      Stats.update(initialText);
      Reports.update(initialText);
      QuickChecks.scheduleCheck(initialText, Editor.getVersion(), function (results, v) {
        if (v >= lastCheckVersion) {
          lastCheckVersion = v;
          processQuickCheckResults(results);
        }
      });
      // Auto-trigger full check on load if document has enough words (AI only)
      if (AI_ENABLED) {
        var initialWords = (initialText.match(/\b\w+\b/g) || []).length;
        if (initialWords >= AUTO_TRIGGER_WORD_THRESHOLD && Documents.getSensitivity() === 'safe') {
          lastFullCheckWordCount = initialWords;
          setTimeout(function () { handleCheckNow(); }, 1200); // Delay to let quick checks finish first
        }
      }
    }
  }

  // ========== Scratchpad save prompt (email/chat modes) ==========

  /**
   * In email/chat modes, the editor is a scratchpad — text isn't auto-saved.
   * When the user navigates away (new draft, documents view, mode change),
   * prompt them to save like Word's "Save your changes?" dialog.
   * Returns true if we should proceed, false if the user cancelled.
   */
  function promptSaveIfNeeded() {
    var mode = Documents.getMode();
    var text = Editor.getText();
    if ((mode === 'email' || mode === 'chat') && text && text.trim().length > 0) {
      var choice = confirm(
        'Save this ' + (mode === 'email' ? 'email' : 'message') + ' before moving on?\n\n' +
        'Click OK to save it to your documents.\n' +
        'Click Cancel to discard it.'
      );
      if (choice) {
        Documents.saveText(text);
      }
      // Either way, proceed (they chose save or discard)
    }
    return true;
  }

  /**
   * Clear the editor for a fresh start (used after sending an email/message).
   */
  function handleClear() {
    var text = Editor.getText();
    if (text && text.trim().length > 0) {
      var mode = Documents.getMode();
      if (mode === 'govuk') {
        // In GOV.UK mode, just create a new draft (saves current)
        createNewDraftAndEdit();
        return;
      }
      if (!confirm('Clear all text? This cannot be undone.')) return;
    }
    Editor.setText('');
    Suggestions.clearAll();
    Editor.clearUnderlines();
    Stats.update('');
    Reports.update('');
  }

  // ========== Handlers ==========

  /**
   * Run an automatic AI check. Called by scheduleAutoCheck() after debounce.
   * If a check is already running, sets a dirty flag to re-check when it finishes.
   */
  function runAutoCheck() {
    var sensitivity = Documents.getSensitivity();
    if (!FullCheck.isAllowed(sensitivity)) return;
    if (FullCheck.getIsRunning()) {
      autoCheckDirty = true;
      return;
    }
    autoCheckDirty = false;
    var text = Editor.getText();
    if (!text || !text.trim()) return;
    if (FullCheck.isAllowanceExhausted()) {
      updateAllowanceMeter();
      return;
    }
    Suggestions.markFullCheckRun();
    var checkDocId = Documents.getCurrentId();
    FullCheck.run(text, sensitivity, function (results, error) {
      if (Documents.getCurrentId() !== checkDocId) return;
      if (!error) {
        updateAllowanceMeter();
        Suggestions.setClarity(results || []);
      }
      if (autoCheckDirty) {
        autoCheckDirty = false;
        scheduleAutoCheck();
      }
    });
  }

  /**
   * Process quick check results: all issues go to both
   * the sidebar AND show as inline underlines in the editor.
   */
  function processQuickCheckResults(results) {
    Suggestions.setCorrectness(results);

    // Filter out dismissed items from underlines too (must match sidebar)
    var visibleResults = results.filter(function (s) {
      return !Suggestions.isDismissed(s);
    });

    // Show visible issues as inline underlines in the editor
    Editor.showUnderlines(visibleResults, function (mark, markEl) {
      if (markEl) {
        InlinePopup.show(mark, markEl);
      }
      Suggestions.selectById(mark.id);
    });
  }

  function handleApply(suggestion) {
    if (suggestion.replacement != null) {
      Editor.applyReplacement(suggestion.start, suggestion.end, suggestion.replacement, suggestion.original);
    }
    // Immediately re-check (don't wait for debounce) since offsets have shifted
    recheckNow();
  }

  function handleApplyAll(suggestions) {
    // Already sorted descending by position in Suggestions.applyAll
    // so later replacements don't shift earlier offsets
    suggestions.forEach(function (s) {
      if (s.replacement != null) {
        Editor.applyReplacement(s.start, s.end, s.replacement, s.original);
      }
    });
    recheckNow();
  }

  /**
   * Run quick checks immediately (cancel any pending debounce).
   */
  function recheckNow() {
    QuickChecks.cancelPending();
    var text = Editor.getText();
    var version = Editor.getVersion();
    var results = QuickChecks.runAll(text);
    lastCheckVersion = version;
    processQuickCheckResults(results);
  }

  function handleSelect(suggestion) {
    var markEl = document.querySelector('[data-issue-id="' + CSS.escape(suggestion.id) + '"]');
    if (markEl) markEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /**
   * Handle "Suggest fix" — sends the flagged text to the AI for a rewrite.
   * Falls back to heuristics when API is not available.
   */
  function handleSuggestFix(suggestion, callback) {
    var sensitivity = Documents.getSensitivity();
    var text = Editor.getText();
    if (!text) { callback(null); return; }

    // Get the sentence context around the flagged text
    var sentStart = suggestion.start;
    while (sentStart > 0 && !/[.!?\n]/.test(text[sentStart - 1])) sentStart--;
    var sentEnd = suggestion.end;
    while (sentEnd < text.length && !/[.!?\n]/.test(text[sentEnd])) sentEnd++;
    if (sentEnd < text.length && /[.!?]/.test(text[sentEnd])) sentEnd++;
    var sentence = text.substring(sentStart, sentEnd).trim();

    // Try AI if available and sensitivity is safe
    if (AI_ENABLED && sensitivity === 'safe' && FullCheck.hasValidConfig() && sentence) {
      var prompt = 'Rewrite this sentence to fix the issue described.\n\n' +
        'Issue: ' + suggestion.message + '\n' +
        'Problematic text: "' + suggestion.original + '"\n' +
        'Full sentence: "' + sentence + '"\n\n' +
        'Return ONLY the rewritten sentence. No explanation.';

      FullCheck.callAPI(prompt, function (result, error) {
        if (result && !error) {
          callback(result.trim().replace(/^["']|["']$/g, ''));
        } else {
          // Fall back to heuristic
          fallbackSuggestFix(suggestion, callback);
        }
      });
      return;
    }

    fallbackSuggestFix(suggestion, callback);
  }

  function fallbackSuggestFix(suggestion, callback) {
    // Extract suggestion from tip text (e.g. "Try: "We completed the report."")
    var tryMatch = suggestion.message.match(/[Tt]ry[:\s]+"([^"]+)"/);
    if (tryMatch) {
      callback(tryMatch[1]);
      return;
    }

    // For passive voice without context, suggest "We [verb]"
    if (suggestion.ruleId === 'passive-voice' && suggestion.original) {
      var parts = suggestion.original.split(/\s+/);
      var verb = parts[parts.length - 1];
      callback('we ' + verb);
      return;
    }

    callback(null);
  }

  /**
   * Schedule an auto-triggered full check after typing pauses.
   * Debounced to 2 seconds for responsive feedback.
   */
  function scheduleAutoCheck() {
    if (Documents.getSensitivity() !== 'safe') return;
    if (autoCheckTimer) clearTimeout(autoCheckTimer);
    autoCheckTimer = setTimeout(function () {
      autoCheckTimer = null;
      runAutoCheck();
    }, AUTO_CHECK_DEBOUNCE_MS);
  }

  /**
   * Handle file upload (.docx or .txt).
   */
  function handleUpload(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    var name = file.name.toLowerCase();

    if (name.endsWith('.txt')) {
      var reader = new FileReader();
      reader.onload = function (ev) {
        loadUploadedText(ev.target.result);
      };
      reader.onerror = function () {
        showToast('Could not read file.', 'error');
      };
      reader.readAsText(file);
    } else if (name.endsWith('.docx') || name.endsWith('.doc')) {
      if (typeof mammoth === 'undefined') {
        showToast('Word document support is loading. Please try again in a moment.', 'warning');
        return;
      }
      var reader2 = new FileReader();
      reader2.onload = function (ev) {
        mammoth.extractRawText({ arrayBuffer: ev.target.result })
          .then(function (result) {
            loadUploadedText(result.value);
          })
          .catch(function (err) {
            showToast('Could not read document: ' + err.message, 'error');
          });
      };
      reader2.onerror = function () {
        showToast('Could not read file.', 'error');
      };
      reader2.readAsArrayBuffer(file);
    } else {
      showToast('Unsupported file type. Please upload a .docx or .txt file.', 'warning');
    }

    // Reset the input so the same file can be re-uploaded
    uploadFile.value = '';
  }

  function loadUploadedText(text) {
    Editor.setText(text);
    Stats.update(text);
    Reports.update(text);
    Suggestions.clearAll();
    updateSaveStatus('unsaved');
    QuickChecks.scheduleCheck(text, Editor.getVersion(), function (results, v) {
      if (v >= lastCheckVersion) {
        lastCheckVersion = v;
        processQuickCheckResults(results);
      }
    });
  }

  /**
   * Export the current text as a .txt file download.
   */
  function handleExport() {
    var text = Editor.getText();
    if (!text || text.trim().length === 0) {
      showToast('Nothing to export.');
      return;
    }
    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    // Use the document title for the filename
    var docs = Documents.loadCurrent();
    var title = (docs && docs.title) || 'draft';
    a.download = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').substring(0, 50) + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ========== UI Updates ==========

  function updateSaveStatus(status) {
    if (!saveStatusEl) return;
    saveStatusEl.className = 'save-status';
    switch (status) {
      case 'saved':
        saveStatusEl.textContent = 'Saved';
        saveStatusEl.classList.add('saved');
        break;
      case 'saving':
        saveStatusEl.textContent = 'Saving...';
        saveStatusEl.classList.add('saving');
        break;
      case 'unsaved':
        saveStatusEl.textContent = 'Not saved';
        saveStatusEl.classList.add('unsaved');
        break;
    }
  }

  // ========== AI Allowance Meter ==========

  function updateAllowanceMeter() {
    var data = FullCheck.getAllowance();
    var remaining = Math.max(0, data.limit - data.used);
    var pct = Math.round((remaining / data.limit) * 100);

    // Update percentage text
    aiAllowanceValue.textContent = pct + '% left';

    // Update progress bar
    aiAllowanceFill.style.width = pct + '%';
    aiAllowanceTrack.setAttribute('aria-valuenow', pct);

    // Determine level
    var level;
    if (pct === 0) {
      level = 'empty';
    } else if (pct <= 10) {
      level = 'critical';
    } else if (pct <= 20) {
      level = 'low';
    } else {
      level = 'ok';
    }

    // Update fill colour class
    aiAllowanceFill.className = 'ai-allowance-fill';
    if (level !== 'ok') {
      aiAllowanceFill.classList.add('level-' + level);
    }

    // Update reset countdown
    aiAllowanceReset.textContent = formatResetTime(data.resetAt);

    // Update warning message
    if (level === 'empty') {
      aiAllowanceWarning.textContent = "You\u2019ve used today\u2019s AI allowance. AI suggestions are off until the allowance resets.";
      aiAllowanceWarning.className = 'ai-allowance-warning level-empty';
      aiAllowanceWarning.hidden = false;
    } else if (level === 'critical') {
      aiAllowanceWarning.textContent = 'AI allowance is very low. If it runs out, AI suggestions will stop until the daily allowance resets. Turn AI off now if you want to save the rest for later.';
      aiAllowanceWarning.className = 'ai-allowance-warning level-critical';
      aiAllowanceWarning.hidden = false;
    } else if (level === 'low') {
      aiAllowanceWarning.textContent = 'AI allowance is getting low. If it runs out, AI suggestions will stop until the daily allowance resets. Turn AI off now if you want to save the rest for later.';
      aiAllowanceWarning.className = 'ai-allowance-warning level-low';
      aiAllowanceWarning.hidden = false;
    } else {
      aiAllowanceWarning.hidden = true;
    }
  }

  function formatResetTime(resetAtISO) {
    if (!resetAtISO) return '';
    var now = new Date();
    var reset = new Date(resetAtISO);
    var diffMs = reset - now;
    if (diffMs <= 0) return 'Resets now';

    var totalMinutes = Math.floor(diffMs / 60000);
    var hours = Math.floor(totalMinutes / 60);
    var minutes = totalMinutes % 60;

    if (hours > 0 && minutes > 0) {
      return 'Resets in ' + hours + (hours === 1 ? ' hour ' : ' hours ') + minutes + (minutes === 1 ? ' minute' : ' minutes');
    } else if (hours > 0) {
      return 'Resets in ' + hours + (hours === 1 ? ' hour' : ' hours');
    } else if (minutes > 0) {
      return 'Resets in ' + minutes + (minutes === 1 ? ' minute' : ' minutes');
    } else {
      return 'Resets in less than a minute';
    }
  }

  function startAllowanceCountdown() {
    if (allowanceIntervalId) clearInterval(allowanceIntervalId);
    allowanceIntervalId = setInterval(function () {
      updateAllowanceMeter();
    }, 60000);
  }

  function updateSensitivityUI(sensitivity) {
    var isSafe = sensitivity === 'safe';
    sensitivityToggle.checked = isSafe;

    if (isSafe) {
      sensitivityText.textContent = 'AI on';
      sensitivityText.className = 'sensitivity-text';
      // Trigger auto-check when AI is turned on
      scheduleAutoCheck();
    } else {
      sensitivityText.textContent = 'AI off';
      sensitivityText.className = 'sensitivity-text sensitive';
      // Cancel any pending or running checks
      if (autoCheckTimer) { clearTimeout(autoCheckTimer); autoCheckTimer = null; }
      FullCheck.cancel();
    }

    // Keep allowance meter in sync
    if (aiAllowanceBar) {
      updateAllowanceMeter();
    }
  }

  function updateModeUI(mode) {
    modeSelect.value = mode;
    QuickChecks.setMode(mode);
    FullCheck.setMode(mode);
    // Show "Done, clear" button in scratchpad modes (email/chat)
    if (clearBtn) {
      clearBtn.hidden = (mode === 'govuk');
    }
  }

  // ========== Modals ==========

  /**
   * Show the documents list view (hides editor).
   */
  function showDocumentsView() {
    // In email/chat mode, prompt to save; in GOV.UK mode, auto-save
    var mode = Documents.getMode();
    var text = Editor.getText();
    if (text && text.trim().length > 0) {
      if (mode === 'email' || mode === 'chat') {
        promptSaveIfNeeded();
      } else {
        Documents.saveText(text);
      }
    }

    // Hide editor + sidebar, show documents view
    editorPane.hidden = true;
    if (sidebar) sidebar.hidden = true;
    documentsView.hidden = false;

    renderDocumentsList();
  }

  /**
   * Hide documents view and return to editor.
   */
  function showEditorView() {
    documentsView.hidden = true;
    editorPane.hidden = false;
    if (sidebar) sidebar.hidden = false;
  }

  /**
   * Create a new draft and switch to the editor.
   */
  function createNewDraftAndEdit() {
    // In email/chat mode, prompt to save; in GOV.UK mode, auto-save
    var mode = Documents.getMode();
    var text = Editor.getText();
    if (text && text.trim().length > 0) {
      if (mode === 'email' || mode === 'chat') {
        promptSaveIfNeeded();
      } else {
        Documents.saveText(text);
      }
    }
    Documents.newDraft(text);
    Editor.setText('');
    Suggestions.clearAll();
    Editor.clearUnderlines();
    Stats.update('');
    Reports.update('');
    if (AI_ENABLED) updateSensitivityUI(Documents.getSensitivity());
    updateModeUI(Documents.getMode());
    showEditorView();
  }

  /**
   * Open a document by ID and switch to the editor.
   */
  function openDocument(docId) {
    Documents.saveText(Editor.getText());
    // Cancel any pending/running auto-check from previous document
    if (autoCheckTimer) { clearTimeout(autoCheckTimer); autoCheckTimer = null; }
    FullCheck.cancel();
    autoCheckDirty = false;
    var switched = Documents.switchDoc(docId);
    if (switched) {
      Editor.setText(switched.text || '');
      Suggestions.clearAll();
      Editor.clearUnderlines();
      Stats.update(switched.text || '');
      Reports.update(switched.text || '');
      lastCheckVersion = -1;
      if (AI_ENABLED) updateSensitivityUI(switched.sensitivity || 'safe');
      updateModeUI(switched.mode || 'govuk');
      QuickChecks.scheduleCheck(switched.text || '', Editor.getVersion(), function (results, v) {
        if (v >= lastCheckVersion) {
          lastCheckVersion = v;
          processQuickCheckResults(results);
        }
      });
      // Auto-run AI check for the new document
      if (AI_ENABLED && (switched.sensitivity || 'safe') === 'safe') {
        runAutoCheck();
      }
    }
    showEditorView();
  }

  /**
   * Delete a document with confirmation.
   */
  function deleteDocument(docId, docTitle) {
    if (!confirm('Delete "' + (docTitle || 'Untitled draft') + '"?\n\nThis cannot be undone.')) return;
    var wasCurrent = (docId === Documents.getCurrentId());
    Documents.deleteDoc(docId);
    if (wasCurrent) {
      // Load whatever doc is now current
      var doc = Documents.loadCurrent();
      Editor.setText(doc.text || '');
      Suggestions.clearAll();
      Stats.update(doc.text || '');
      Reports.update(doc.text || '');
      if (AI_ENABLED) updateSensitivityUI(Documents.getSensitivity());
      updateModeUI(Documents.getMode());
    }
    renderDocumentsList();
  }

  /**
   * Render the documents list.
   */
  function renderDocumentsList() {
    var drafts = Documents.getRecentDrafts();
    var savedScroll = documentsList.scrollTop;
    documentsList.innerHTML = '';

    if (drafts.length === 0) {
      var emptyP = document.createElement('p');
      emptyP.className = 'empty-state';
      emptyP.textContent = 'No documents yet. Click "New draft" to get started.';
      documentsList.appendChild(emptyP);
      return;
    }

    var currentId = Documents.getCurrentId();
    var modeLabels = { govuk: 'GOV.UK', email: 'Email', chat: 'Teams/Slack' };

    drafts.forEach(function (doc) {
      var card = document.createElement('div');
      card.className = 'doc-card' + (doc.id === currentId ? ' current' : '');

      var info = document.createElement('div');
      info.className = 'doc-card-info';

      var titleEl = document.createElement('div');
      titleEl.className = 'doc-card-title';
      titleEl.textContent = doc.title || 'Untitled draft';
      info.appendChild(titleEl);

      var metaEl = document.createElement('div');
      metaEl.className = 'doc-card-meta';
      metaEl.textContent = formatDate(doc.updatedAt) + (doc.mode ? ' \u00b7 ' + (modeLabels[doc.mode] || doc.mode) : '');
      info.appendChild(metaEl);

      // Show preview of content
      var preview = (doc.text || '').trim();
      if (preview.length > 0) {
        var previewEl = document.createElement('div');
        previewEl.className = 'doc-card-preview';
        previewEl.textContent = preview.substring(0, 120) + (preview.length > 120 ? '...' : '');
        info.appendChild(previewEl);
      }

      card.appendChild(info);

      // Actions
      var actions = document.createElement('div');
      actions.className = 'doc-card-actions';

      var openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'btn btn-secondary btn-sm';
      openBtn.textContent = doc.id === currentId ? 'Continue editing' : 'Open';
      openBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        openDocument(doc.id);
      });
      actions.appendChild(openBtn);

      var deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-danger btn-sm';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteDocument(doc.id, doc.title);
      });
      actions.appendChild(deleteBtn);

      card.appendChild(actions);

      // Click the card to open
      card.addEventListener('click', function () {
        openDocument(doc.id);
      });

      documentsList.appendChild(card);
    });
    documentsList.scrollTop = savedScroll;
  }

  function openHistoryModal() {
    var versions = Documents.getVersions();
    historyList.innerHTML = '';

    if (versions.length === 0) {
      var emptyP = document.createElement('p');
      emptyP.className = 'empty-state';
      emptyP.textContent = 'No versions saved yet. Versions are created automatically when you run AI checks or switch between drafts.';
      historyList.appendChild(emptyP);
      historyModal.hidden = false;
      trapFocus(historyModal);
      return;
    }

    versions.forEach(function (version, index) {
      var item = document.createElement('div');
      item.className = 'version-item';

      var info = document.createElement('div');
      var metaEl = document.createElement('div');
      metaEl.className = 'version-meta';
      metaEl.textContent = formatDate(version.timestamp);
      info.appendChild(metaEl);

      var previewEl = document.createElement('div');
      previewEl.className = 'version-preview';
      previewEl.textContent = (version.text || '').substring(0, 80) + ((version.text || '').length > 80 ? '...' : '');
      info.appendChild(previewEl);

      item.appendChild(info);

      var restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'btn btn-secondary btn-sm';
      restoreBtn.textContent = 'Restore';
      restoreBtn.addEventListener('click', function () {
        pendingRestore = index;
        restoreConfirmModal.hidden = false;
        trapFocus(restoreConfirmModal);
      });
      item.appendChild(restoreBtn);

      historyList.appendChild(item);
    });

    historyModal.hidden = false;
    trapFocus(historyModal);
  }

  // ========== Focus trapping ==========

  var trapStack = [];

  function trapFocus(modalEl) {
    var handler = function (e) {
      if (e.key !== 'Tab') return;
      var focusable = modalEl.querySelectorAll('button:not([hidden]):not([disabled]), input:not([hidden]):not([disabled]), select:not([hidden]):not([disabled]), textarea:not([hidden]):not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      var first = focusable[0];
      var last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    trapStack.push(handler);
    document.addEventListener('keydown', handler);
    // Focus the first focusable element
    var firstFocusable = modalEl.querySelector('button:not([hidden]):not([disabled]), input:not([hidden]):not([disabled])');
    if (firstFocusable) firstFocusable.focus();
  }

  function releaseFocus() {
    var handler = trapStack.pop();
    if (handler) {
      document.removeEventListener('keydown', handler);
    }
  }

  // ========== Toast notifications ==========

  var toastContainer = document.getElementById('toastContainer');

  function showToast(message, type, duration) {
    if (!toastContainer) return;
    type = type || 'info';
    duration = duration || 4000;
    var el = document.createElement('div');
    el.className = 'toast' + (type === 'error' ? ' toast-error' : type === 'warning' ? ' toast-warning' : '');
    el.textContent = message;
    toastContainer.appendChild(el);
    // Trigger reflow then show
    el.offsetHeight; // force reflow
    el.classList.add('toast-visible');
    setTimeout(function () {
      el.classList.remove('toast-visible');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 200);
    }, duration);
  }

  // ========== Helpers ==========

  function formatDate(isoString) {
    if (!isoString) return '';
    try {
      var d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      var now = new Date();
      var diffMs = now - d;
      var diffMins = Math.floor(diffMs / 60000);
      var diffHours = Math.floor(diffMs / 3600000);

      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return diffMins + (diffMins === 1 ? ' minute ago' : ' minutes ago');
      if (diffHours < 24) return diffHours + (diffHours === 1 ? ' hour ago' : ' hours ago');

      return d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return isoString;
    }
  }

  // ========== Text-to-speech ==========

  var speakerSvg = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 5.5h2l4-3v11l-4-3H3a1 1 0 01-1-1v-3a1 1 0 011-1z" fill="currentColor"/><path d="M11 5.5a3 3 0 010 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  var stopSvg = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor"/></svg>';

  function setTTSLabel(playing) {
    ttsIcon.innerHTML = playing ? stopSvg : speakerSvg;
    var label = ttsBtn.querySelector('span:last-child');
    if (label) label.textContent = playing ? 'Stop' : 'Read aloud';
    if (playing) ttsBtn.classList.add('tts-playing');
    else ttsBtn.classList.remove('tts-playing');
  }

  function handleTTS() {
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
      setTTSLabel(false);
      return;
    }

    var text = Editor.getText();
    if (!text || text.trim().length === 0) return;

    ttsUtterance = new window.SpeechSynthesisUtterance(text);
    ttsUtterance.lang = 'en-GB';
    ttsUtterance.rate = 0.95;

    setTTSLabel(true);

    ttsUtterance.onend = function () { setTTSLabel(false); };
    ttsUtterance.onerror = function () { setTTSLabel(false); };

    window.speechSynthesis.speak(ttsUtterance);
  }

  // ========== Custom dictionary ==========

  var DEFRA_DEFAULTS = [
    'Defra', 'APHA', 'RPA', 'SFI', 'BPS', 'ELMS', 'ELM',
    'NE', 'EA', 'MMO', 'Cefas', 'JNCC', 'RSPB',
    'catchment', 'biodiversity', 'agri-environment',
    'nitrate', 'slurry', 'waterbody', 'waterbodies',
    'hedgerow', 'hedgerows', 'SSSI', 'SSSIs',
    'HMRC', 'defra.gov.uk', 'GOV.UK'
  ];

  function getCustomDict() {
    try {
      var stored = localStorage.getItem('wa-custom-dictionary');
      if (stored) return JSON.parse(stored);
    } catch (e) {}
    // First time: seed with Defra defaults
    localStorage.setItem('wa-custom-dictionary', JSON.stringify(DEFRA_DEFAULTS));
    return DEFRA_DEFAULTS.slice();
  }

  function saveCustomDict(words) {
    localStorage.setItem('wa-custom-dictionary', JSON.stringify(words));
  }

  function loadCustomDictionary() {
    var words = getCustomDict();
    if (typeof QuickChecks.setCustomDictionary === 'function') {
      QuickChecks.setCustomDictionary(words);
    }
  }

  function addDictWord() {
    var word = (dictInput.value || '').trim();
    if (!word) return;
    var words = getCustomDict();
    // Case-insensitive check
    var lower = word.toLowerCase();
    var exists = words.some(function (w) { return w.toLowerCase() === lower; });
    if (!exists) {
      words.push(word);
      saveCustomDict(words);
      loadCustomDictionary();
      // Re-run checks to clear false positives
      recheckNow();
    }
    dictInput.value = '';
    renderDictionary();
  }

  function removeDictWord(word) {
    var words = getCustomDict().filter(function (w) { return w !== word; });
    saveCustomDict(words);
    loadCustomDictionary();
    recheckNow();
    renderDictionary();
  }

  function renderDictionary() {
    var words = getCustomDict();
    var savedScroll = dictWordList.scrollTop;
    dictWordList.innerHTML = '';
    words.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
    words.forEach(function (word) {
      var chip = document.createElement('span');
      chip.className = 'dict-word-chip';
      chip.textContent = word + ' ';
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'dict-remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.title = 'Remove "' + word + '"';
      removeBtn.addEventListener('click', function () { removeDictWord(word); });
      chip.appendChild(removeBtn);
      dictWordList.appendChild(chip);
    });
    dictWordList.scrollTop = savedScroll;
  }

  // ========== Custom style rules ==========
  var RULES_STORAGE_KEY = 'wa-custom-rules';
  var editingRuleId = null;

  function getStoredRules() {
    try {
      var stored = localStorage.getItem(RULES_STORAGE_KEY);
      if (stored) return JSON.parse(stored);
    } catch (e) {}
    return [];
  }

  function saveStoredRules(rules) {
    localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(rules));
  }

  function loadCustomRules() {
    var rules = getStoredRules();
    if (typeof QuickChecks.setCustomRules === 'function') {
      QuickChecks.setCustomRules(rules);
    }
  }

  function addCustomRule() {
    var phrase = (rulePhrase.value || '').trim();
    if (!phrase) return;
    var rules = getStoredRules();
    var lower = phrase.toLowerCase();
    var exists = rules.some(function (r) { return r.phrase.toLowerCase() === lower && r.id !== editingRuleId; });
    if (exists) return;

    if (editingRuleId) {
      rules.forEach(function (r) {
        if (r.id === editingRuleId) {
          r.phrase = phrase;
          r.replacement = (ruleReplacement.value || '').trim() || null;
          r.message = (ruleMessage.value || '').trim() || 'Custom rule: consider replacing "' + phrase + '"';
        }
      });
      saveStoredRules(rules);
      loadCustomRules();
      recheckNow();
      cancelEditRule();
      renderCustomRules();
      return;
    }

    rules.push({
      id: 'cr_' + Date.now(),
      phrase: phrase,
      replacement: (ruleReplacement.value || '').trim() || null,
      message: (ruleMessage.value || '').trim() || 'Custom rule: consider replacing "' + phrase + '"',
      category: 'Custom rule',
      enabled: true
    });
    saveStoredRules(rules);
    loadCustomRules();
    recheckNow();
    rulePhrase.value = '';
    ruleReplacement.value = '';
    ruleMessage.value = '';
    renderCustomRules();
  }

  function removeCustomRule(id) {
    var rules = getStoredRules().filter(function (r) { return r.id !== id; });
    saveStoredRules(rules);
    loadCustomRules();
    recheckNow();
    renderCustomRules();
  }

  function toggleCustomRule(id) {
    var rules = getStoredRules();
    rules.forEach(function (r) { if (r.id === id) r.enabled = !r.enabled; });
    saveStoredRules(rules);
    loadCustomRules();
    recheckNow();
    renderCustomRules();
  }

  function editCustomRule(id) {
    var rules = getStoredRules();
    var rule = null;
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].id === id) { rule = rules[i]; break; }
    }
    if (!rule) return;
    editingRuleId = id;
    rulePhrase.value = rule.phrase;
    ruleReplacement.value = rule.replacement || '';
    ruleMessage.value = rule.message || '';
    ruleAddBtn.textContent = 'Save changes';
    if (!document.getElementById('ruleCancelBtn')) {
      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-secondary btn-sm';
      cancelBtn.id = 'ruleCancelBtn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', cancelEditRule);
      ruleAddBtn.parentNode.insertBefore(cancelBtn, ruleAddBtn.nextSibling);
    }
    rulePhrase.focus();
  }

  function cancelEditRule() {
    editingRuleId = null;
    rulePhrase.value = '';
    ruleReplacement.value = '';
    ruleMessage.value = '';
    ruleAddBtn.textContent = 'Add rule';
    var cancelBtn = document.getElementById('ruleCancelBtn');
    if (cancelBtn) cancelBtn.remove();
  }

  function renderCustomRules() {
    var rules = getStoredRules();
    var savedScroll = rulesList.scrollTop;
    rulesList.innerHTML = '';
    if (rules.length === 0) {
      var emptyP = document.createElement('p');
      emptyP.className = 'rules-empty';
      emptyP.textContent = 'No custom rules yet.';
      rulesList.appendChild(emptyP);
      return;
    }
    rules.forEach(function (rule) {
      var row = document.createElement('div');
      row.className = 'rules-item' + (rule.enabled ? '' : ' rules-item-disabled');

      var info = document.createElement('div');
      info.className = 'rules-item-info';
      var phraseEl = document.createElement('strong');
      phraseEl.textContent = rule.phrase;
      info.appendChild(phraseEl);
      if (rule.replacement) {
        info.appendChild(document.createTextNode(' \u2192 '));
        var replEl = document.createElement('span');
        replEl.textContent = rule.replacement;
        info.appendChild(replEl);
      }
      var msgEl = document.createElement('div');
      msgEl.className = 'rules-item-msg';
      msgEl.textContent = rule.message;
      info.appendChild(msgEl);
      row.appendChild(info);

      var actions = document.createElement('div');
      actions.className = 'rules-item-actions';
      var editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn btn-sm';
      editBtn.textContent = 'Edit';
      editBtn.setAttribute('aria-label', 'Edit rule for "' + rule.phrase + '"');
      editBtn.addEventListener('click', (function (ruleId) {
        return function () { editCustomRule(ruleId); };
      })(rule.id));
      actions.appendChild(editBtn);
      var toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'btn btn-sm';
      toggleBtn.textContent = rule.enabled ? 'Disable' : 'Enable';
      toggleBtn.addEventListener('click', function () { toggleCustomRule(rule.id); });
      actions.appendChild(toggleBtn);
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'rules-remove';
      delBtn.textContent = '\u00d7';
      delBtn.title = 'Delete rule';
      delBtn.setAttribute('aria-label', 'Delete rule for "' + rule.phrase + '"');
      delBtn.addEventListener('click', function () { removeCustomRule(rule.id); });
      actions.appendChild(delBtn);
      row.appendChild(actions);

      rulesList.appendChild(row);
    });
    rulesList.scrollTop = savedScroll;
  }

  // ========== AI Settings ==========

  function updateAIEnabledUI() {
    if (!AI_ENABLED) {
      sensitivityToggle.parentElement.style.display = 'none';
      if (aiAllowanceBar) {
        aiAllowanceBar.style.display = 'none';
        var aiHeading = aiAllowanceBar.previousElementSibling;
        if (aiHeading && aiHeading.textContent.trim() === 'AI allowance') {
          aiHeading.style.display = 'none';
        }
      }
      if (toneBtn) toneBtn.hidden = true;
      if (aiRuleSection) aiRuleSection.hidden = true;
    } else {
      sensitivityToggle.parentElement.style.display = '';
      if (aiAllowanceBar) {
        aiAllowanceBar.style.display = '';
        var aiHeading2 = aiAllowanceBar.previousElementSibling;
        if (aiHeading2 && aiHeading2.textContent.trim() === 'AI allowance') {
          aiHeading2.style.display = '';
        }
      }
      if (toneBtn) toneBtn.hidden = false;
      if (aiRuleSection) aiRuleSection.hidden = false;
    }
  }

  function populateAISettings() {
    var cfg = FullCheck.getConfig();
    if (settingsProvider) settingsProvider.value = cfg.provider || 'anthropic';
    if (settingsApiEndpoint) settingsApiEndpoint.value = cfg.apiEndpoint || '';
    if (settingsApiKey) settingsApiKey.value = cfg.apiKey || '';
    updateModelOptions(cfg.provider || 'anthropic');
    if (settingsModel) settingsModel.value = cfg.model || '';
    updateEndpointPlaceholder(cfg.provider || 'anthropic');
    if (settingsSaveStatus) settingsSaveStatus.hidden = true;
  }

  function updateModelOptions(provider) {
    if (!settingsModel) return;
    var providers = FullCheck.getProviders();
    var models = (providers[provider] && providers[provider].models) || [];
    settingsModel.innerHTML = '';
    models.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label;
      settingsModel.appendChild(opt);
    });
  }

  function updateEndpointPlaceholder(provider) {
    if (!settingsApiEndpoint) return;
    var providers = FullCheck.getProviders();
    var p = providers[provider];
    settingsApiEndpoint.placeholder = p ? p.defaultEndpoint : '';
  }

  function saveAISettings() {
    var provider = settingsProvider ? settingsProvider.value : 'anthropic';
    var endpoint = settingsApiEndpoint ? settingsApiEndpoint.value.trim() : '';
    var key = settingsApiKey ? settingsApiKey.value.trim() : '';
    var model = settingsModel ? settingsModel.value : '';

    // Auto-fill endpoint if user only entered a key
    if (key && !endpoint) {
      var providers = FullCheck.getProviders();
      endpoint = providers[provider] ? providers[provider].defaultEndpoint : '';
      if (settingsApiEndpoint) settingsApiEndpoint.value = endpoint;
    }

    FullCheck.saveConfig(provider, endpoint, key, model);

    // Update AI_ENABLED based on new config
    var wasEnabled = AI_ENABLED;
    AI_ENABLED = FullCheck.hasValidConfig();
    updateAIEnabledUI();

    if (AI_ENABLED && !wasEnabled) {
      // Newly enabled — set up sensitivity and allowance
      var sensitivity = Documents.getSensitivity();
      updateSensitivityUI(sensitivity);
      sensitivityToggle.checked = sensitivity === 'safe';
      updateAllowanceMeter();
      startAllowanceCountdown();
    }

    if (settingsSaveStatus) {
      settingsSaveStatus.textContent = 'Saved';
      settingsSaveStatus.className = 'settings-save-status';
      settingsSaveStatus.hidden = false;
      setTimeout(function () { settingsSaveStatus.hidden = true; }, 2000);
    }
  }

  // ========== Tone rewrite ==========

  function openToneModal() {
    // Capture selection before opening modal (browser may clear it on focus change)
    var selText = Editor.getSelectedText();
    var selOffsets = Editor.getSelectionOffsets();
    var fullText = Editor.getText();

    var sourceText, isFullDoc;
    if (selText && selText.trim().length > 0) {
      sourceText = selText;
      isFullDoc = false;
    } else {
      sourceText = fullText;
      isFullDoc = true;
      selOffsets = { start: 0, end: fullText.length };
    }

    if (!sourceText || !sourceText.trim()) {
      showToast('Nothing to rewrite. Type or select some text first.');
      return;
    }

    var wordCount = sourceText.split(/\s+/).filter(function (w) { return w.length > 0; }).length;
    toneSourceInfo.textContent = isFullDoc
      ? 'Rewriting full document (' + wordCount + ' words)'
      : 'Rewriting selected text (' + wordCount + ' words)';

    pendingToneRewrite = {
      text: sourceText,
      startOffset: selOffsets ? selOffsets.start : 0,
      endOffset: selOffsets ? selOffsets.end : fullText.length,
      isFullDoc: isFullDoc,
      rewritten: null
    };

    // Reset UI
    tonePreview.hidden = true;
    toneLoading.hidden = true;
    toneError.hidden = true;
    toneApplyBtn.hidden = true;
    toneRewriteBtn.hidden = false;
    toneRewriteBtn.disabled = true;
    // Clear radio selection
    var radios = toneOptions.querySelectorAll('input[type="radio"]');
    radios.forEach(function (r) { r.checked = false; });

    toneModal.hidden = false;
    trapFocus(toneModal);
  }

  function handleToneRewrite() {
    var selected = toneOptions.querySelector('input[name="targetTone"]:checked');
    if (!selected || !pendingToneRewrite) return;

    var targetTone = selected.value;

    // Show loading
    toneRewriteBtn.hidden = true;
    toneLoading.hidden = false;
    tonePreview.hidden = true;
    toneError.hidden = true;

    FullCheck.rewriteTone(pendingToneRewrite.text, targetTone, function (result, error) {
      toneLoading.hidden = true;

      if (error) {
        toneError.textContent = 'Rewrite failed: ' + error;
        toneError.hidden = false;
        toneRewriteBtn.hidden = false;
        return;
      }

      pendingToneRewrite.rewritten = result;

      // Show preview
      toneOriginalText.textContent = pendingToneRewrite.text;
      toneRewrittenText.textContent = result;
      tonePreview.hidden = false;
      toneApplyBtn.hidden = false;
    });
  }

  function handleToneApply() {
    if (!pendingToneRewrite || !pendingToneRewrite.rewritten) return;

    if (pendingToneRewrite.isFullDoc) {
      Editor.setText(pendingToneRewrite.rewritten);
    } else {
      Editor.applyReplacement(
        pendingToneRewrite.startOffset,
        pendingToneRewrite.endOffset,
        pendingToneRewrite.rewritten,
        pendingToneRewrite.text
      );
    }

    toneModal.hidden = true;
    releaseFocus();
    pendingToneRewrite = null;
    recheckNow();
    showToast('Tone rewrite applied.');
  }

  // ========== AI rule generation ==========

  function handleGenerateRule() {
    var description = ruleDescription ? ruleDescription.value.trim() : '';
    if (!description) return;

    ruleGenerateBtn.disabled = true;
    ruleGenerateBtn.textContent = 'Generating...';
    if (ruleGenerateStatus) {
      ruleGenerateStatus.hidden = true;
    }

    // Get existing phrases for dedup
    var existingRules = getStoredRules();
    var existingPhrases = existingRules.map(function (r) { return r.phrase; });

    FullCheck.generateRule(description, existingPhrases, function (result, error) {
      ruleGenerateBtn.disabled = false;
      ruleGenerateBtn.textContent = 'Generate rule';

      if (error) {
        if (ruleGenerateStatus) {
          ruleGenerateStatus.textContent = 'Failed: ' + error;
          ruleGenerateStatus.className = 'settings-save-status error';
          ruleGenerateStatus.hidden = false;
        }
        return;
      }

      if (result && result.duplicate) {
        if (ruleGenerateStatus) {
          ruleGenerateStatus.textContent = 'A rule for "' + (result.existingPhrase || result.phrase) + '" already exists.';
          ruleGenerateStatus.className = 'settings-save-status error';
          ruleGenerateStatus.hidden = false;
        }
        return;
      }

      if (result && result.phrase) {
        // Pre-fill the form
        rulePhrase.value = result.phrase;
        ruleReplacement.value = result.replacement || '';
        ruleMessage.value = result.message || '';
        ruleDescription.value = '';

        if (ruleGenerateStatus) {
          ruleGenerateStatus.textContent = 'Rule generated — review and click "Add rule"';
          ruleGenerateStatus.className = 'settings-save-status';
          ruleGenerateStatus.hidden = false;
        }
        // Scroll to the form
        rulePhrase.focus();
      } else {
        if (ruleGenerateStatus) {
          ruleGenerateStatus.textContent = 'Could not generate a rule from that description.';
          ruleGenerateStatus.className = 'settings-save-status error';
          ruleGenerateStatus.hidden = false;
        }
      }
    });
  }

  // ========== Start ==========
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
