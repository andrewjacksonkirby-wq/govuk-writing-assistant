/**
 * App module
 * Wires together editor, documents, quick checks, full check, and suggestions.
 */
(function () {
  'use strict';

  // DOM elements
  var saveStatusEl = document.getElementById('saveStatus');
  var sensitivityToggle = document.getElementById('sensitivityToggle');
  var sensitivityText = document.getElementById('sensitivityText');
  var checkNowBtn = document.getElementById('checkNowBtn');
  var draftsBtn = document.getElementById('draftsBtn');
  var historyBtn = document.getElementById('historyBtn');
  var draftsModal = document.getElementById('draftsModal');
  var historyModal = document.getElementById('historyModal');
  var restoreConfirmModal = document.getElementById('restoreConfirmModal');
  var closeDraftsModal = document.getElementById('closeDraftsModal');
  var closeHistoryModal = document.getElementById('closeHistoryModal');
  var cancelRestore = document.getElementById('cancelRestore');
  var confirmRestore = document.getElementById('confirmRestore');
  var draftsList = document.getElementById('draftsList');
  var historyList = document.getElementById('historyList');

  var lastCheckVersion = -1;
  var pendingRestore = null;

  // ========== Init ==========

  function init() {
    // Init editor
    Editor.init('editor');

    // Init documents
    Documents.init(updateSaveStatus);

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

    // Start autosave
    Documents.startAutosave(function () {
      return Editor.getText();
    });

    // ========== Event listeners ==========

    // Editor changes -> trigger quick checks
    Editor.onChange(function (text, version) {
      updateSaveStatus('unsaved');
      QuickChecks.scheduleCheck(text, version, function (results, checkedVersion) {
        if (checkedVersion >= lastCheckVersion) {
          lastCheckVersion = checkedVersion;
          Suggestions.setCorrectness(results);
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

    // Check now button
    checkNowBtn.addEventListener('click', handleCheckNow);

    // Drafts modal
    draftsBtn.addEventListener('click', openDraftsModal);
    closeDraftsModal.addEventListener('click', function () { draftsModal.hidden = true; });
    draftsModal.addEventListener('click', function (e) {
      if (e.target === draftsModal) draftsModal.hidden = true;
    });

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
          // Trigger quick checks on restored text
          QuickChecks.scheduleCheck(restoredText, Editor.getVersion(), function (results, v) {
            lastCheckVersion = v;
            Suggestions.setCorrectness(results);
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

    // Run initial quick check if there's text
    var initialText = Editor.getText();
    if (initialText.trim().length > 0) {
      QuickChecks.scheduleCheck(initialText, Editor.getVersion(), function (results, v) {
        lastCheckVersion = v;
        Suggestions.setCorrectness(results);
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

  function handleApply(suggestion) {
    if (suggestion.replacement !== undefined) {
      Editor.applyReplacement(suggestion.start, suggestion.end, suggestion.replacement);
    }
  }

  function handleApplyAll(suggestions) {
    // Already sorted descending by position in Suggestions.applyAll
    // so later replacements don't shift earlier offsets
    suggestions.forEach(function (s) {
      if (s.replacement !== undefined) {
        Editor.applyReplacement(s.start, s.end, s.replacement);
      }
    });
  }

  function handleSelect(suggestion) {
    var groupClass = suggestion.group === 'correctness' ? 'highlight-correctness' : 'highlight-clarity';
    Editor.highlightRange(suggestion.start, suggestion.end, groupClass);
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
    var existingStatus = toolbar.querySelector('.ai-status');
    if (existingStatus) existingStatus.remove();

    var statusEl = document.createElement('span');
    statusEl.className = 'ai-status ' + (isSafe ? 'available' : 'unavailable');
    statusEl.textContent = isSafe ? 'AI check available' : 'AI check unavailable';
    toolbar.insertBefore(statusEl, checkNowBtn);
  }

  // ========== Modals ==========

  function openDraftsModal() {
    // Save current first
    Documents.saveText(Editor.getText());

    var drafts = Documents.getRecentDrafts();
    draftsList.innerHTML = '';

    if (drafts.length === 0) {
      draftsList.innerHTML = '<p class="empty-state">No saved drafts</p>';
      draftsModal.hidden = false;
      return;
    }

    // New draft button
    var newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'btn btn-secondary';
    newBtn.textContent = 'New draft';
    newBtn.style.marginBottom = '16px';
    newBtn.addEventListener('click', function () {
      var doc = Documents.newDraft(Editor.getText());
      Editor.setText('');
      Suggestions.clearAll();
      updateSensitivityUI(Documents.getSensitivity());
      draftsModal.hidden = true;
    });
    draftsList.appendChild(newBtn);

    var currentId = Documents.getCurrentId();

    drafts.forEach(function (doc) {
      var item = document.createElement('div');
      item.className = 'draft-item' + (doc.id === currentId ? ' current' : '');

      var info = document.createElement('div');
      var titleEl = document.createElement('div');
      titleEl.className = 'draft-title';
      titleEl.textContent = doc.title || 'Untitled draft';
      info.appendChild(titleEl);

      var metaEl = document.createElement('div');
      metaEl.className = 'draft-meta';
      metaEl.textContent = formatDate(doc.updatedAt);
      info.appendChild(metaEl);

      item.appendChild(info);

      if (doc.id !== currentId) {
        var openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'btn btn-secondary btn-sm';
        openBtn.textContent = 'Open';
        openBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          // Save current before switching
          Documents.saveText(Editor.getText());
          var switched = Documents.switchDoc(doc.id);
          if (switched) {
            Editor.setText(switched.text || '');
            Suggestions.clearAll();
            updateSensitivityUI(switched.sensitivity || 'safe');
            // Run quick checks
            QuickChecks.scheduleCheck(switched.text || '', Editor.getVersion(), function (results, v) {
              lastCheckVersion = v;
              Suggestions.setCorrectness(results);
            });
          }
          draftsModal.hidden = true;
        });

        var actions = document.createElement('div');
        actions.className = 'draft-actions';
        actions.appendChild(openBtn);
        item.appendChild(actions);
      }

      draftsList.appendChild(item);
    });

    draftsModal.hidden = false;
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
      if (diffMins < 60) return diffMins + ' minutes ago';
      if (diffHours < 24) return diffHours + ' hours ago';

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
