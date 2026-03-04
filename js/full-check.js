/**
 * FullCheck module
 * AI-based full check with sensitivity gate.
 * Only runs when user clicks "Check now" AND content is marked safe.
 * Results go under "Clarity and style".
 */
const FullCheck = (function () {
  var isRunning = false;
  var idCounter = 0;

  // Default API config - user can configure this
  var config = {
    apiEndpoint: '', // Set to a real endpoint to enable AI checks
    apiKey: '',
    model: 'claude-sonnet-4-20250514',
    useSimulation: true // If true, uses local simulation instead of API
  };

  function makeId() {
    return 'fc-' + (++idCounter);
  }

  /**
   * Check whether AI check is allowed for the current sensitivity setting.
   */
  function isAllowed(sensitivity) {
    return sensitivity === 'safe';
  }

  /**
   * Run the full check.
   * @param {string} text - The editor text
   * @param {string} sensitivity - 'safe' or 'sensitive'
   * @param {function} callback - callback(results, error)
   */
  function run(text, sensitivity, callback) {
    if (!isAllowed(sensitivity)) {
      callback(null, 'blocked');
      return;
    }

    if (isRunning) {
      callback(null, 'already-running');
      return;
    }

    if (!text || text.trim().length === 0) {
      callback([], null);
      return;
    }

    isRunning = true;

    if (config.useSimulation || !config.apiEndpoint) {
      runSimulation(text, callback);
    } else {
      runAPI(text, callback);
    }
  }

  /**
   * Local simulation of AI checks for GOV.UK style issues.
   * This provides useful checks without needing an API.
   */
  function runSimulation(text, callback) {
    setTimeout(function () {
      var results = [];

      // Check sentence length
      var sentences = text.split(/[.!?]+/).filter(function (s) { return s.trim().length > 0; });
      sentences.forEach(function (sentence) {
        var words = sentence.trim().split(/\s+/);
        if (words.length > 25) {
          var start = text.indexOf(sentence.trim());
          if (start >= 0) {
            results.push({
              id: makeId(),
              ruleId: 'sentence-length',
              source: 'ai',
              group: 'clarity',
              category: 'Sentence length',
              start: start,
              end: start + sentence.trim().length,
              message: 'This sentence has ' + words.length + ' words. GOV.UK recommends keeping sentences under 25 words.',
              title: 'Long sentence',
              original: sentence.trim()
            });
          }
        }
      });

      // Check for passive voice patterns
      var passivePatterns = [
        /\b(was|were|is|are|been|being|be)\s+(being\s+)?\w+ed\b/gi,
        /\b(has|have|had)\s+been\s+\w+ed\b/gi
      ];
      passivePatterns.forEach(function (pat) {
        var match;
        while ((match = pat.exec(text)) !== null) {
          results.push({
            id: makeId(),
            ruleId: 'passive-voice',
            source: 'ai',
            group: 'clarity',
            category: 'Tone',
            start: match.index,
            end: match.index + match[0].length,
            message: 'Consider using active voice for clearer writing.',
            title: 'Passive voice',
            original: match[0]
          });
        }
      });

      // Check for GOV.UK date format issues
      var datePatterns = [
        { regex: /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g, msg: 'GOV.UK style: use "1 January 2024" format instead of numeric dates' },
        { regex: /\b(\d{1,2})(?:st|nd|rd|th)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/gi, msg: 'GOV.UK style: do not use ordinals with dates. Write "1 January" not "1st January"' }
      ];
      datePatterns.forEach(function (pat) {
        var match;
        while ((match = pat.regex.exec(text)) !== null) {
          results.push({
            id: makeId(),
            ruleId: 'date-format',
            source: 'ai',
            group: 'clarity',
            category: 'Dates',
            start: match.index,
            end: match.index + match[0].length,
            message: pat.msg,
            title: 'Date format',
            original: match[0]
          });
        }
      });

      // Check for "click here" and poor link text
      var linkPatterns = [
        { regex: /\bclick here\b/gi, msg: 'Avoid "click here" - use descriptive link text instead' },
        { regex: /\bhere\b(?=\s*<|\s*\(http)/gi, msg: 'Avoid using "here" as link text - describe the destination' }
      ];
      linkPatterns.forEach(function (pat) {
        var match;
        while ((match = pat.regex.exec(text)) !== null) {
          results.push({
            id: makeId(),
            ruleId: 'link-text',
            source: 'ai',
            group: 'clarity',
            category: 'Links',
            start: match.index,
            end: match.index + match[0].length,
            message: pat.msg,
            title: 'Link text',
            original: match[0]
          });
        }
      });

      // Check for GOV.UK style issues
      var stylePatterns = [
        { regex: /\bplease\b/gi, msg: 'GOV.UK style: avoid using "please" - be direct' },
        { regex: /\bkindly\b/gi, msg: 'GOV.UK style: avoid "kindly" - be direct' },
        { regex: /\bgoing forward\b/gi, msg: 'Avoid "going forward" - be specific about timing' },
        { regex: /\bat this point in time\b/gi, msg: 'Use "now" or "currently" instead' },
        { regex: /\bin the event that\b/gi, msg: 'Use "if" instead of "in the event that"' },
        { regex: /\bwith regards to\b/gi, msg: 'Use "about" instead of "with regards to"' },
        { regex: /\ba number of\b/gi, msg: 'Be specific - say how many instead of "a number of"' },
        { regex: /\bin respect of\b/gi, msg: 'Use "about" or "for" instead of "in respect of"' },
        { regex: /\bI\b/g, msg: 'GOV.UK style: avoid first person. Use "we" for the organisation or restructure the sentence.' },
        { regex: /\betc\.?\b/gi, msg: 'GOV.UK style: avoid "etc" - list the items or say "for example"' },
        { regex: /\bie\b/gi, msg: 'Write "that is" or rephrase instead of "ie"' },
        { regex: /\beg\b/gi, msg: 'Write "for example" instead of "eg"' }
      ];
      stylePatterns.forEach(function (pat) {
        var match;
        while ((match = pat.regex.exec(text)) !== null) {
          results.push({
            id: makeId(),
            ruleId: 'govuk-style',
            source: 'ai',
            group: 'clarity',
            category: 'GOV.UK style',
            start: match.index,
            end: match.index + match[0].length,
            message: pat.msg,
            title: 'Style',
            original: match[0]
          });
        }
      });

      // Sort by document order
      results.sort(function (a, b) { return a.start - b.start; });

      isRunning = false;
      callback(results, null);
    }, 800); // Simulate slight delay
  }

  /**
   * Run via external API.
   * This function is only called when config.useSimulation is false
   * and an API endpoint is configured.
   */
  function runAPI(text, callback) {
    var prompt = 'You are a GOV.UK content style checker. Analyse the following text and return a JSON array of issues.\n\n' +
      'Check for:\n' +
      '- GOV.UK style violations\n' +
      '- Sentence length over 25 words\n' +
      '- Poor link text like "click here"\n' +
      '- Incorrect date formats (should be "1 January 2024")\n' +
      '- Unclear phrasing\n' +
      '- Passive voice\n' +
      '- Tone issues\n\n' +
      'Return a JSON array where each item has:\n' +
      '- category: one of "GOV.UK style", "Sentence length", "Links", "Dates", "Tone"\n' +
      '- start: character offset start\n' +
      '- end: character offset end\n' +
      '- message: short explanation\n' +
      '- title: short title\n' +
      '- original: the problematic text\n' +
      '- replacement: suggested fix (optional)\n\n' +
      'Text to check:\n\n' + text;

    fetch(config.apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      })
    })
    .then(function (response) {
      if (!response.ok) throw new Error('API error: ' + response.status);
      return response.json();
    })
    .then(function (data) {
      var content = data.content && data.content[0] && data.content[0].text;
      if (!content) {
        isRunning = false;
        callback([], null);
        return;
      }

      // Parse the JSON from the response
      var jsonMatch = content.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        isRunning = false;
        callback([], null);
        return;
      }

      var issues = JSON.parse(jsonMatch[0]);
      var results = issues.map(function (issue) {
        return {
          id: makeId(),
          ruleId: 'ai-' + (issue.category || 'general').toLowerCase().replace(/\s+/g, '-'),
          source: 'ai',
          group: 'clarity',
          category: issue.category || 'Style',
          start: issue.start || 0,
          end: issue.end || 0,
          message: issue.message || '',
          title: issue.title || 'Style issue',
          original: issue.original || '',
          replacement: issue.replacement
        };
      });

      results.sort(function (a, b) { return a.start - b.start; });
      isRunning = false;
      callback(results, null);
    })
    .catch(function (err) {
      isRunning = false;
      callback(null, err.message);
    });
  }

  /**
   * Configure the API endpoint.
   */
  function configure(options) {
    Object.assign(config, options);
  }

  function getIsRunning() {
    return isRunning;
  }

  return {
    run: run,
    isAllowed: isAllowed,
    configure: configure,
    getIsRunning: getIsRunning
  };
})();
