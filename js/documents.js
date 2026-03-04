/**
 * Documents module
 * Handles saving, loading, autosave, recent drafts, and version history.
 * Uses localStorage for persistence.
 */
const Documents = (function () {
  const STORAGE_KEY = 'govuk-wa-documents';
  const CURRENT_KEY = 'govuk-wa-current-doc';
  const AUTOSAVE_INTERVAL = 5000; // 5 seconds

  let currentDocId = null;
  let autosaveTimer = null;
  let lastSavedText = '';
  let onStatusChange = null;

  /**
   * Get all documents from storage.
   */
  function getAllDocs() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveDocs(docs) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
  }

  /**
   * Initialise with callbacks.
   */
  function init(statusCallback) {
    onStatusChange = statusCallback;
    currentDocId = localStorage.getItem(CURRENT_KEY);
    if (!currentDocId) {
      currentDocId = createNewDoc();
    }
  }

  /**
   * Create a new document, return its id.
   */
  function createNewDoc(initialText) {
    var id = 'doc-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    var docs = getAllDocs();
    docs[id] = {
      id: id,
      text: initialText || '',
      title: 'Untitled draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sensitivity: 'sensitive', // 'sensitive' or 'safe'
      versions: []
    };
    saveDocs(docs);
    localStorage.setItem(CURRENT_KEY, id);
    currentDocId = id;
    return id;
  }

  /**
   * Load the current document. Returns { id, text, title, sensitivity, ... } or null.
   */
  function loadCurrent() {
    var docs = getAllDocs();
    var doc = docs[currentDocId];
    if (!doc) {
      currentDocId = createNewDoc();
      docs = getAllDocs();
      doc = docs[currentDocId];
    }
    lastSavedText = doc.text || '';
    return doc;
  }

  /**
   * Save current text (called by autosave and manual save).
   */
  function saveText(text) {
    if (!currentDocId) return;
    setStatus('saving');
    var docs = getAllDocs();
    if (!docs[currentDocId]) return;

    docs[currentDocId].text = text;
    docs[currentDocId].updatedAt = new Date().toISOString();

    // Auto-title from first line
    var firstLine = text.trim().split('\n')[0] || '';
    if (firstLine.length > 0) {
      docs[currentDocId].title = firstLine.substring(0, 60) + (firstLine.length > 60 ? '...' : '');
    } else {
      docs[currentDocId].title = 'Untitled draft';
    }

    saveDocs(docs);
    lastSavedText = text;
    setStatus('saved');
  }

  /**
   * Start autosave loop.
   */
  function startAutosave(getTextFn) {
    stopAutosave();
    autosaveTimer = setInterval(function () {
      var text = getTextFn();
      if (text !== lastSavedText) {
        saveText(text);
      }
    }, AUTOSAVE_INTERVAL);
  }

  function stopAutosave() {
    if (autosaveTimer) {
      clearInterval(autosaveTimer);
      autosaveTimer = null;
    }
  }

  /**
   * Save a version snapshot.
   */
  function saveVersion(text) {
    if (!currentDocId) return;
    var docs = getAllDocs();
    var doc = docs[currentDocId];
    if (!doc) return;

    doc.versions.push({
      timestamp: new Date().toISOString(),
      text: text
    });

    // Keep max 50 versions
    if (doc.versions.length > 50) {
      doc.versions = doc.versions.slice(-50);
    }

    saveDocs(docs);
  }

  /**
   * Get version history for the current document.
   */
  function getVersions() {
    var docs = getAllDocs();
    var doc = docs[currentDocId];
    if (!doc) return [];
    return (doc.versions || []).slice().reverse();
  }

  /**
   * Restore a version by index (in reversed array).
   * Saves current text as a version first.
   */
  function restoreVersion(reversedIndex, currentText) {
    var versions = getVersions();
    if (reversedIndex < 0 || reversedIndex >= versions.length) return null;

    // Save current state as a version first
    saveVersion(currentText);

    var version = versions[reversedIndex];
    saveText(version.text);
    return version.text;
  }

  /**
   * Get recent drafts (all documents, sorted by last updated).
   */
  function getRecentDrafts() {
    var docs = getAllDocs();
    return Object.values(docs)
      .sort(function (a, b) {
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      });
  }

  /**
   * Switch to a different document.
   */
  function switchDoc(docId) {
    var docs = getAllDocs();
    if (!docs[docId]) return null;
    currentDocId = docId;
    localStorage.setItem(CURRENT_KEY, docId);
    lastSavedText = docs[docId].text || '';
    return docs[docId];
  }

  /**
   * Get/set the sensitivity classification of the current document.
   */
  function getSensitivity() {
    var docs = getAllDocs();
    var doc = docs[currentDocId];
    return doc ? doc.sensitivity : 'safe';
  }

  function setSensitivity(value) {
    var docs = getAllDocs();
    if (!docs[currentDocId]) return;
    docs[currentDocId].sensitivity = value;
    saveDocs(docs);
  }

  /**
   * Get/set the writing mode of the current document.
   * Modes: 'govuk', 'email', 'chat'
   */
  function getMode() {
    var docs = getAllDocs();
    var doc = docs[currentDocId];
    return doc && doc.mode ? doc.mode : 'govuk';
  }

  function setMode(value) {
    var docs = getAllDocs();
    if (!docs[currentDocId]) return;
    docs[currentDocId].mode = value;
    saveDocs(docs);
  }

  function getCurrentId() {
    return currentDocId;
  }

  function setStatus(status) {
    if (onStatusChange) onStatusChange(status);
  }

  /**
   * Delete a document.
   */
  function deleteDoc(docId) {
    var docs = getAllDocs();
    delete docs[docId];
    saveDocs(docs);
    if (currentDocId === docId) {
      var remaining = Object.keys(docs);
      if (remaining.length > 0) {
        switchDoc(remaining[0]);
      } else {
        currentDocId = createNewDoc();
      }
    }
  }

  /**
   * Create a new draft (for "New draft" button).
   */
  function newDraft(currentText) {
    // Save current first
    if (currentText && currentText.trim().length > 0) {
      saveText(currentText);
      saveVersion(currentText);
    }
    var id = createNewDoc();
    return getAllDocs()[id];
  }

  return {
    init: init,
    loadCurrent: loadCurrent,
    saveText: saveText,
    startAutosave: startAutosave,
    stopAutosave: stopAutosave,
    saveVersion: saveVersion,
    getVersions: getVersions,
    restoreVersion: restoreVersion,
    getRecentDrafts: getRecentDrafts,
    switchDoc: switchDoc,
    getSensitivity: getSensitivity,
    setSensitivity: setSensitivity,
    getMode: getMode,
    setMode: setMode,
    getCurrentId: getCurrentId,
    deleteDoc: deleteDoc,
    newDraft: newDraft
  };
})();
