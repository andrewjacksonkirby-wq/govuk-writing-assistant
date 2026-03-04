/**
 * QuickChecks module
 * Regex-based, local-only mechanical checks.
 * Covers: spelling, grammar, repeated words, double spaces, punctuation.
 * Never calls external APIs.
 */
const QuickChecks = (function () {
  var debounceTimer = null;
  var DEBOUNCE_MS = 1000; // 1 second, within 800-1500ms range
  var pendingVersion = -1;
  var currentMode = 'govuk'; // 'govuk', 'email', 'chat'

  /**
   * Common misspellings dictionary (UK English / GOV.UK focus).
   * Each key is a misspelling, value is the correct spelling.
   */
  var COMMON_MISSPELLINGS = {
    'accomodation': 'accommodation',
    'accross': 'across',
    'acheive': 'achieve',
    'aknowledge': 'acknowledge',
    'adress': 'address',
    'agrement': 'agreement',
    'alot': 'a lot',
    'amend-ment': 'amendment',
    'amoung': 'among',
    'apparantly': 'apparently',
    'applicaiton': 'application',
    'assesment': 'assessment',
    'basicly': 'basically',
    'becuase': 'because',
    'begining': 'beginning',
    'beleive': 'believe',
    'buisness': 'business',
    'calender': 'calendar',
    'catagory': 'category',
    'comittee': 'committee',
    'commision': 'commission',
    'completly': 'completely',
    'concious': 'conscious',
    'consistant': 'consistent',
    'correspondance': 'correspondence',
    'criterias': 'criteria',
    'decison': 'decision',
    'definately': 'definitely',
    'dependant': 'dependent',
    'develope': 'develop',
    'diffrence': 'difference',
    'dissapoint': 'disappoint',
    'embarass': 'embarrass',
    'enviroment': 'environment',
    'equiptment': 'equipment',
    'excellant': 'excellent',
    'existance': 'existence',
    'experiance': 'experience',
    'foriegn': 'foreign',
    'fourty': 'forty',
    'fulfil': 'fulfil',
    'goverment': 'government',
    'governemnt': 'government',
    'guidence': 'guidance',
    'happend': 'happened',
    'harrass': 'harass',
    'immediatly': 'immediately',
    'independant': 'independent',
    'indipendent': 'independent',
    'infomation': 'information',
    'knowlege': 'knowledge',
    'liaise': 'liaise',
    'liason': 'liaison',
    'maintainance': 'maintenance',
    'managment': 'management',
    'millenium': 'millennium',
    'miniscule': 'minuscule',
    'mispell': 'misspell',
    'neccessary': 'necessary',
    'necessery': 'necessary',
    'noticable': 'noticeable',
    'occassion': 'occasion',
    'occured': 'occurred',
    'occurence': 'occurrence',
    'offical': 'official',
    'oportunity': 'opportunity',
    'parliment': 'parliament',
    'particually': 'particularly',
    'peice': 'piece',
    'persistant': 'persistent',
    'posession': 'possession',
    'practise': 'practise',
    'preceeding': 'preceding',
    'privelege': 'privilege',
    'proffesional': 'professional',
    'profesional': 'professional',
    'publically': 'publicly',
    'recomend': 'recommend',
    'recieve': 'receive',
    'refered': 'referred',
    'relevent': 'relevant',
    'reoccur': 'recur',
    'reponsible': 'responsible',
    'resourse': 'resource',
    'responsibilty': 'responsibility',
    'seize': 'seize',
    'seperate': 'separate',
    'sincerely': 'sincerely',
    'sucessful': 'successful',
    'supercede': 'supersede',
    'supress': 'suppress',
    'surprize': 'surprise',
    'tendancy': 'tendency',
    'thier': 'their',
    'threshhold': 'threshold',
    'tommorow': 'tomorrow',
    'tounge': 'tongue',
    'transfered': 'transferred',
    'truely': 'truly',
    'unfortunatly': 'unfortunately',
    'untill': 'until',
    'usefull': 'useful',
    'vegatable': 'vegetable',
    'wether': 'whether',
    'wich': 'which',
    'wierd': 'weird',
    'withold': 'withhold',
    'writting': 'writing',
    'teh': 'the',
    'adn': 'and',
    'hte': 'the',
    'taht': 'that',
    'ahve': 'have',
    'nto': 'not',
    'waht': 'what',
    'yuo': 'you',
    'coudl': 'could',
    'shoudl': 'should',
    'woudl': 'would',
    'dont': "don't",
    'doesnt': "doesn't",
    'cant': "can't",
    'wont': "won't",
    'didnt': "didn't",
    'isnt': "isn't",
    'wasnt': "wasn't",
    'hasnt': "hasn't",
    'hadnt': "hadn't",
    'wouldnt': "wouldn't",
    'shouldnt': "shouldn't",
    'couldnt': "couldn't"
  };

  /**
   * All check rules. Each returns an array of suggestion objects.
   */
  /**
   * Commonly confused words.
   * Each entry: regex, the wrong usage context hint, suggestion.
   */
  var CONFUSED_WORDS = [
    { regex: /\b(your)\s+(welcome|right|wrong|correct|the best|amazing|brilliant)\b/gi, msg: 'Did you mean "you\'re" (you are)?', fix: "you're", matchGroup: 1 },
    { regex: /\b(its)\s+(a|the|been|not|going|very|really|quite|also|important)\b/gi, msg: 'Did you mean "it\'s" (it is)?', fix: "it's", matchGroup: 1 },
    { regex: /\b(there)\s+(is|are|was|were|will|has|have|would|could|should|might|may|must)\s+(?:be\s+)?(?:a\s+|an\s+|the\s+)?(?:\w+\s+){0,3}(that|who|which)\s+(they|he|she|we|I)\b/gi, msg: 'Check: did you mean "their" (belonging to them)?', fix: null, matchGroup: 0 },
    { regex: /\b(then)\s+(I|you|we|they|he|she|it)\b/gi, msg: 'Check: did you mean "than" (comparison)?', fix: null, matchGroup: 0 },
    { regex: /\b(affect|effect)\b/gi, msg: '"Affect" is usually a verb (to influence), "effect" is usually a noun (a result). Check which you need.', fix: null, matchGroup: 0 },
    { regex: /\b(practise|practice)\b/gi, msg: 'UK English: "practise" is the verb, "practice" is the noun.', fix: null, matchGroup: 0, modes: ['govuk'] },
    { regex: /\b(licence|license)\b/gi, msg: 'UK English: "licence" is the noun, "license" is the verb.', fix: null, matchGroup: 0, modes: ['govuk'] },
    { regex: /\b(bare)\s+(in mind)\b/gi, msg: 'Did you mean "bear in mind"?', fix: 'bear', matchGroup: 1 },
    { regex: /\b(could|should|would)\s+of\b/gi, msg: 'Use "have" not "of" — "could have", "should have", "would have".', fix: null, matchGroup: 0 },
    { regex: /\b(loose)\b(?=\s+(?:my|your|his|her|their|our|the|a|an|it|this|that|track|sight|control|interest))/gi, msg: 'Did you mean "lose" (to misplace)? "Loose" means not tight.', fix: 'lose', matchGroup: 1 },
    { regex: /\b(defiantly)\b/gi, msg: 'Did you mean "definitely"? "Defiantly" means in a rebellious way.', fix: 'definitely', matchGroup: 1 },
    { regex: /\b(weather)\s+(or not|we|they|you|he|she|it|to|the)\b/gi, msg: 'Did you mean "whether"? "Weather" refers to climate.', fix: 'whether', matchGroup: 1 },
    { regex: /\b(aloud)\s+(to)\b/gi, msg: 'Did you mean "allowed to"? "Aloud" means out loud.', fix: 'allowed', matchGroup: 1 },
    { regex: /\b(accept)\s+(for|from)\b/gi, msg: 'Check: did you mean "except" (excluding)?', fix: null, matchGroup: 0 },
    { regex: /\b(pacific)\s+(reason|example|issue|case|time|date|detail|requirement)/gi, msg: 'Did you mean "specific"?', fix: 'specific', matchGroup: 1 }
  ];

  /**
   * Email/chat tone patterns — only active in email/chat modes.
   */
  var TONE_PATTERNS = [
    { regex: /\b(I just wanted to)\b/gi, msg: 'Drop the hedge — just say what you need', fix: null, category: 'Tone', title: 'Hedging language', modes: ['email', 'chat'] },
    { regex: /\b(sorry to bother you)\b/gi, msg: 'No need to apologise — state your request directly', fix: null, category: 'Tone', title: 'Unnecessary apology', modes: ['email', 'chat'] },
    { regex: /\b(sorry for the delay)\b/gi, msg: 'Try "thanks for your patience" — it\'s more positive', fix: 'thanks for your patience', category: 'Tone', title: 'Negative framing', modes: ['email', 'chat'] },
    { regex: /\b(as per my last email)\b/gi, msg: 'This can sound passive-aggressive. Try "as I mentioned" or restate the point.', fix: 'as I mentioned', category: 'Tone', title: 'Passive-aggressive', modes: ['email', 'chat'] },
    { regex: /\b(as previously stated)\b/gi, msg: 'This can sound curt. Try restating the point directly.', fix: null, category: 'Tone', title: 'Passive-aggressive', modes: ['email', 'chat'] },
    { regex: /\b(I think maybe)\b/gi, msg: 'Pick one: "I think" or "maybe" — both together sounds unsure', fix: 'I think', category: 'Tone', title: 'Over-hedging', modes: ['email', 'chat'] },
    { regex: /\b(I was wondering if you could)\b/gi, msg: 'Be direct: "Could you" or "Please" works better', fix: 'Could you', category: 'Tone', title: 'Indirect request', modes: ['email', 'chat'] },
    { regex: /\b(does that make sense)\b/gi, msg: 'This can undermine your point. Try "let me know if you have questions"', fix: 'let me know if you have questions', category: 'Tone', title: 'Self-undermining', modes: ['email', 'chat'] },
    { regex: /\b(per se)\b/gi, msg: 'Consider simpler phrasing — "per se" can sound overly formal', fix: null, category: 'Tone', title: 'Overly formal', modes: ['email', 'chat'] },
    { regex: /\b(please advise)\b/gi, msg: 'Try "let me know" or ask a specific question instead', fix: 'let me know', category: 'Tone', title: 'Stiff phrasing', modes: ['email', 'chat'] },
    { regex: /\b(please do not hesitate to)\b/gi, msg: 'Simpler: "feel free to" or just ask directly', fix: 'feel free to', category: 'Tone', title: 'Overly formal', modes: ['email', 'chat'] },
    { regex: /\b(I hope this email finds you well)\b/gi, msg: 'This is filler — jump straight to the point', fix: null, category: 'Tone', title: 'Filler phrase', modes: ['email'] },
    { regex: /\b(kind regards|warm regards|best regards)\b/gi, msg: null, fix: null, category: null, modes: [] }, // skip — these are fine
    { regex: /\b(ASAP)\b/g, msg: 'Give a specific deadline instead of "ASAP" — it creates urgency without clarity', fix: null, category: 'Tone', title: 'Vague urgency', modes: ['email', 'chat'] },
    { regex: /\b(FYI)\b/g, msg: 'In formal emails, write "for your information" or just provide the context', fix: null, category: 'Tone', title: 'Too casual', modes: ['email'] }
  ];

  var rules = [
    {
      id: 'spelling',
      category: 'Spelling',
      run: checkSpelling
    },
    {
      id: 'repeated-word',
      category: 'Grammar',
      run: checkRepeatedWords
    },
    {
      id: 'double-space',
      category: 'Punctuation',
      run: checkDoubleSpaces
    },
    {
      id: 'punctuation-spacing',
      category: 'Punctuation',
      run: checkPunctuationSpacing
    },
    {
      id: 'capitalisation',
      category: 'Grammar',
      run: checkCapitalisation
    },
    {
      id: 'common-grammar',
      category: 'Grammar',
      run: checkCommonGrammar
    },
    {
      id: 'confused-words',
      category: 'Spelling',
      run: checkConfusedWords
    },
    {
      id: 'tone',
      category: 'Tone',
      run: checkTonePatterns
    }
  ];

  var idCounter = 0;

  function makeId() {
    return 'qc-' + (++idCounter);
  }

  /**
   * Check for common misspellings.
   */
  function checkSpelling(text) {
    var results = [];
    var wordRegex = /\b[a-zA-Z']+\b/g;
    var match;
    while ((match = wordRegex.exec(text)) !== null) {
      var word = match[0];
      var lower = word.toLowerCase();
      if (COMMON_MISSPELLINGS[lower]) {
        var replacement = COMMON_MISSPELLINGS[lower];
        // Preserve original case for first letter
        if (word[0] === word[0].toUpperCase()) {
          replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
        }
        results.push({
          id: makeId(),
          ruleId: 'spelling',
          source: 'regex',
          group: 'correctness',
          category: 'Spelling',
          start: match.index,
          end: match.index + word.length,
          message: '"' + word + '" may be misspelt',
          title: 'Possible misspelling',
          replacement: replacement,
          original: word
        });
      }
    }
    return results;
  }

  /**
   * Check for repeated words (e.g., "the the").
   */
  function checkRepeatedWords(text) {
    var results = [];
    var regex = /\b(\w+)\s+\1\b/gi;
    var match;
    while ((match = regex.exec(text)) !== null) {
      results.push({
        id: makeId(),
        ruleId: 'repeated-word',
        source: 'regex',
        group: 'correctness',
        category: 'Grammar',
        start: match.index,
        end: match.index + match[0].length,
        message: '"' + match[1] + '" is repeated',
        title: 'Repeated word',
        replacement: match[1],
        original: match[0]
      });
    }
    return results;
  }

  /**
   * Check for double spaces.
   */
  function checkDoubleSpaces(text) {
    var results = [];
    var regex = /[^\n] {2,}/g;
    var match;
    while ((match = regex.exec(text)) !== null) {
      // Only flag the extra spaces (keep the first char)
      var spacesStart = match.index + 1;
      var spacesEnd = match.index + match[0].length;
      results.push({
        id: makeId(),
        ruleId: 'double-space',
        source: 'regex',
        group: 'correctness',
        category: 'Punctuation',
        start: spacesStart,
        end: spacesEnd,
        message: 'Multiple spaces found',
        title: 'Extra spaces',
        replacement: ' ',
        original: match[0].substring(1)
      });
    }
    return results;
  }

  /**
   * Check for punctuation spacing issues.
   * - Space before comma, period, semicolon, colon
   * - Missing space after comma, period, semicolon, colon
   */
  function checkPunctuationSpacing(text) {
    var results = [];

    // Space before punctuation (but not before decimal points like 3.5)
    var spaceBefore = / +([,;:])/g;
    var match;
    while ((match = spaceBefore.exec(text)) !== null) {
      results.push({
        id: makeId(),
        ruleId: 'punctuation-spacing',
        source: 'regex',
        group: 'correctness',
        category: 'Punctuation',
        start: match.index,
        end: match.index + match[0].length,
        message: 'Remove space before "' + match[1] + '"',
        title: 'Space before punctuation',
        replacement: match[1],
        original: match[0]
      });
    }

    // Missing space after punctuation (not URLs, not decimal numbers, not end of text)
    var missingSpace = /([,;:])([a-zA-Z])/g;
    while ((match = missingSpace.exec(text)) !== null) {
      results.push({
        id: makeId(),
        ruleId: 'punctuation-spacing',
        source: 'regex',
        group: 'correctness',
        category: 'Punctuation',
        start: match.index,
        end: match.index + match[0].length,
        message: 'Add a space after "' + match[1] + '"',
        title: 'Missing space after punctuation',
        replacement: match[1] + ' ' + match[2],
        original: match[0]
      });
    }

    return results;
  }

  /**
   * Check for missing capitalisation at start of sentences.
   */
  function checkCapitalisation(text) {
    var results = [];
    // Match sentence starters: beginning of text, or after ". " / "? " / "! "
    var regex = /(?:^|[.!?]\s+)([a-z])/gm;
    var match;
    while ((match = regex.exec(text)) !== null) {
      var charIndex = match.index + match[0].length - 1;
      var theChar = text[charIndex];
      results.push({
        id: makeId(),
        ruleId: 'capitalisation',
        source: 'regex',
        group: 'correctness',
        category: 'Grammar',
        start: charIndex,
        end: charIndex + 1,
        message: 'Sentences should start with a capital letter',
        title: 'Missing capital letter',
        replacement: theChar.toUpperCase(),
        original: theChar
      });
    }
    return results;
  }

  /**
   * Check for common grammar issues.
   */
  function checkCommonGrammar(text) {
    var results = [];
    var patterns = [
      { regex: /\b(could of)\b/gi, fix: 'could have', msg: 'Use "could have" instead of "could of"' },
      { regex: /\b(should of)\b/gi, fix: 'should have', msg: 'Use "should have" instead of "should of"' },
      { regex: /\b(would of)\b/gi, fix: 'would have', msg: 'Use "would have" instead of "would of"' },
      { regex: /\b(must of)\b/gi, fix: 'must have', msg: 'Use "must have" instead of "must of"' },
      { regex: /\b(alright)\b/gi, fix: 'all right', msg: 'GOV.UK style uses "all right" not "alright"', modes: ['govuk'] },
      { regex: /\b(utilise)\b/gi, fix: 'use', msg: 'Prefer "use" over "utilise" for plain English' },
      { regex: /\b(utilisation)\b/gi, fix: 'use', msg: 'Prefer "use" over "utilisation" for plain English' },
      { regex: /\b(commence)\b/gi, fix: 'start', msg: 'Prefer "start" over "commence" for plain English' },
      { regex: /\b(purchase)\b/gi, fix: 'buy', msg: 'Prefer "buy" over "purchase" for plain English' },
      { regex: /\b(regarding)\b/gi, fix: 'about', msg: 'Prefer "about" over "regarding" for plain English' },
      { regex: /\b(in order to)\b/gi, fix: 'to', msg: 'Prefer "to" over "in order to" for brevity' },
      { regex: /\b(prior to)\b/gi, fix: 'before', msg: 'Prefer "before" over "prior to" for plain English' }
    ];

    patterns.forEach(function (pat) {
      // Skip mode-restricted patterns
      if (pat.modes && pat.modes.indexOf(currentMode) === -1) return;

      var match;
      while ((match = pat.regex.exec(text)) !== null) {
        var replacement = pat.fix;
        // Preserve capitalisation
        if (match[1][0] === match[1][0].toUpperCase()) {
          replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
        }
        results.push({
          id: makeId(),
          ruleId: 'common-grammar',
          source: 'regex',
          group: 'correctness',
          category: 'Grammar',
          start: match.index,
          end: match.index + match[1].length,
          message: pat.msg,
          title: 'Grammar',
          replacement: replacement,
          original: match[1]
        });
      }
    });
    return results;
  }

  /**
   * Check for commonly confused words.
   */
  function checkConfusedWords(text) {
    var results = [];
    CONFUSED_WORDS.forEach(function (entry) {
      // Skip if mode-restricted and doesn't match current mode
      if (entry.modes && entry.modes.length > 0 && entry.modes.indexOf(currentMode) === -1) return;

      var match;
      while ((match = entry.regex.exec(text)) !== null) {
        var target = match[entry.matchGroup];
        var start = match.index + match[0].indexOf(target);
        var suggestion = {
          id: makeId(),
          ruleId: 'confused-words',
          source: 'regex',
          group: 'correctness',
          category: 'Confused words',
          start: start,
          end: start + target.length,
          message: entry.msg,
          title: 'Confused word',
          original: target
        };
        if (entry.fix) {
          // Preserve case
          var fix = entry.fix;
          if (target[0] === target[0].toUpperCase()) {
            fix = fix.charAt(0).toUpperCase() + fix.slice(1);
          }
          suggestion.replacement = fix;
        }
        results.push(suggestion);
      }
    });
    return results;
  }

  /**
   * Check for tone issues (active in email/chat modes).
   */
  function checkTonePatterns(text) {
    var results = [];
    TONE_PATTERNS.forEach(function (entry) {
      if (!entry.msg || !entry.category) return; // skip null entries
      if (entry.modes && entry.modes.length > 0 && entry.modes.indexOf(currentMode) === -1) return;

      var match;
      while ((match = entry.regex.exec(text)) !== null) {
        var suggestion = {
          id: makeId(),
          ruleId: 'tone',
          source: 'regex',
          group: 'correctness',
          category: entry.category,
          start: match.index,
          end: match.index + match[0].length,
          message: entry.msg,
          title: entry.title,
          original: match[0]
        };
        if (entry.fix) {
          suggestion.replacement = entry.fix;
        }
        results.push(suggestion);
      }
    });
    return results;
  }

  /**
   * Run all quick checks on the given text.
   * Returns an array of suggestion objects.
   */
  function runAll(text) {
    var allResults = [];
    rules.forEach(function (rule) {
      var results = rule.run(text);
      allResults = allResults.concat(results);
    });
    // Sort by document order
    allResults.sort(function (a, b) { return a.start - b.start; });
    return allResults;
  }

  /**
   * Schedule a debounced check.
   * Cancels any in-flight check if typing resumes.
   * Calls callback(results, version) when done.
   */
  function scheduleCheck(text, version, callback) {
    cancelPending();
    pendingVersion = version;

    debounceTimer = setTimeout(function () {
      // Check version hasn't changed
      if (version !== pendingVersion) return;

      var results = runAll(text);
      callback(results, version);
    }, DEBOUNCE_MS);
  }

  /**
   * Cancel any pending debounced check.
   */
  function cancelPending() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  }

  /**
   * Set the writing mode. Affects which rules are active.
   * @param {string} mode - 'govuk', 'email', or 'chat'
   */
  function setMode(mode) {
    currentMode = mode;
  }

  function getMode() {
    return currentMode;
  }

  return {
    runAll: runAll,
    scheduleCheck: scheduleCheck,
    cancelPending: cancelPending,
    setMode: setMode,
    getMode: getMode
  };
})();
