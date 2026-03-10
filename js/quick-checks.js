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
   * Pre-expanded word set for spell-checking (British English).
   * Contains ~88k fully-inflected word forms — no affix processing needed.
   */
  var wordSet = null;
  var dictLoading = false;
  var dictLoaded = false;
  var dictRetries = 0;
  var MAX_RETRIES = 3;

  /**
   * BK-tree for fast fuzzy matching / spelling suggestions.
   * Stores words organised by edit distance for O(log n) suggestion lookup.
   */
  var bkTree = null;

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    // Optimised single-row DP
    var prev = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var curr = [i];
      for (var j = 1; j <= b.length; j++) {
        var cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(
          curr[j - 1] + 1,      // insertion
          prev[j] + 1,          // deletion
          prev[j - 1] + cost    // substitution
        );
      }
      prev = curr;
    }
    return prev[b.length];
  }

  /**
   * Build a BK-tree from a sample of the word set for fast suggestions.
   * We sample common-length words (4-10 chars) to keep the tree manageable.
   */
  function buildBKTree(words) {
    if (!words || words.length === 0) return null;
    var root = { word: words[0], children: {} };
    for (var i = 1; i < words.length; i++) {
      insertBK(root, words[i]);
    }
    return root;
  }

  function insertBK(node, word) {
    var d = levenshtein(node.word, word);
    if (d === 0) return; // duplicate
    if (node.children[d]) {
      insertBK(node.children[d], word);
    } else {
      node.children[d] = { word: word, children: {} };
    }
  }

  function searchBK(node, word, maxDist, results, limit) {
    if (!node || results.length >= limit) return;
    var d = levenshtein(node.word, word);
    if (d <= maxDist) {
      results.push({ word: node.word, dist: d });
    }
    // Only visit children within the triangle inequality bounds
    var lo = d - maxDist;
    var hi = d + maxDist;
    var keys = Object.keys(node.children);
    for (var i = 0; i < keys.length; i++) {
      var k = parseInt(keys[i], 10);
      if (k >= lo && k <= hi) {
        searchBK(node.children[k], word, maxDist, results, limit);
      }
    }
  }

  function loadDictionary() {
    if (dictLoading || dictLoaded) return;
    dictLoading = true;

    fetch('dictionaries/words.txt').then(function (r) {
      if (!r.ok) throw new Error('words.txt returned HTTP ' + r.status);
      return r.text();
    }).then(function (data) {
      var lines = data.split('\n');
      wordSet = new Set();
      for (var i = 0; i < lines.length; i++) {
        var w = lines[i].trim();
        if (w) wordSet.add(w);
      }
      console.log('[QuickChecks] Word list loaded: ' + wordSet.size + ' words');

      // Build BK-tree from a sample of words (4-10 chars) for suggestions
      // Sampling keeps memory and build time reasonable
      var sampleWords = [];
      var iter = wordSet.values();
      var entry;
      while ((entry = iter.next()) && !entry.done) {
        var w = entry.value;
        if (w.length >= 3 && w.length <= 12) {
          sampleWords.push(w);
        }
      }
      // Shuffle and take up to 30k for the BK-tree (covers most common words)
      if (sampleWords.length > 30000) {
        // Fisher-Yates partial shuffle
        for (var i = sampleWords.length - 1; i > 0 && i > sampleWords.length - 30001; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var tmp = sampleWords[i];
          sampleWords[i] = sampleWords[j];
          sampleWords[j] = tmp;
        }
        sampleWords = sampleWords.slice(0, 30000);
      }
      bkTree = buildBKTree(sampleWords);
      console.log('[QuickChecks] BK-tree built with ' + sampleWords.length + ' words for suggestions');

      dictLoaded = true;
      dictLoading = false;
      document.dispatchEvent(new CustomEvent('typo-dictionary-loaded'));
    }).catch(function (err) {
      console.warn('[QuickChecks] Failed to load word list (attempt ' + (dictRetries + 1) + '):', err);
      dictLoading = false;
      if (dictRetries < MAX_RETRIES) {
        var delay = Math.pow(2, dictRetries) * 1000;
        dictRetries++;
        setTimeout(loadDictionary, delay);
      } else {
        console.warn('[QuickChecks] Dictionary loading failed after all retries — spelling will use common misspellings + heuristics only');
        dictLoaded = true;
        document.dispatchEvent(new CustomEvent('typo-dictionary-loaded'));
      }
    });
  }

  // Start loading dictionary immediately
  loadDictionary();

  /**
   * Words to skip during spell checking — short common words,
   * abbreviations, and patterns that aren't real misspellings.
   */
  var SKIP_WORDS = new Set([
    'i', 'a', 'ok', 'vs', 'eg', 'ie', 'uk', 'eu', 'hr', 'id',
    'pm', 'am', 'cv', 'qa', 'jr', 'sr', 'mr', 'ms', 'dr', 'st',
    'nd', 'rd', 'th', 'gov', 'www', 'http', 'https', 'html', 'css',
    'pdf', 'doc', 'csv', 'url', 'api', 'btn', 'img', 'src', 'div',
    // Government departments and agencies
    'hmrc', 'dvla', 'nhs', 'moj', 'dwp', 'hmcts', 'defra',
    'apha', 'rpa', 'mmo', 'cefas', 'jncc', 'ofsted', 'ofgem',
    'ofcom', 'dfe', 'dhsc', 'dcms', 'beis', 'fcdo', 'mod',
    'dft', 'dluhc', 'ho', 'co', 'gds', 'ons',
    // Common GOV.UK / Defra terms
    'sfi', 'bps', 'elms', 'elm', 'sssi', 'sac', 'spa', 'lnr',
    'eia', 'sea', 'habitats', 'brp', 'rle', 'oifm',
    'intranet', 'stakeholder', 'stakeholders',
    'biodiversity', 'catchment', 'waterbody', 'waterbodies',
    'hedgerow', 'hedgerows', 'agri-environment',
    // Days and months
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ]);

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
    'calander': 'calendar',
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
    'dependance': 'dependence',
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
    'practize': 'practise',
    'preceeding': 'preceding',
    'privelege': 'privilege',
    'proffesional': 'professional',
    'profesional': 'professional',
    'publically': 'publicly',
    'recomend': 'recommend',
    'recieve': 'receive',
    'refered': 'referred',
    'relevent': 'relevant',
    'reoccured': 'recurred',
    'reponsible': 'responsible',
    'resourse': 'resource',
    'responsibilty': 'responsibility',
    'sieze': 'seize',
    'seperate': 'separate',
    'sincerly': 'sincerely',
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
    'whetehr': 'whether',
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
    'couldnt': "couldn't",
    // Fast-typing / keyboard slip typos
    'thks': 'thanks',
    'thnks': 'thanks',
    'thankyou': 'thank you',
    'thx': 'thanks',
    'shpping': 'shipping',
    'shping': 'shipping',
    'shoping': 'shopping',
    'shoppping': 'shopping',
    'ot': 'to', // 2-char but "ot" isn't a real word
    'fo': 'of',
    'nad': 'and',
    'foir': 'for',
    'fom': 'from',
    'frm': 'from',
    'wiht': 'with',
    'wtih': 'with',
    'htat': 'that',
    'thsi': 'this',
    'htis': 'this',
    'tihs': 'this',
    'jsut': 'just',
    'juts': 'just',
    'liek': 'like',
    'lkie': 'like',
    'abuot': 'about',
    'abotu': 'about',
    'whne': 'when',
    'wehn': 'when',
    'hwen': 'when',
    'thna': 'than',
    'tahn': 'than',
    'tehn': 'then',
    'htey': 'they',
    'tehy': 'they',
    'thye': 'they',
    'fomr': 'from',
    'lsit': 'list',
    'lits': 'list',
    'oen': 'one',
    'ont': 'not',
    'yoru': 'your',
    'yuor': 'your',
    'youre': "you're",
    'thats': "that's",
    'whats': "what's",
    'heres': "here's",
    'theres': "there's",
    'weve': "we've",
    'theyre': "they're",
    'youve': "you've",
    'youll': "you'll",
    'theyll': "they'll",
    'wll': "we'll",
    'itll': "it'll",
    'ive': "I've",
    'wer': 'were',
    'wre': 'were',
    'whre': 'where',
    'ther': 'there',
    'theri': 'their',
    'tehir': 'their',
    'beign': 'being',
    'bieng': 'being',
    'beeing': 'being',
    'comign': 'coming',
    'goign': 'going',
    'havign': 'having',
    'makign': 'making',
    'takign': 'taking',
    'usign': 'using',
    'gievn': 'given',
    'knwo': 'know',
    'konw': 'know',
    'nkow': 'know',
    'wrok': 'work',
    'owrk': 'work',
    'peolpe': 'people',
    'peopel': 'people',
    'poeple': 'people',
    'cahnge': 'change',
    'chnage': 'change',
    'chagne': 'change',
    'plase': 'please',
    'plsea': 'please',
    'pleae': 'please',
    'pls': 'please',
    'sicne': 'since',
    'snce': 'since',
    'udpate': 'update',
    'upadte': 'update',
    'updaet': 'update',
    'nede': 'need',
    'neeed': 'need',
    'aslo': 'also',
    'alsi': 'also',
    'soem': 'some',
    'smoe': 'some',
    'cna': 'can',
    'evne': 'even',
    'evrey': 'every',
    'eveyr': 'every',
    'porblem': 'problem',
    'probelm': 'problem',
    'problme': 'problem',
    'acess': 'access',
    'acccess': 'access',
    'buidl': 'build',
    'bulid': 'build',
    'chekc': 'check',
    'chedk': 'check',
    'contnet': 'content',
    'contetn': 'content',
    'detials': 'details',
    'deatils': 'details',
    'detilas': 'details',
    'emial': 'email',
    'eamil': 'email',
    'meial': 'email',
    'entier': 'entire',
    'exapmle': 'example',
    'exmaple': 'example',
    'exampel': 'example',
    'frist': 'first',
    'fisrt': 'first',
    'formt': 'format',
    'gorund': 'ground',
    'incldue': 'include',
    'inclue': 'include',
    'inlcude': 'include',
    'isssue': 'issue',
    'isue': 'issue',
    'isseu': 'issue',
    'lnk': 'link',
    'lnik': 'link',
    'manay': 'many',
    'mnay': 'many',
    'msut': 'must',
    'muts': 'must',
    'nmae': 'name',
    'naem': 'name',
    'oepn': 'open',
    'opne': 'open',
    'paeg': 'page',
    'pgae': 'page',
    'plna': 'plan',
    'palne': 'plane',
    'pubilsh': 'publish',
    'publsih': 'publish',
    'raed': 'read',
    'rela': 'real',
    'rigth': 'right',
    'rihgt': 'right',
    'saem': 'same',
    'smae': 'same',
    'sned': 'send',
    'sedn': 'send',
    'shwo': 'show',
    'hsow': 'show',
    'szie': 'size',
    'tiem': 'time',
    'tima': 'time',
    'udner': 'under',
    'undedr': 'under',
    'veyr': 'very',
    'vrey': 'very',
    'wnat': 'want',
    'awnt': 'want',
    'wyas': 'ways',
    'whihc': 'which',
    'wihch': 'which',
    'iwth': 'with',
    'wrods': 'words',
    'owrds': 'words',
    'wrtie': 'write',
    'wirte': 'write',
    // More transposed / dropped-letter typos for common words
    'baout': 'about',
    'aften': 'after',
    'aftre': 'after',
    'agian': 'again',
    'aginst': 'against',
    'alraedy': 'already',
    'alredy': 'already',
    'alwyas': 'always',
    'alwasy': 'always',
    'amoutn': 'amount',
    'anohter': 'another',
    'antoher': 'another',
    'anythign': 'anything',
    'anyhting': 'anything',
    'aroud': 'around',
    'aroudn': 'around',
    'avilable': 'available',
    'avialable': 'available',
    'availble': 'available',
    'avaialble': 'available',
    'becasue': 'because',
    'becuaes': 'because',
    'beacuse': 'because',
    'befoer': 'before',
    'befroe': 'before',
    'bewteen': 'between',
    'betwen': 'between',
    'beyodn': 'beyond',
    'borwser': 'browser',
    'busines': 'business',
    'buiness': 'business',
    'busniess': 'business',
    'claer': 'clear',
    'clera': 'clear',
    'colse': 'close',
    'cloase': 'close',
    'comapny': 'company',
    'compnay': 'company',
    'comapre': 'compare',
    'compleet': 'complete',
    'compelte': 'complete',
    'confrm': 'confirm',
    'confrim': 'confirm',
    'consier': 'consider',
    'considr': 'consider',
    'contian': 'contain',
    'conatin': 'contain',
    'contniu': 'continue',
    'contineu': 'continue',
    'contorl': 'control',
    'cnotrol': 'control',
    'corect': 'correct',
    'correc': 'correct',
    'craete': 'create',
    'cretae': 'create',
    'creat': 'create',
    'currnet': 'current',
    'curent': 'current',
    'curren': 'current',
    'daet': 'date',
    'dael': 'deal',
    'descirbe': 'describe',
    'desgin': 'design',
    'deisng': 'design',
    'develp': 'develop',
    'devlop': 'develop',
    'diretc': 'direct',
    'dicuss': 'discuss',
    'disucss': 'discuss',
    'documnet': 'document',
    'docuemnt': 'document',
    'doucment': 'document',
    'donw': 'down',
    'dwon': 'down',
    'duirng': 'during',
    'druing': 'during',
    'easliy': 'easily',
    'ealry': 'early',
    'eidtor': 'editor',
    'ediotr': 'editor',
    'enabl': 'enable',
    'enabel': 'enable',
    'enoguh': 'enough',
    'enouhg': 'enough',
    'esnure': 'ensure',
    'ensrue': 'ensure',
    'envrionment': 'environment',
    'evironemnt': 'environment',
    'esimate': 'estimate',
    'estiamte': 'estimate',
    'excpet': 'except',
    'expcet': 'expect',
    'expetc': 'expect',
    'explian': 'explain',
    'fianl': 'final',
    'finla': 'final',
    'fidn': 'find',
    'fnid': 'find',
    'folowing': 'following',
    'follwoing': 'following',
    'genearl': 'general',
    'generla': 'general',
    'givne': 'given',
    'gerat': 'great',
    'graet': 'great',
    'gropu': 'group',
    'gourp': 'group',
    'grdoup': 'group',
    'haev': 'have',
    'hvae': 'have',
    'heigth': 'height',
    'hieght': 'height',
    'hihg': 'high',
    'hgih': 'high',
    'howver': 'however',
    'howevr': 'however',
    'imapct': 'impact',
    'impcat': 'impact',
    'importnat': 'important',
    'importan': 'important',
    'impotant': 'important',
    'includ': 'include',
    'inculde': 'include',
    'indciate': 'indicate',
    'inicdate': 'indicate',
    'informaton': 'information',
    'informatoin': 'information',
    'interset': 'interest',
    'interst': 'interest',
    'itme': 'item',
    'iems': 'items',
    'kepe': 'keep',
    'kep': 'keep',
    'langauge': 'language',
    'languge': 'language',
    'larg': 'large',
    'alrge': 'large',
    'lsat': 'last',
    'laest': 'least',
    'leaset': 'least',
    'leav': 'leave',
    'leaev': 'leave',
    'levle': 'level',
    'lveel': 'level',
    'liley': 'likely',
    'likley': 'likely',
    'loacl': 'local',
    'lcaol': 'local',
    'lnog': 'long',
    'logn': 'long',
    'loook': 'look',
    'loko': 'look',
    'mian': 'main',
    'maek': 'make',
    'mkae': 'make',
    'manag': 'manage',
    'mangae': 'manage',
    'meeitng': 'meeting',
    'meetign': 'meeting',
    'metnion': 'mention',
    'mentoin': 'mention',
    'mesage': 'message',
    'messgae': 'message',
    'messge': 'message',
    'mehtod': 'method',
    'mehod': 'method',
    'mgiht': 'might',
    'mihgt': 'might',
    'modle': 'model',
    'moent': 'moment',
    'moemnt': 'moment',
    'moeny': 'money',
    'mnoney': 'money',
    'motnh': 'month',
    'monht': 'month',
    'mroe': 'more',
    'moer': 'more',
    'movign': 'moving',
    'muhc': 'much',
    'mcuh': 'much',
    'natioanl': 'national',
    'natioal': 'national',
    'natrual': 'natural',
    'nautral': 'natural',
    'nevr': 'never',
    'nver': 'never',
    'nwe': 'new',
    'enw': 'new',
    'nxet': 'next',
    'netx': 'next',
    'nubmer': 'number',
    'numbre': 'number',
    'numbr': 'number',
    'offfer': 'offer',
    'offre': 'offer',
    'onyl': 'only',
    'olny': 'only',
    'otehr': 'other',
    'ohter': 'other',
    'outptu': 'output',
    'ouput': 'output',
    'outisde': 'outside',
    'outsdie': 'outside',
    'overal': 'overall',
    'ovrall': 'overall',
    'aprt': 'part',
    'pasrt': 'parts',
    'payemnt': 'payment',
    'paymnet': 'payment',
    'perioud': 'period',
    'peroid': 'period',
    'perosn': 'person',
    'persom': 'person',
    'palce': 'place',
    'plcae': 'place',
    'poitn': 'point',
    'ponit': 'point',
    'poewr': 'power',
    'powr': 'power',
    'presetnt': 'present',
    'rpesent': 'present',
    'priavte': 'private',
    'prviate': 'private',
    'probelms': 'problems',
    'procss': 'process',
    'porcess': 'process',
    'prodcut': 'product',
    'proudct': 'product',
    'proejct': 'project',
    'projcet': 'project',
    'proejcts': 'projects',
    'provdie': 'provide',
    'porvide': 'provide',
    'pubilc': 'public',
    'pulbic': 'public',
    'purose': 'purpose',
    'purpsoe': 'purpose',
    'quesiton': 'question',
    'questoin': 'question',
    'qustion': 'question',
    'quikc': 'quick',
    'qucik': 'quick',
    'quicly': 'quickly',
    'quckly': 'quickly',
    'reahc': 'reach',
    'reasn': 'reason',
    'reaosn': 'reason',
    'repalce': 'replace',
    'replce': 'replace',
    'reoprt': 'report',
    'reprot': 'report',
    'requier': 'require',
    'requrie': 'require',
    'repsond': 'respond',
    'resonpd': 'respond',
    'respone': 'response',
    'respones': 'response',
    'reuslt': 'result',
    'resutl': 'result',
    'reveiw': 'review',
    'reveiew': 'review',
    'rveiw': 'review',
    'ruel': 'rule',
    'rlue': 'rule',
    'savfe': 'save',
    'svae': 'save',
    'sceren': 'screen',
    'screne': 'screen',
    'serach': 'search',
    'serahc': 'search',
    'secton': 'section',
    'sectoin': 'section',
    'selct': 'select',
    'slect': 'select',
    'servce': 'service',
    'serivce': 'service',
    'sevreal': 'several',
    'severla': 'several',
    'shaep': 'shape',
    'shuold': 'should',
    'simlar': 'similar',
    'similiar': 'similar',
    'smiple': 'simple',
    'simpl': 'simple',
    'smaill': 'small',
    'samll': 'small',
    'soical': 'social',
    'socail': 'social',
    'soemthing': 'something',
    'somethign': 'something',
    'somethng': 'something',
    'soemtimes': 'sometimes',
    'sometims': 'sometimes',
    'soruce': 'source',
    'souce': 'source',
    'speicfy': 'specify',
    'specfiy': 'specify',
    'stnadard': 'standard',
    'standrad': 'standard',
    'statr': 'start',
    'strat': 'start',
    'satrt': 'start',
    'statemnt': 'statement',
    'statment': 'statement',
    'stlil': 'still',
    'sitll': 'still',
    'storng': 'strong',
    'stirng': 'string',
    'strnig': 'string',
    'sturcture': 'structure',
    'strucutre': 'structure',
    'subejct': 'subject',
    'suport': 'support',
    'supprot': 'support',
    'suppor': 'support',
    'sysem': 'system',
    'systme': 'system',
    'systm': 'system',
    'tabel': 'table',
    'talbe': 'table',
    'taks': 'task',
    'taeks': 'takes',
    'thnk': 'think',
    'thikn': 'think',
    'thnig': 'thing',
    'thign': 'thing',
    'throuhg': 'through',
    'trhough': 'through',
    'thruogh': 'through',
    'tgoether': 'together',
    'togehter': 'together',
    'togther': 'together',
    'todya': 'today',
    'toaday': 'today',
    'totla': 'total',
    'toatl': 'total',
    'trian': 'train',
    'tpye': 'type',
    'tyep': 'type',
    'understnad': 'understand',
    'undersatnd': 'understand',
    'udnerstand': 'understand',
    'untli': 'until',
    'unitl': 'until',
    'uise': 'use',
    'uesd': 'used',
    'usde': 'used',
    'uesr': 'user',
    'uers': 'user',
    'ueser': 'user',
    'vlaue': 'value',
    'valeu': 'value',
    'veiw': 'view',
    'viwe': 'view',
    'vistit': 'visit',
    'watn': 'want',
    'wehre': 'where',
    'wheer': 'where',
    'whiel': 'while',
    'whlile': 'while',
    'whoel': 'whole',
    'wholee': 'whole',
    'widht': 'width',
    'wdith': 'width',
    'iwll': 'will',
    'wlil': 'will',
    'wihtout': 'without',
    'withotu': 'without',
    'wihtin': 'within',
    'witihn': 'within',
    'wordl': 'world',
    'wrold': 'world',
    'woudld': 'would',
    'wuold': 'would',
    'yaer': 'year',
    'yera': 'year',
    // GOV.UK / workplace specific typos
    'aplpy': 'apply',
    'aply': 'apply',
    'appyl': 'apply',
    'applciation': 'application',
    'applciaton': 'application',
    'apporval': 'approval',
    'apprvol': 'approval',
    'asssess': 'assess',
    'asess': 'assess',
    'assesed': 'assessed',
    'asssessed': 'assessed',
    'authoirty': 'authority',
    'authroity': 'authority',
    'beenfit': 'benefit',
    'benfit': 'benefit',
    'beneift': 'benefit',
    'cliam': 'claim',
    'calim': 'claim',
    'compiance': 'compliance',
    'complianec': 'compliance',
    'complaine': 'complaint',
    'comunity': 'community',
    'commuity': 'community',
    'condtion': 'condition',
    'conditon': 'condition',
    'conslut': 'consult',
    'consutl': 'consult',
    'contarct': 'contract',
    'conract': 'contract',
    'coucnil': 'council',
    'concuil': 'council',
    'decalre': 'declare',
    'depatment': 'department',
    'departmnet': 'department',
    'departemnt': 'department',
    'detial': 'detail',
    'deatil': 'detail',
    'digiatl': 'digital',
    'digtial': 'digital',
    'eligble': 'eligible',
    'eligibl': 'eligible',
    'elgiible': 'eligible',
    'employement': 'employment',
    'emplyoment': 'employment',
    'engagment': 'engagement',
    'engagmeent': 'engagement',
    'enquriy': 'enquiry',
    'enqiury': 'enquiry',
    'envrionmental': 'environmental',
    'environemntal': 'environmental',
    'evidnece': 'evidence',
    'eviednce': 'evidence',
    'finacial': 'financial',
    'finanical': 'financial',
    'fianncial': 'financial',
    'framewrok': 'framework',
    'farmeowrk': 'framework',
    'fundign': 'funding',
    'fudning': 'funding',
    'govrenment': 'government',
    'govenrment': 'government',
    'governmnet': 'government',
    'gudiance': 'guidance',
    'guidanec': 'guidance',
    'guidacne': 'guidance',
    'heatlh': 'health',
    'healht': 'health',
    'helath': 'health',
    'identfiy': 'identify',
    'identigy': 'identify',
    'implment': 'implement',
    'impelment': 'implement',
    'imrpove': 'improve',
    'imporve': 'improve',
    'inspcetion': 'inspection',
    'inpsection': 'inspection',
    'invocie': 'invoice',
    'inovice': 'invoice',
    'langague': 'language',
    'legisaltion': 'legislation',
    'legislaiton': 'legislation',
    'legislaton': 'legislation',
    'licecne': 'licence',
    'licnece': 'licence',
    'measrue': 'measure',
    'meausre': 'measure',
    'memebr': 'member',
    'mebmer': 'member',
    'miniser': 'minister',
    'minisrte': 'minister',
    'moitor': 'monitor',
    'monitr': 'monitor',
    'notifiy': 'notify',
    'ntoify': 'notify',
    'oficer': 'officer',
    'offcier': 'officer',
    'organisaiton': 'organisation',
    'organsiation': 'organisation',
    'oranisation': 'organisation',
    'outcoem': 'outcome',
    'outocme': 'outcome',
    'overlal': 'overall',
    'pannle': 'panel',
    'pnael': 'panel',
    'parnter': 'partner',
    'partne': 'partner',
    'penaly': 'penalty',
    'penalyt': 'penalty',
    'pefrorm': 'perform',
    'perfrom': 'perform',
    'perofrm': 'perform',
    'planing': 'planning',
    'plannig': 'planning',
    'poilcy': 'policy',
    'policiy': 'policy',
    'populaiton': 'population',
    'pracitce': 'practice',
    'preapre': 'prepare',
    'prpeare': 'prepare',
    'prioirty': 'priority',
    'priotiry': 'priority',
    'proceure': 'procedure',
    'proceudre': 'procedure',
    'progamme': 'programme',
    'porgramme': 'programme',
    'progarme': 'programme',
    'porgress': 'progress',
    'progres': 'progress',
    'proeprty': 'property',
    'proprety': 'property',
    'prtoect': 'protect',
    'proteect': 'protect',
    'publihs': 'publish',
    'recrod': 'record',
    'reocrd': 'record',
    'redcue': 'reduce',
    'reudce': 'reduce',
    'refernce': 'reference',
    'refrence': 'reference',
    'registr': 'register',
    'regsiter': 'register',
    'regulaiton': 'regulation',
    'regulaton': 'regulation',
    'reqeust': 'request',
    'reuqest': 'request',
    'requets': 'request',
    'reasearch': 'research',
    'researhc': 'research',
    'resposne': 'response',
    'reponse': 'response',
    'repsponse': 'response',
    'safeyt': 'safety',
    'safetly': 'safely',
    'scheudl': 'schedule',
    'scheudle': 'schedule',
    'scehme': 'scheme',
    'shceme': 'scheme',
    'servcies': 'services',
    'serivces': 'services',
    'signficant': 'significant',
    'significnat': 'significant',
    'speicfic': 'specific',
    'spcific': 'specific',
    'specificaiton': 'specification',
    'staemnent': 'statement',
    'staretgy': 'strategy',
    'stratgey': 'strategy',
    'stratehy': 'strategy',
    'submti': 'submit',
    'sumbmit': 'submit',
    'subbmit': 'submit',
    'sumamry': 'summary',
    'summray': 'summary',
    'surevy': 'survey',
    'survye': 'survey',
    'tehcnical': 'technical',
    'techincal': 'technical',
    'technial': 'technical',
    'tempalte': 'template',
    'tmeplate': 'template',
    'trnasfer': 'transfer',
    'tarnfsfer': 'transfer',
    'verisonl': 'version',
    'verison': 'version',
    'vresion': 'version',
    'webiste': 'website',
    'wesbite': 'website',
    'websit': 'website'
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
    { regex: /\b(pacific)\s+(reason|example|issue|case|time|date|detail|requirement)/gi, msg: 'Did you mean "specific"?', fix: 'specific', matchGroup: 1 },
    // --- Additional confused words ---
    { regex: /\b(ensure)\b(?=\s+(?:against|your\s+(?:car|home|house|property|vehicle|building|contents|life|travel)))/gi, msg: 'Did you mean "insure" (to take out insurance)? "Ensure" means to make certain.', fix: 'insure', matchGroup: 1 },
    { regex: /\b(insure)\b(?=\s+(?:that|this|we|you|they|it|the\s+(?:quality|safety|accuracy|success|correct)))/gi, msg: 'Did you mean "ensure" (to make certain)? "Insure" means to take out insurance.', fix: 'ensure', matchGroup: 1 },
    { regex: /\b(compliment)\b(?=\s+(?:to|the|each|one|this))/gi, msg: 'Check: "complement" means to complete/enhance. "Compliment" means praise.', fix: null, matchGroup: 0 },
    { regex: /\b(complement)\b(?=\s+(?:you|her|him|them|me|on))/gi, msg: 'Did you mean "compliment" (praise)? "Complement" means to complete/enhance.', fix: 'compliment', matchGroup: 1 },
    { regex: /\b(principle)\b(?=\s+(?:of|reason|concern|objective|aim|purpose))/gi, msg: '"Principle" is a rule/belief. "Principal" means main/chief. Check which you need.', fix: null, matchGroup: 0 },
    { regex: /\b(principal)\b(?=\s+(?:that|of\s+(?:fairness|equality|justice|law|good)))/gi, msg: 'Did you mean "principle" (a rule/belief)? "Principal" means main/chief.', fix: 'principle', matchGroup: 1 },
    { regex: /\b(stationary)\b(?=\s+(?:shop|cupboard|supplies|order|items|products))/gi, msg: 'Did you mean "stationery" (paper and pens)? "Stationary" means not moving.', fix: 'stationery', matchGroup: 1 },
    { regex: /\b(stationery)\b(?=\s+(?:car|vehicle|bus|train|object|target|position))/gi, msg: 'Did you mean "stationary" (not moving)? "Stationery" means paper and pens.', fix: 'stationary', matchGroup: 1 },
    { regex: /\b(advise)\b(?=\s+(?:on|about|is|was))/gi, msg: 'Check: "advice" (noun) is what you give. "Advise" (verb) is the action of giving it.', fix: null, matchGroup: 0 },
    { regex: /\b(discrete)\b/gi, msg: 'Check: "discrete" means separate/distinct. "Discreet" means careful/unobtrusive.', fix: null, matchGroup: 0 },
    { regex: /\b(lead)\b(?=\s+(?:to\s+(?:a\s+)?(?:increase|decrease|reduction|improvement|change)|the\s+(?:team|project|investigation|inquiry)))/gi, msg: 'Check tense: "led" is past tense. "Lead" is present tense (or a metal).', fix: null, matchGroup: 0 },
    { regex: /\b(who's)\s+((?:car|house|home|bag|phone|idea|fault|job|role|turn|responsibility))\b/gi, msg: 'Did you mean "whose" (belonging to whom)? "Who\'s" means "who is".', fix: "whose", matchGroup: 1 },
    { regex: /\b(whose)\s+((?:going|coming|the|been|there|here|that|this|responsible|available|ready))\b/gi, msg: 'Did you mean "who\'s" (who is)? "Whose" shows possession.', fix: "who's", matchGroup: 1 },
    { regex: /\b(less)\s+(people|items|applicants|applications|employees|users|customers|participants|members|cases|instances|complaints|requests|payments|claims)\b/gi, msg: 'Use "fewer" for countable things. "Less" is for uncountable quantities.', fix: 'fewer', matchGroup: 1 },
    { regex: /\b(amount)\s+of\s+(people|items|applicants|applications|employees|users|customers|participants|members|cases|instances|complaints|requests|payments|claims)\b/gi, msg: 'Use "number of" for countable things. "Amount of" is for uncountable quantities.', fix: 'number', matchGroup: 1 },
    { regex: /\b(bought)\b(?=\s+(?:to|about|in|up|forward|before|into))/gi, msg: 'Did you mean "brought" (past tense of bring)? "Bought" is past tense of buy.', fix: 'brought', matchGroup: 1 },
    { regex: /\b(past)\b(?=\s+(?:the|a|an|it|them|me|him|her|us)\b)/gi, msg: 'Check: "past" is a noun/adjective/preposition. "Passed" is the verb (went past).', fix: null, matchGroup: 0 },
    { regex: /\b(than)\s+(I|he|she|we|they)\s+(went|came|arrived|left|started|began|decided|realised|noticed)\b/gi, msg: 'Did you mean "then" (at that time)? "Than" is for comparisons.', fix: 'then', matchGroup: 1 },
    { regex: /\b(where)\s+((?:I|we|you|they|he|she)\s+(?:can|could|should|would|will|shall|must|need|have|had|want))\b/gi, msg: 'Check: did you mean "were" or "where"? "Where" is about location. "Were" is a past tense verb.', fix: null, matchGroup: 0 },
    { regex: /\b(to)\s+(many|much|few|little|often|late|early|soon|long|fast|slow|big|small|large|hard|soft|loud|quiet)\b(?!\s+(?:of|for|to|in))/gi, msg: 'Did you mean "too" (excessively)? "To" is a preposition.', fix: 'too', matchGroup: 1 }
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
      id: 'missing-letter',
      category: 'Spelling',
      run: checkMissingLetters
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
    },
    {
      id: 'abbreviation-first-use',
      category: 'Style',
      run: checkAbbreviationFirstUse
    },
    {
      id: 'govuk-extra-style',
      category: 'Style',
      run: checkGovukExtraStyle
    },
    {
      id: 'list-formatting',
      category: 'Lists',
      run: checkListFormatting
    },
    // NOTE: sentence-length check removed from quick-checks to avoid duplicates.
    // The full-check module provides a better version with split-point advice.
    // See full-check.js checkSentenceLengthContextual()

  ];

  var idCounter = 0;

  function makeId() {
    return 'qc-' + (++idCounter);
  }

  var MISSING_APOSTROPHE_WORDS = new Set([
    'dont', 'doesnt', 'cant', 'wont', 'didnt', 'isnt',
    'wasnt', 'hasnt', 'hadnt', 'wouldnt', 'shouldnt', 'couldnt'
  ]);

  /**
   * Check for common misspellings.
   * Uses COMMON_MISSPELLINGS for fast known corrections, then falls back
   * to the word list for comprehensive spell-checking.
   */
  function checkSpelling(text) {
    var results = [];
    var wordRegex = /\b[a-zA-Z']+\b/g;
    var match;
    var alreadyFlagged = new Set(); // track positions already flagged

    // Pre-scan: find hyphenated tokens that are in the custom dictionary
    // so their sub-words don't get flagged as misspellings
    var hyphenSkipRanges = new Set();
    var hyphenRegex = /\b[a-zA-Z]+-[a-zA-Z]+(?:-[a-zA-Z]+)*\b/g;
    var hm;
    while ((hm = hyphenRegex.exec(text)) !== null) {
      if (isInCustomDictionary(hm[0])) {
        for (var hi = hm.index; hi < hm.index + hm[0].length; hi++) {
          hyphenSkipRanges.add(hi);
        }
      }
    }

    // Pass 1: known misspellings (fast, high-quality suggestions)
    while ((match = wordRegex.exec(text)) !== null) {
      var word = match[0];
      var lower = word.toLowerCase();
      if (hyphenSkipRanges.has(match.index)) continue;
      if (isInCustomDictionary(word)) continue;
      if (COMMON_MISSPELLINGS[lower]) {
        var replacement = COMMON_MISSPELLINGS[lower];
        if (word[0] === word[0].toUpperCase()) {
          replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
        }
        var isMissingApostrophe = MISSING_APOSTROPHE_WORDS.has(lower);
        results.push({
          id: makeId(),
          ruleId: 'spelling',
          source: 'regex',
          group: 'correctness',
          category: isMissingApostrophe ? 'Punctuation' : 'Spelling',
          start: match.index,
          end: match.index + word.length,
          message: isMissingApostrophe ? 'Missing apostrophe in "' + word + '"' : 'Check the spelling of "' + word + '"',
          title: isMissingApostrophe ? 'Missing apostrophe' : 'Possible spelling mistake',
          replacement: replacement,
          original: word
        });
        alreadyFlagged.add(match.index);
      }
    }

    // Pass 2: Dictionary check (pre-expanded word list)
    var hasDictionary = !!wordSet;
    if (hasDictionary) {
      try {
        wordRegex.lastIndex = 0;
        while ((match = wordRegex.exec(text)) !== null) {
          var word = match[0];
          var lower = word.toLowerCase();

          // Skip if already flagged by pass 1
          if (alreadyFlagged.has(match.index)) continue;
          // Skip words that are part of a hyphenated custom dictionary entry
          if (hyphenSkipRanges.has(match.index)) continue;
          // Skip custom dictionary words
          if (isInCustomDictionary(word)) continue;
          // Skip very short words, abbreviations, and known skip-list
          if (word.length < 2) continue;
          if (SKIP_WORDS.has(lower)) continue;
          // Skip words that are all uppercase (acronyms like DEFRA, APHA, BPS, ELMS)
          if (word === word.toUpperCase() && /^[A-Z]+$/.test(word)) continue;
          // Skip words with apostrophes that are contractions
          if (word.indexOf("'") !== -1) continue;
          // Capitalised words: check the lowercase version instead of skipping entirely
          if (word.length > 1 && word[0] === word[0].toUpperCase() && word[1] === word[1].toLowerCase()) {
            if (checkWordValid(word.toLowerCase())) continue;
            // Lowercase failed dictionary check — fall through to flag it
          }

          // Check against dictionary
          if (!checkWordValid(word)) {
            var suggestions = getWordSuggestions(word, 3);
            var replacement = suggestions.length > 0 ? suggestions[0] : null;
            // Preserve case
            if (replacement && word[0] === word[0].toUpperCase()) {
              replacement = replacement.charAt(0).toUpperCase() + replacement.slice(1);
            }
            var entry = {
              id: makeId(),
              ruleId: 'spelling',
              source: 'wordlist',
              group: 'correctness',
              category: 'Spelling',
              start: match.index,
              end: match.index + word.length,
              message: suggestions.length > 0
                ? 'Check the spelling of "' + word + '". Did you mean "' + suggestions.slice(0, 3).join('", "') + '"?'
                : 'Check the spelling of "' + word + '"',
              title: 'Possible spelling mistake',
              original: word
            };
            if (replacement) {
              entry.replacement = replacement;
            }
            results.push(entry);
          }
        }
      } catch (e) {
        console.warn('Dictionary check error:', e);
      }
    }

    // Pass 3: Heuristic check for obviously broken words (no dictionary needed)
    if (!hasDictionary) {
      wordRegex.lastIndex = 0;
      while ((match = wordRegex.exec(text)) !== null) {
        var hw = match[0];
        if (hw.length < 3) continue;
        if (alreadyFlagged.has(match.index)) continue;
        if (isInCustomDictionary(hw)) continue;
        if (SKIP_WORDS.has(hw.toLowerCase())) continue;
        if (hw === hw.toUpperCase() && /^[A-Z]+$/.test(hw)) continue;
        if (hw.indexOf("'") !== -1) continue;

        // Flag words with no vowels (a,e,i,o,u,y) — almost always misspelled
        if (!/[aeiouyAEIOUY]/.test(hw)) {
          results.push({
            id: makeId(),
            ruleId: 'spelling',
            source: 'heuristic',
            group: 'correctness',
            category: 'Spelling',
            start: match.index,
            end: match.index + hw.length,
            message: 'Check the spelling of "' + hw + '"',
            title: 'Possible spelling mistake',
            original: hw
          });
          alreadyFlagged.add(match.index);
        }
      }
    }

    return results;
  }

  /**
   * Check if a word is valid against the pre-expanded word set.
   * Since the word set already contains all inflected forms, a simple
   * lowercase lookup is all that's needed.
   */
  function checkWordValid(word) {
    if (!wordSet) return true; // No dictionary loaded — don't flag
    return wordSet.has(word.toLowerCase());
  }

  /**
   * Get spelling suggestions using a hybrid approach:
   * 1. Fast edit-distance-1 candidates checked against wordSet (instant)
   * 2. BK-tree search for distance-2 candidates (fast, O(log n))
   * Results are ranked by edit distance, then alphabetically.
   */
  function getWordSuggestions(word, limit) {
    if (!wordSet) return [];
    limit = limit || 3;
    var lower = word.toLowerCase();
    var results = [];
    var seen = new Set();

    // Phase 1: edit-distance-1 candidates (very fast — no tree needed)
    var ed1 = editDistance1Candidates(lower);
    for (var i = 0; i < ed1.length && results.length < limit * 2; i++) {
      if (wordSet.has(ed1[i]) && !seen.has(ed1[i])) {
        seen.add(ed1[i]);
        results.push({ word: ed1[i], dist: 1 });
      }
    }

    // Phase 2: BK-tree search for distance-2 if we need more suggestions
    if (results.length < limit && bkTree) {
      var bkResults = [];
      searchBK(bkTree, lower, 2, bkResults, limit * 3);
      for (var i = 0; i < bkResults.length; i++) {
        if (!seen.has(bkResults[i].word) && bkResults[i].dist > 0) {
          seen.add(bkResults[i].word);
          results.push(bkResults[i]);
        }
      }
    }

    // Sort by distance, then alphabetically
    results.sort(function (a, b) {
      if (a.dist !== b.dist) return a.dist - b.dist;
      return a.word < b.word ? -1 : 1;
    });

    var out = [];
    for (var i = 0; i < Math.min(results.length, limit); i++) {
      out.push(results[i].word);
    }
    return out;
  }

  /**
   * Generate all edit-distance-1 candidates for a word.
   * Returns array of candidate strings (not checked against dictionary yet).
   */
  function editDistance1Candidates(word) {
    var candidates = [];
    var alphabet = 'abcdefghijklmnopqrstuvwxyz';

    // Deletions
    for (var i = 0; i < word.length; i++) {
      candidates.push(word.substring(0, i) + word.substring(i + 1));
    }
    // Transpositions (swaps)
    for (var i = 0; i < word.length - 1; i++) {
      candidates.push(word.substring(0, i) + word[i + 1] + word[i] + word.substring(i + 2));
    }
    // Replacements
    for (var i = 0; i < word.length; i++) {
      for (var j = 0; j < alphabet.length; j++) {
        if (alphabet[j] !== word[i]) {
          candidates.push(word.substring(0, i) + alphabet[j] + word.substring(i + 1));
        }
      }
    }
    // Insertions
    for (var i = 0; i <= word.length; i++) {
      for (var j = 0; j < alphabet.length; j++) {
        candidates.push(word.substring(0, i) + alphabet[j] + word.substring(i));
      }
    }
    return candidates;
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
        message: '"' + match[1] + '" appears twice in a row',
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
        message: 'Remove the extra space',
        title: 'Extra space',
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
    'e.g', 'i.e', 'n.b', 'etc', 'viz', 'ibid', 'vs', 'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr',
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
        message: 'Start sentences with a capital letter',
        title: 'Missing capital',
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
      { regex: /\b(must of)\b/gi, fix: 'must have', msg: 'Use "must have" instead of "must of"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(alright)\b/gi, fix: 'all right', msg: 'GOV.UK style uses "all right" not "alright"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      // Subject-verb agreement
      { regex: /\b(there is)\s+(?:many|several|numerous|various|multiple|a\s+number\s+of|a\s+lot\s+of)\b/gi, fix: null, msg: 'Subject-verb agreement: use "there are" with plural nouns', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(the data) (shows?|indicates?|suggests?|demonstrates?|reveals?|confirms?)\b/gi, fix: null, msg: '"Data" is plural \u2014 use "the data show" or "the data indicate"', cat: 'Grammar', title: 'Grammar note' },
      { regex: /\b(criteria) (is|was|has)\b/gi, fix: null, msg: '"Criteria" is plural \u2014 use "criteria are". The singular is "criterion".', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(media) (is|was|has)\b/gi, fix: null, msg: '"Media" is plural \u2014 use "media are". The singular is "medium".', cat: 'Grammar', title: 'Grammar note' },
      // Dangling "which" vs "that"
      { regex: /\b(\w+)\s+which\s+(?:is|are|was|were)\s+(?:not|also|very|quite|rather|extremely|particularly)\b/gi, fix: null, msg: 'Consider whether you need "which" (non-defining, adds info) or "that" (defining, essential info). Use a comma before "which".', cat: 'Grammar', title: 'Which vs that' },
      // Double negatives
      { regex: /\b((?:do|does|did|have|has|had|could|would|should|can|will)\s+not)\s+(?:\w+\s+){0,3}(no|none|nothing|nobody|nowhere|neither|never|not)\b/gi, fix: null, msg: 'Double negative detected \u2014 this may reverse your intended meaning', cat: 'Grammar', title: 'Double negative' },
      // Tautology / redundant phrases
      { regex: /\b(free gift)\b/gi, fix: 'gift', msg: 'Tautology: gifts are free by definition', cat: 'Grammar', title: 'Redundant phrase' },
      { regex: /\b(added bonus)\b/gi, fix: 'bonus', msg: 'Tautology: a bonus is already something extra', cat: 'Grammar', title: 'Redundant phrase' },
      { regex: /\b(end result)\b/gi, fix: 'result', msg: 'Tautology: a result is already the end', cat: 'Grammar', title: 'Redundant phrase' },
      { regex: /\b(past history)\b/gi, fix: 'history', msg: 'Tautology: history is already in the past', cat: 'Grammar', title: 'Redundant phrase' },
      { regex: /\b(future plans?)\b/gi, fix: null, msg: 'Tautology: plans are for the future by definition', cat: 'Grammar', title: 'Redundant phrase' },
      { regex: /\b(completely (?:destroyed|eliminated|eradicated|annihilated))\b/gi, fix: null, msg: 'Redundant modifier: the verb already implies completeness', cat: 'Grammar', title: 'Redundant phrase' },
      { regex: /\b(advance warning)\b/gi, fix: 'warning', msg: 'Tautology: warnings are given in advance by definition', cat: 'Grammar', title: 'Redundant phrase' },
      { regex: /\b(new innovation)\b/gi, fix: 'innovation', msg: 'Tautology: innovations are new by definition', cat: 'Grammar', title: 'Redundant phrase' },
      { regex: /\b(each and every)\b/gi, fix: 'each', msg: '"Each and every" is redundant \u2014 use "each" or "every"', cat: 'Grammar', title: 'Redundant phrase' },
      { regex: /\b(first and foremost)\b/gi, fix: 'first', msg: '"First and foremost" is redundant \u2014 use "first"', cat: 'Grammar', title: 'Redundant phrase' },
      { regex: /\b(basic fundamentals?)\b/gi, fix: 'fundamentals', msg: 'Tautology: fundamentals are basic by definition', cat: 'Grammar', title: 'Redundant phrase' },
      { regex: /\b(revert back)\b/gi, fix: 'revert', msg: '"Revert" already means "go back" \u2014 "back" is redundant', cat: 'Grammar', title: 'Redundant phrase' },
      { regex: /\b(return back)\b/gi, fix: 'return', msg: '"Return" already means "go back" \u2014 "back" is redundant', cat: 'Grammar', title: 'Redundant phrase' },
      { regex: /\b(repeat again)\b/gi, fix: 'repeat', msg: '"Repeat" already means "do again" \u2014 "again" is redundant', cat: 'Grammar', title: 'Redundant phrase' },
      { regex: /\b(combine together)\b/gi, fix: 'combine', msg: '"Combine" already means "bring together" \u2014 "together" is redundant', cat: 'Grammar', title: 'Redundant phrase' },
      { regex: /\b(merge together)\b/gi, fix: 'merge', msg: '"Merge" already means "join together" \u2014 "together" is redundant', cat: 'Grammar', title: 'Redundant phrase' },
      { regex: /\b(plan ahead)\b/gi, fix: 'plan', msg: '"Plan" already implies looking ahead \u2014 "ahead" is redundant', cat: 'Grammar', title: 'Redundant phrase' },
      // Common verb errors
      { regex: /\b(could of)\b/gi, fix: 'could have', msg: 'Use "could have" instead of "could of"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(would of)\b/gi, fix: 'would have', msg: 'Use "would have" instead of "would of"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(should of)\b/gi, fix: 'should have', msg: 'Use "should have" instead of "should of"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(might of)\b/gi, fix: 'might have', msg: 'Use "might have" instead of "might of"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(would of been)\b/gi, fix: 'would have been', msg: 'Use "would have been" instead of "would of been"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(try and)\b(?=\s+\w)/gi, fix: 'try to', msg: 'Use "try to" instead of "try and"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(suppose to)\b/gi, fix: 'supposed to', msg: 'Use "supposed to" instead of "suppose to"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(use to)\b(?=\s+\w)/gi, fix: 'used to', msg: 'Use "used to" instead of "use to"', cat: 'Grammar', title: 'Grammar error' },
      // Misused prepositions
      { regex: /\b(different than)\b/gi, fix: 'different from', msg: 'In British English, use "different from" not "different than"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(bored of)\b/gi, fix: 'bored with', msg: 'Use "bored with" or "bored by", not "bored of"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(off of)\b/gi, fix: 'off', msg: '"Off" is sufficient \u2014 "of" is unnecessary', cat: 'Grammar', title: 'Grammar error' },
      // Commonly misused words
      { regex: /\b(literally)\b(?=\s+(?:died|killed|exploded|destroyed|the\s+(?:best|worst)|on\s+fire|flying))/gi, fix: null, msg: 'Check: "literally" means it actually happened. Did you mean "figuratively"?', cat: 'Grammar', title: 'Word misuse' },
      { regex: /\b(irregardless)\b/gi, fix: 'regardless', msg: '"Irregardless" is not standard \u2014 use "regardless"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(could care less)\b/gi, fix: 'could not care less', msg: 'The expression is "could not care less" (meaning you care the minimum amount)', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(for all intensive purposes)\b/gi, fix: 'for all intents and purposes', msg: 'The expression is "for all intents and purposes"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(one in the same)\b/gi, fix: 'one and the same', msg: 'The expression is "one and the same"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(case and point)\b/gi, fix: 'case in point', msg: 'The expression is "case in point"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(by in large)\b/gi, fix: 'by and large', msg: 'The expression is "by and large"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(peaked? my interest)\b/gi, fix: 'piqued my interest', msg: 'The expression is "piqued my interest" (piqued = stimulated)', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(baited breath)\b/gi, fix: 'bated breath', msg: 'The expression is "bated breath" (bated = restrained)', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(beckon call)\b/gi, fix: 'beck and call', msg: 'The expression is "beck and call"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(sneak peak)\b/gi, fix: 'sneak peek', msg: '"Peek" means a quick look. "Peak" is the top of a mountain.', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(deep-seeded)\b/gi, fix: 'deep-seated', msg: 'The expression is "deep-seated" not "deep-seeded"', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(wet your appetite)\b/gi, fix: 'whet your appetite', msg: '"Whet" means to sharpen/stimulate. "Wet" means to make damp.', cat: 'Grammar', title: 'Grammar error' },
      { regex: /\b(hone in on)\b/gi, fix: 'home in on', msg: 'The expression is "home in on" (like homing in). "Hone" means to sharpen.', cat: 'Grammar', title: 'Grammar error' },

      // --- Plain English: single-word replacements (all modes) ---
      { regex: /\b(utili[sz](?:e[ds]?|ing|ation))\b/gi, fix: 'use', msg: 'Use "use" instead of "utilise"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(commenc(?:e[ds]?|ing))\b/gi, fix: 'start', msg: 'Use "start" instead of "commence"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(purchas(?:e[ds]?|ing))\b/gi, fix: 'buy', msg: 'Use "buy" instead of "purchase"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(regarding)\b/gi, fix: 'about', msg: 'Use "about" instead of "regarding"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(facilitat(?:e[ds]?|ing|ion))\b/gi, fix: 'help', msg: 'Use "help" instead of "facilitate"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(endeavou?r(?:ed|s|ing)?)\b/gi, fix: 'try', msg: 'Use "try" instead of "endeavour"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(terminat(?:e[ds]?|ing|ion))\b/gi, fix: 'end', msg: 'Use "end" instead of "terminate"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(additional(?:ly)?)\b/gi, fix: 'extra', msg: 'Use "extra" or "more" instead of "additional"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(accordingly)\b/gi, fix: 'so', msg: 'Use "so" instead of "accordingly"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(subsequently)\b/gi, fix: 'then', msg: 'Use "then" instead of "subsequently"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(approximately)\b/gi, fix: 'about', msg: 'Use "about" instead of "approximately"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(furthermore)\b/gi, fix: 'also', msg: 'Use "also" instead of "furthermore"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(nevertheless)\b/gi, fix: 'but', msg: 'Use "but" or "however" instead of "nevertheless"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(notwithstanding)\b/gi, fix: 'despite', msg: 'Use "despite" instead of "notwithstanding"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(ascertain(?:ed|s|ing)?)\b/gi, fix: 'find out', msg: 'Use "find out" instead of "ascertain"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(demonstrat(?:e[ds]?|ing|ion))\b/gi, fix: 'show', msg: 'Use "show" instead of "demonstrate"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(consequently)\b/gi, fix: 'so', msg: 'Use "so" instead of "consequently"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(assist(?:ance|ed|s|ing)?)\b/gi, fix: 'help', msg: 'Use "help" instead of "assist"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(sufficient(?:ly)?)\b/gi, fix: 'enough', msg: 'Use "enough" instead of "sufficient"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(obtain(?:ed|s|ing)?)\b/gi, fix: 'get', msg: 'Use "get" instead of "obtain"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(requir(?:e[ds]?|ing|ement))\b/gi, fix: 'need', msg: 'Use "need" instead of "require"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(modif(?:y|ied|ies|ying|ication))\b/gi, fix: 'change', msg: 'Use "change" instead of "modify"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(submit(?:ted|ting|s)?)\b/gi, fix: 'send', msg: 'Use "send" instead of "submit"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(upon)\b/gi, fix: 'on', msg: 'Use "on" instead of "upon"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(whilst)\b/gi, fix: 'while', msg: 'Use "while" instead of "whilst"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(amongst)\b/gi, fix: 'among', msg: 'Use "among" instead of "amongst"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(attempt(?:ed|s|ing)?)\b/gi, fix: 'try', msg: 'Use "try" instead of "attempt"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(initiat(?:e[ds]?|ing|ive))\b/gi, fix: 'start', msg: 'Use "start" instead of "initiate"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(implement(?:ed|s|ing|ation)?)\b/gi, fix: 'carry out', msg: 'Use "carry out" or "set up" instead of "implement"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(indicat(?:e[ds]?|ing|ion))\b/gi, fix: 'show', msg: 'Use "show" or "suggest" instead of "indicate"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(therefore)\b/gi, fix: 'so', msg: 'GOV.UK style: prefer "so" over "therefore"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\b(however)\b/gi, fix: 'but', msg: 'GOV.UK style: consider "but" instead of "however"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },

      // --- Plain English: multi-word phrases (all modes) ---
      // These are verbose in any context — flagging them everywhere is helpful.
      { regex: /\b(in order to)\b/gi, fix: 'to', msg: 'Prefer "to" over "in order to" for brevity', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(prior to)\b/gi, fix: 'before', msg: 'Prefer "before" over "prior to" for plain English', cat: 'Plain English', title: 'Use plain English' },
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
      { regex: /\bat this point in time\b/gi, fix: 'now', msg: 'Prefer "now" over "at this point in time"', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\bin the event that\b/gi, fix: 'if', msg: 'Prefer "if" over "in the event that"', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\bwith regards to\b/gi, fix: 'about', msg: 'Prefer "about" over "with regards to"', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\ba number of\b/gi, fix: 'some', msg: 'Be specific — say how many instead of "a number of"', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\bin respect of\b/gi, fix: 'about', msg: 'Prefer "about" or "for" over "in respect of"', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      // --- Latin abbreviations (catch all variations: eg, e.g, e.g., eg.) ---
      { regex: /\be\.?g\.?(?=[\s,;:\)]|$)/gi, fix: 'for example', msg: 'Write "for example" instead of "e.g."', cat: 'GOV.UK style', title: 'Latin abbreviation', group: 'style', modes: ['govuk'] },
      { regex: /\bi\.?e\.?(?=[\s,;:\)]|$)/gi, fix: 'that is', msg: 'Write "that is" or rephrase instead of "i.e."', cat: 'GOV.UK style', title: 'Latin abbreviation', group: 'style', modes: ['govuk'] },
      { regex: /\be[tc]{2}\.?(?=[\s,;:\)]|$)/gi, fix: null, msg: 'GOV.UK style: avoid "etc" — list the items or say "for example"', cat: 'GOV.UK style', title: 'Latin abbreviation', group: 'style', modes: ['govuk'] },
      { regex: /\bn\.?b\.?(?=[\s,;:\)]|$)/gi, fix: 'note', msg: 'Write "note" or "please note" instead of "N.B."', cat: 'GOV.UK style', title: 'Latin abbreviation', group: 'style', modes: ['govuk'] },
      { regex: /\bviz\.?(?=[\s,;:\)]|$)/gi, fix: 'namely', msg: 'Write "namely" or "specifically" instead of "viz."', cat: 'GOV.UK style', title: 'Latin abbreviation', group: 'style', modes: ['govuk'] },
      { regex: /\bibid\.?(?=[\s,;:\)]|$)/gi, fix: null, msg: 'Avoid "ibid." — give the full reference', cat: 'GOV.UK style', title: 'Latin abbreviation', group: 'style', modes: ['govuk'] },
      { regex: /\bet\.?\s*al\.?(?=[\s,;:\)]|$)/gi, fix: 'and others', msg: 'Write "and others" instead of "et al."', cat: 'GOV.UK style', title: 'Latin abbreviation', group: 'style', modes: ['govuk'] },
      { regex: /\bper\s+se\b/gi, fix: 'in itself', msg: 'Write "in itself", "as such", or "by itself" instead of "per se"', cat: 'GOV.UK style', title: 'Latin abbreviation', group: 'style', modes: ['govuk'] },
      { regex: /\bre(?=\s*:)/gi, fix: 'about', msg: 'Write "about" instead of "re:"', cat: 'GOV.UK style', title: 'Latin abbreviation', group: 'style', modes: ['govuk'] },
      { regex: /\bvia\b/gi, fix: 'through', msg: 'GOV.UK style: use "through" or "by" instead of "via"', cat: 'GOV.UK style', title: 'Latin abbreviation', group: 'style', modes: ['govuk'] },

      // --- GOV.UK words to avoid (jargon/buzzwords) ---
      { regex: /\b(agenda)(?!\s+item|\s+for\s+the\s+meeting)\b/gi, fix: 'plan', msg: 'Avoid "agenda" (unless for a meeting) — say what you mean: plan, approach', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(collaborat(?:e|ing|ion))\b/gi, fix: 'work together', msg: 'Avoid "collaborate" — try "work with" or "work together"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(combat(?:ing|ted)?)\b(?!\s+(?:troops|forces|zone|aircraft|training))/gi, fix: 'reduce', msg: 'Avoid "combat" (unless military) — try "reduce", "stop", "prevent"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(deliver(?:ing|ed|s|y)?)\b(?!\s+(?:mail|post|parcel|package|letter|goods|baby))/gi, fix: 'provide', msg: 'Avoid "deliver" (unless physical delivery) — try "provide", "create", "run"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(deploy(?:ing|ed|ment|s)?)\b(?!\s+(?:troops|forces|soldiers|software|code|server|application))/gi, fix: 'use', msg: 'Avoid "deploy" (unless military or software) — try "use", "introduce"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(dialogue)\b/gi, fix: 'discussion', msg: 'Avoid "dialogue" — try "conversation", "discussion", "spoke to"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(disincentivise)\b/gi, fix: 'discourage', msg: 'Avoid "disincentivise" — use "discourage"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(empower(?:ing|ed|ment|s)?)\b/gi, fix: 'allow', msg: 'Avoid "empower" — try "allow", "enable", "let"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(foster(?:ing|ed|s)?)\b(?!\s+(?:care|child|parent|home|family|carer))/gi, fix: 'encourage', msg: 'Avoid "foster" (unless about children) — try "encourage", "support"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b((?:going|moving)\s+forward)\b/gi, fix: 'from now on', msg: 'Avoid "going forward" — say "from now on" or be specific about timing', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(incentivise)\b/gi, fix: 'encourage', msg: 'Avoid "incentivise" — use "encourage"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(impact(?:ing|ed|s)?)\b(?=\s+(?:on|upon|the|our|their|your))/gi, fix: 'affect', msg: 'Avoid "impact" as a verb — try "affect", "influence", "change"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(key)\b(?=\s+(?:is|are|was|were|will|priorities|objectives|themes|aims|goals|issues|challenges|deliverables|stakeholders|findings|messages))/gi, fix: 'important', msg: 'Avoid "key" (overused) — try "important", "main", "significant"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(land)\b(?=\s+(?:a|the|this|our|your|their)\s+(?:deal|contract|agreement|role|job|funding|investment))/gi, fix: 'secure', msg: 'Avoid "land" as a verb (unless about aircraft) — try "get", "secure", "achieve"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(leverage)\b(?!\s+(?:ratio|buyout))/gi, fix: 'use', msg: 'Avoid "leverage" (unless financial) — try "use", "take advantage of"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(liaise)\b/gi, fix: 'work with', msg: 'Avoid "liaise" — try "work with", "contact", "talk to"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\bone[- ]stop[- ]shop\b/gi, fix: null, msg: 'Avoid "one-stop shop" — describe what the service actually does', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(overarching)\b/gi, fix: 'overall', msg: 'Avoid "overarching" — try "overall" or just remove it', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(portal)\b/gi, fix: 'website', msg: 'Avoid "portal" — use "website" or "service" or the service name', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(ring[- ]?fenc(?:e|ed|ing))\b/gi, fix: 'protect', msg: 'Avoid "ring-fencing" — try "separate", "protect", "keep aside"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(robust)\b/gi, fix: 'strong', msg: 'Avoid "robust" — try "strong", "effective", "thorough"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(signpost(?:ing|ed|s)?)\b/gi, fix: 'directing', msg: 'Avoid "signposting" — try "directing", "linking", "tell users about"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\bslimming\s+down\b/gi, fix: 'reducing', msg: 'Avoid "slimming down" — try "reducing" or "removing"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(streamlin(?:e|ing|ed))\b/gi, fix: 'simplify', msg: 'Avoid "streamline" — try "simplify" or "improve"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(tackl(?:e|ing|ed|es))\b(?!\s+(?:football|rugby|player|opponent))/gi, fix: 'deal with', msg: 'Avoid "tackle" (unless sports) — try "solve", "reduce", "deal with"', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },
      { regex: /\b(transform(?:ing|ed|ation|s)?)\b/gi, fix: 'change', msg: 'Avoid "transform" — be specific: what is actually changing?', cat: 'GOV.UK style', title: 'Word to avoid', group: 'style', modes: ['govuk'] },

      // --- More plain English (all modes — these are genuinely archaic/legal everywhere) ---
      { regex: /\b(proforma)\b/gi, fix: 'form', msg: 'Use "form" or "template" instead of "proforma"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(henceforth)\b/gi, fix: 'from now on', msg: 'Use "from now on" instead of "henceforth"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(herewith)\b/gi, fix: null, msg: 'Avoid "herewith" — just say what you are including', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(aforementioned)\b/gi, fix: null, msg: 'Avoid "aforementioned" — name the thing directly', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(forthwith)\b/gi, fix: 'immediately', msg: 'Use "immediately" or "now" instead of "forthwith"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(whatsoever)\b/gi, fix: null, msg: 'Avoid "whatsoever" — it rarely adds meaning', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
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
      { regex: /\bfinancial\s+penalt(?:y|ies)\b/gi, fix: 'fine', msg: 'GOV.UK style: use "fine" instead of "financial penalty"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },

      // --- British vs American spelling (GOV.UK must use British English) ---
      { regex: /\b(color)\b/gi, fix: 'colour', msg: 'Use British spelling: "colour" not "color"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(favor(?:ite|able|ably)?)\b/gi, fix: null, msg: 'Use British spelling with "-our": "favour", "favourite"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(honor(?:able|ary|ed|ing|s)?)\b/gi, fix: null, msg: 'Use British spelling: "honour"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(humor)\b/gi, fix: 'humour', msg: 'Use British spelling: "humour" not "humor"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(labor)\b/gi, fix: 'labour', msg: 'Use British spelling: "labour" not "labor"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(neighbor(?:hood|ing|s)?)\b/gi, fix: null, msg: 'Use British spelling: "neighbour"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(behavior(?:al|s)?)\b/gi, fix: null, msg: 'Use British spelling: "behaviour"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(center(?:ed|s|ing)?)\b/gi, fix: null, msg: 'Use British spelling: "centre"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(theater|theater)\b/gi, fix: 'theatre', msg: 'Use British spelling: "theatre" not "theater"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(meter)\b(?!\s+(?:reading|long|tall|wide|high|deep))/gi, fix: 'metre', msg: 'Use British spelling: "metre" (unit of length). "Meter" is a measuring device.', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(liter)\b/gi, fix: 'litre', msg: 'Use British spelling: "litre" not "liter"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(traveling|traveled|traveler)\b/gi, fix: null, msg: 'Use British spelling with double "l": "travelling", "travelled", "traveller"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(modeling|modeled)\b/gi, fix: null, msg: 'Use British spelling with double "l": "modelling", "modelled"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(counseling|counselor)\b/gi, fix: null, msg: 'Use British spelling with double "l": "counselling", "counsellor"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(canceled)\b/gi, fix: 'cancelled', msg: 'Use British spelling: "cancelled" not "canceled"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(labeled)\b/gi, fix: 'labelled', msg: 'Use British spelling: "labelled" not "labeled"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(fulfill(?:ed|ing|ment|s)?)\b/gi, fix: null, msg: 'Use British spelling: "fulfil" not "fulfill"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(enroll(?:ed|ing|ment|s)?)\b/gi, fix: null, msg: 'Use British spelling: "enrol" not "enroll"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(analyze)\b/gi, fix: 'analyse', msg: 'Use British spelling: "analyse" not "analyze"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(organize)\b/gi, fix: 'organise', msg: 'Use British spelling: "organise" not "organize"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(recognize)\b/gi, fix: 'recognise', msg: 'Use British spelling: "recognise" not "recognize"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(apologize)\b/gi, fix: 'apologise', msg: 'Use British spelling: "apologise" not "apologize"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(prioritize)\b/gi, fix: 'prioritise', msg: 'Use British spelling: "prioritise" not "prioritize"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(summarize)\b/gi, fix: 'summarise', msg: 'Use British spelling: "summarise" not "summarize"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(categorize)\b/gi, fix: 'categorise', msg: 'Use British spelling: "categorise" not "categorize"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(maximize)\b/gi, fix: 'maximise', msg: 'Use British spelling: "maximise" not "maximize"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(minimize)\b/gi, fix: 'minimise', msg: 'Use British spelling: "minimise" not "minimize"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(customize)\b/gi, fix: 'customise', msg: 'Use British spelling: "customise" not "customize"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(standardize)\b/gi, fix: 'standardise', msg: 'Use British spelling: "standardise" not "standardize"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(defense)\b/gi, fix: 'defence', msg: 'Use British spelling: "defence" not "defense"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(offense)\b/gi, fix: 'offence', msg: 'Use British spelling: "offence" not "offense"', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },
      { regex: /\b(program)\b(?!\s*(?:me|ming|mer|mable))/gi, fix: 'programme', msg: 'Use British spelling: "programme" (unless referring to a computer program)', cat: 'Spelling', title: 'British spelling', group: 'correctness', modes: ['govuk'] },

      // --- Gendered job titles (use gender-neutral alternatives) ---
      { regex: /\b(fireman|firemen)\b/gi, fix: 'firefighter', msg: 'Use gender-neutral language: "firefighter" instead of "fireman"', cat: 'Inclusive language', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(policeman|policemen)\b/gi, fix: 'police officer', msg: 'Use gender-neutral language: "police officer"', cat: 'Inclusive language', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(policewoman|policewomen)\b/gi, fix: 'police officer', msg: 'Use gender-neutral language: "police officer"', cat: 'Inclusive language', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(chairman)\b/gi, fix: 'chair', msg: 'Use gender-neutral language: "chair" or "chairperson"', cat: 'Inclusive language', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(chairwoman)\b/gi, fix: 'chair', msg: 'Use gender-neutral language: "chair" or "chairperson"', cat: 'Inclusive language', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(spokesman)\b/gi, fix: 'spokesperson', msg: 'Use gender-neutral language: "spokesperson"', cat: 'Inclusive language', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(spokeswoman)\b/gi, fix: 'spokesperson', msg: 'Use gender-neutral language: "spokesperson"', cat: 'Inclusive language', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(manpower)\b/gi, fix: 'workforce', msg: 'Use gender-neutral language: "workforce" or "staff"', cat: 'Inclusive language', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(mankind)\b/gi, fix: 'humanity', msg: 'Use gender-neutral language: "humanity" or "people"', cat: 'Inclusive language', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(manmade|man-made)\b/gi, fix: 'manufactured', msg: 'Use gender-neutral language: "manufactured", "synthetic", or "artificial"', cat: 'Inclusive language', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(layman)\b/gi, fix: 'non-specialist', msg: 'Use gender-neutral language: "non-specialist" or "ordinary person"', cat: 'Inclusive language', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(craftsman|craftsmen)\b/gi, fix: 'craftsperson', msg: 'Use gender-neutral language: "craftsperson" or "artisan"', cat: 'Inclusive language', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(businessmen)\b/gi, fix: 'business people', msg: 'Use gender-neutral language: "business people"', cat: 'Inclusive language', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(businessman)\b/gi, fix: 'businessperson', msg: 'Use gender-neutral language: "businessperson"', cat: 'Inclusive language', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },
      { regex: /\b(foreman)\b/gi, fix: 'supervisor', msg: 'Use gender-neutral language: "supervisor" or "foreperson"', cat: 'Inclusive language', title: 'Gender-neutral language', group: 'style', modes: ['govuk'] },

      // --- Vague time expressions (GOV.UK says be specific) ---
      { regex: /\b(in due course)\b/gi, fix: null, msg: 'Be specific about timing instead of "in due course"', cat: 'Plain English', title: 'Vague timing', group: 'style', modes: ['govuk'] },
      { regex: /\b(in the coming weeks)\b/gi, fix: null, msg: 'Be specific \u2014 give a date or say "by [date]"', cat: 'Plain English', title: 'Vague timing', group: 'style', modes: ['govuk'] },
      { regex: /\b(in the coming months)\b/gi, fix: null, msg: 'Be specific \u2014 give a date or say "by [date]"', cat: 'Plain English', title: 'Vague timing', group: 'style', modes: ['govuk'] },
      { regex: /\b(at some point)\b/gi, fix: null, msg: 'Be specific about when, or remove if not needed', cat: 'Plain English', title: 'Vague timing', group: 'style', modes: ['govuk'] },
      { regex: /\b(shortly)\b/gi, fix: null, msg: 'Be specific about timing instead of "shortly"', cat: 'Plain English', title: 'Vague timing', group: 'style', modes: ['govuk'] },
      { regex: /\b(presently)\b/gi, fix: 'now', msg: '"Presently" is ambiguous \u2014 use "now" (current) or "soon" (future)', cat: 'Plain English', title: 'Ambiguous word', group: 'style', modes: ['govuk'] },

      // --- "It is" filler constructions ---
      { regex: /\b(it is important to note that)\b/gi, fix: null, msg: 'Remove filler \u2014 just state the point directly', cat: 'Plain English', title: 'Remove filler', group: 'style', modes: ['govuk'] },
      { regex: /\b(it is worth noting that)\b/gi, fix: null, msg: 'Remove filler \u2014 just state the point directly', cat: 'Plain English', title: 'Remove filler', group: 'style', modes: ['govuk'] },
      { regex: /\b(it is important that)\b/gi, fix: null, msg: 'Consider removing \u2014 just state what matters', cat: 'Plain English', title: 'Remove filler', group: 'style', modes: ['govuk'] },
      { regex: /\b(it is necessary to)\b/gi, fix: 'you must', msg: 'Be direct: "you must" or "you need to"', cat: 'Plain English', title: 'Remove filler', group: 'style', modes: ['govuk'] },
      { regex: /\b(it is recommended that)\b/gi, fix: null, msg: 'Be direct: say who recommends it and what they should do', cat: 'Plain English', title: 'Remove filler', group: 'style', modes: ['govuk'] },
      { regex: /\b(it is essential that)\b/gi, fix: 'you must', msg: 'Be direct: "you must" \u2014 say who needs to act', cat: 'Plain English', title: 'Remove filler', group: 'style', modes: ['govuk'] },
      { regex: /\b(there is a need to)\b/gi, fix: 'you need to', msg: 'Be direct: "you need to" or "we need to"', cat: 'Plain English', title: 'Remove filler', group: 'style', modes: ['govuk'] },
      { regex: /\b(there is a requirement to)\b/gi, fix: 'you must', msg: 'Be direct: "you must" or name who needs to act', cat: 'Plain English', title: 'Remove filler', group: 'style', modes: ['govuk'] },

      // --- Weak action verb phrases (say it in fewer words) ---
      { regex: /\b(make a (?:payment|decision|choice|request|claim|complaint|contribution))\b/gi, fix: null, msg: 'Simplify: "make a payment" \u2192 "pay", "make a decision" \u2192 "decide", etc.', cat: 'Plain English', title: 'Use plain English', group: 'style', modes: ['govuk'] },
      { regex: /\b(carry out)\b(?=\s+(?:a|an|the|this|that|your))/gi, fix: null, msg: 'Consider a simpler verb: "carry out an inspection" \u2192 "inspect"', cat: 'Plain English', title: 'Use plain English', group: 'style', modes: ['govuk'] },
      { regex: /\b(give consideration to)\b/gi, fix: 'consider', msg: 'Simplify: use "consider" instead of "give consideration to"', cat: 'Plain English', title: 'Use plain English', group: 'style', modes: ['govuk'] },
      { regex: /\b(take into consideration)\b/gi, fix: 'consider', msg: 'Simplify: use "consider" instead of "take into consideration"', cat: 'Plain English', title: 'Use plain English', group: 'style', modes: ['govuk'] },
      { regex: /\b(make an application)\b/gi, fix: 'apply', msg: 'Simplify: use "apply" instead of "make an application"', cat: 'Plain English', title: 'Use plain English', group: 'style', modes: ['govuk'] },
      { regex: /\b(make provision for)\b/gi, fix: 'provide for', msg: 'Simplify: use "provide for" instead of "make provision for"', cat: 'Plain English', title: 'Use plain English', group: 'style', modes: ['govuk'] },
      { regex: /\b(reach a decision)\b/gi, fix: 'decide', msg: 'Simplify: use "decide" instead of "reach a decision"', cat: 'Plain English', title: 'Use plain English', group: 'style', modes: ['govuk'] },
      { regex: /\b(take action)\b/gi, fix: 'act', msg: 'Simplify: use "act" instead of "take action"', cat: 'Plain English', title: 'Use plain English', group: 'style', modes: ['govuk'] },
      { regex: /\b(take steps to)\b/gi, fix: null, msg: 'Be specific about what action to take instead of "take steps to"', cat: 'Plain English', title: 'Use plain English', group: 'style', modes: ['govuk'] },
      { regex: /\b(put in place)\b/gi, fix: null, msg: 'Be specific: "set up", "create", or "introduce" instead of "put in place"', cat: 'Plain English', title: 'Use plain English', group: 'style', modes: ['govuk'] },
      { regex: /\b(in relation to)\b/gi, fix: 'about', msg: 'Use "about" or "for" instead of "in relation to"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(with regard to)\b/gi, fix: 'about', msg: 'Use "about" instead of "with regard to"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(for the purpose of)\b/gi, fix: 'to', msg: 'Use "to" instead of "for the purpose of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in the process of)\b/gi, fix: null, msg: 'Remove \u2014 just say what is being done', cat: 'Plain English', title: 'Remove filler' },
      { regex: /\b(is able to)\b/gi, fix: 'can', msg: 'Use "can" instead of "is able to"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(are able to)\b/gi, fix: 'can', msg: 'Use "can" instead of "are able to"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(be able to)\b/gi, fix: 'can', msg: 'Use "can" instead of "be able to"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(whether or not)\b/gi, fix: 'whether', msg: '"Or not" is usually unnecessary \u2014 "whether" is enough', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(at this moment in time)\b/gi, fix: 'now', msg: 'Use "now" instead of "at this moment in time"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(due to the fact that)\b/gi, fix: 'because', msg: 'Use "because" instead of "due to the fact that"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(despite the fact that)\b/gi, fix: 'although', msg: 'Use "although" instead of "despite the fact that"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in view of the fact that)\b/gi, fix: 'because', msg: 'Use "because" or "since" instead of "in view of the fact that"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(on the grounds that)\b/gi, fix: 'because', msg: 'Use "because" instead of "on the grounds that"', cat: 'Plain English', title: 'Use plain English' },

      // --- More plain English: common word swaps ---
      { regex: /\b(ensure)\b/gi, fix: 'make sure', msg: 'Use "make sure" instead of "ensure"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(advise)\b(?!\s+(?:against|on\s+(?:the|a|how|what|where|when|which)))/gi, fix: 'tell', msg: 'Use "tell" or "let [someone] know" instead of "advise"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(notify)\b/gi, fix: 'tell', msg: 'Use "tell" instead of "notify"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(inform)\b/gi, fix: 'tell', msg: 'Use "tell" instead of "inform"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(request)\b(?=\s+(?:that|you|the|a|an|this|your))/gi, fix: 'ask for', msg: 'Use "ask for" instead of "request"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(provide)\b/gi, fix: 'give', msg: 'Use "give" instead of "provide"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(receive)\b/gi, fix: 'get', msg: 'Use "get" instead of "receive"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(retain)\b/gi, fix: 'keep', msg: 'Use "keep" instead of "retain"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(permit)\b(?=\s+(?:you|the|a|an|this|them|us|him|her))/gi, fix: 'let', msg: 'Use "let" or "allow" instead of "permit"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(prohibit)\b/gi, fix: 'ban', msg: 'Use "ban", "stop", or "do not allow" instead of "prohibit"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(cease)\b/gi, fix: 'stop', msg: 'Use "stop" instead of "cease"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(acquire)\b/gi, fix: 'get', msg: 'Use "get" or "buy" instead of "acquire"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(reside)\b/gi, fix: 'live', msg: 'Use "live" instead of "reside"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(residence)\b/gi, fix: 'home', msg: 'Use "home" or "address" instead of "residence"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(dwelling)\b/gi, fix: 'home', msg: 'Use "home" or "property" instead of "dwelling"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(expedite)\b/gi, fix: 'speed up', msg: 'Use "speed up" or "hurry" instead of "expedite"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(numerous)\b/gi, fix: 'many', msg: 'Use "many" instead of "numerous"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(remainder)\b/gi, fix: 'rest', msg: 'Use "rest" instead of "remainder"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(substantial)\b/gi, fix: 'large', msg: 'Use "large", "big", or "a lot of" instead of "substantial"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(adjacent to)\b/gi, fix: 'next to', msg: 'Use "next to" or "near" instead of "adjacent to"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(forward(?:ed|ing|s)?)\b(?=\s+(?:the|this|a|an|your|their|our))/gi, fix: 'send', msg: 'Use "send" instead of "forward" where possible', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(determine)\b/gi, fix: 'find out', msg: 'Use "find out" or "decide" instead of "determine"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(comply)\b/gi, fix: 'keep to', msg: 'Use "keep to" or "follow" instead of "comply"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in the amount of)\b/gi, fix: 'for', msg: 'Use "for" instead of "in the amount of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(on the basis of)\b/gi, fix: 'based on', msg: 'Use "based on" or "because of" instead of "on the basis of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(with the exception of)\b/gi, fix: 'except', msg: 'Use "except" or "apart from" instead of "with the exception of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in the absence of)\b/gi, fix: 'without', msg: 'Use "without" instead of "in the absence of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in the region of)\b/gi, fix: 'about', msg: 'Use "about" or "around" instead of "in the region of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(as a means of)\b/gi, fix: 'to', msg: 'Use "to" instead of "as a means of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(for the duration of)\b/gi, fix: 'during', msg: 'Use "during" instead of "for the duration of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(at the conclusion of)\b/gi, fix: 'after', msg: 'Use "after" instead of "at the conclusion of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(has the ability to)\b/gi, fix: 'can', msg: 'Use "can" instead of "has the ability to"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(have the ability to)\b/gi, fix: 'can', msg: 'Use "can" instead of "have the ability to"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(until such time as)\b/gi, fix: 'until', msg: 'Use "until" instead of "until such time as"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(it should be borne in mind that)\b/gi, fix: null, msg: 'Remove \u2014 just state the point', cat: 'Plain English', title: 'Remove filler' },
      { regex: /\b(as to whether)\b/gi, fix: 'whether', msg: 'Use "whether" instead of "as to whether"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in a position to)\b/gi, fix: 'can', msg: 'Use "can" instead of "in a position to"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in light of)\b/gi, fix: 'because of', msg: 'Use "because of" instead of "in light of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in connection with)\b/gi, fix: 'about', msg: 'Use "about" or "for" instead of "in connection with"', cat: 'Plain English', title: 'Use plain English' },

      // --- Even more plain English: single words ---
      { regex: /\b(complete)\b(?=\s+(?:the|this|a|an|your|their|our)\s+(?:form|application|questionnaire|survey|return))/gi, fix: 'fill in', msg: 'Use "fill in" instead of "complete" for forms', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(establish)\b/gi, fix: 'set up', msg: 'Use "set up", "find out", or "show" instead of "establish"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(constitute)\b/gi, fix: 'make up', msg: 'Use "make up" or "form" instead of "constitute"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(anticipate)\b/gi, fix: 'expect', msg: 'Use "expect" instead of "anticipate"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(administer)\b/gi, fix: 'manage', msg: 'Use "manage" or "run" instead of "administer"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(concerning)\b/gi, fix: 'about', msg: 'Use "about" instead of "concerning"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(consider(?:able|ably))\b/gi, fix: null, msg: 'Use "big", "large", "much", or "a lot" instead of "considerable"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(currently)\b/gi, fix: 'now', msg: 'Use "now" instead of "currently"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(disclose)\b/gi, fix: 'tell', msg: 'Use "tell" or "show" instead of "disclose"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(discontinue)\b/gi, fix: 'stop', msg: 'Use "stop" or "end" instead of "discontinue"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(enclose)\b/gi, fix: 'put in', msg: 'Use "put in" or "include" instead of "enclose"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(encounter)\b/gi, fix: 'meet', msg: 'Use "meet" or "find" instead of "encounter"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(expenditure)\b/gi, fix: 'spending', msg: 'Use "spending" or "costs" instead of "expenditure"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in excess of)\b/gi, fix: 'more than', msg: 'Use "more than" instead of "in excess of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(incur)\b/gi, fix: null, msg: 'Use "pay", "lose", or "get" instead of "incur"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(mandatory)\b/gi, fix: 'you must', msg: 'Use "you must" or "required" instead of "mandatory"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(methodology)\b/gi, fix: 'method', msg: 'Use "method" instead of "methodology"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(optimum)\b/gi, fix: 'best', msg: 'Use "best" instead of "optimum"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(particulars)\b/gi, fix: 'details', msg: 'Use "details" instead of "particulars"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(predominant(?:ly)?)\b/gi, fix: 'main', msg: 'Use "main" or "mostly" instead of "predominant"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(precisely)\b/gi, fix: 'exactly', msg: 'Use "exactly" instead of "precisely"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(procure)\b/gi, fix: 'buy', msg: 'Use "buy" or "get" instead of "procure"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(reimburse)\b/gi, fix: 'pay back', msg: 'Use "pay back" or "repay" instead of "reimburse"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(remuneration)\b/gi, fix: 'pay', msg: 'Use "pay" or "wages" instead of "remuneration"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(supplement(?:ary)?)\b/gi, fix: 'extra', msg: 'Use "extra" or "more" instead of "supplementary"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(undertake)\b/gi, fix: 'do', msg: 'Use "do" or "carry out" instead of "undertake"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(verify)\b/gi, fix: 'check', msg: 'Use "check" instead of "verify"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(predominantly)\b/gi, fix: 'mostly', msg: 'Use "mostly" or "mainly" instead of "predominantly"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(allocate)\b/gi, fix: 'give', msg: 'Use "give", "share", or "set aside" instead of "allocate"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(necessitate)\b/gi, fix: 'need', msg: 'Use "need" or "must have" instead of "necessitate"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(correspondence)\b/gi, fix: null, msg: 'Use "letter", "email", or "message" instead of "correspondence"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(attain)\b/gi, fix: 'reach', msg: 'Use "reach" or "get" instead of "attain"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(amalgamate)\b/gi, fix: 'join', msg: 'Use "join", "merge", or "combine" instead of "amalgamate"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(furnish)\b/gi, fix: 'give', msg: 'Use "give" instead of "furnish"', cat: 'Plain English', title: 'Use plain English' },

      // --- Even more plain English: multi-word phrases ---
      { regex: /\b(as a consequence of)\b/gi, fix: 'because of', msg: 'Use "because of" instead of "as a consequence of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(as a result of)\b/gi, fix: 'because of', msg: 'Use "because of" instead of "as a result of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(at the time of writing)\b/gi, fix: 'now', msg: 'Use "now" or give a specific date instead of "at the time of writing"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(by means of)\b/gi, fix: 'by', msg: 'Use "by" or "with" instead of "by means of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(by virtue of)\b/gi, fix: 'because of', msg: 'Use "because of" instead of "by virtue of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(for the most part)\b/gi, fix: 'mostly', msg: 'Use "mostly" or "mainly" instead of "for the most part"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in advance of)\b/gi, fix: 'before', msg: 'Use "before" instead of "in advance of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in conjunction with)\b/gi, fix: 'with', msg: 'Use "with" instead of "in conjunction with"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in the course of)\b/gi, fix: 'during', msg: 'Use "during" instead of "in the course of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in the first instance)\b/gi, fix: 'first', msg: 'Use "first" instead of "in the first instance"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in the interests of)\b/gi, fix: 'for', msg: 'Use "for" or "to" instead of "in the interests of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(on a daily basis)\b/gi, fix: 'daily', msg: 'Use "daily" or "every day" instead of "on a daily basis"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(on a weekly basis)\b/gi, fix: 'weekly', msg: 'Use "weekly" or "every week" instead of "on a weekly basis"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(on a monthly basis)\b/gi, fix: 'monthly', msg: 'Use "monthly" or "every month" instead of "on a monthly basis"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(on an annual basis)\b/gi, fix: 'yearly', msg: 'Use "yearly" or "every year" instead of "on an annual basis"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(to the effect that)\b/gi, fix: 'that', msg: 'Use "that" instead of "to the effect that"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(with effect from)\b/gi, fix: 'from', msg: 'Use "from" instead of "with effect from"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(with the aim of)\b/gi, fix: 'to', msg: 'Use "to" instead of "with the aim of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(at your earliest convenience)\b/gi, fix: null, msg: 'Be specific about timing \u2014 give a date or say "as soon as you can"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(we would like to inform you that)\b/gi, fix: null, msg: 'Remove \u2014 just say the thing directly', cat: 'Plain English', title: 'Remove filler' },
      { regex: /\b(please do not hesitate to)\b/gi, fix: null, msg: 'Remove \u2014 just say "contact us" or "get in touch"', cat: 'Plain English', title: 'Remove filler' },
      { regex: /\b(I am writing to)\b/gi, fix: null, msg: 'Remove \u2014 just say what you need to say', cat: 'Plain English', title: 'Remove filler' },
      { regex: /\b(please find attached)\b/gi, fix: null, msg: 'Use "I have attached" or "here is" instead of "please find attached"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(please find enclosed)\b/gi, fix: null, msg: 'Use "I have included" or "here is" instead of "please find enclosed"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(I would be grateful if)\b/gi, fix: null, msg: 'Be direct \u2014 say "please" or just ask', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(the above(?:mentioned|[\s-]mentioned)?)\b/gi, fix: null, msg: 'Name the thing directly instead of saying "the above"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(the undersigned)\b/gi, fix: 'I', msg: 'Use "I" or "we" instead of "the undersigned"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(we wish to advise you that)\b/gi, fix: null, msg: 'Remove \u2014 just say the thing directly', cat: 'Plain English', title: 'Remove filler' },
      { regex: /\b(should you require)\b/gi, fix: 'if you need', msg: 'Use "if you need" instead of "should you require"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(prior to the commencement of)\b/gi, fix: 'before', msg: 'Use "before" instead of "prior to the commencement of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(on receipt of)\b/gi, fix: 'when we get', msg: 'Use "when we get" or "when you get" instead of "on receipt of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(in the event of non-compliance)\b/gi, fix: null, msg: 'Say what will actually happen, for example "if you do not..."', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(failure to comply)\b/gi, fix: null, msg: 'Use "if you do not" instead of "failure to comply"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(deemed to be)\b/gi, fix: 'treated as', msg: 'Use "treated as" or "counted as" instead of "deemed to be"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(irrespective of)\b/gi, fix: 'no matter', msg: 'Use "no matter" or "regardless of" instead of "irrespective of"', cat: 'Plain English', title: 'Use plain English' },
      { regex: /\b(with respect to)\b/gi, fix: 'about', msg: 'Use "about" instead of "with respect to"', cat: 'Plain English', title: 'Use plain English' }
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

    // Slash usage: GOV.UK style says use "and" or "or" instead of "/"
    if (currentMode === 'govuk') {
      var slashRegex = /\b(\w+)\s*\/\s*(\w+)\b/g;
      var slashMatch;
      while ((slashMatch = slashRegex.exec(text)) !== null) {
        // Skip URLs, file paths, dates
        if (slashMatch.index > 0 && /[:.\\]/.test(text[slashMatch.index - 1])) continue;
        if (/^https?$/i.test(slashMatch[1])) continue;
        // Skip date patterns like 01/02/2024
        if (/^\d+$/.test(slashMatch[1]) && /^\d+$/.test(slashMatch[2])) continue;
        var word1 = slashMatch[1], word2 = slashMatch[2];
        results.push({
          id: makeId(),
          ruleId: 'common-grammar',
          source: 'regex',
          group: 'style',
          category: 'GOV.UK style',
          start: slashMatch.index,
          end: slashMatch.index + slashMatch[0].length,
          message: 'GOV.UK style: use "' + word1 + ' and ' + word2 + '" or "' + word1 + ' or ' + word2 + '" instead of "/"',
          title: 'Avoid slashes',
          replacement: null,
          original: slashMatch[0]
        });
      }
    }

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
        if (/^(s|ed|er|es|ing|ly|tion|sion|ment|ness|ise|ize|ised|ized|ising|izing|isation|ization|able|ible|ful|less|ous|ive|al|ial|ary|ery|ory|ity|ance|ence|ant|ent|ist|ism)$/.test(suffix)) {
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

      // Skip words in the custom dictionary
      if (isInCustomDictionary(word)) continue;
      // Skip words that are valid English words (e.g. "mount" is not a misspelling of "amount")
      if (wordSet && wordSet.has(lower)) continue;
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
          message: 'Did you mean "' + replacement + '"?',
          title: 'Missing letter',
          replacement: replacement,
          original: word
        });
      }
    }
    return results;
  }

  // Sentence-length and passive voice detection live in full-check.js only (runs via "Check now").

  /**
   * Check date format issues (GOV.UK style: "1 January 2024").
   */
  var MONTHS_FULL = 'January|February|March|April|May|June|July|August|September|October|November|December';
  var MONTHS_ABBR = 'Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec';
  var MONTHS_ALL = MONTHS_FULL + '|' + MONTHS_ABBR;

  function checkDateFormat(text) {
    var results = [];
    var match;

    // 1. Numeric dates with slashes: 01/01/2024, 1/1/24
    var numericSlash = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g;
    while ((match = numericSlash.exec(text)) !== null) {
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

    // 2. Numeric dates with dashes: 01-01-2024, 2024-01-15 (ISO)
    var numericDash = /\b(\d{1,4})[-.](\d{1,2})[-.](\d{1,4})\b/g;
    while ((match = numericDash.exec(text)) !== null) {
      // Skip time-like patterns (e.g. 9.30) and version numbers
      var p1 = parseInt(match[1], 10);
      var p3 = parseInt(match[3], 10);
      if (p1 <= 31 && p3 <= 31 && parseInt(match[2], 10) <= 12) {
        // Looks like a date
      } else if ((p1 >= 1900 && p1 <= 2099) || (p3 >= 1900 && p3 <= 2099)) {
        // Contains a year
      } else {
        continue; // Not a date
      }
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

    // 3. Ordinals with dates: "1st January", "2nd March", "1st Jan"
    var ordinalDate = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)\\s+(' + MONTHS_ALL + ')\\b', 'gi');
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

    // 4. Month-first format (US style): "January 1st", "January 1, 2024", "January 1 2024"
    var monthFirst = new RegExp('\\b(' + MONTHS_FULL + ')\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b', 'gi');
    while ((match = monthFirst.exec(text)) !== null) {
      var day = match[2];
      var month = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
      var year = match[3] || '';
      var fix = day + ' ' + month + (year ? ' ' + year : '');
      results.push({
        id: makeId(),
        ruleId: 'date-format',
        source: 'regex',
        group: 'style',
        category: 'Date format',
        start: match.index,
        end: match.index + match[0].length,
        message: 'GOV.UK style: write date as "' + fix + '" (day before month)',
        title: 'Date format',
        replacement: fix,
        original: match[0]
      });
    }

    // 5. Abbreviated months: "1 Jan 2024", "15 Sept 2024", "3 Oct"
    var abbrMonth = new RegExp('\\b(\\d{1,2})\\s+(' + MONTHS_ABBR + ')\\.?(?:\\s+(\\d{4}))?\\b', 'gi');
    while ((match = abbrMonth.exec(text)) !== null) {
      // Map abbreviated month to full name
      var abbrMap = {
        'jan': 'January', 'feb': 'February', 'mar': 'March', 'apr': 'April',
        'jun': 'June', 'jul': 'July', 'aug': 'August', 'sep': 'September',
        'sept': 'September', 'oct': 'October', 'nov': 'November', 'dec': 'December'
      };
      var fullMonth = abbrMap[match[2].toLowerCase()];
      if (fullMonth) {
        var abbrFix = match[1] + ' ' + fullMonth + (match[3] ? ' ' + match[3] : '');
        results.push({
          id: makeId(),
          ruleId: 'date-format',
          source: 'regex',
          group: 'style',
          category: 'Date format',
          start: match.index,
          end: match.index + match[0].length,
          message: 'GOV.UK style: write months in full — "' + abbrFix + '"',
          title: 'Date format',
          replacement: abbrFix,
          original: match[0]
        });
      }
    }

    // 6. Ordinals after month (US style with ordinals): "January 1st"
    var monthOrdinal = new RegExp('\\b(' + MONTHS_ALL + ')\\s+(\\d{1,2})(?:st|nd|rd|th)\\b', 'gi');
    while ((match = monthOrdinal.exec(text)) !== null) {
      var moMonth = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
      var moFix = match[2] + ' ' + moMonth;
      results.push({
        id: makeId(),
        ruleId: 'date-format',
        source: 'regex',
        group: 'style',
        category: 'Date format',
        start: match.index,
        end: match.index + match[0].length,
        message: 'GOV.UK style: write "' + moFix + '" — day before month, no ordinals',
        title: 'Date format',
        replacement: moFix,
        original: match[0]
      });
    }

    // 7. Financial year formats: 2024/25, 2024-25, 2024/2025, FY2024, FY24/25, FY 2024-25
    // GOV.UK style: "2024 to 2025"
    var fySlashShort = /\b((?:FY\s*)?)(20\d{2})\s*[\/\-]\s*(\d{2,4})\b/gi;
    while ((match = fySlashShort.exec(text)) !== null) {
      var fyPrefix = match[1];
      var fyStart = match[2];
      var fyEndRaw = match[3];
      // Skip if this is a numeric date (has a third segment)
      var afterFy = text.substring(match.index + match[0].length, match.index + match[0].length + 3);
      if (/^[\/\-]\d/.test(afterFy)) continue;
      // Build full end year
      var fyEnd = fyEndRaw.length === 2 ? fyStart.substring(0, 2) + fyEndRaw : fyEndRaw;
      // Validate it's plausible as a financial year (end = start + 1)
      var startNum = parseInt(fyStart, 10);
      var endNum = parseInt(fyEnd, 10);
      if (endNum !== startNum + 1 && endNum !== startNum) continue;
      var fyFix = fyStart + ' to ' + fyEnd;
      results.push({
        id: makeId(),
        ruleId: 'date-format',
        source: 'regex',
        group: 'style',
        category: 'Date format',
        start: match.index,
        end: match.index + match[0].length,
        message: 'GOV.UK style: write financial years as "' + fyFix + '"',
        title: 'Financial year format',
        replacement: fyFix,
        original: match[0]
      });
    }

    // 8. Standalone "FY2024" or "FY 2024" without a range
    var fyStandalone = /\bFY\s*(\d{4})\b/gi;
    while ((match = fyStandalone.exec(text)) !== null) {
      // Skip if already caught by the range regex above
      var afterStandalone = text.substring(match.index + match[0].length, match.index + match[0].length + 3);
      if (/^[\/\-]\d/.test(afterStandalone)) continue;
      results.push({
        id: makeId(),
        ruleId: 'date-format',
        source: 'regex',
        group: 'style',
        category: 'Date format',
        start: match.index,
        end: match.index + match[0].length,
        message: 'GOV.UK style: avoid "FY" prefix — write the year or financial year in full',
        title: 'Financial year format',
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
        message: 'GOV.UK style guide recommends avoiding exclamation marks. Consider using a full stop instead.',
        title: 'Exclamation mark',
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

    // Find mid-sentence occurrences of words that should be lower case
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

    // Generic terms that should be lower case mid-sentence (GOV.UK style)
    // Only flag when NOT part of a proper name (e.g. "the minister said" not "Minister for Defence")
    var genericTerms = [
      { word: 'Minister', lower: 'minister', except: /Minister\s+(?:of|for|of\s+State)/i },
      { word: 'Department', lower: 'department', except: /Department\s+(?:of|for)/i },
      { word: 'Committee', lower: 'committee', except: /Committee\s+(?:of|on|for)/i },
      { word: 'Board', lower: 'board', except: /Board\s+(?:of)/i },
      { word: 'Act', lower: 'act', except: /(?:the\s+\w+\s+)?Act\s+\d{4}/i },
      { word: 'White Paper', lower: 'white paper', except: null },
      { word: 'Green Paper', lower: 'green paper', except: null },
      { word: 'Civil Servant', lower: 'civil servant', except: null },
      { word: 'Civil Service', lower: 'civil service', except: /Civil\s+Service\s+(?:Commission|Code)/i },
      { word: 'Council', lower: 'council', except: /Council\s+(?:of|for|Tax)/i },
      { word: 'Executive', lower: 'executive', except: /(?:Chief|Senior)\s+Executive/i },
      { word: 'Strategy', lower: 'strategy', except: null },
      { word: 'Policy', lower: 'policy', except: null },
      { word: 'Programme', lower: 'programme', except: null },
      { word: 'Project', lower: 'project', except: null }
    ];

    genericTerms.forEach(function (term) {
      var termRegex = new RegExp('[a-z,;:]\\s+(' + term.word.replace(/\s+/g, '\\s+') + ')\\b', 'g');
      while ((match = termRegex.exec(text)) !== null) {
        var tStart = match.index + match[0].indexOf(match[1]);
        // Check exception pattern — skip if this is part of a proper name
        if (term.except) {
          var context = text.substring(Math.max(0, tStart - 20), Math.min(text.length, tStart + match[1].length + 30));
          if (term.except.test(context)) continue;
        }
        results.push({
          id: makeId(),
          ruleId: 'govuk-capitalisation',
          source: 'regex',
          group: 'style',
          category: 'GOV.UK style',
          start: tStart,
          end: tStart + match[1].length,
          message: 'GOV.UK style: "' + term.lower + '" is lower case when used generically',
          title: 'GOV.UK style',
          replacement: term.lower,
          original: match[1]
        });
      }
    });

    // Job titles should be lower case when generic: "the director said" not "the Director said"
    var jobTitles = [
      'Director', 'Chair', 'Chairman', 'Chairwoman', 'Chairperson',
      'Secretary', 'Treasurer', 'Officer', 'Manager', 'Adviser', 'Advisor',
      'Commissioner', 'Inspector', 'Ombudsman', 'Permanent Secretary'
    ];
    jobTitles.forEach(function (title) {
      var titleRegex = new RegExp('[a-z,;:]\\s+(?:the\\s+)?(' + title.replace(/\s+/g, '\\s+') + ')\\b(?!\\s+(?:of|for|General))', 'g');
      while ((match = titleRegex.exec(text)) !== null) {
        var jStart = match.index + match[0].indexOf(match[1]);
        results.push({
          id: makeId(),
          ruleId: 'govuk-capitalisation',
          source: 'regex',
          group: 'style',
          category: 'GOV.UK style',
          start: jStart,
          end: jStart + match[1].length,
          message: 'GOV.UK style: job titles are lower case when used generically — "' + match[1].toLowerCase() + '"',
          title: 'GOV.UK style',
          replacement: match[1].toLowerCase(),
          original: match[1]
        });
      }
    });

    return results;
  }

  /**
   * Check that abbreviations/acronyms are spelled out on first use.
   * Detects uppercase abbreviations (2+ letters) and checks whether
   * the full form appears earlier in the text with the abbreviation in brackets.
   * E.g. "Subject Matter Expert (SME)" then "SME" is fine.
   * But if "SME" appears without prior definition, flag it.
   */
  function checkAbbreviationFirstUse(text) {
    if (currentMode !== 'govuk') return [];
    var results = [];

    // Common abbreviations that don't need spelling out (well-known)
    var wellKnown = new Set([
      'UK', 'US', 'USA', 'EU', 'UN', 'NHS', 'BBC', 'GDP', 'VAT', 'MP', 'PM',
      'CEO', 'IT', 'HR', 'PR', 'CV', 'ID', 'PIN', 'ATM', 'PDF', 'URL', 'HTML',
      'CSS', 'API', 'FAQ', 'DIY', 'ASAP', 'FYI', 'HMRC', 'DVLA', 'DWP', 'MOD',
      'MOJ', 'CPS', 'DEFRA', 'OFSTED', 'NATO', 'AIDS', 'HIV', 'DNA', 'RNA',
      'GCSE', 'PhD', 'MBA', 'BA', 'MA', 'MSc', 'BSc', 'OBE', 'MBE', 'CBE',
      'KBE', 'AM', 'PM', 'AD', 'BC', 'GP', 'ICU', 'A&E', 'NHS', 'NI', 'GB',
      'GOV', 'FOI', 'DPA', 'GDPR', 'ICO', 'BAME', 'SEND', 'SEN', 'NEET',
      'COO', 'CFO', 'CTO', 'CMO', 'CSO', 'CPO', 'OK'
    ]);

    // Find all uppercase abbreviations (2-8 capital letters, possibly with numbers)
    var abbrRegex = /\b([A-Z][A-Z0-9]{1,7})\b/g;
    var match;
    var found = {}; // track first occurrence of each abbreviation

    while ((match = abbrRegex.exec(text)) !== null) {
      var abbr = match[1];
      if (wellKnown.has(abbr)) continue;
      if (found[abbr]) continue; // Already flagged or defined
      found[abbr] = true;

      // Check if there's a definition before this point: "Full Name (ABBR)" pattern
      var before = text.substring(0, match.index);
      // Look for "(ABBR)" preceded by words that could be the expansion
      var defPattern = new RegExp('\\(' + abbr + '\\)', 'i');
      if (defPattern.test(before)) continue; // Defined earlier, OK

      // Also check if the abbreviation appears in brackets right here (this IS the definition)
      var surroundStart = Math.max(0, match.index - 1);
      var surroundEnd = Math.min(text.length, match.index + abbr.length + 1);
      var surrounding = text.substring(surroundStart, surroundEnd);
      if (/^\(/.test(surrounding) && /\)$/.test(surrounding)) continue; // This is the definition itself

      results.push({
        id: makeId(),
        ruleId: 'abbreviation-first-use',
        source: 'regex',
        group: 'style',
        category: 'Abbreviations',
        start: match.index,
        end: match.index + abbr.length,
        message: 'GOV.UK style: spell out "' + abbr + '" in full the first time you use it, then put the abbreviation in brackets — e.g. "Full Name (' + abbr + ')"',
        title: 'Abbreviation not defined',
        original: abbr
      });
    }

    return results;
  }

  /**
   * Additional GOV.UK style guide checks not covered by the plain English rules.
   */
  function checkGovukExtraStyle(text) {
    if (currentMode !== 'govuk') return [];
    var results = [];
    var match;

    var extraRules = [
      // Ampersand — use "and"
      { regex: /\s(&)\s/g, fix: 'and', msg: 'GOV.UK style: use "and" not "&" (ampersand)', title: 'Use "and"' },
      // "should" — GOV.UK says use "must" for requirements, "can" for permissions
      { regex: /\b(should)\b/gi, fix: null, msg: 'GOV.UK style: use "must" for things people have to do, "can" for things they may do — avoid "should"', title: 'Avoid "should"' },
      // "click" — GOV.UK says "select" for digital content
      { regex: /\b(click(?:ed|s|ing)?)\b/gi, fix: 'select', msg: 'GOV.UK style: use "select" instead of "click" — not everyone uses a mouse', title: 'Use "select"' },
      // "smartphone" — use "phone"
      { regex: /\b(smartphones?)\b/gi, fix: 'phone', msg: 'GOV.UK style: use "phone" instead of "smartphone"', title: 'Use "phone"' },
      // "shall" — use "will" or "must"
      { regex: /\b(shall)\b/gi, fix: 'will', msg: 'GOV.UK style: use "will" or "must" instead of "shall"', title: 'Use plain English' },
      // "aforementioned" — name the specific thing
      { regex: /\b(aforementioned|above-mentioned|abovementioned)\b/gi, fix: null, msg: 'GOV.UK style: do not use "aforementioned" — name the specific thing', title: 'Use plain English' },
      // Legal language
      { regex: /\b(herewith|hereby|herein|hereinafter|hereunder|thereof|therein|thereto|whereby|wherein)\b/gi, fix: null, msg: 'GOV.UK style: avoid legal language — rephrase in plain English', title: 'Avoid legal language' },
      // "at this time" — use "now"
      { regex: /\bat\s+this\s+time\b/gi, fix: 'now', msg: 'GOV.UK style: use "now"', title: 'Use plain English' },
      // "in the event that" — use "if"
      { regex: /\bin\s+the\s+event\s+that\b/gi, fix: 'if', msg: 'GOV.UK style: use "if"', title: 'Use plain English' },
      // "with a view to" — use "to"
      { regex: /\bwith\s+a\s+view\s+to\b/gi, fix: 'to', msg: 'GOV.UK style: use "to"', title: 'Use plain English' },
      // "on behalf of" can often just be "for"
      { regex: /\bon\s+behalf\s+of\b/gi, fix: 'for', msg: 'GOV.UK style: consider using "for" instead of "on behalf of"', title: 'Use plain English' },
      // "in excess of" — use "more than"
      { regex: /\bin\s+excess\s+of\b/gi, fix: 'more than', msg: 'GOV.UK style: use "more than"', title: 'Use plain English' },
      // "in conjunction with" — use "with"
      { regex: /\bin\s+conjunction\s+with\b/gi, fix: 'with', msg: 'GOV.UK style: use "with"', title: 'Use plain English' },
      // "it should be noted that" — just state the thing
      { regex: /\bit\s+should\s+be\s+noted\s+that\b/gi, fix: null, msg: 'GOV.UK style: remove "it should be noted that" — just state the point', title: 'Remove filler' },
      // "please note that" — just state it
      { regex: /\bplease\s+note\s+that\b/gi, fix: null, msg: 'GOV.UK style: remove "please note that" — just state the point', title: 'Remove filler' },
      // "as a consequence of" — use "because"
      { regex: /\bas\s+a\s+(?:consequence|result)\s+of\b/gi, fix: 'because of', msg: 'GOV.UK style: use "because of"', title: 'Use plain English' },
      // "at the end of the day"
      { regex: /\bat\s+the\s+end\s+of\s+the\s+day\b/gi, fix: null, msg: 'GOV.UK style: avoid clichés — say what you actually mean', title: 'Avoid clichés' },
      // "touch base"
      { regex: /\btouch\s+base\b/gi, fix: 'contact', msg: 'GOV.UK style: use "contact", "speak to", or "meet"', title: 'Avoid clichés' },
      // "going forward" already handled in words-to-avoid, but "moving forward" too
      { regex: /\bmoving\s+forwards?\b/gi, fix: 'from now on', msg: 'GOV.UK style: say "from now on" or be specific about timing', title: 'Avoid clichés' },
      // "best practice" — say what you actually mean
      { regex: /\bbest\s+practice\b/gi, fix: null, msg: 'GOV.UK style: avoid "best practice" — describe what the practice actually is', title: 'Word to avoid' },
      // "stakeholder" — say who you mean
      { regex: /\b(stakeholders?)\b/gi, fix: null, msg: 'GOV.UK style: avoid "stakeholder" — say who you mean specifically', title: 'Word to avoid' },
      // "robust" — overused, be specific
      { regex: /\b(robust)\b/gi, fix: null, msg: 'GOV.UK style: avoid "robust" — be specific about what makes it strong', title: 'Word to avoid' },
      // "streamline" — say what you mean
      { regex: /\b(streamlin(?:e|ed|ing|es))\b/gi, fix: null, msg: 'GOV.UK style: avoid "streamline" — say what you actually mean', title: 'Word to avoid' },
      // "drive" (as in "drive change") — be specific
      { regex: /\b(drive)\b(?=\s+(?:change|growth|improvement|innovation|transformation|value|efficiency|results|outcomes|performance|progress))/gi, fix: null, msg: 'GOV.UK style: avoid "drive" in this sense — be specific about what action you mean', title: 'Word to avoid' },
      // "pipeline"
      { regex: /\b(pipeline)\b(?!\s+(?:gas|oil|water|data))/gi, fix: null, msg: 'GOV.UK style: avoid "pipeline" unless literal — say what you mean', title: 'Word to avoid' }
    ];

    extraRules.forEach(function (rule) {
      while ((match = rule.regex.exec(text)) !== null) {
        var mStart = match.index;
        var mEnd = match.index + match[0].length;
        // For ampersand, adjust to just the & character
        if (match[0].trim() === '&') {
          mStart = match.index + match[0].indexOf('&');
          mEnd = mStart + 1;
        }
        results.push({
          id: makeId(),
          ruleId: 'govuk-extra-style',
          source: 'regex',
          group: 'style',
          category: 'GOV.UK style',
          start: mStart,
          end: mEnd,
          message: rule.msg,
          title: rule.title,
          replacement: rule.fix || undefined,
          original: match[0].trim()
        });
      }
    });

    return results;
  }

  // ---------------------------------------------------------------------------
  // List formatting checks
  // ---------------------------------------------------------------------------
  function checkListFormatting(text) {
    var results = [];
    var lines = text.split('\n');

    // Build array of {line, offset, text} with absolute char offsets
    var entries = [];
    var offset = 0;
    for (var i = 0; i < lines.length; i++) {
      entries.push({ idx: i, offset: offset, text: lines[i] });
      offset += lines[i].length + 1; // +1 for '\n'
    }

    var bulletRe = /^([\t ]*)([-*\u2022\u2013\u2014]|\d+[.):])(\s+)(.*)/;

    // Group consecutive list items
    var groups = [];
    var current = null;
    for (var i = 0; i < entries.length; i++) {
      var m = bulletRe.exec(entries[i].text);
      if (m) {
        var item = {
          entry: entries[i],
          indent: m[1],
          marker: m[2],
          space: m[3],
          content: m[4],
          contentStart: entries[i].offset + m[1].length + m[2].length + m[3].length,
          contentEnd: entries[i].offset + entries[i].text.length
        };
        if (!current) {
          // Find lead-in: last non-blank line before this group
          var leadIn = null;
          for (var j = i - 1; j >= 0; j--) {
            if (entries[j].text.trim() !== '') {
              leadIn = entries[j];
              break;
            }
          }
          current = { items: [item], leadIn: leadIn };
        } else {
          current.items.push(item);
        }
      } else {
        if (current && current.items.length >= 2) {
          groups.push(current);
        }
        current = null;
      }
    }
    if (current && current.items.length >= 2) {
      groups.push(current);
    }

    groups.forEach(function (group) {
      var items = group.items;

      // Check 1: Inconsistent end punctuation
      var endings = items.map(function (it) {
        var c = it.content.trim();
        if (!c) return 'none';
        var last = c[c.length - 1];
        if (last === ',' || last === ';' || last === '.') return last;
        return 'none';
      });
      var endCounts = {};
      endings.forEach(function (e) { endCounts[e] = (endCounts[e] || 0) + 1; });
      var majorEnd = 'none';
      var majorCount = 0;
      for (var k in endCounts) {
        if (endCounts[k] > majorCount) { majorCount = endCounts[k]; majorEnd = k; }
      }
      if (Object.keys(endCounts).length > 1) {
        items.forEach(function (it, idx) {
          if (endings[idx] !== majorEnd) {
            results.push({
              id: makeId(),
              ruleId: 'list-formatting',
              source: 'regex',
              group: 'style',
              category: 'Lists',
              start: it.contentStart,
              end: it.contentEnd,
              message: 'List items have mixed punctuation endings. Pick one style for all items.',
              title: 'Inconsistent list punctuation',
              replacement: null,
              original: it.content
            });
          }
        });
      }

      // Check 2: Capitalisation inconsistency
      var allSentences = items.every(function (it) {
        var c = it.content.trim();
        return c.length > 0 && /^[A-Z]/.test(c) && /\.$/.test(c);
      });
      if (!allSentences) {
        items.forEach(function (it) {
          var c = it.content.trim();
          if (c.length > 0 && /^[A-Z]/.test(c)) {
            var lowered = c[0].toLowerCase() + c.slice(1);
            results.push({
              id: makeId(),
              ruleId: 'list-formatting',
              source: 'regex',
              group: 'style',
              category: 'Lists',
              start: it.contentStart,
              end: it.contentStart + 1,
              message: 'GOV.UK style: list items should start with a lowercase letter (they continue the lead-in sentence).',
              title: 'Lowercase list items',
              replacement: c[0].toLowerCase(),
              original: c[0]
            });
          }
        });
      }

      // Check 3: Lead-in line missing colon
      if (group.leadIn) {
        var leadText = group.leadIn.text.trimRight();
        if (leadText.length > 0 && !/:$/.test(leadText)) {
          var leadEnd = group.leadIn.offset + group.leadIn.text.length;
          var trailingPunc = /[.;,!?]$/.test(leadText);
          var replStart, replEnd, repl;
          if (trailingPunc) {
            replStart = leadEnd - 1;
            replEnd = leadEnd;
            repl = ':';
          } else {
            replStart = leadEnd;
            replEnd = leadEnd;
            repl = ':';
          }
          results.push({
            id: makeId(),
            ruleId: 'list-formatting',
            source: 'regex',
            group: 'style',
            category: 'Lists',
            start: replStart,
            end: replEnd,
            message: 'A lead-in line before a bullet list should end with a colon.',
            title: 'Lead-in needs colon',
            replacement: repl,
            original: trailingPunc ? leadText[leadText.length - 1] : ''
          });
        }
      }

      // Check 4: Nested/sub-bullets
      var baseIndent = items[0].indent.length;
      items.forEach(function (it) {
        if (it.indent.length > baseIndent) {
          var nestStart = it.entry.offset;
          results.push({
            id: makeId(),
            ruleId: 'list-formatting',
            source: 'regex',
            group: 'style',
            category: 'Lists',
            start: nestStart,
            end: it.contentEnd,
            message: 'GOV.UK style: avoid nested (sub) bullets. Restructure as a flat list or separate lists.',
            title: 'Avoid nested bullets',
            replacement: null,
            original: it.entry.text
          });
        }
      });

      // Check 5: Repeated trailing punctuation
      items.forEach(function (it) {
        var repMatch = /([,;.!?])\1+$/.exec(it.content);
        if (repMatch) {
          var repStart = it.contentStart + repMatch.index;
          var repEnd = it.contentStart + repMatch.index + repMatch[0].length;
          results.push({
            id: makeId(),
            ruleId: 'list-formatting',
            source: 'regex',
            group: 'correctness',
            category: 'Lists',
            start: repStart,
            end: repEnd,
            message: 'Repeated punctuation at the end of a list item.',
            title: 'Repeated punctuation',
            replacement: repMatch[1],
            original: repMatch[0]
          });
        }
      });

      // Check 6: "etc" in list items
      items.forEach(function (it) {
        var etcRe = /\betc\b\.?/gi;
        var etcMatch;
        while ((etcMatch = etcRe.exec(it.content)) !== null) {
          results.push({
            id: makeId(),
            ruleId: 'list-formatting',
            source: 'regex',
            group: 'style',
            category: 'Lists',
            start: it.contentStart + etcMatch.index,
            end: it.contentStart + etcMatch.index + etcMatch[0].length,
            message: 'Lists already imply there may be more items. Rephrase the lead-in with "such as" or "includes" instead of using "etc".',
            title: 'Avoid "etc" in lists',
            replacement: null,
            original: etcMatch[0]
          });
        }
      });
    });

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
    'list-formatting': 4,
    'capitalisation': 3,
    'double-space': 2,
    'punctuation-spacing': 2
  };

  function runAll(text) {
    console.log('[QuickChecks] runAll called, text length=' + (text ? text.length : 0) + ', rules=' + rules.length + ', dictLoaded=' + dictLoaded + ', wordSet=' + !!wordSet);
    var allResults = [];
    rules.forEach(function (rule) {
      try {
        var results = rule.run(text);
        if (results.length > 0) {
          console.log('[QuickChecks] rule "' + rule.id + '" found ' + results.length + ' issues');
        }
        allResults = allResults.concat(results);
      } catch (e) {
        console.warn('QuickChecks: rule "' + rule.id + '" threw:', e);
      }
    });

    // Deduplicate: if two results overlap the same text range, keep the
    // higher-priority (more specific) one. E.g. missing-letter beats capitalisation.
    allResults.sort(function (a, b) {
      return a.start - b.start || (RULE_PRIORITY[b.ruleId] || 5) - (RULE_PRIORITY[a.ruleId] || 5);
    });

    var deduped = [];
    for (var i = 0; i < allResults.length; i++) {
      var current = allResults[i];
      var currentPri = RULE_PRIORITY[current.ruleId] || 5;

      var overlapping = [];
      var nonOverlapping = [];
      for (var j = 0; j < deduped.length; j++) {
        var kept = deduped[j];
        if (current.start < kept.end && current.end > kept.start) {
          overlapping.push(kept);
        } else {
          nonOverlapping.push(kept);
        }
      }

      // If any overlapping kept item has equal or higher priority, current is dominated
      var dominated = overlapping.some(function (k) {
        return (RULE_PRIORITY[k.ruleId] || 5) >= currentPri;
      });

      if (!dominated) {
        // current wins — discard all lower-priority overlapping items and add current
        deduped = nonOverlapping;
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
    console.log('[QuickChecks] Check scheduled (version=' + version + ', debounce=' + DEBOUNCE_MS + 'ms)');

    debounceTimer = setTimeout(function () {
      // Check version hasn't changed
      if (version !== pendingVersion) return;

      var results = runAll(text);
      console.log('[QuickChecks] Check complete: ' + results.length + ' results after dedup');
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

  /**
   * Custom dictionary — words that should not be flagged as spelling mistakes.
   */
  var customDictSet = new Set();

  function setCustomDictionary(words) {
    customDictSet = new Set();
    (words || []).forEach(function (w) {
      customDictSet.add(w.toLowerCase());
    });
  }

  function isInCustomDictionary(word) {
    return customDictSet.has(word.toLowerCase());
  }

  return {
    runAll: runAll,
    scheduleCheck: scheduleCheck,
    cancelPending: cancelPending,
    setMode: setMode,
    getMode: getMode,
    setCustomDictionary: setCustomDictionary,
    isInCustomDictionary: isInCustomDictionary,
    isDictionaryLoaded: function () { return dictLoaded || wordSet !== null; }
  };
})();
