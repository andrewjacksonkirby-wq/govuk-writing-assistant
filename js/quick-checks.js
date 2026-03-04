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
    'fullfil': 'fulfil',
    'fullfill': 'fulfil',
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
      category: 'Capitalisation',
      run: checkCapitalisation
    },
    {
      id: 'common-grammar',
      category: 'Grammar',
      run: checkCommonGrammar
    },
    {
      id: 'confused-words',
      category: 'Grammar',
      run: checkConfusedWords
    },
    {
      id: 'tone',
      category: 'Tone',
      run: checkTonePatterns
    },
    {
      id: 'missing-letter',
      category: 'Spelling',
      run: checkMissingLetters
    },
    {
      id: 'sentence-length',
      category: 'Clarity',
      run: checkSentenceLength
    },
    {
      id: 'passive-voice',
      category: 'Clarity',
      run: checkPassiveVoice
    },
    {
      id: 'date-format',
      category: 'Style',
      run: checkDateFormat
    },
    {
      id: 'contractions',
      category: 'Style',
      run: checkContractions
    },
    {
      id: 'numbers',
      category: 'Style',
      run: checkNumbers
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
   * Skips valid doubled constructions like "had had", "that that".
   */
  var VALID_DOUBLES = new Set([
    'had', 'that', 'is', 'was', 'do', 'can', 'will', 'so'
  ]);

  function checkRepeatedWords(text) {
    var results = [];
    var regex = /\b(\w+)\s+\1\b/gi;
    var match;
    while ((match = regex.exec(text)) !== null) {
      // Skip words that are commonly valid when doubled
      if (VALID_DOUBLES.has(match[1].toLowerCase())) continue;

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
  // Common abbreviations whose trailing period should NOT trigger a capital-letter check
  var ABBREVIATIONS = new Set([
    'e.g', 'i.e', 'etc', 'vs', 'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr',
    'no', 'nos', 'vol', 'dept', 'govt', 'approx', 'inc', 'ltd', 'st', 'ave',
    'ref', 'fig', 'gen', 'corp', 'est', 'jan', 'feb', 'mar', 'apr', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'mon', 'tue', 'wed', 'thu',
    'fri', 'sat', 'sun'
  ]);

  function checkCapitalisation(text) {
    var results = [];
    // Match after sentence-ending punctuation followed by whitespace, then a lowercase letter
    // Uses a more targeted approach to avoid false positives
    var regex = /([.!?][\s]+)([a-z])/g;
    var match;
    while ((match = regex.exec(text)) !== null) {
      var punctIndex = match.index;

      // Skip ellipsis: three or more dots (e.g. "wait... let me")
      if (text[punctIndex] === '.') {
        // Check if this period is part of an ellipsis
        var dotStart = punctIndex;
        while (dotStart > 0 && text[dotStart - 1] === '.') dotStart--;
        if (punctIndex - dotStart >= 1) continue; // 2+ dots = ellipsis, skip
      }

      // Skip abbreviations: look back from the period to find the preceding word
      if (text[punctIndex] === '.') {
        var before = text.substring(Math.max(0, punctIndex - 15), punctIndex);
        var abbrevMatch = before.match(/(\w+(?:\.\w+)?)$/);
        if (abbrevMatch) {
          // Check with and without trailing dots (e.g. "e.g" from "e.g.")
          var candidate = abbrevMatch[1].toLowerCase().replace(/\.$/, '');
          if (ABBREVIATIONS.has(candidate)) continue;
          // Also check the full dotted form (e.g. "i.e")
          var dottedCandidate = candidate.replace(/\./g, '');
          if (ABBREVIATIONS.has(dottedCandidate)) continue;
        }
      }

      var charIndex = match.index + match[1].length;
      var theChar = text[charIndex];
      results.push({
        id: makeId(),
        ruleId: 'capitalisation',
        source: 'regex',
        group: 'correctness',
        category: 'Capitalisation',
        start: charIndex,
        end: charIndex + 1,
        message: 'Sentences should start with a capital letter',
        title: 'Missing capital letter',
        replacement: theChar.toUpperCase(),
        original: theChar
      });
    }

    // Also check start of text (first non-whitespace character)
    var startMatch = text.match(/^\s*([a-z])/);
    if (startMatch) {
      var idx = text.indexOf(startMatch[1]);
      results.push({
        id: makeId(),
        ruleId: 'capitalisation',
        source: 'regex',
        group: 'correctness',
        category: 'Capitalisation',
        start: idx,
        end: idx + 1,
        message: 'Sentences should start with a capital letter',
        title: 'Missing capital letter',
        replacement: startMatch[1].toUpperCase(),
        original: startMatch[1]
      });
    }

    return results;
  }

  /**
   * Check for common grammar issues, plain English, and GOV.UK style.
   * Each pattern has its own category and title for distinct card display.
   */
  function checkCommonGrammar(text) {
    var results = [];
    var patterns = [
      // --- Grammar errors ---
      { regex: /\b(could of)\b/gi, fix: 'could have', msg: 'Use "could have" instead of "could of"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(should of)\b/gi, fix: 'should have', msg: 'Use "should have" instead of "should of"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(would of)\b/gi, fix: 'would have', msg: 'Use "would have" instead of "would of"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(must of)\b/gi, fix: 'must have', msg: 'Use "must have" instead of "must of"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(alright)\b/gi, fix: 'all right', msg: 'GOV.UK style uses "all right" not "alright"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },

      // --- Plain English ---
      { regex: /\b(utilise)\b/gi, fix: 'use', msg: 'Prefer "use" over "utilise" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(utilisation)\b/gi, fix: 'use', msg: 'Prefer "use" over "utilisation" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(commence)\b/gi, fix: 'start', msg: 'Prefer "start" over "commence" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(purchase)\b/gi, fix: 'buy', msg: 'Prefer "buy" over "purchase" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(regarding)\b/gi, fix: 'about', msg: 'Prefer "about" over "regarding" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in order to)\b/gi, fix: 'to', msg: 'Prefer "to" over "in order to" for brevity', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(prior to)\b/gi, fix: 'before', msg: 'Prefer "before" over "prior to" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(facilitate)\b/gi, fix: 'help', msg: 'Prefer "help" over "facilitate" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(endeavour)\b/gi, fix: 'try', msg: 'Prefer "try" over "endeavour" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(terminate)\b/gi, fix: 'end', msg: 'Prefer "end" over "terminate" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(additional)\b/gi, fix: 'extra', msg: 'Prefer "extra" or "more" over "additional" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(accordingly)\b/gi, fix: 'so', msg: 'Prefer "so" over "accordingly" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(subsequently)\b/gi, fix: 'then', msg: 'Prefer "then" over "subsequently" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(approximately)\b/gi, fix: 'about', msg: 'Prefer "about" over "approximately" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(furthermore)\b/gi, fix: 'also', msg: 'Prefer "also" over "furthermore" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(nevertheless)\b/gi, fix: 'but', msg: 'Prefer "but" or "however" over "nevertheless" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(notwithstanding)\b/gi, fix: 'despite', msg: 'Prefer "despite" over "notwithstanding" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(ascertain)\b/gi, fix: 'find out', msg: 'Prefer "find out" over "ascertain" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(demonstrate)\b/gi, fix: 'show', msg: 'Prefer "show" over "demonstrate" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(consequently)\b/gi, fix: 'so', msg: 'Prefer "so" over "consequently" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(assistance)\b/gi, fix: 'help', msg: 'Prefer "help" over "assistance" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(sufficient)\b/gi, fix: 'enough', msg: 'Prefer "enough" over "sufficient" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(obtain)\b/gi, fix: 'get', msg: 'Prefer "get" over "obtain" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(require)\b/gi, fix: 'need', msg: 'Prefer "need" over "require" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(requirement)\b/gi, fix: 'need', msg: 'Prefer "need" over "requirement" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(modify)\b/gi, fix: 'change', msg: 'Prefer "change" over "modify" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(submit)\b/gi, fix: 'send', msg: 'Prefer "send" over "submit" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(upon)\b/gi, fix: 'on', msg: 'Prefer "on" over "upon" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(whilst)\b/gi, fix: 'while', msg: 'Prefer "while" over "whilst" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(amongst)\b/gi, fix: 'among', msg: 'Prefer "among" over "amongst" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(attempt)\b/gi, fix: 'try', msg: 'Prefer "try" over "attempt" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(initiate)\b/gi, fix: 'start', msg: 'Prefer "start" over "initiate" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(implement)\b/gi, fix: 'carry out', msg: 'Prefer "carry out" or "set up" over "implement" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(indicate)\b/gi, fix: 'show', msg: 'Prefer "show" or "suggest" over "indicate" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(therefore)\b/gi, fix: 'so', msg: 'Prefer "so" over "therefore" for plain English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(however)\b/gi, fix: 'but', msg: 'Consider "but" instead of "however" for simpler English', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in accordance with)\b/gi, fix: 'in line with', msg: 'Prefer "in line with" or "following" over "in accordance with"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(with reference to)\b/gi, fix: 'about', msg: 'Prefer "about" over "with reference to"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in the event of)\b/gi, fix: 'if', msg: 'Prefer "if" over "in the event of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(at the present time)\b/gi, fix: 'now', msg: 'Prefer "now" over "at the present time"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(on a regular basis)\b/gi, fix: 'regularly', msg: 'Prefer "regularly" or "often" over "on a regular basis"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in the near future)\b/gi, fix: 'soon', msg: 'Prefer "soon" over "in the near future"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(a large number of)\b/gi, fix: 'many', msg: 'Prefer "many" over "a large number of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(the majority of)\b/gi, fix: 'most', msg: 'Prefer "most" over "the majority of"', cat: 'Plain English', title: 'Use plain English' },

      // --- GOV.UK style patterns ---
      { regex: /\bplease\b/gi, fix: null, msg: 'GOV.UK style: avoid "please" — be direct', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\bkindly\b/gi, fix: null, msg: 'GOV.UK style: avoid "kindly" — be direct', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\bgoing forward\b/gi, fix: null, msg: 'Avoid "going forward" — be specific about timing', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\bat this point in time\b/gi, fix: 'now', msg: 'Use "now" or "currently" instead', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\bin the event that\b/gi, fix: 'if', msg: 'Use "if" instead of "in the event that"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\bwith regards to\b/gi, fix: 'about', msg: 'Use "about" instead of "with regards to"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\ba number of\b/gi, fix: null, msg: 'Be specific — say how many instead of "a number of"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\bin respect of\b/gi, fix: 'about', msg: 'Use "about" or "for" instead of "in respect of"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\betc\.?\b/gi, fix: null, msg: 'GOV.UK style: avoid "etc" — list the items or say "for example"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\bie\b/gi, fix: 'that is', msg: 'Write "that is" or rephrase instead of "ie"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\beg\b/gi, fix: 'for example', msg: 'Write "for example" instead of "eg"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\bvia\b/gi, fix: 'through', msg: 'GOV.UK style: use "through" or "by" instead of "via"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\bi\.e\.\b/gi, fix: 'that is', msg: 'Write "that is" or rephrase instead of "i.e."', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\be\.g\.\b/gi, fix: 'for example', msg: 'Write "for example" instead of "e.g."', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] }
    ];

    patterns.forEach(function (pat) {
      // Skip mode-restricted patterns
      if (pat.modes && pat.modes.indexOf(currentMode) === -1) return;

      var match;
      while ((match = pat.regex.exec(text)) !== null) {
        var matched = match[1] || match[0];
        var replacement = pat.fix;
        // Preserve capitalisation (only if there's a fix)
        if (replacement && matched[0] === matched[0].toUpperCase()) {
          replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
        }
        var suggestion = {
          id: makeId(),
          ruleId: 'common-grammar',
          source: 'regex',
          group: pat.group || 'correctness',
          category: pat.cat,
          start: match.index,
          end: match.index + matched.length,
          message: pat.msg,
          title: pat.title,
          original: matched
        };
        if (replacement) {
          suggestion.replacement = replacement;
        }
        results.push(suggestion);
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

      entry.regex.lastIndex = 0; // Reset — g flag retains lastIndex between calls
      var match;
      while ((match = entry.regex.exec(text)) !== null) {
        var target = match[entry.matchGroup];
        var start = match.index + match[0].indexOf(target);
        var suggestion = {
          id: makeId(),
          ruleId: 'confused-words',
          source: 'regex',
          group: 'correctness',
          category: 'Grammar',
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

      entry.regex.lastIndex = 0; // Reset — g flag retains lastIndex between calls
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
   * Detect words with missing first letter (e.g. "nternal" → "internal").
   * Uses a dictionary of common words where dropping the first letter
   * produces a non-word that we can detect.
   */
  var MISSING_FIRST_LETTER = {
    'ccess': 'access', 'ccount': 'account', 'ccording': 'according',
    'ctual': 'actual', 'ctually': 'actually', 'ddress': 'address',
    'dditional': 'additional', 'dvice': 'advice', 'greement': 'agreement',
    'llowed': 'allowed', 'lready': 'already', 'lternative': 'alternative',
    'mount': 'amount', 'nalysis': 'analysis', 'nother': 'another',
    'nswer': 'answer', 'pplication': 'application', 'pply': 'apply',
    'pproval': 'approval', 'pprove': 'approve', 'ssessment': 'assessment',
    'vailable': 'available', 'usiness': 'business', 'omplete': 'complete',
    'ompletely': 'completely', 'ondition': 'condition', 'onfirm': 'confirm',
    'onsider': 'consider', 'ontact': 'contact', 'ontinue': 'continue',
    'ontract': 'contract', 'ontrol': 'control', 'orrect': 'correct',
    'urrent': 'current', 'urrently': 'currently', 'ecision': 'decision',
    'epartment': 'department', 'escription': 'description',
    'etail': 'detail', 'etails': 'details', 'evelop': 'develop',
    'evelopment': 'development', 'ifferent': 'different',
    'irectly': 'directly', 'ocument': 'document', 'mployee': 'employee',
    'nquiry': 'enquiry', 'nsure': 'ensure', 'nvironment': 'environment',
    'ssential': 'essential', 'stimate': 'estimate', 'vidence': 'evidence',
    'xample': 'example', 'xpect': 'expect', 'xperience': 'experience',
    'inancial': 'financial', 'ollowing': 'following', 'overnment': 'government',
    'uidance': 'guidance', 'mmediate': 'immediate', 'mmediately': 'immediately',
    'mportant': 'important', 'nclude': 'include', 'ncluding': 'including',
    'ncrease': 'increase', 'ndividual': 'individual',
    'nformation': 'information', 'nitial': 'initial',
    'nternal': 'internal', 'nternational': 'international',
    'nvestigation': 'investigation', 'ssue': 'issue',
    'anagement': 'management', 'anager': 'manager', 'eeting': 'meeting',
    'ember': 'member', 'inister': 'minister', 'ational': 'national',
    'ecessary': 'necessary', 'umber': 'number', 'fficer': 'officer',
    'peration': 'operation', 'pportunity': 'opportunity',
    'rganisation': 'organisation', 'riginal': 'original',
    'arliament': 'parliament', 'articular': 'particular',
    'eople': 'people', 'eriod': 'period', 'erson': 'person',
    'olicy': 'policy', 'osition': 'position', 'ossible': 'possible',
    'roblem': 'problem', 'rocess': 'process', 'rogramme': 'programme',
    'roject': 'project', 'rovide': 'provide', 'ublic': 'public',
    'uality': 'quality', 'uestion': 'question', 'eceive': 'receive',
    'ecommend': 'recommend', 'eference': 'reference', 'eport': 'report',
    'equest': 'request', 'equire': 'require', 'equirement': 'requirement',
    'esource': 'resource', 'esponse': 'response', 'esponsible': 'responsible',
    'eview': 'review', 'ection': 'section', 'ervice': 'service',
    'imilar': 'similar', 'ituation': 'situation', 'pecific': 'specific',
    'tandard': 'standard', 'tatement': 'statement', 'upport': 'support',
    'ystem': 'system', 'hrough': 'through', 'ogether': 'together',
    'raining': 'training', 'nderstand': 'understand', 'pdate': 'update',
    'ithin': 'within', 'ithout': 'without'
  };

  function checkMissingLetters(text) {
    var results = [];
    var wordRegex = /\b([a-zA-Z]{4,})\b/g;
    var match;
    while ((match = wordRegex.exec(text)) !== null) {
      var word = match[1];
      var lower = word.toLowerCase();

      // Check if this looks like a word with a missing first letter
      if (MISSING_FIRST_LETTER[lower]) {
        var replacement = MISSING_FIRST_LETTER[lower];
        // Preserve case
        if (word[0] === word[0].toUpperCase()) {
          replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
        }
        results.push({
          id: makeId(),
          ruleId: 'missing-letter',
          source: 'regex',
          group: 'correctness',
          category: 'Spelling',
          start: match.index,
          end: match.index + word.length,
          message: '"' + word + '" looks like "' + replacement + '" with a missing first letter',
          title: 'Missing letter',
          replacement: replacement,
          original: word
        });
      }
    }
    return results;
  }

  /**
   * Check sentence length (GOV.UK recommends under 25 words).
   */
  function checkSentenceLength(text) {
    var results = [];
    // Split on sentence-ending punctuation
    var sentenceRegex = /[^.!?]*[.!?]+/g;
    var match;
    while ((match = sentenceRegex.exec(text)) !== null) {
      var sentence = match[0].trim();
      if (!sentence) continue;
      var words = sentence.split(/\s+/).filter(function (w) { return w.length > 0; });
      if (words.length > 25) {
        results.push({
          id: makeId(),
          ruleId: 'sentence-length',
          source: 'regex',
          group: 'clarity',
          category: 'Sentence length',
          start: match.index,
          end: match.index + match[0].length,
          message: 'This sentence has ' + words.length + ' words. Try to keep sentences under 25 words.',
          title: 'Long sentence',
          original: sentence
        });
      }
    }
    return results;
  }

  /**
   * Improved passive voice detection.
   * Uses a curated list of common past participles to reduce false positives
   * (avoids flagging adjectives like "excited", "interested", "concerned").
   */
  var PAST_PARTICIPLES = new Set([
    'accepted', 'achieved', 'added', 'agreed', 'allowed', 'announced',
    'applied', 'approved', 'arranged', 'asked', 'assessed', 'assigned',
    'awarded', 'based', 'built', 'called', 'carried', 'caused', 'changed',
    'charged', 'checked', 'chosen', 'claimed', 'closed', 'collected',
    'completed', 'confirmed', 'considered', 'contacted', 'controlled',
    'covered', 'created', 'decided', 'defined', 'delivered', 'described',
    'designed', 'developed', 'directed', 'discussed', 'distributed',
    'done', 'drawn', 'driven', 'dropped', 'earned', 'employed', 'ended',
    'entered', 'established', 'examined', 'expected', 'explained',
    'expressed', 'extended', 'filed', 'filled', 'fixed', 'followed',
    'formed', 'found', 'funded', 'given', 'governed', 'granted', 'grown',
    'handled', 'heard', 'held', 'helped', 'hidden', 'hired', 'hit',
    'identified', 'improved', 'included', 'increased', 'informed',
    'introduced', 'investigated', 'invited', 'issued', 'joined', 'judged',
    'kept', 'killed', 'known', 'launched', 'led', 'left', 'listed',
    'lost', 'made', 'maintained', 'managed', 'measured', 'met', 'moved',
    'named', 'needed', 'noted', 'obtained', 'offered', 'opened',
    'operated', 'ordered', 'organised', 'owned', 'paid', 'passed',
    'performed', 'placed', 'planned', 'played', 'posted', 'prepared',
    'presented', 'processed', 'produced', 'protected', 'provided',
    'published', 'put', 'raised', 'reached', 'read', 'received',
    'recognised', 'recorded', 'reduced', 'referred', 'refused', 'released',
    'removed', 'replaced', 'reported', 'requested', 'required', 'resolved',
    'reviewed', 'run', 'said', 'seen', 'selected', 'sent', 'served',
    'set', 'shared', 'shown', 'signed', 'sold', 'solved', 'sought',
    'spent', 'split', 'spoken', 'started', 'stated', 'stopped', 'stored',
    'submitted', 'supported', 'taken', 'taught', 'tested', 'thought',
    'told', 'treated', 'turned', 'understood', 'updated', 'used',
    'visited', 'wanted', 'warned', 'withdrawn', 'won', 'worked', 'written'
  ]);

  function checkPassiveVoice(text) {
    var results = [];
    // Pattern: be-verb + (optional adverb) + past participle from curated list
    var beVerbs = '(?:is|are|was|were|be|been|being)';
    var adverb = '(?:\\s+\\w+ly)?';
    var regex = new RegExp('\\b(' + beVerbs + ')' + adverb + '\\s+(\\w+)\\b', 'gi');
    var match;
    while ((match = regex.exec(text)) !== null) {
      var participle = match[2].toLowerCase();
      if (PAST_PARTICIPLES.has(participle)) {
        results.push({
          id: makeId(),
          ruleId: 'passive-voice',
          source: 'regex',
          group: 'clarity',
          category: 'Passive voice',
          start: match.index,
          end: match.index + match[0].length,
          message: 'Consider using active voice for clearer writing. Who is doing the action?',
          title: 'Passive voice',
          original: match[0]
        });
      }
    }
    return results;
  }

  /**
   * Check date format issues (GOV.UK style: "1 January 2024").
   */
  function checkDateFormat(text) {
    var results = [];
    // Numeric date formats like 01/01/2024
    var numericDate = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;
    var match;
    while ((match = numericDate.exec(text)) !== null) {
      results.push({
        id: makeId(),
        ruleId: 'date-format',
        source: 'regex',
        group: 'style',
        category: 'Date format',
        start: match.index,
        end: match.index + match[0].length,
        message: 'GOV.UK style: use "1 January 2024" format instead of numeric dates',
        title: 'Date format',
        original: match[0]
      });
    }

    // Ordinals with dates: "1st January", "2nd March"
    var ordinalDate = /\b(\d{1,2})(?:st|nd|rd|th)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/gi;
    while ((match = ordinalDate.exec(text)) !== null) {
      var fixedDate = match[1] + ' ' + match[2].charAt(0).toUpperCase() + match[2].slice(1).toLowerCase();
      results.push({
        id: makeId(),
        ruleId: 'date-format',
        source: 'regex',
        group: 'style',
        category: 'Date format',
        start: match.index,
        end: match.index + match[0].length,
        message: 'GOV.UK style: do not use ordinals with dates. Write "1 January" not "1st January"',
        title: 'Date format',
        replacement: fixedDate,
        original: match[0]
      });
    }
    return results;
  }

  /**
   * GOV.UK encourages contractions for a friendlier tone.
   * Flag formal non-contracted forms and suggest contractions.
   */
  function checkContractions(text) {
    if (currentMode !== 'govuk') return [];

    var results = [];
    var patterns = [
      { regex: /\b(do not)\b/gi, fix: "don't", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(does not)\b/gi, fix: "doesn't", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(did not)\b/gi, fix: "didn't", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(cannot)\b/gi, fix: "can't", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(can not)\b/gi, fix: "can't", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(will not)\b/gi, fix: "won't", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(would not)\b/gi, fix: "wouldn't", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(should not)\b/gi, fix: "shouldn't", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(could not)\b/gi, fix: "couldn't", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(is not)\b/gi, fix: "isn't", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(are not)\b/gi, fix: "aren't", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(was not)\b/gi, fix: "wasn't", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(were not)\b/gi, fix: "weren't", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(has not)\b/gi, fix: "hasn't", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(have not)\b/gi, fix: "haven't", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(had not)\b/gi, fix: "hadn't", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(you will)\b/gi, fix: "you'll", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(we will)\b/gi, fix: "we'll", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(they will)\b/gi, fix: "they'll", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(it is)\b/gi, fix: "it's", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(you are)\b/gi, fix: "you're", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(we are)\b/gi, fix: "we're", msg: 'GOV.UK style: use contractions for a friendlier tone' },
      { regex: /\b(they are)\b/gi, fix: "they're", msg: 'GOV.UK style: use contractions for a friendlier tone' }
    ];

    patterns.forEach(function (pat) {
      var match;
      while ((match = pat.regex.exec(text)) !== null) {
        var replacement = pat.fix;
        // Preserve capitalisation
        if (match[1][0] === match[1][0].toUpperCase()) {
          replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
        }
        results.push({
          id: makeId(),
          ruleId: 'contractions',
          source: 'regex',
          group: 'style',
          category: 'Contractions',
          start: match.index,
          end: match.index + match[1].length,
          message: pat.msg,
          title: 'Use contraction',
          replacement: replacement,
          original: match[1]
        });
      }
    });
    return results;
  }

  /**
   * GOV.UK number style: spell out one to nine, use digits for 10+.
   */
  function checkNumbers(text) {
    if (currentMode !== 'govuk') return [];

    var results = [];
    var DIGIT_TO_WORD = { '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine' };

    // Standalone digits 1-9 (not part of a larger number, date, or measurement)
    // Avoids lookbehind for browser compatibility
    var digitRegex = /\b([1-9])\b(?!\d|\/|\.|,\d|%|st|nd|rd|th|:|pm|am)/g;
    var match;
    while ((match = digitRegex.exec(text)) !== null) {
      // Skip if preceded by a digit (e.g. "12" — \b doesn't prevent this for digits)
      if (match.index > 0 && /\d/.test(text[match.index - 1])) continue;

      // Skip if part of a range like "5 to 10" or list with larger numbers
      var after = text.substring(match.index + match[0].length, match.index + match[0].length + 10);
      if (/^\s*(-|to|–)\s*\d{2,}/.test(after)) continue;

      var word = DIGIT_TO_WORD[match[1]];
      if (word) {
        results.push({
          id: makeId(),
          ruleId: 'numbers',
          source: 'regex',
          group: 'style',
          category: 'Numbers',
          start: match.index,
          end: match.index + match[1].length,
          message: 'GOV.UK style: spell out numbers one to nine',
          title: 'Number style',
          replacement: word,
          original: match[1]
        });
      }
    }
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
