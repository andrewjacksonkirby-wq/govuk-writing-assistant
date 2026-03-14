/**
 * FullCheck module
 * AI-based full check with sensitivity gate.
 * Only runs when user clicks "Check now" AND content is marked safe.
 * Results go under "Clarity and style".
 */
const FullCheck = (function () {
  'use strict';
  var isRunning = false;
  var idCounter = 0;
  var currentMode = 'govuk'; // 'govuk', 'email', 'chat'

  // Default API config
  var CONFIG_STORAGE_KEY = 'wa-ai-config';
  var config = {
    provider: 'anthropic',   // 'anthropic' or 'gemini'
    apiEndpoint: '',
    apiKey: '',
    model: 'claude-sonnet-4-20250514',
    useSimulation: true
  };

  // Provider-specific defaults
  var PROVIDERS = {
    anthropic: {
      label: 'Anthropic (Claude)',
      defaultEndpoint: 'https://api.anthropic.com/v1/messages',
      models: [
        { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
        { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' }
      ]
    },
    gemini: {
      label: 'Google AI Studio (Gemini)',
      defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
      models: [
        { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
        { id: 'gemini-2.5-pro-preview-05-06', label: 'Gemini 2.5 Pro' }
      ]
    }
  };

  function loadConfig() {
    try {
      var stored = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY));
      if (stored) {
        config.provider = stored.provider || 'anthropic';
        config.apiEndpoint = stored.apiEndpoint || '';
        config.apiKey = stored.apiKey || '';
        config.model = stored.model || 'claude-sonnet-4-20250514';
        config.useSimulation = !config.apiEndpoint || !config.apiKey;
      }
    } catch (e) { /* use defaults */ }
  }

  function saveConfig(provider, endpoint, key, model) {
    config.provider = provider || 'anthropic';
    config.apiEndpoint = endpoint;
    config.apiKey = key;
    config.model = model;
    config.useSimulation = !endpoint || !key;
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({
      provider: config.provider,
      apiEndpoint: endpoint,
      apiKey: key,
      model: model
    }));
  }

  function getConfig() {
    return {
      provider: config.provider,
      apiEndpoint: config.apiEndpoint,
      apiKey: config.apiKey,
      model: config.model,
      useSimulation: config.useSimulation
    };
  }

  function hasValidConfig() {
    return !!(config.apiEndpoint && config.apiKey);
  }

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

    // Check if allowance is exhausted
    if (isAllowanceExhausted()) {
      callback(null, 'allowance-exhausted');
      return;
    }

    isRunning = true;

    var useAPI = !config.useSimulation && config.apiEndpoint && config.apiKey;

    if (useAPI) {
      runAPI(text, callback);
    } else {
      runSimulation(text, callback);
    }
  }

  /**
   * Common words to ignore for overuse detection.
   */
  var STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'shall', 'can', 'it', 'its', 'this',
    'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'me',
    'him', 'her', 'us', 'them', 'my', 'your', 'his', 'our', 'their',
    'what', 'which', 'who', 'when', 'where', 'how', 'not', 'no', 'if',
    'then', 'than', 'so', 'as', 'up', 'out', 'about', 'into', 'all',
    'also', 'just', 'more', 'some', 'any', 'each', 'very', 'there', 'here',
    'both', 'own', 'other', 'such', 'only', 'same', 'too', 'still', 'now'
  ]);

  /**
   * Detect words used 3+ times (excluding stop words).
   * Groups by word and flags each occurrence.
   */
  function checkOverusedWords(text) {
    var results = [];
    var wordRegex = /\b([a-zA-Z]{4,})\b/g;
    var wordCounts = {};
    var wordPositions = {};
    var match;

    while ((match = wordRegex.exec(text)) !== null) {
      var word = match[1].toLowerCase();
      if (STOP_WORDS.has(word)) continue;
      if (!wordCounts[word]) {
        wordCounts[word] = 0;
        wordPositions[word] = [];
      }
      wordCounts[word]++;
      wordPositions[word].push({ start: match.index, end: match.index + match[1].length, original: match[1] });
    }

    Object.keys(wordCounts).forEach(function (word) {
      if (wordCounts[word] >= 3) {
        // Only flag the 2nd+ occurrences
        var positions = wordPositions[word];
        for (var i = 1; i < positions.length; i++) {
          results.push({
            id: makeId(),
            ruleId: 'overused-word',
            source: 'ai',
            group: 'clarity',
            category: 'Word choice',
            start: positions[i].start,
            end: positions[i].end,
            message: '"' + word + '" appears ' + positions.length + ' times. Try a synonym or rephrase.',
            title: 'Overused word',
            original: positions[i].original
          });
        }
      }
    });

    return results;
  }

  // ========== Passive voice detection ==========

  var PAST_PARTICIPLES = new Set([
    'accepted', 'achieved', 'added', 'addressed', 'adjusted', 'adopted',
    'advised', 'affected', 'agreed', 'allowed', 'amended', 'announced',
    'applied', 'appointed', 'approved', 'arranged', 'asked', 'assessed',
    'assigned', 'assumed', 'attached', 'attempted', 'attended', 'authorised',
    'awarded', 'based', 'begun', 'believed', 'blocked', 'borrowed', 'broken',
    'brought', 'built', 'bought', 'calculated', 'called', 'cancelled',
    'captured', 'carried', 'caused', 'challenged', 'changed', 'charged',
    'checked', 'chosen', 'claimed', 'classified', 'cleared', 'closed',
    'collected', 'combined', 'committed', 'communicated', 'compared',
    'compensated', 'completed', 'conducted', 'confirmed', 'connected',
    'considered', 'constructed', 'consulted', 'contacted', 'contained',
    'controlled', 'converted', 'copied', 'corrected', 'covered', 'created',
    'cut', 'damaged', 'decided', 'declared', 'delayed', 'delegated',
    'delivered', 'demonstrated', 'denied', 'deployed', 'described',
    'designed', 'destroyed', 'detected', 'determined', 'developed',
    'directed', 'discovered', 'discussed', 'dismissed', 'displayed',
    'distributed', 'divided', 'documented', 'done', 'downloaded', 'drafted',
    'drawn', 'driven', 'dropped', 'earned', 'edited', 'educated',
    'eliminated', 'employed', 'enabled', 'encouraged', 'ended', 'enforced',
    'engaged', 'entered', 'equipped', 'established', 'estimated', 'evaluated',
    'examined', 'exceeded', 'exchanged', 'excluded', 'executed', 'exempted',
    'exercised', 'expanded', 'expected', 'explained', 'explored', 'exported',
    'exposed', 'expressed', 'extended', 'extracted', 'facilitated', 'fed',
    'filed', 'filled', 'finalised', 'financed', 'fixed', 'focused',
    'followed', 'forbidden', 'forced', 'formed', 'found', 'frozen',
    'fulfilled', 'funded', 'gathered', 'generated', 'given', 'governed',
    'granted', 'grouped', 'grown', 'guaranteed', 'guided', 'handled',
    'heard', 'held', 'helped', 'hidden', 'hired', 'hit', 'hosted',
    'identified', 'ignored', 'illustrated', 'implemented', 'imported',
    'imposed', 'improved', 'included', 'incorporated', 'increased',
    'indicated', 'influenced', 'informed', 'inherited', 'initiated',
    'inspected', 'installed', 'instructed', 'intended', 'interpreted',
    'interviewed', 'introduced', 'investigated', 'invited', 'involved',
    'isolated', 'issued', 'joined', 'judged', 'justified', 'kept',
    'killed', 'known', 'labelled', 'launched', 'led', 'left', 'limited',
    'linked', 'listed', 'located', 'locked', 'lost', 'made', 'maintained',
    'managed', 'manufactured', 'mapped', 'marked', 'matched', 'measured',
    'mentioned', 'met', 'mitigated', 'modified', 'monitored', 'motivated',
    'moved', 'named', 'needed', 'neglected', 'negotiated', 'nominated',
    'noted', 'notified', 'obtained', 'occupied', 'offered', 'opened',
    'operated', 'opposed', 'ordered', 'organised', 'outsourced', 'overcome',
    'overlooked', 'overseen', 'owned', 'paid', 'passed', 'penalised',
    'perceived', 'performed', 'permitted', 'placed', 'planned', 'played',
    'pledged', 'pointed', 'positioned', 'posted', 'postponed', 'practised',
    'predicted', 'prepared', 'prescribed', 'presented', 'preserved',
    'prevented', 'prioritised', 'processed', 'procured', 'produced',
    'programmed', 'prohibited', 'promoted', 'proposed', 'prosecuted',
    'protected', 'proved', 'proven', 'provided', 'published', 'punished',
    'purchased', 'pursued', 'put', 'questioned', 'quoted', 'raised',
    'reached', 'read', 'realised', 'received', 'recognised', 'recommended',
    'recorded', 'recovered', 'recruited', 'reduced', 'referred', 'refused',
    'registered', 'regulated', 'rejected', 'related', 'released', 'relied',
    'relocated', 'removed', 'renewed', 'repaired', 'replaced', 'reported',
    'represented', 'requested', 'required', 'rescued', 'researched',
    'resolved', 'respected', 'restricted', 'restructured', 'retained',
    'retired', 'retrieved', 'returned', 'revealed', 'reversed', 'reviewed',
    'revised', 'revoked', 'rewarded', 'run', 'sacrificed', 'said',
    'satisfied', 'saved', 'scheduled', 'screened', 'secured', 'seen',
    'seized', 'selected', 'sent', 'separated', 'served', 'set', 'settled',
    'shaped', 'shared', 'shifted', 'shown', 'shut', 'signed', 'simplified',
    'sold', 'solved', 'sought', 'specified', 'spent', 'split', 'spoken',
    'sponsored', 'staffed', 'staged', 'standardised', 'started', 'stated',
    'stolen', 'stopped', 'stored', 'strengthened', 'structured', 'submitted',
    'substituted', 'succeeded', 'suggested', 'summarised', 'supervised',
    'supplied', 'supported', 'supposed', 'suspended', 'sustained', 'sworn',
    'taken', 'targeted', 'taught', 'terminated', 'tested', 'thought',
    'threatened', 'thrown', 'tied', 'told', 'torn', 'tracked', 'trained',
    'transferred', 'transformed', 'translated', 'transmitted', 'transported',
    'trapped', 'treated', 'triggered', 'trusted', 'turned', 'uncovered',
    'undermined', 'understood', 'undertaken', 'undone', 'unified', 'updated',
    'upgraded', 'upheld', 'used', 'utilised', 'validated', 'valued',
    'verified', 'violated', 'visited', 'wanted', 'warned', 'wasted',
    'weakened', 'weighed', 'welcomed', 'widened', 'withdrawn', 'withheld',
    'witnessed', 'won', 'worked', 'worn', 'worsened', 'wound', 'written'
  ]);

  var ACTIVE_FORMS = {
    'affected': 'affects', 'allowed': 'allows', 'begun': 'began',
    'believed': 'believes', 'broken': 'broke', 'chosen': 'chose',
    'contained': 'contains', 'done': 'did', 'drawn': 'drew',
    'driven': 'drove', 'enabled': 'enables', 'expected': 'expects',
    'forbidden': 'forbids', 'frozen': 'froze', 'given': 'gave',
    'governed': 'governs', 'grown': 'grew', 'guaranteed': 'guarantees',
    'hidden': 'hid', 'indicated': 'indicates', 'intended': 'intends',
    'involved': 'involves', 'known': 'knows', 'limited': 'limits',
    'maintained': 'maintains', 'monitored': 'monitors', 'needed': 'needs',
    'overcome': 'overcame', 'overseen': 'oversaw', 'owned': 'owns',
    'perceived': 'perceives', 'permitted': 'permits', 'prevented': 'prevents',
    'prohibited': 'prohibits', 'protected': 'protects', 'proven': 'proves',
    'recommended': 'recommends', 'regulated': 'regulates',
    'related': 'relates', 'represented': 'represents',
    'required': 'requires', 'respected': 'respects',
    'restricted': 'restricts', 'run': 'runs', 'seen': 'saw',
    'shown': 'shows', 'specified': 'specifies', 'spoken': 'spoke',
    'stolen': 'stole', 'suggested': 'suggests', 'supported': 'supports',
    'supposed': 'supposes', 'sworn': 'swore', 'taken': 'took',
    'thrown': 'threw', 'torn': 'tore', 'trusted': 'trusts',
    'understood': 'understands', 'undertaken': 'undertook',
    'undone': 'undid', 'used': 'uses', 'valued': 'values',
    'wanted': 'wants', 'withdrawn': 'withdrew', 'worn': 'wore',
    'written': 'wrote'
  };

  function checkPassiveVoice(text) {
    var results = [];
    var beVerbs = '(?:is|are|was|were|be|been|being)';
    var adverb = '(?:\\s+\\w+ly)?';
    var regex = new RegExp('\\b(' + beVerbs + ')' + adverb + '\\s+(\\w+)\\b', 'gi');
    var match;
    while ((match = regex.exec(text)) !== null) {
      var participle = match[2].toLowerCase();
      if (!PAST_PARTICIPLES.has(participle)) continue;

      var beVerb = match[1].toLowerCase();
      var fullMatch = match[0];
      var verb = ACTIVE_FORMS[participle] || participle;

      // Find the sentence boundary for context
      var sentStart = text.lastIndexOf('.', match.index);
      if (sentStart < 0) sentStart = 0; else sentStart += 1;
      var sentEnd = text.indexOf('.', match.index + fullMatch.length);
      if (sentEnd < 0) sentEnd = text.length;

      // Check for "by ..." agent
      var after = text.substring(match.index + fullMatch.length, match.index + fullMatch.length + 80);
      var byAgent = after.match(/^\s+by\s+(the\s+\w+(?:\s+\w+)?|\w+(?:\s+\w+)?)/i);

      // Get the passive subject (object of the active version)
      var before = text.substring(sentStart, match.index).trim();
      var subjectMatch = before.match(/(?:the\s+)?(?:\w+\s+){0,2}\w+$/i);
      var passiveSubject = subjectMatch ? subjectMatch[0].trim() : null;

      var tip;
      var replacement;
      if (byAgent) {
        var agent = byAgent[1].trim();
        var rewrite = capitalise(agent) + ' ' + verb;
        if (passiveSubject) rewrite += ' ' + uncapitalise(passiveSubject);
        tip = 'Passive voice. Try: "' + rewrite + '." \u2014 put "' + agent + '" first as the doer.';
        // Replacement covers the full passive phrase including "by <agent>"
        replacement = rewrite;
      } else if (passiveSubject) {
        var govRewrite = 'we ' + verb + ' ' + uncapitalise(passiveSubject);
        tip = 'Passive voice. Who does this? Try: "' + capitalise(govRewrite) + '." On GOV.UK, use "we" for the organisation or name the doer.';
        replacement = capitalise(govRewrite);
      } else {
        tip = 'Passive voice. Who ' + verb + '? Name the doer and put them first \u2014 e.g. "We ' + verb + '..." or "[Team name] ' + verb + '..."';
        replacement = undefined; // No fix — need context
      }

      var result = {
        id: makeId(),
        ruleId: 'passive-voice',
        source: 'ai',
        group: 'clarity',
        category: 'Passive voice',
        start: match.index,
        end: match.index + fullMatch.length,
        message: tip,
        title: 'Passive voice',
        original: fullMatch
      };

      if (byAgent) {
        // Extend the match end to include "by <agent>"
        result.end = match.index + fullMatch.length + byAgent[0].length;
        result.original = text.substring(result.start, result.end);
      }

      if (replacement !== undefined) {
        result.replacement = replacement;
      }

      results.push(result);
    }
    return results;
  }

  function capitalise(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function uncapitalise(s) {
    if (s.length > 1 && s === s.toUpperCase()) return s;
    if (s.length > 1 && s[0] === s[0].toUpperCase() && s[1] === s[1].toUpperCase()) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  // ========== Sentence length (contextual) ==========

  var SPLIT_CONNECTORS = [
    { regex: /,\s+(but|however|yet|although|though)\s+/gi, advice: 'split into two sentences' },
    { regex: /,\s+(and|so|or)\s+(?:(?:this|that|it|they|we|he|she|I|you|the|there|these|those)\s+)/gi, advice: 'split into two sentences' },
    { regex: /\s+(which|who|that)\s+(?:is|are|was|were|has|have|had|will|would|could|should|can|may|might)\s+/gi, advice: 'try a separate sentence' },
    { regex: /;\s+/g, advice: 'replace semicolon with a full stop' },
    { regex: /,\s+(because|since|as|while|whereas|unless|until|after|before|if|when|where)\s+/gi, advice: 'split into two sentences' },
    { regex: /,\s+(and|or)\s+/gi, advice: 'split into two sentences or use a list' },
    { regex: /\s+(in addition|furthermore|moreover|as well as|in order to|as a result|for example|for instance)\s+/gi, advice: 'start a new sentence' },
  ];

  function checkSentenceLengthContextual(text) {
    var results = [];
    var sentenceRegex = /[^.!?]*[.!?]+/g;
    var match;
    while ((match = sentenceRegex.exec(text)) !== null) {
      var sentence = match[0].trim();
      if (!sentence) continue;
      var words = sentence.split(/\s+/).filter(function (w) { return w.length > 0; });
      if (words.length <= 25) continue;

      // Find a split point for contextual advice
      var advice = 'This sentence is ' + words.length + ' words (GOV.UK recommends under 25).';
      var splitReplacement;
      for (var i = 0; i < SPLIT_CONNECTORS.length; i++) {
        var conn = SPLIT_CONNECTORS[i];
        conn.regex.lastIndex = 0;
        var m = conn.regex.exec(sentence);
        if (m) {
          var before = sentence.substring(0, m.index);
          var wordsBefore = (before.match(/\b\w+\b/g) || []).length;
          var wordsAfter = words.length - wordsBefore;
          if (wordsBefore >= 5 && wordsAfter >= 5) {
            var connWord = m[0].replace(/^[,;]\s+/i, '').replace(/\s+$/, '');
            advice += ' Try splitting at "' + connWord + '" \u2014 ' + conn.advice + '.';

            // Build a split replacement: end first sentence, start new one
            var firstPart = sentence.substring(0, m.index).replace(/\s+$/, '');
            // Ensure first part ends with a full stop
            if (!/[.!?]$/.test(firstPart)) firstPart += '.';
            var afterConn = sentence.substring(m.index + m[0].length);
            // For semicolons, just capitalise what follows
            // For connectors like "but", "however", keep the connector word
            var isSemicolon = /^[;]/.test(m[0]);
            var secondPart;
            if (isSemicolon) {
              secondPart = capitalise(afterConn.replace(/^\s+/, ''));
            } else {
              secondPart = capitalise(connWord) + ' ' + afterConn.replace(/^\s+/, '');
            }
            splitReplacement = firstPart + ' ' + secondPart;
            break;
          }
        }
      }

      var sentStart = match.index;
      var sentEnd = match.index + match[0].length;
      var sentResult = {
        id: makeId(),
        ruleId: 'sentence-length',
        source: 'ai',
        group: 'clarity',
        category: 'Sentence length',
        start: sentStart,
        end: sentEnd,
        message: advice,
        title: 'Long sentence',
        original: sentence
      };
      if (splitReplacement) {
        sentResult.replacement = splitReplacement;
      }
      results.push(sentResult);
    }
    return results;
  }

  // ========== Tone patterns (contextual) ==========

  var TONE_PATTERNS = [
    { regex: /\b(I just wanted to)\b/gi, msg: 'Drop the hedge \u2014 just say what you need.', fix: null, title: 'Hedging language', modes: ['email', 'chat'] },
    { regex: /\b(sorry to bother you)\b/gi, msg: 'No need to apologise \u2014 state your request directly.', fix: null, title: 'Unnecessary apology', modes: ['email', 'chat'] },
    { regex: /\b(sorry for the delay)\b/gi, msg: 'Try "thanks for your patience" \u2014 it\'s more positive.', fix: 'thanks for your patience', title: 'Negative framing', modes: ['email', 'chat'] },
    { regex: /\b(as per my last email)\b/gi, msg: 'This can sound passive-aggressive. Try "as I mentioned" or restate the point.', fix: 'as I mentioned', title: 'Passive-aggressive', modes: ['email', 'chat'] },
    { regex: /\b(as previously stated)\b/gi, msg: 'This can sound curt. Try restating the point directly.', fix: null, title: 'Passive-aggressive', modes: ['email', 'chat'] },
    { regex: /\b(I think maybe)\b/gi, msg: 'Pick one: "I think" or "maybe" \u2014 both together sounds unsure.', fix: 'I think', title: 'Over-hedging', modes: ['email', 'chat'] },
    { regex: /\b(I was wondering if you could)\b/gi, msg: 'Be direct: "Could you" or "Please" works better.', fix: 'Could you', title: 'Indirect request', modes: ['email', 'chat'] },
    { regex: /\b(does that make sense)\b/gi, msg: 'This can undermine your point. Try "let me know if you have questions".', fix: 'let me know if you have questions', title: 'Self-undermining', modes: ['email', 'chat'] },
    { regex: /\b(please advise)\b/gi, msg: 'Try "let me know" or ask a specific question instead.', fix: 'let me know', title: 'Stiff phrasing', modes: ['email', 'chat'] },
    { regex: /\b(please do not hesitate to)\b/gi, msg: 'Simpler: "feel free to" or just ask directly.', fix: 'feel free to', title: 'Overly formal', modes: ['email', 'chat'] },
    { regex: /\b(I hope this email finds you well)\b/gi, msg: 'This is filler \u2014 jump straight to the point.', fix: null, title: 'Filler phrase', modes: ['email'] },
    { regex: /\b(ASAP)\b/g, msg: 'Give a specific deadline instead of "ASAP" \u2014 it creates urgency without clarity.', fix: null, title: 'Vague urgency', modes: ['email', 'chat'] },
    { regex: /\b(FYI)\b/g, msg: 'In formal emails, write "for your information" or just provide the context.', fix: null, title: 'Too casual', modes: ['email'] }
  ];

  function checkToneContextual(text) {
    var results = [];
    TONE_PATTERNS.forEach(function (entry) {
      if (entry.modes && entry.modes.indexOf(currentMode) === -1) return;
      entry.regex.lastIndex = 0;
      var match;
      while ((match = entry.regex.exec(text)) !== null) {
        var suggestion = {
          id: makeId(),
          ruleId: 'tone',
          source: 'ai',
          group: 'clarity',
          category: 'Tone',
          start: match.index,
          end: match.index + match[0].length,
          message: entry.msg,
          title: entry.title,
          original: match[0]
        };
        if (entry.fix) suggestion.replacement = entry.fix;
        results.push(suggestion);
      }
    });
    return results;
  }

  // ========== Paragraph length check ==========

  /**
   * GOV.UK recommends short paragraphs (ideally 2-3 sentences, max 5).
   * Long paragraphs are harder to read on screen.
   */
  function checkParagraphLength(text) {
    var results = [];
    var paragraphs = text.split(/\n\s*\n/);
    var searchFrom = 0;

    paragraphs.forEach(function (para) {
      var trimmed = para.trim();
      if (!trimmed) {
        return;
      }

      var paraPos = text.indexOf(para, searchFrom);
      if (paraPos >= 0) {
        searchFrom = paraPos + para.length;
      }

      // Count sentences (rough: split on . ! ?)
      var sentences = trimmed.split(/[.!?]+/).filter(function (s) {
        return s.trim().length > 5; // ignore very short fragments
      });

      if (sentences.length > 5) {
        var paraStart = text.indexOf(trimmed, paraPos >= 0 ? paraPos : 0);
        if (paraStart >= 0) {
          results.push({
            id: makeId(),
            ruleId: 'paragraph-length',
            source: 'ai',
            group: 'clarity',
            category: 'Readability',
            start: paraStart,
            end: paraStart + Math.min(trimmed.length, 60),
            message: 'This paragraph has ' + sentences.length + ' sentences. GOV.UK recommends keeping paragraphs to 2\u20133 sentences (5 max) for readability.',
            title: 'Long paragraph',
            original: trimmed.substring(0, 40) + '...'
          });
        }
      }
    });

    return results;
  }

  /**
   * Local simulation of AI checks for GOV.UK style issues.
   * This provides useful checks without needing an API.
   */
  function runSimulation(text, callback) {
    setTimeout(function () {
      var results = [];

      // Checks for: link text, first person (GOV.UK)
      // NOTE: sentence length, passive voice, dates, contractions, numbers,
      // and GOV.UK style patterns are now in quick-checks.js for instant feedback.

      // Check for "click here" and poor link text
      var linkPatterns = [
        { regex: /\bclick here\b/gi, msg: 'Avoid "click here" — use descriptive link text instead' },
        { regex: /\bhere\b(?=\s*<|\s*\(http)/gi, msg: 'Avoid using "here" as link text — describe the destination' }
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

      // First person "I" check (only in govuk mode, kept in full check as it's noisy)
      if (currentMode === 'govuk') {
        var firstPersonRegex = /\bI\b/g;
        var fpMatch;
        while ((fpMatch = firstPersonRegex.exec(text)) !== null) {
          results.push({
            id: makeId(),
            ruleId: 'govuk-style',
            source: 'ai',
            group: 'clarity',
            category: 'GOV.UK style',
            start: fpMatch.index,
            end: fpMatch.index + 1,
            message: 'Avoid "I" in GOV.UK content. Use "we" for the organisation, or rephrase.',
            title: 'Avoid first person',
            original: 'I'
          });
        }
      }

      // Email/chat tone checks (only in email/chat modes)
      if (currentMode === 'email' || currentMode === 'chat') {
        var emailTonePatterns = [
          { regex: /\b(pursuant to|hereunder|herewith|aforementioned|hereinafter)\b/gi, msg: 'Too formal for ' + (currentMode === 'chat' ? 'a message' : 'an email') + '. Use simpler language.', title: 'Overly formal' },
          { regex: /\b(I would like to take this opportunity to)\b/gi, msg: 'This is filler. Get straight to the point.', title: 'Filler phrase' },
          { regex: /\b(it has come to my attention that)\b/gi, msg: 'Sounds bureaucratic. Just say what you noticed.', title: 'Stiff phrasing' },
          { regex: /\b(I regret to inform you that)\b/gi, msg: 'Be direct but kind. Try "Unfortunately" or just state the situation.', title: 'Overly formal' },
          { regex: /\b(at your earliest convenience)\b/gi, msg: 'Give a specific date or timeframe instead.', title: 'Vague timing' },
          { regex: /\b(to whom it may concern)\b/gi, msg: 'Use the person\'s name if you can.', title: 'Impersonal greeting' }
        ];
        emailTonePatterns.forEach(function (pat) {
          var match;
          while ((match = pat.regex.exec(text)) !== null) {
            results.push({
              id: makeId(),
              ruleId: 'email-tone',
              source: 'ai',
              group: 'clarity',
              category: 'Tone',
              start: match.index,
              end: match.index + match[0].length,
              message: pat.msg,
              title: pat.title,
              original: match[0]
            });
          }
        });

        // Chat-specific: flag overly long messages
        if (currentMode === 'chat') {
          var wordCount = (text.match(/\b\w+\b/g) || []).length;
          if (wordCount > 150) {
            results.push({
              id: makeId(),
              ruleId: 'chat-length',
              source: 'ai',
              group: 'clarity',
              category: 'Length',
              start: 0,
              end: Math.min(text.length, 50),
              message: 'This is ' + wordCount + ' words. Messages work best under 150 words \u2014 break it up or send it as an email instead.',
              title: 'Message too long',
              original: text.substring(0, 40) + '...'
            });
          }
        }
      }

      // Contextual checks — these need judgment, so only run via "Check now"
      var passiveResults = checkPassiveVoice(text);
      results = results.concat(passiveResults);

      var sentenceLengthResults = checkSentenceLengthContextual(text);
      results = results.concat(sentenceLengthResults);

      var toneResults = checkToneContextual(text);
      results = results.concat(toneResults);

      // Check for overused words (3+ occurrences, excluding common words)
      var overusedResults = checkOverusedWords(text);
      results = results.concat(overusedResults);

      // Check paragraph length (GOV.UK recommends short paragraphs)
      if (currentMode === 'govuk') {
        var paraResults = checkParagraphLength(text);
        results = results.concat(paraResults);
      }

      // Sort by document order
      results.sort(function (a, b) { return a.start - b.start; });

      isRunning = false;
      callback(results, null);
    }, 800); // Simulate slight delay
  }

  // ========== Shared API call helper ==========

  /**
   * Send a prompt to the configured LLM and return the text response.
   * Handles both Anthropic and Gemini API formats.
   * @param {string} prompt - The user prompt
   * @param {function} callback - callback(responseText, error)
   * @param {object} [options] - { timeout: ms }
   */
  function callAPI(prompt, callback, options) {
    if (config.useSimulation || !config.apiEndpoint || !config.apiKey) {
      callback(null, 'no-api');
      return;
    }
    if (isAllowanceExhausted()) {
      callback(null, 'allowance-exhausted');
      return;
    }

    var timeout = (options && options.timeout) || 30000;
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, timeout);

    var url, headers, body;

    if (config.provider === 'gemini') {
      // Google AI Studio / Gemini API
      url = config.apiEndpoint + '/models/' + config.model + ':generateContent?key=' + encodeURIComponent(config.apiKey);
      headers = { 'Content-Type': 'application/json' };
      body = JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2048 }
      });
    } else {
      // Anthropic Claude API (default)
      url = config.apiEndpoint;
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      };
      body = JSON.stringify({
        model: config.model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      });
    }

    fetch(url, {
      method: 'POST',
      headers: headers,
      signal: controller.signal,
      body: body
    })
    .then(function (response) {
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error('API error: ' + response.status);
      return response.json();
    })
    .then(function (data) {
      var text;
      if (config.provider === 'gemini') {
        // Gemini response format
        text = data.candidates && data.candidates[0] &&
               data.candidates[0].content && data.candidates[0].content.parts &&
               data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
      } else {
        // Anthropic response format
        text = data.content && data.content[0] && data.content[0].text;
      }
      if (!text) {
        callback(null, 'Empty response from AI');
        return;
      }
      recordUsage();
      callback(text, null);
    })
    .catch(function (err) {
      clearTimeout(timeoutId);
      var msg = err.name === 'AbortError' ? 'Request timed out' : err.message;
      callback(null, msg);
    });
  }

  /**
   * Run via external API.
   */
  function runAPI(text, callback) {
    var modeDesc = currentMode === 'govuk' ? 'GOV.UK government content' :
                   currentMode === 'email' ? 'professional email' : 'Slack/Teams message';

    var prompt = 'You are a writing style checker for ' + modeDesc + '. Analyse the following text and return a JSON array of issues.\n\n' +
      'For each issue:\n' +
      '- Reference the EXACT problematic phrase in the message\n' +
      '- Explain WHY it is a problem in this context (1 sentence, under 25 words)\n' +
      '- Provide a concrete rewrite in the replacement field\n\n' +
      'Check for:\n' +
      '- Style violations and unclear phrasing\n' +
      '- Sentence length over 25 words\n' +
      '- Passive voice\n' +
      '- Poor link text like "click here"\n' +
      '- Tone issues\n\n' +
      'Return a JSON array where each item has:\n' +
      '- category: one of "Style", "Sentence length", "Links", "Passive voice", "Tone", "Clarity"\n' +
      '- start: character offset start\n' +
      '- end: character offset end\n' +
      '- message: contextual explanation referencing the specific text\n' +
      '- title: short title (2-4 words)\n' +
      '- original: the problematic text\n' +
      '- replacement: suggested fix (REQUIRED)\n\n' +
      'Return ONLY the JSON array, no other text.\n\n' +
      'Text to check:\n\n' + text;

    callAPI(prompt, function (responseText, error) {
      if (error) {
        isRunning = false;
        callback(null, error);
        return;
      }

      // Parse the JSON from the response
      var jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        isRunning = false;
        callback([], null);
        return;
      }

      var issues;
      try {
        issues = JSON.parse(jsonMatch[0]);
      } catch (parseErr) {
        isRunning = false;
        callback(null, 'Failed to parse AI response');
        return;
      }
      var results = [];
      issues.forEach(function (issue) {
        if (typeof issue.start !== 'number' || typeof issue.end !== 'number' ||
            issue.start < 0 || issue.end > text.length || issue.start >= issue.end) return;
        var actualText = text.substring(issue.start, issue.end);
        if (issue.original && actualText !== issue.original) return;
        results.push({
          id: makeId(),
          ruleId: 'ai-' + (issue.category || 'general').toLowerCase().replace(/\s+/g, '-'),
          source: 'ai',
          group: 'clarity',
          category: issue.category || 'Style',
          start: issue.start,
          end: issue.end,
          message: issue.message || '',
          title: issue.title || 'Style issue',
          original: issue.original || '',
          replacement: issue.replacement,
          aiEnhanced: true
        });
      });

      results.sort(function (a, b) { return a.start - b.start; });
      isRunning = false;
      callback(results, null);
    });
  }

  // ========== Tone rewrite ==========

  var TONE_PROMPTS = {
    govuk: 'Rewrite in GOV.UK style: clear, direct, no jargon, address the reader as "you", active voice, short sentences (under 25 words). Follow the GOV.UK style guide.',
    plain: 'Rewrite in Plain English: short sentences, common everyday words, active voice, reading age 9. Remove all jargon and technical terms.',
    email: 'Rewrite as a friendly professional email: warm but clear, conversational tone, contractions are fine. Keep it concise.',
    chat: 'Rewrite as a brief Slack/Teams message: concise, casual, under 100 words. Get straight to the point.'
  };

  function rewriteTone(text, targetTone, callback) {
    if (!hasValidConfig()) {
      callback(null, 'no-api');
      return;
    }
    var prompt = 'Rewrite the following text.\n\n' +
      'Style: ' + (TONE_PROMPTS[targetTone] || TONE_PROMPTS.plain) + '\n\n' +
      'Return ONLY the rewritten text. No preamble, no explanation, no quotes.\n\n' +
      'Text:\n\n' + text;

    callAPI(prompt, function (responseText, error) {
      if (error) {
        callback(null, error);
        return;
      }
      // Strip any wrapping quotes the model might add
      var cleaned = (responseText || '').trim().replace(/^["']|["']$/g, '');
      callback(cleaned, null);
    });
  }

  // ========== AI rule generation ==========

  function generateRule(description, existingPhrases, callback) {
    if (!hasValidConfig()) {
      callback(null, 'no-api');
      return;
    }
    var prompt = 'Convert this plain English description into a writing style rule.\n\n' +
      'Return JSON only: { "phrase": "word or phrase to flag", "replacement": "suggested fix or null", "message": "short explanation" }\n\n' +
      'Existing rules already flag these phrases (do NOT duplicate): ' +
      (existingPhrases.length > 0 ? existingPhrases.join(', ') : 'none') + '\n\n' +
      'If the described rule duplicates an existing one, return: { "duplicate": true, "existingPhrase": "the matching phrase" }\n\n' +
      'Description: ' + description;

    callAPI(prompt, function (responseText, error) {
      if (error) {
        callback(null, error);
        return;
      }
      // Extract JSON from response
      var jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        callback(null, 'Could not parse AI response');
        return;
      }
      try {
        var result = JSON.parse(jsonMatch[0]);
        callback(result, null);
      } catch (e) {
        callback(null, 'Could not parse AI response');
      }
    });
  }

  /**
   * Configure the API endpoint.
   */
  function configure(options) {
    ['provider', 'apiEndpoint', 'apiKey', 'model', 'useSimulation'].forEach(function(k) {
      if (k in options) config[k] = options[k];
    });
  }

  function getIsRunning() {
    return isRunning;
  }

  function setMode(mode) {
    currentMode = mode;
  }

  // ========== AI Allowance tracking ==========

  var ALLOWANCE_KEY = 'govuk-wa-ai-allowance';
  var DEFAULT_DAILY_LIMIT = 120;

  function loadAllowance() {
    try {
      var stored = localStorage.getItem(ALLOWANCE_KEY);
      if (stored) {
        var data = JSON.parse(stored);
        // Check if reset time has passed
        if (data.resetAt && new Date(data.resetAt) <= new Date()) {
          return resetAllowance();
        }
        return data;
      }
    } catch (e) {}
    return resetAllowance();
  }

  function resetAllowance() {
    var now = new Date();
    var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    var data = {
      used: 0,
      limit: DEFAULT_DAILY_LIMIT,
      resetAt: tomorrow.toISOString()
    };
    try {
      localStorage.setItem(ALLOWANCE_KEY, JSON.stringify(data));
    } catch (e) {}
    return data;
  }

  function saveAllowance(data) {
    try {
      localStorage.setItem(ALLOWANCE_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function recordUsage() {
    var data = loadAllowance();
    data.used = Math.min(data.used + 1, data.limit);
    saveAllowance(data);
    return data;
  }

  function getAllowance() {
    return loadAllowance();
  }

  function isAllowanceExhausted() {
    var data = loadAllowance();
    return data.used >= data.limit;
  }

  // Load config from localStorage on init
  loadConfig();

  return {
    run: run,
    isAllowed: isAllowed,
    configure: configure,
    getIsRunning: getIsRunning,
    setMode: setMode,
    getAllowance: getAllowance,
    recordUsage: recordUsage,
    isAllowanceExhausted: isAllowanceExhausted,
    loadConfig: loadConfig,
    saveConfig: saveConfig,
    getConfig: getConfig,
    hasValidConfig: hasValidConfig,
    getProviders: function () { return PROVIDERS; },
    rewriteTone: rewriteTone,
    generateRule: generateRule,
    callAPI: callAPI
  };
})();
