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
    },
    {
      id: 'number-formatting',
      category: 'Style',
      run: checkNumberFormatting
    },
    {
      id: 'time-formatting',
      category: 'Style',
      run: checkTimeFormatting
    },
    {
      id: 'govuk-punctuation',
      category: 'Style',
      run: checkGovukPunctuation
    },
    {
      id: 'govuk-capitalisation',
      category: 'Style',
      run: checkGovukCapitalisation
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

      // Skip if the word is a known missing-letter pattern (e.g. "nternal" -> "internal")
      var wordAfter = text.substring(charIndex).match(/^([a-z]+)/i);
      var isMissingWord = wordAfter && findMissingLetterMatch(wordAfter[1].toLowerCase());
      if (!isMissingWord) {
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
    }

    // Also check start of text (first non-whitespace character)
    var startMatch = text.match(/^\s*([a-z])/);
    if (startMatch) {
      var idx = text.indexOf(startMatch[1]);
      // Skip if the first word is a known missing-letter pattern (e.g. "nternal" -> "internal")
      var firstWordMatch = text.substring(idx).match(/^([a-z]+)/i);
      var isMissingLetter = firstWordMatch && findMissingLetterMatch(firstWordMatch[1].toLowerCase());
      if (!isMissingLetter) {
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
      // "going forward" handled below with "moving forward"
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
      { regex: /\be\.g\.\b/gi, fix: 'for example', msg: 'Write "for example" instead of "e.g."', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },

      // --- GOV.UK words to avoid (jargon/buzzwords) ---
      { regex: /\b(agenda)(?!\s+item|\s+for\s+the\s+meeting)\b/gi, fix: null, msg: 'Avoid "agenda" (unless for a meeting) — say what you mean: plan, approach', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(collaborat(?:e|ing|ion))\b/gi, fix: null, msg: 'Avoid "collaborate" — try "work with" or "work together"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(combat(?:ing|ted)?)\b(?!\s+(?:troops|forces|zone|aircraft|training))/gi, fix: null, msg: 'Avoid "combat" (unless military) — try "reduce", "stop", "prevent"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(deliver(?:ing|ed|s|y)?)\b(?!\s+(?:mail|post|parcel|package|letter|goods|baby))/gi, fix: null, msg: 'Avoid "deliver" (unless physical delivery) — try "provide", "create", "run"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(deploy(?:ing|ed|ment|s)?)\b(?!\s+(?:troops|forces|soldiers|software|code|server|application))/gi, fix: null, msg: 'Avoid "deploy" (unless military or software) — try "use", "introduce"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(dialogue)\b/gi, fix: null, msg: 'Avoid "dialogue" — try "conversation", "discussion", "spoke to"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(disincentivise)\b/gi, fix: 'discourage', msg: 'Avoid "disincentivise" — use "discourage"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(empower(?:ing|ed|ment|s)?)\b/gi, fix: null, msg: 'Avoid "empower" — try "allow", "enable", "let"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(foster(?:ing|ed|s)?)\b(?!\s+(?:care|child|parent|home|family|carer))/gi, fix: null, msg: 'Avoid "foster" (unless about children) — try "encourage", "support"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b((?:going|moving)\s+forward)\b/gi, fix: null, msg: 'Avoid "going forward" — say "from now on" or be specific about timing', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(incentivise)\b/gi, fix: 'encourage', msg: 'Avoid "incentivise" — use "encourage"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(impact(?:ing|ed|s)?)\b(?=\s+(?:on|upon|the|our|their|your))/gi, fix: null, msg: 'Avoid "impact" as a verb — try "affect", "influence", "change"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(key)\b(?=\s+(?:is|are|was|were|will|priorities|objectives|themes|aims|goals|issues|challenges|deliverables|stakeholders|findings|messages))/gi, fix: null, msg: 'Avoid "key" (overused) — try "important", "main", "significant"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(land)\b(?=\s+(?:a|the|this|our|your|their)\s+(?:deal|contract|agreement|role|job|funding|investment))/gi, fix: null, msg: 'Avoid "land" as a verb (unless about aircraft) — try "get", "secure", "achieve"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(leverage)\b(?!\s+(?:ratio|buyout))/gi, fix: null, msg: 'Avoid "leverage" (unless financial) — try "use", "take advantage of"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(liaise)\b/gi, fix: null, msg: 'Avoid "liaise" — try "work with", "contact", "talk to"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\bone[- ]stop[- ]shop\b/gi, fix: null, msg: 'Avoid "one-stop shop" — describe what the service actually does', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(overarching)\b/gi, fix: null, msg: 'Avoid "overarching" — try "overall" or just remove it', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(portal)\b/gi, fix: null, msg: 'Avoid "portal" — use "website" or "service" or the service name', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(ring[- ]?fenc(?:e|ed|ing))\b/gi, fix: null, msg: 'Avoid "ring-fencing" — try "separate", "protect", "keep aside"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(robust)\b/gi, fix: null, msg: 'Avoid "robust" — try "strong", "effective", "thorough"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(signpost(?:ing|ed|s)?)\b/gi, fix: null, msg: 'Avoid "signposting" — try "directing", "linking", "tell users about"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\bslimming\s+down\b/gi, fix: null, msg: 'Avoid "slimming down" — try "reducing" or "removing"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(streamlin(?:e|ing|ed))\b/gi, fix: null, msg: 'Avoid "streamline" — try "simplify" or "improve"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(tackl(?:e|ing|ed|es))\b(?!\s+(?:football|rugby|player|opponent))/gi, fix: null, msg: 'Avoid "tackle" (unless sports) — try "solve", "reduce", "deal with"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(transform(?:ing|ed|ation|s)?)\b/gi, fix: null, msg: 'Avoid "transform" — be specific: what is actually changing?', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },

      // --- More plain English ---
      { regex: /\b(proforma)\b/gi, fix: 'form', msg: 'Use "form" or "template" instead of "proforma"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(henceforth)\b/gi, fix: 'from now on', msg: 'Use "from now on" instead of "henceforth"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(herewith)\b/gi, fix: null, msg: 'Avoid "herewith" — just say what you are including', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(aforementioned)\b/gi, fix: null, msg: 'Avoid "aforementioned" — name the thing directly', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(forthwith)\b/gi, fix: 'immediately', msg: 'Use "immediately" or "now" instead of "forthwith"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(whatsoever)\b/gi, fix: null, msg: 'Avoid "whatsoever" — it rarely adds meaning', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in lieu of)\b/gi, fix: 'instead of', msg: 'Use "instead of" instead of "in lieu of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(pertaining to)\b/gi, fix: 'about', msg: 'Use "about" instead of "pertaining to"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(pursuant to)\b/gi, fix: 'under', msg: 'Use "under" or "in line with" instead of "pursuant to"', cat: 'Plain English', title: 'Use plain English' },

      // --- Gender-neutral language ---
      { regex: /\b(he or she)\b/gi, fix: 'they', msg: 'Use "they" instead of "he or she" for gender-neutral language', cat: 'GOV.UK style', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(his or her)\b/gi, fix: 'their', msg: 'Use "their" instead of "his or her" for gender-neutral language', cat: 'GOV.UK style', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(him or her)\b/gi, fix: 'them', msg: 'Use "them" instead of "him or her" for gender-neutral language', cat: 'GOV.UK style', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(he\/she)\b/gi, fix: 'they', msg: 'Use "they" instead of "he/she" for gender-neutral language', cat: 'GOV.UK style', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(his\/her)\b/gi, fix: 'their', msg: 'Use "their" instead of "his/her" for gender-neutral language', cat: 'GOV.UK style', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },

      // --- "simply" minimises user difficulty ---
      { regex: /\b(simply)\b/gi, fix: null, msg: 'Avoid "simply" — it can make users feel bad if they find it difficult', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },

      // --- Specific GOV.UK term corrections ---
      { regex: /\b(e-mail)\b/gi, fix: 'email', msg: 'GOV.UK style: use "email" not "e-mail"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\bfill\s+out\b/gi, fix: 'fill in', msg: 'GOV.UK style: use "fill in" not "fill out"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\bFAQs?\b/g, fix: null, msg: 'GOV.UK style: do not use FAQs — present information in a user-centred way', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\b(percent)\b/gi, fix: 'per cent', msg: 'GOV.UK style: use "per cent" not "percent"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\bfinancial\s+penalt(?:y|ies)\b/gi, fix: null, msg: 'GOV.UK style: use "fine" instead of "financial penalty"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] }
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
          group: 'clarity',
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

  // Build a list of missing-letter roots sorted longest first (for prefix matching)
  var MISSING_LETTER_ROOTS = Object.keys(MISSING_FIRST_LETTER).sort(function (a, b) {
    return b.length - a.length;
  });

  /**
   * Check if a word starts with a known missing-letter root.
   * Returns { root, fix } or null.
   * Handles exact matches ("nternal" -> "internal") and
   * suffixed forms ("nternalising" -> "internalising").
   */
  function findMissingLetterMatch(lower) {
    // Exact match first
    if (MISSING_FIRST_LETTER[lower]) {
      return { root: lower, fix: MISSING_FIRST_LETTER[lower] };
    }
    // Prefix match: check if word starts with a known root + has a suffix
    for (var i = 0; i < MISSING_LETTER_ROOTS.length; i++) {
      var root = MISSING_LETTER_ROOTS[i];
      if (lower.length > root.length && lower.indexOf(root) === 0) {
        var suffix = lower.substring(root.length);
        // Only match if suffix looks like a real English suffix
        if (/^(s|ed|er|es|ing|ly|tion|sion|ment|ness|ise|ize|ised|ized|ising|izing|isation|ization|able|ible|ful|less|ous|ive|al|ial|ary|ery|ory|ity|ity|ance|ence|ant|ent|ist|ism)$/.test(suffix)) {
          return { root: root, fix: MISSING_FIRST_LETTER[root] + suffix };
        }
      }
    }
    return null;
  }

  function checkMissingLetters(text) {
    var results = [];
    var wordRegex = /\b([a-zA-Z]{4,})\b/g;
    var match;
    while ((match = wordRegex.exec(text)) !== null) {
      var word = match[1];
      var lower = word.toLowerCase();

      // Check if this looks like a word with a missing first letter
      var found = findMissingLetterMatch(lower);
      if (found) {
        var replacement = found.fix;
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
          message: 'This sentence has ' + words.length + ' words. Try splitting at a natural break \u2014 look for "and", "but", "which", or commas where you could start a new sentence.',
          title: 'Long sentence (' + words.length + ' words)',
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
        var beVerb = match[1].toLowerCase();
        var passivePhrase = match[0];

        // Build educational guidance based on what was detected
        var tip = buildPassiveVoiceTip(beVerb, participle, passivePhrase, text, match.index);

        results.push({
          id: makeId(),
          ruleId: 'passive-voice',
          source: 'regex',
          group: 'clarity',
          category: 'Passive voice',
          start: match.index,
          end: match.index + match[0].length,
          message: tip,
          title: 'Passive voice',
          original: match[0]
        });
      }
    }
    return results;
  }

  /**
   * Build an educational tip for passive voice.
   * Helps the user figure out how to rewrite, rather than doing it for them.
   */
  function buildPassiveVoiceTip(beVerb, participle, fullMatch, text, matchIndex) {
    // Check if there's a "by ..." agent after the passive phrase
    var after = text.substring(matchIndex + fullMatch.length, matchIndex + fullMatch.length + 60);
    var byAgent = after.match(/^\s+by\s+(\w+(?:\s+\w+)?)/i);

    if (byAgent) {
      // "was approved by the manager" -> tip: put "the manager" first
      return 'This is passive voice. The doer ("' + byAgent[1] + '") is hidden at the end. ' +
        'Try flipping: put "' + byAgent[1] + '" at the start as the subject, then use an active verb. ' +
        'Pattern: [who did it] + [active verb] + [what was done].';
    }

    // No "by" agent — the doer is missing entirely
    return 'This is passive voice \u2014 the sentence hides who is doing the action. ' +
      'Ask yourself: who or what "' + participle + '"? ' +
      'Put that person or thing at the start of the sentence as the subject, ' +
      'then follow with the action. Pattern: [who did it] + [active verb] + [what].';
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
   * GOV.UK contractions guidance:
   * - Negative contractions (can't, don't, won't etc.) should NOT be used
   *   → use "cannot", "do not", "will not" instead
   * - Positive contractions (it's, you'll, we're etc.) ARE allowed
   * - Complex tense contractions (should've, could've, would've, they've) should be avoided
   */
  function checkContractions(text) {
    if (currentMode !== 'govuk') return [];

    var results = [];
    var patterns = [
      // Negative contractions: GOV.UK says use the full form
      { regex: /\b(can't)\b/gi, fix: 'cannot', msg: 'GOV.UK style: use "cannot" instead of "can\'t"' },
      { regex: /\b(don't)\b/gi, fix: 'do not', msg: 'GOV.UK style: use "do not" instead of "don\'t"' },
      { regex: /\b(doesn't)\b/gi, fix: 'does not', msg: 'GOV.UK style: use "does not" instead of "doesn\'t"' },
      { regex: /\b(didn't)\b/gi, fix: 'did not', msg: 'GOV.UK style: use "did not" instead of "didn\'t"' },
      { regex: /\b(won't)\b/gi, fix: 'will not', msg: 'GOV.UK style: use "will not" instead of "won\'t"' },
      { regex: /\b(wouldn't)\b/gi, fix: 'would not', msg: 'GOV.UK style: use "would not" instead of "wouldn\'t"' },
      { regex: /\b(shouldn't)\b/gi, fix: 'should not', msg: 'GOV.UK style: use "should not" instead of "shouldn\'t"' },
      { regex: /\b(couldn't)\b/gi, fix: 'could not', msg: 'GOV.UK style: use "could not" instead of "couldn\'t"' },
      { regex: /\b(isn't)\b/gi, fix: 'is not', msg: 'GOV.UK style: use "is not" instead of "isn\'t"' },
      { regex: /\b(aren't)\b/gi, fix: 'are not', msg: 'GOV.UK style: use "are not" instead of "aren\'t"' },
      { regex: /\b(wasn't)\b/gi, fix: 'was not', msg: 'GOV.UK style: use "was not" instead of "wasn\'t"' },
      { regex: /\b(weren't)\b/gi, fix: 'were not', msg: 'GOV.UK style: use "were not" instead of "weren\'t"' },
      { regex: /\b(hasn't)\b/gi, fix: 'has not', msg: 'GOV.UK style: use "has not" instead of "hasn\'t"' },
      { regex: /\b(haven't)\b/gi, fix: 'have not', msg: 'GOV.UK style: use "have not" instead of "haven\'t"' },
      { regex: /\b(hadn't)\b/gi, fix: 'had not', msg: 'GOV.UK style: use "had not" instead of "hadn\'t"' },
      // Complex tense contractions: avoid these
      { regex: /\b(should've)\b/gi, fix: 'should have', msg: 'GOV.UK style: use "should have" instead of "should\'ve"' },
      { regex: /\b(could've)\b/gi, fix: 'could have', msg: 'GOV.UK style: use "could have" instead of "could\'ve"' },
      { regex: /\b(would've)\b/gi, fix: 'would have', msg: 'GOV.UK style: use "would have" instead of "would\'ve"' },
      { regex: /\b(they've)\b/gi, fix: 'they have', msg: 'GOV.UK style: use "they have" instead of "they\'ve"' }
      // Note: positive contractions (it's, you'll, we'll, we're, they're, you're) are allowed
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
          title: 'Avoid contraction',
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
   * GOV.UK number formatting rules beyond simple digit spelling.
   * Covers: commas in large numbers, number ranges with hyphens,
   * sentence-starting digits, missing leading zero, measurement spacing,
   * abbreviated millions/billions.
   */
  function checkNumberFormatting(text) {
    if (currentMode !== 'govuk') return [];
    var results = [];
    var match;

    // Numbers over 999 without commas (e.g. 1234 should be 1,234)
    // Skip years (1900-2099), postcodes, and common non-comma numbers
    var bigNumRegex = /\b(\d{4,})\b/g;
    while ((match = bigNumRegex.exec(text)) !== null) {
      var num = match[1];
      // Skip years (1900-2099)
      if (/^(19|20)\d{2}$/.test(num)) continue;
      // Skip if already has commas nearby or is part of a decimal
      if (match.index > 0 && text[match.index - 1] === ',') continue;
      if (text[match.index + num.length] === '.') continue;
      // Skip phone numbers, postcodes
      if (match.index > 0 && /[+\-()]/.test(text[match.index - 1])) continue;
      // Only flag if it should have commas
      var numVal = parseInt(num, 10);
      if (numVal >= 10000) {
        var formatted = numVal.toLocaleString('en-GB');
        results.push({
          id: makeId(),
          ruleId: 'number-formatting',
          source: 'regex',
          group: 'style',
          category: 'Number formatting',
          start: match.index,
          end: match.index + num.length,
          message: 'GOV.UK style: use commas in numbers over 999 — "' + formatted + '"',
          title: 'Number formatting',
          replacement: formatted,
          original: num
        });
      }
    }

    // Number ranges with hyphens: "500-900" should be "500 to 900"
    var rangeRegex = /\b(\d+)\s*[-–—]\s*(\d+)\b/g;
    while ((match = rangeRegex.exec(text)) !== null) {
      // Skip time ranges like "9-5" that look like times, or years
      var left = parseInt(match[1], 10);
      var right = parseInt(match[2], 10);
      if (right <= left) continue; // Not a range
      // Skip year ranges handled by date check
      if (left >= 1900 && left <= 2099 && right >= 1900 && right <= 2099) continue;
      results.push({
        id: makeId(),
        ruleId: 'number-formatting',
        source: 'regex',
        group: 'style',
        category: 'Number formatting',
        start: match.index,
        end: match.index + match[0].length,
        message: 'GOV.UK style: use "to" in ranges, not hyphens — "' + match[1] + ' to ' + match[2] + '"',
        title: 'Number formatting',
        replacement: match[1] + ' to ' + match[2],
        original: match[0]
      });
    }

    // Sentence starting with a digit
    var sentenceDigit = /(?:^|[.!?]\s+)(\d+)\s+[a-zA-Z]/gm;
    while ((match = sentenceDigit.exec(text)) !== null) {
      var digitStart = match.index + match[0].indexOf(match[1]);
      // Only flag if it's not a heading-like context
      results.push({
        id: makeId(),
        ruleId: 'number-formatting',
        source: 'regex',
        group: 'style',
        category: 'Number formatting',
        start: digitStart,
        end: digitStart + match[1].length,
        message: 'GOV.UK style: do not start a sentence with a numeral — write it out in full',
        title: 'Number formatting',
        original: match[1]
      });
    }

    // Missing leading zero before decimal: .5 should be 0.5
    var leadingZero = /(?:^|[^0-9])(\.\d+)\b/g;
    while ((match = leadingZero.exec(text)) !== null) {
      var dotNum = match[1];
      var dotStart = match.index + match[0].indexOf(dotNum);
      results.push({
        id: makeId(),
        ruleId: 'number-formatting',
        source: 'regex',
        group: 'style',
        category: 'Number formatting',
        start: dotStart,
        end: dotStart + dotNum.length,
        message: 'GOV.UK style: use a leading zero before decimals — "0' + dotNum + '"',
        title: 'Number formatting',
        replacement: '0' + dotNum,
        original: dotNum
      });
    }

    // Space between number and measurement abbreviation: "3,500 kg" should be "3,500kg"
    var measureSpace = /(\d)\s+(kg|km|mm|cm|m|lb|oz|mg|g|ml|mph|kph)\b/g;
    while ((match = measureSpace.exec(text)) !== null) {
      // Avoid flagging "5 m" where m could be a word; only flag clear measurement abbreviations
      if (match[2] === 'm' || match[2] === 'g') continue; // Too ambiguous as standalone
      results.push({
        id: makeId(),
        ruleId: 'number-formatting',
        source: 'regex',
        group: 'style',
        category: 'Number formatting',
        start: match.index,
        end: match.index + match[0].length,
        message: 'GOV.UK style: no space between number and unit — "' + match[1] + match[2] + '"',
        title: 'Number formatting',
        replacement: match[1] + match[2],
        original: match[0]
      });
    }

    // Abbreviated millions/billions with currency: £138m should be £138 million
    var abbrMillion = /£(\d+(?:,\d{3})*)m\b/g;
    while ((match = abbrMillion.exec(text)) !== null) {
      results.push({
        id: makeId(),
        ruleId: 'number-formatting',
        source: 'regex',
        group: 'style',
        category: 'Number formatting',
        start: match.index,
        end: match.index + match[0].length,
        message: 'GOV.UK style: write "million" in full — "£' + match[1] + ' million"',
        title: 'Number formatting',
        replacement: '£' + match[1] + ' million',
        original: match[0]
      });
    }

    var abbrBillion = /£(\d+(?:,\d{3})*)bn?\b/g;
    while ((match = abbrBillion.exec(text)) !== null) {
      results.push({
        id: makeId(),
        ruleId: 'number-formatting',
        source: 'regex',
        group: 'style',
        category: 'Number formatting',
        start: match.index,
        end: match.index + match[0].length,
        message: 'GOV.UK style: write "billion" in full — "£' + match[1] + ' billion"',
        title: 'Number formatting',
        replacement: '£' + match[1] + ' billion',
        original: match[0]
      });
    }

    return results;
  }

  /**
   * GOV.UK time formatting rules.
   * - 5:30pm not 5:30 pm (no space before am/pm)
   * - 5:30pm not 5.30pm (colon not dot)
   * - 5pm not 5:00pm (no trailing zeros)
   * - 12-hour clock not 24-hour
   * - "to" not hyphens in time ranges
   * - Avoid 12am/12pm (use midnight/midday)
   */
  function checkTimeFormatting(text) {
    if (currentMode !== 'govuk') return [];
    var results = [];
    var match;

    // Space before am/pm: "5:30 pm" → "5:30pm"
    var spaceAmPm = /\b(\d{1,2}(?::\d{2})?)\s+(am|pm)\b/gi;
    while ((match = spaceAmPm.exec(text)) !== null) {
      results.push({
        id: makeId(),
        ruleId: 'time-formatting',
        source: 'regex',
        group: 'style',
        category: 'Time formatting',
        start: match.index,
        end: match.index + match[0].length,
        message: 'GOV.UK style: no space before am/pm — "' + match[1] + match[2].toLowerCase() + '"',
        title: 'Time formatting',
        replacement: match[1] + match[2].toLowerCase(),
        original: match[0]
      });
    }

    // Dot instead of colon in times: "5.30pm" → "5:30pm"
    var dotTime = /\b(\d{1,2})\.(\d{2})\s*(am|pm)\b/gi;
    while ((match = dotTime.exec(text)) !== null) {
      var fixed = match[1] + ':' + match[2] + match[3].toLowerCase();
      results.push({
        id: makeId(),
        ruleId: 'time-formatting',
        source: 'regex',
        group: 'style',
        category: 'Time formatting',
        start: match.index,
        end: match.index + match[0].length,
        message: 'GOV.UK style: use a colon in times, not a dot — "' + fixed + '"',
        title: 'Time formatting',
        replacement: fixed,
        original: match[0]
      });
    }

    // Trailing :00 in times: "5:00pm" → "5pm"
    var trailingZero = /\b(\d{1,2}):00\s*(am|pm)\b/gi;
    while ((match = trailingZero.exec(text)) !== null) {
      results.push({
        id: makeId(),
        ruleId: 'time-formatting',
        source: 'regex',
        group: 'style',
        category: 'Time formatting',
        start: match.index,
        end: match.index + match[0].length,
        message: 'GOV.UK style: remove trailing zeros — "' + match[1] + match[2].toLowerCase() + '"',
        title: 'Time formatting',
        replacement: match[1] + match[2].toLowerCase(),
        original: match[0]
      });
    }

    // 24-hour clock: "17:30" or "15:00" → suggest 12-hour format
    var twentyFour = /\b([1-2][0-9]):([0-5][0-9])\b(?!\s*(am|pm))/gi;
    while ((match = twentyFour.exec(text)) !== null) {
      var hour = parseInt(match[1], 10);
      if (hour < 13) continue; // Could be 12-hour format
      var hour12 = hour > 12 ? hour - 12 : hour;
      var mins = match[2];
      var suffix = hour >= 12 ? 'pm' : 'am';
      var replacement = mins === '00' ? hour12 + suffix : hour12 + ':' + mins + suffix;
      results.push({
        id: makeId(),
        ruleId: 'time-formatting',
        source: 'regex',
        group: 'style',
        category: 'Time formatting',
        start: match.index,
        end: match.index + match[0].length,
        message: 'GOV.UK style: use 12-hour clock — "' + replacement + '"',
        title: 'Time formatting',
        replacement: replacement,
        original: match[0]
      });
    }

    // 12am / 12pm (confusing): suggest midnight/midday
    var noon = /\b12\s*(am|pm)\b/gi;
    while ((match = noon.exec(text)) !== null) {
      var suggest = match[1].toLowerCase() === 'am' ? 'midnight' : 'midday';
      results.push({
        id: makeId(),
        ruleId: 'time-formatting',
        source: 'regex',
        group: 'style',
        category: 'Time formatting',
        start: match.index,
        end: match.index + match[0].length,
        message: 'GOV.UK style: use "' + suggest + '" instead of "12' + match[1].toLowerCase() + '" to avoid confusion',
        title: 'Time formatting',
        replacement: suggest,
        original: match[0]
      });
    }

    return results;
  }

  /**
   * GOV.UK punctuation rules.
   * - No ampersand (&) in prose
   * - No exclamation marks (unless in quotes)
   * - No block capitals (3+ words in ALL CAPS)
   * - No dots in abbreviations (B.B.C. → BBC)
   */
  function checkGovukPunctuation(text) {
    if (currentMode !== 'govuk') return [];
    var results = [];
    var match;

    // Ampersand in prose (not in HTML entities like &amp;)
    var ampRegex = /\s(&)\s/g;
    while ((match = ampRegex.exec(text)) !== null) {
      results.push({
        id: makeId(),
        ruleId: 'govuk-punctuation',
        source: 'regex',
        group: 'style',
        category: 'GOV.UK style',
        start: match.index + 1,
        end: match.index + 2,
        message: 'GOV.UK style: use "and" not "&" in text',
        title: 'GOV.UK style',
        replacement: 'and',
        original: '&'
      });
    }

    // Exclamation marks (not inside quotes)
    var exclRegex = /[^"'"](!)/g;
    while ((match = exclRegex.exec(text)) !== null) {
      // Simple heuristic: skip if preceded by a closing quote
      var before = text.substring(Math.max(0, match.index - 50), match.index + 1);
      var openQuotes = (before.match(/[""\u201C]/g) || []).length;
      var closeQuotes = (before.match(/[""\u201D]/g) || []).length;
      if (openQuotes > closeQuotes) continue; // Inside quotes

      var exclIdx = match.index + 1;
      results.push({
        id: makeId(),
        ruleId: 'govuk-punctuation',
        source: 'regex',
        group: 'style',
        category: 'GOV.UK style',
        start: exclIdx,
        end: exclIdx + 1,
        message: 'GOV.UK style: do not use exclamation marks',
        title: 'GOV.UK style',
        replacement: '.',
        original: '!'
      });
    }

    // Block capitals: 3+ consecutive uppercase words
    var blockCaps = /\b([A-Z]{2,}(?:\s+[A-Z]{2,}){2,})\b/g;
    while ((match = blockCaps.exec(text)) !== null) {
      // Skip known all-caps acronyms/abbreviations
      if (/^[A-Z]{2,4}$/.test(match[1])) continue;
      results.push({
        id: makeId(),
        ruleId: 'govuk-punctuation',
        source: 'regex',
        group: 'style',
        category: 'GOV.UK style',
        start: match.index,
        end: match.index + match[0].length,
        message: 'GOV.UK style: do not use block capitals — they are harder to read',
        title: 'GOV.UK style',
        original: match[0]
      });
    }

    // Dotted abbreviations: B.B.C. → BBC, U.K. → UK
    var dottedAbbr = /(?:^|[^A-Za-z])([A-Z]\.(?:[A-Z]\.)+[A-Z]?)/g;
    while ((match = dottedAbbr.exec(text)) !== null) {
      var abbr = match[1];
      var clean = abbr.replace(/\./g, '');
      var abbrStart = match.index + match[0].indexOf(abbr);
      // If abbreviation ends with dot and is followed by a space+capital (sentence boundary),
      // keep the trailing dot as a full stop
      var afterAbbr = text[abbrStart + abbr.length];
      var endsWithDot = abbr[abbr.length - 1] === '.';
      if (endsWithDot && afterAbbr && /\s/.test(afterAbbr)) {
        // Check if next non-space char is uppercase (sentence boundary)
        var nextChars = text.substring(abbrStart + abbr.length).match(/^\s+([A-Z])/);
        if (nextChars) {
          clean = clean + '.'; // Preserve sentence-ending period
        }
      }
      results.push({
        id: makeId(),
        ruleId: 'govuk-punctuation',
        source: 'regex',
        group: 'style',
        category: 'GOV.UK style',
        start: abbrStart,
        end: abbrStart + abbr.length,
        message: 'GOV.UK style: no dots in abbreviations — "' + clean + '"',
        title: 'GOV.UK style',
        replacement: clean,
        original: abbr
      });
    }

    return results;
  }

  /**
   * GOV.UK capitalisation rules.
   * - "internet" not "Internet" mid-sentence
   * - "web" not "Web" mid-sentence
   * - Seasons lower case mid-sentence
   * - "government" lower case when generic
   */
  function checkGovukCapitalisation(text) {
    if (currentMode !== 'govuk') return [];
    var results = [];
    var match;

    // Words that should be lower case mid-sentence
    var lcWords = [
      { regex: /(?:^.|\.\s+.{0,50}?).*?\b(Internet)\b/g, word: 'Internet', fix: 'internet', msg: 'GOV.UK style: "internet" is lower case' },
      { regex: /(?:[.!?]\s+\w.*?\b|\w.*?\b)(Internet)\b/g, word: 'Internet', fix: 'internet', msg: 'GOV.UK style: "internet" is lower case' },
      { regex: /(?:[.!?]\s+\w.*?\b|\w.*?\b)(Web)\b(?!\s*(?:site|page|browser|server|developer|design|application|service|standard))/g, word: 'Web', fix: 'web', msg: 'GOV.UK style: "web" is lower case' }
    ];

    // Simpler approach: find mid-sentence occurrences
    var internetMid = /[a-z,;:]\s+(Internet)\b/g;
    while ((match = internetMid.exec(text)) !== null) {
      var wordStart = match.index + match[0].indexOf('Internet');
      results.push({
        id: makeId(),
        ruleId: 'govuk-capitalisation',
        source: 'regex',
        group: 'style',
        category: 'GOV.UK style',
        start: wordStart,
        end: wordStart + 8,
        message: 'GOV.UK style: "internet" is lower case',
        title: 'GOV.UK style',
        replacement: 'internet',
        original: 'Internet'
      });
    }

    var webMid = /[a-z,;:]\s+(Web)\b(?!\s*(?:site|page|browser|server|developer|design))/g;
    while ((match = webMid.exec(text)) !== null) {
      var wStart = match.index + match[0].indexOf('Web');
      results.push({
        id: makeId(),
        ruleId: 'govuk-capitalisation',
        source: 'regex',
        group: 'style',
        category: 'GOV.UK style',
        start: wStart,
        end: wStart + 3,
        message: 'GOV.UK style: "web" is lower case',
        title: 'GOV.UK style',
        replacement: 'web',
        original: 'Web'
      });
    }

    // Capitalised seasons mid-sentence
    var seasons = /[a-z,;:]\s+(Spring|Summer|Autumn|Winter)\b/g;
    while ((match = seasons.exec(text)) !== null) {
      var seasonWord = match[1];
      var sStart = match.index + match[0].indexOf(seasonWord);
      results.push({
        id: makeId(),
        ruleId: 'govuk-capitalisation',
        source: 'regex',
        group: 'style',
        category: 'GOV.UK style',
        start: sStart,
        end: sStart + seasonWord.length,
        message: 'GOV.UK style: seasons are lower case — "' + seasonWord.toLowerCase() + '"',
        title: 'GOV.UK style',
        replacement: seasonWord.toLowerCase(),
        original: seasonWord
      });
    }

    // "Government" when used generically mid-sentence (not at start, not part of a name)
    var govMid = /[a-z,;:]\s+(Government)\b(?!\s+(?:of|Digital|Communication|Statistical|Legal|Property|Actuary))/g;
    while ((match = govMid.exec(text)) !== null) {
      var gStart = match.index + match[0].indexOf('Government');
      results.push({
        id: makeId(),
        ruleId: 'govuk-capitalisation',
        source: 'regex',
        group: 'style',
        category: 'GOV.UK style',
        start: gStart,
        end: gStart + 10,
        message: 'GOV.UK style: "government" is lower case when used generically',
        title: 'GOV.UK style',
        replacement: 'government',
        original: 'Government'
      });
    }

    return results;
  }

  /**
   * Run all quick checks on the given text.
   * Returns an array of suggestion objects.
   */
  // Priority for deduplication: more specific checks win over generic ones
  var RULE_PRIORITY = {
    'missing-letter': 10,
    'confused-words': 9,
    'spelling': 8,
    'common-grammar': 7,
    'repeated-word': 6,
    'capitalisation': 3,
    'double-space': 2,
    'punctuation-spacing': 2
  };

  function runAll(text) {
    var allResults = [];
    rules.forEach(function (rule) {
      var results = rule.run(text);
      allResults = allResults.concat(results);
    });

    // Deduplicate: if two results overlap the same text range, keep the
    // higher-priority (more specific) one. E.g. missing-letter beats capitalisation.
    allResults.sort(function (a, b) {
      return a.start - b.start || (RULE_PRIORITY[b.ruleId] || 5) - (RULE_PRIORITY[a.ruleId] || 5);
    });

    var deduped = [];
    for (var i = 0; i < allResults.length; i++) {
      var current = allResults[i];
      var dominated = false;
      for (var j = 0; j < deduped.length; j++) {
        var kept = deduped[j];
        // Check if ranges overlap
        if (current.start < kept.end && current.end > kept.start) {
          // Overlapping — keep the higher priority one
          var currentPri = RULE_PRIORITY[current.ruleId] || 5;
          var keptPri = RULE_PRIORITY[kept.ruleId] || 5;
          if (currentPri <= keptPri) {
            dominated = true;
            break;
          }
        }
      }
      if (!dominated) {
        deduped.push(current);
      }
    }

    return deduped;
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
