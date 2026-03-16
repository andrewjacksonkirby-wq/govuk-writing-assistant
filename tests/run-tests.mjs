/**
 * Headless browser test runner using Playwright.
 * Runs the smoke tests and exercises the full app.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';

const PORT = 9876;
const ROOT = join(import.meta.dirname, '..');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.txt': 'text/plain',
  '.json': 'application/json',
};

// Simple static file server
const server = createServer((req, res) => {
  let filePath = join(ROOT, req.url === '/' ? 'index.html' : req.url);
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(readFileSync(filePath));
});

let passed = 0;
let failed = 0;
let errors = [];

function log(status, msg) {
  const icon = status === 'PASS' ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${icon} ${msg}`);
  if (status === 'PASS') passed++;
  else { failed++; errors.push(msg); }
}

async function run() {
  server.listen(PORT);
  const browser = await chromium.launch({
    executablePath: '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // ==================== PART 1: Smoke tests ====================
    console.log('\n\x1b[1m=== Smoke Tests (tests/smoke.html) ===\x1b[0m');
    const ctx1 = await browser.newContext();
    const page1 = await ctx1.newPage();

    const consoleErrors1 = [];
    page1.on('console', msg => { if (msg.type() === 'error') consoleErrors1.push(msg.text()); });
    page1.on('pageerror', err => consoleErrors1.push(err.message));

    await page1.goto(`http://localhost:${PORT}/tests/smoke.html`);
    // Wait for tests to run
    await page1.waitForFunction(() => {
      const summary = document.getElementById('summary');
      return summary && summary.textContent && summary.textContent.includes('passed');
    }, { timeout: 15000 });

    const smokeResults = await page1.evaluate(() => {
      const rows = document.querySelectorAll('.test-row');
      return Array.from(rows).map(row => ({
        text: row.textContent,
        pass: row.querySelector('.pass') !== null
      }));
    });

    smokeResults.forEach(r => {
      log(r.pass ? 'PASS' : 'FAIL', r.text.trim());
    });

    const smokeSummary = await page1.$eval('#summary', el => el.textContent);
    console.log(`  Summary: ${smokeSummary}`);

    // Check for JS errors during smoke tests
    const realErrors1 = consoleErrors1.filter(e =>
      !e.includes('dictionary') && !e.includes('words.txt') && !e.includes('fetch') && !e.includes('net::') && !e.includes('Failed to load resource')
    );
    if (realErrors1.length > 0) {
      realErrors1.forEach(e => log('FAIL', 'Console error: ' + e));
    } else {
      log('PASS', 'No unexpected console errors in smoke tests');
    }

    await ctx1.close();

    // ==================== PART 2: Full app tests ====================
    console.log('\n\x1b[1m=== Full App Tests (index.html) ===\x1b[0m');
    const ctx2 = await browser.newContext();
    const page = await ctx2.newPage();

    const consoleErrors2 = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors2.push(msg.text()); });
    page.on('pageerror', err => consoleErrors2.push(err.message));

    // Block CDN requests that hang in this environment
    await page.route('**/*.cloudflare.com/**', route => route.abort());
    await page.route('**/cdnjs.cloudflare.com/**', route => route.abort());
    await page.route('**/fonts.googleapis.com/**', route => route.abort());
    await page.route('**/fonts.gstatic.com/**', route => route.abort());

    await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2000); // Let modules initialize

    // -- App loads without crash --
    const title = await page.title();
    log(title.includes('Writing Assistant') ? 'PASS' : 'FAIL', 'App title: ' + title);

    // -- All modules accessible --
    const modules = await page.evaluate(() => {
      return {
        Editor: typeof Editor !== 'undefined',
        QuickChecks: typeof QuickChecks !== 'undefined',
        FullCheck: typeof FullCheck !== 'undefined',
        Stats: typeof Stats !== 'undefined',
        Suggestions: typeof Suggestions !== 'undefined',
        Reports: typeof Reports !== 'undefined',
        InlinePopup: typeof InlinePopup !== 'undefined',
        Documents: typeof Documents !== 'undefined',
      };
    });
    for (const [name, exists] of Object.entries(modules)) {
      log(exists ? 'PASS' : 'FAIL', `Module ${name} loaded`);
    }

    // -- Editor works --
    await page.click('#editor');
    await page.keyboard.type('The cat sat on the mat.');
    const editorText = await page.evaluate(() => Editor.getText());
    log(editorText.trim() === 'The cat sat on the mat.' ? 'PASS' : 'FAIL',
      'Editor typing works: "' + editorText.trim().slice(0, 40) + '"');

    // -- Stats update --
    await page.waitForTimeout(500);
    const wordCount = await page.$eval('#statWords', el => el.textContent);
    log(wordCount === '6' ? 'PASS' : 'FAIL', 'Word count: ' + wordCount + ' (expected 6)');

    // -- QuickChecks detects issues --
    await page.evaluate(() => {
      Editor.setText('I must of gone there. The the cat sat.');
    });
    await page.waitForTimeout(1500); // Wait for debounced check

    const issueCount = await page.evaluate(() => {
      return QuickChecks.runAll('I must of gone there. The the cat sat.').length;
    });
    log(issueCount > 0 ? 'PASS' : 'FAIL', 'QuickChecks finds issues: ' + issueCount);

    // -- Mode switching --
    await page.selectOption('#modeSelect', 'email');
    await page.waitForTimeout(300);
    const mode = await page.evaluate(() => QuickChecks.getMode());
    log(mode === 'email' ? 'PASS' : 'FAIL', 'Mode switch to email: ' + mode);
    await page.selectOption('#modeSelect', 'govuk');
    await page.waitForTimeout(300);

    // -- Custom rules modal opens --
    await page.click('#customRulesBtn');
    const rulesModalVisible = await page.evaluate(() => !document.getElementById('customRulesModal').hidden);
    log(rulesModalVisible ? 'PASS' : 'FAIL', 'Custom rules modal opens');

    // -- Built-in rules list renders --
    await page.waitForTimeout(300);
    const builtinCount = await page.evaluate(() => {
      return document.querySelectorAll('#builtinRulesList .builtin-rule-row').length;
    });
    log(builtinCount > 100 ? 'PASS' : 'FAIL', 'Built-in rules rendered: ' + builtinCount + ' rows');

    // -- Built-in rules footer shows count --
    const footerText = await page.$eval('#builtinRulesFooter', el => el.textContent);
    log(footerText.includes('of') && footerText.includes('rules') ? 'PASS' : 'FAIL',
      'Built-in rules footer: "' + footerText + '"');

    // -- Built-in rules search works --
    await page.fill('#builtinRulesSearch', 'leverage');
    await page.waitForTimeout(200);
    const searchCount = await page.evaluate(() => {
      return document.querySelectorAll('#builtinRulesList .builtin-rule-row').length;
    });
    log(searchCount > 0 && searchCount < builtinCount ? 'PASS' : 'FAIL',
      'Search filters rules: ' + searchCount + ' results for "leverage"');

    // -- Clear search --
    await page.fill('#builtinRulesSearch', '');
    await page.waitForTimeout(200);

    // -- Category filter works --
    await page.selectOption('#builtinRulesCatFilter', 'Spelling');
    await page.waitForTimeout(200);
    const spellingCount = await page.evaluate(() => {
      return document.querySelectorAll('#builtinRulesList .builtin-rule-row').length;
    });
    log(spellingCount > 10 && spellingCount < builtinCount ? 'PASS' : 'FAIL',
      'Category filter (Spelling): ' + spellingCount + ' rules');
    await page.selectOption('#builtinRulesCatFilter', 'all');
    await page.waitForTimeout(200);

    // -- Toggle a built-in rule off --
    const toggleResult = await page.evaluate(() => {
      // Use "must of" which is only caught by the grammar rule, not spelling
      var rules = QuickChecks.getBuiltinRules();
      var mustOfRule = rules.find(r => r.phrase === 'must of');
      if (!mustOfRule) return 'must-of rule not found';
      // Verify it flags "must of"
      var before = QuickChecks.runAll('I must of gone there.');
      var flaggedBefore = before.some(r => r.original === 'must of');
      // Disable it
      QuickChecks.setDisabledBuiltinRules([mustOfRule.key]);
      var after = QuickChecks.runAll('I must of gone there.');
      var flaggedAfter = after.some(r => r.original === 'must of');
      QuickChecks.setDisabledBuiltinRules([]);
      if (!flaggedBefore) return 'must of not flagged before disable';
      if (flaggedAfter) return 'must of still flagged after disable';
      return 'ok';
    });
    log(toggleResult === 'ok' ? 'PASS' : 'FAIL', 'Toggle built-in rule off: ' + toggleResult);

    // -- Close rules modal --
    await page.click('#closeRulesModal');
    const rulesModalHidden = await page.evaluate(() => document.getElementById('customRulesModal').hidden);
    log(rulesModalHidden ? 'PASS' : 'FAIL', 'Rules modal closes');

    // -- Dictionary modal opens --
    await page.click('#dictBtn');
    const dictVisible = await page.evaluate(() => !document.getElementById('dictionaryModal').hidden);
    log(dictVisible ? 'PASS' : 'FAIL', 'Dictionary modal opens');
    await page.click('#closeDictModal');

    // -- Settings modal opens --
    await page.click('#settingsBtn');
    const settingsVisible = await page.evaluate(() => !document.getElementById('settingsModal').hidden);
    log(settingsVisible ? 'PASS' : 'FAIL', 'Settings modal opens');
    await page.click('#closeSettingsModal');

    // -- History modal opens --
    await page.click('#historyBtn');
    const historyVisible = await page.evaluate(() => !document.getElementById('historyModal').hidden);
    log(historyVisible ? 'PASS' : 'FAIL', 'History modal opens');
    await page.click('#closeHistoryModal');

    // -- Documents view --
    await page.click('#draftsBtn');
    const docsVisible = await page.evaluate(() => !document.getElementById('documentsView').hidden);
    log(docsVisible ? 'PASS' : 'FAIL', 'Documents view opens');

    // -- New draft from documents --
    await page.click('#docsNewDraftBtn');
    const docsHidden = await page.evaluate(() => document.getElementById('documentsView').hidden);
    log(docsHidden ? 'PASS' : 'FAIL', 'New draft returns to editor');

    // -- Export button doesn't crash --
    await page.evaluate(() => Editor.setText('Test export content.'));
    await page.waitForTimeout(300);
    const exportOk = await page.evaluate(() => {
      try {
        document.getElementById('exportBtn').click();
        return true;
      } catch (e) { return e.message; }
    });
    log(exportOk === true ? 'PASS' : 'FAIL', 'Export button: ' + exportOk);

    // -- Sidebar view toggle --
    const reportsTabExists = await page.evaluate(() => {
      var tab = document.getElementById('viewReports');
      if (!tab) return false;
      tab.click();
      return !document.getElementById('reportsView').hidden;
    });
    log(reportsTabExists ? 'PASS' : 'FAIL', 'Reports tab switches view');

    const suggestionsTabWorks = await page.evaluate(() => {
      var tab = document.getElementById('viewSuggestions');
      if (!tab) return false;
      tab.click();
      return !document.getElementById('suggestionsView').hidden;
    });
    log(suggestionsTabWorks ? 'PASS' : 'FAIL', 'Suggestions tab switches back');

    // -- GOV.UK mode: full detection test --
    const govukDetection = await page.evaluate(() => {
      Editor.setText('');
      var text = 'Please leverage the portal to collaborate with stakeholders. We should utilize this going forward. The color of the fireman\'s uniform. I must of seen it e.g. yesterday. This is a free gift.';
      var results = QuickChecks.runAll(text);
      var categories = {};
      results.forEach(r => { categories[r.category] = (categories[r.category] || 0) + 1; });
      return { count: results.length, categories: categories };
    });
    log(govukDetection.count >= 8 ? 'PASS' : 'FAIL',
      'GOV.UK full detection: ' + govukDetection.count + ' issues, categories: ' + JSON.stringify(govukDetection.categories));

    // -- Keyboard shortcut (Esc closes modal) --
    await page.click('#settingsBtn');
    await page.keyboard.press('Escape');
    const settingsAfterEsc = await page.evaluate(() => document.getElementById('settingsModal').hidden);
    log(settingsAfterEsc ? 'PASS' : 'FAIL', 'Escape closes modal');

    // -- Check console errors --
    const realErrors2 = consoleErrors2.filter(e =>
      !e.includes('dictionary') && !e.includes('words.txt') && !e.includes('fetch') &&
      !e.includes('net::') && !e.includes('mammoth') && !e.includes('Failed to load resource') && !e.includes('cdnjs')
    );
    if (realErrors2.length > 0) {
      realErrors2.forEach(e => log('FAIL', 'Console error: ' + e));
    } else {
      log('PASS', 'No unexpected console errors in app');
    }

    await ctx2.close();

  } finally {
    await browser.close();
    server.close();
  }

  // ==================== Summary ====================
  console.log('\n\x1b[1m=== Summary ===\x1b[0m');
  console.log(`  \x1b[32m${passed} passed\x1b[0m, \x1b[${failed > 0 ? '31' : '32'}m${failed} failed\x1b[0m`);
  if (errors.length > 0) {
    console.log('\n  \x1b[31mFailures:\x1b[0m');
    errors.forEach(e => console.log('    - ' + e));
  }
  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Test runner error:', err);
  server.close();
  process.exit(1);
});
