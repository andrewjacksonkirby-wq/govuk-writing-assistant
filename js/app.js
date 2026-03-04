/**
 * App module
 * Wires together editor, documents, quick checks, full check, suggestions,
 * stats, mode selector, upload, export, and keyboard shortcuts.
 */
(function () {
  'use strict';

  // DOM elements
  var saveStatusEl = document.getElementById('saveStatus');
  var sensitivityToggle = document.getElementById('sensitivityToggle');
  var sensitivityText = document.getElementById('sensitivityText');
  var checkNowBtn = document.getElementById('checkNowBtn');
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

  // ========== Init ==========

  function init() {
    // Init editor
    Editor.init('editor');

    // Init documents
    Documents.init(updateSaveStatus);

    // Init stats
    Stats.init();

    // Init suggestions
    Suggestions.init({
      onApply: handleApply,
      onApplyAll: handleApplyAll,
      onSelect: handleSelect
    });

    // Load current document
    var doc = Documents.loadCurrent();
    if (doc && doc.text) {
      Editor.setText(doc.text);
    }

    // Set sensitivity state
    var sensitivity = Documents.getSensitivity();
    updateSensitivityUI(sensitivity);
    sensitivityToggle.checked = sensitivity === 'safe';

    // Set writing mode
    var mode = Documents.getMode();
    updateModeUI(mode);

    // Start autosave
    Documents.startAutosave(function () {
      return Editor.getText();
    });

    // ========== Event listeners ==========

    // Editor changes -> trigger quick checks + update stats
    Editor.onChange(function (text, version) {
      updateSaveStatus('unsaved');
      Stats.update(text);
      QuickChecks.scheduleCheck(text, version, function (results, checkedVersion) {
        if (checkedVersion >= lastCheckVersion) {
          lastCheckVersion = checkedVersion;
          processQuickCheckResults(results);
        }
      });
    });

    // Sensitivity toggle
    sensitivityToggle.addEventListener('change', function () {
      var isSafe = sensitivityToggle.checked;
      var value = isSafe ? 'safe' : 'sensitive';
      Documents.setSensitivity(value);
      updateSensitivityUI(value);
    });

    // Mode selector
    modeSelect.addEventListener('change', function () {
      var mode = modeSelect.value;
      Documents.setMode(mode);
      QuickChecks.setMode(mode);
      FullCheck.setMode(mode);
      // Re-run quick checks with new mode
      var text = Editor.getText();
      QuickChecks.scheduleCheck(text, Editor.getVersion(), function (results, v) {
        lastCheckVersion = v;
        processQuickCheckResults(results);
      });
    });

    // Check now button
    checkNowBtn.addEventListener('click', handleCheckNow);

    // Upload handler
    uploadFile.addEventListener('change', handleUpload);

    // Export handler
    exportBtn.addEventListener('click', handleExport);

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      // Ctrl+S / Cmd+S = save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        Documents.saveText(Editor.getText());
      }
      // Ctrl+Shift+C / Cmd+Shift+C = check now
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        handleCheckNow();
      }
    });

    // Documents view
    draftsBtn.addEventListener('click', showDocumentsView);
    newDraftBtn.addEventListener('click', createNewDraftAndEdit);
    docsNewDraftBtn.addEventListener('click', createNewDraftAndEdit);

    // History modal
    historyBtn.addEventListener('click', openHistoryModal);
    closeHistoryModal.addEventListener('click', function () { historyModal.hidden = true; });
    historyModal.addEventListener('click', function (e) {
      if (e.target === historyModal) historyModal.hidden = true;
    });

    // Restore confirm
    cancelRestore.addEventListener('click', function () {
      restoreConfirmModal.hidden = true;
      pendingRestore = null;
    });
    confirmRestore.addEventListener('click', function () {
      if (pendingRestore !== null) {
        var restoredText = Documents.restoreVersion(pendingRestore, Editor.getText());
        if (restoredText !== null) {
          Editor.setText(restoredText);
          Suggestions.clearAll();
          Stats.update(restoredText);
          // Trigger quick checks on restored text
          QuickChecks.scheduleCheck(restoredText, Editor.getVersion(), function (results, v) {
            lastCheckVersion = v;
            processQuickCheckResults(results);
          });
        }
        pendingRestore = null;
      }
      restoreConfirmModal.hidden = true;
      historyModal.hidden = true;
    });

    // Save version on significant actions (before closing, switching docs)
    window.addEventListener('beforeunload', function () {
      var text = Editor.getText();
      if (text.trim().length > 0) {
        Documents.saveText(text);
      }
    });

    // Run initial quick check + stats if there's text
    var initialText = Editor.getText();
    if (initialText.trim().length > 0) {
      Stats.update(initialText);
      QuickChecks.scheduleCheck(initialText, Editor.getVersion(), function (results, v) {
        lastCheckVersion = v;
        processQuickCheckResults(results);
      });
    }
  }

  // ========== Handlers ==========

  function handleCheckNow() {
    var sensitivity = Documents.getSensitivity();

    if (!FullCheck.isAllowed(sensitivity)) {
      alert('AI check is not available for this draft.\n\nThis draft is marked as "Do not send to external AI". Change the classification to use AI checks.');
      return;
    }

    if (FullCheck.getIsRunning()) return;

    var text = Editor.getText();
    if (!text || text.trim().length === 0) return;

    // Save a version snapshot before running full check
    Documents.saveVersion(text);

    // Show loading state
    checkNowBtn.disabled = true;
    checkNowBtn.textContent = 'Checking...';
    Suggestions.markFullCheckRun();

    FullCheck.run(text, sensitivity, function (results, error) {
      checkNowBtn.disabled = false;
      checkNowBtn.textContent = 'Check now';

      if (error === 'blocked') {
        alert('AI check blocked: this draft is marked as sensitive.');
        return;
      }

      if (error) {
        alert('AI check failed: ' + error);
        return;
      }

      Suggestions.setClarity(results || []);
    });
  }

  /**
   * Process quick check results: all issues go to both
   * the sidebar AND show as inline underlines in the editor.
   */
  function processQuickCheckResults(results) {
    Suggestions.setCorrectness(results);

    // Show all issues as inline underlines in the editor
    Editor.showUnderlines(results, function (mark) {
      // Clicking an underline expands the corresponding sidebar card
      Suggestions.selectById(mark.id);
    });
  }

  function handleApply(suggestion) {
    if (suggestion.replacement !== undefined) {
      Editor.applyReplacement(suggestion.start, suggestion.end, suggestion.replacement);
    }
    // Immediately re-check (don't wait for debounce) since offsets have shifted
    recheckNow();
  }

  function handleApplyAll(suggestions) {
    // Already sorted descending by position in Suggestions.applyAll
    // so later replacements don't shift earlier offsets
    suggestions.forEach(function (s) {
      if (s.replacement !== undefined) {
        Editor.applyReplacement(s.start, s.end, s.replacement);
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
    var groupClass = suggestion.group === 'correctness' ? 'highlight-correctness' : 'highlight-clarity';
    Editor.highlightRange(suggestion.start, suggestion.end, groupClass);
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
      reader.readAsText(file);
    } else if (name.endsWith('.docx') || name.endsWith('.doc')) {
      if (typeof mammoth === 'undefined') {
        alert('Word document support is loading. Please try again in a moment.');
        return;
      }
      var reader2 = new FileReader();
      reader2.onload = function (ev) {
        mammoth.extractRawText({ arrayBuffer: ev.target.result })
          .then(function (result) {
            loadUploadedText(result.value);
          })
          .catch(function (err) {
            alert('Could not read document: ' + err.message);
          });
      };
      reader2.readAsArrayBuffer(file);
    } else {
      alert('Unsupported file type. Please upload a .docx or .txt file.');
    }

    // Reset the input so the same file can be re-uploaded
    uploadFile.value = '';
  }

  function loadUploadedText(text) {
    Editor.setText(text);
    Stats.update(text);
    Suggestions.clearAll();
    updateSaveStatus('unsaved');
    QuickChecks.scheduleCheck(text, Editor.getVersion(), function (results, v) {
      lastCheckVersion = v;
      processQuickCheckResults(results);
    });
  }

  /**
   * Export the current text as a .txt file download.
   */
  function handleExport() {
    var text = Editor.getText();
    if (!text || text.trim().length === 0) {
      alert('Nothing to export.');
      return;
    }
    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    // Use the document title for the filename
    var docs = Documents.loadCurrent();
    var title = (docs && docs.title) || 'draft';
    a.download = title.replace(/[^a-zA-Z0-9 _-]/g, '').substring(0, 50) + '.txt';
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

  function updateSensitivityUI(sensitivity) {
    var isSafe = sensitivity === 'safe';
    sensitivityToggle.checked = isSafe;

    if (isSafe) {
      sensitivityText.textContent = 'Safe to send to AI';
      sensitivityText.className = 'sensitivity-text';
      checkNowBtn.disabled = false;
      checkNowBtn.title = '';
    } else {
      sensitivityText.textContent = 'Do not send to external AI';
      sensitivityText.className = 'sensitivity-text sensitive';
      checkNowBtn.disabled = true;
      checkNowBtn.title = 'AI check unavailable — draft marked as sensitive';
    }

    // Update AI status indicator
    var toolbar = document.querySelector('.editor-actions');
    if (toolbar) {
      var existingStatus = toolbar.querySelector('.ai-status');
      if (existingStatus) existingStatus.remove();

      var statusEl = document.createElement('span');
      statusEl.className = 'ai-status ' + (isSafe ? 'available' : 'unavailable');
      statusEl.textContent = isSafe ? 'AI check available' : 'AI check unavailable';
      toolbar.insertBefore(statusEl, checkNowBtn);
    }
  }

  function updateModeUI(mode) {
    modeSelect.value = mode;
    QuickChecks.setMode(mode);
    FullCheck.setMode(mode);
  }

  // ========== Modals ==========

  /**
   * Show the documents list view (hides editor).
   */
  function showDocumentsView() {
    // Save current draft first
    var text = Editor.getText();
    if (text && text.trim().length > 0) {
      Documents.saveText(text);
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
    // Save current work first
    var text = Editor.getText();
    if (text && text.trim().length > 0) {
      Documents.saveText(text);
    }
    Documents.newDraft(text);
    Editor.setText('');
    Suggestions.clearAll();
    Editor.clearUnderlines();
    Stats.update('');
    updateSensitivityUI(Documents.getSensitivity());
    updateModeUI(Documents.getMode());
    showEditorView();
  }

  /**
   * Open a document by ID and switch to the editor.
   */
  function openDocument(docId) {
    Documents.saveText(Editor.getText());
    var switched = Documents.switchDoc(docId);
    if (switched) {
      Editor.setText(switched.text || '');
      Suggestions.clearAll();
      Editor.clearUnderlines();
      Stats.update(switched.text || '');
      updateSensitivityUI(switched.sensitivity || 'safe');
      updateModeUI(switched.mode || 'govuk');
      QuickChecks.scheduleCheck(switched.text || '', Editor.getVersion(), function (results, v) {
        lastCheckVersion = v;
        processQuickCheckResults(results);
      });
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
      updateSensitivityUI(Documents.getSensitivity());
      updateModeUI(Documents.getMode());
    }
    renderDocumentsList();
  }

  /**
   * Render the documents list.
   */
  function renderDocumentsList() {
    var drafts = Documents.getRecentDrafts();
    documentsList.innerHTML = '';

    if (drafts.length === 0) {
      documentsList.innerHTML = '<p class="empty-state">No documents yet. Click "New draft" to get started.</p>';
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
  }

  function openHistoryModal() {
    var versions = Documents.getVersions();
    historyList.innerHTML = '';

    if (versions.length === 0) {
      historyList.innerHTML = '<p class="empty-state">No versions saved yet. Versions are created automatically when you run AI checks or switch between drafts.</p>';
      historyModal.hidden = false;
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
      });
      item.appendChild(restoreBtn);

      historyList.appendChild(item);
    });

    historyModal.hidden = false;
  }

  // ========== Helpers ==========

  function formatDate(isoString) {
    if (!isoString) return '';
    try {
      var d = new Date(isoString);
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

  // ========== Start ==========
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
