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
    { regex: /\b(pacific)\s+(reason|example|issue|case|time|date|detail|requirement)/gi, msg: 'Did you mean "specific"?', fix: 'specific', matchGroup: 1 }
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

      // --- Plain English (GOV.UK only): single-word replacements ---
      // These are normal business words in email/chat, but GOV.UK style guide says simplify.
      { regex: /\b(utilise)\b/gi, fix: 'use', msg: 'Prefer "use" over "utilise" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(utilisation)\b/gi, fix: 'use', msg: 'Prefer "use" over "utilisation" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(commence)\b/gi, fix: 'start', msg: 'Prefer "start" over "commence" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(purchase)\b/gi, fix: 'buy', msg: 'Prefer "buy" over "purchase" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(regarding)\b/gi, fix: 'about', msg: 'Prefer "about" over "regarding" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(facilitate)\b/gi, fix: 'help', msg: 'Prefer "help" over "facilitate" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(endeavour)\b/gi, fix: 'try', msg: 'Prefer "try" over "endeavour" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(terminate)\b/gi, fix: 'end', msg: 'Prefer "end" over "terminate" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(additional)\b/gi, fix: 'extra', msg: 'Prefer "extra" or "more" over "additional" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(accordingly)\b/gi, fix: 'so', msg: 'Prefer "so" over "accordingly" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(subsequently)\b/gi, fix: 'then', msg: 'Prefer "then" over "subsequently" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(approximately)\b/gi, fix: 'about', msg: 'Prefer "about" over "approximately" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(furthermore)\b/gi, fix: 'also', msg: 'Prefer "also" over "furthermore" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(nevertheless)\b/gi, fix: 'but', msg: 'Prefer "but" or "however" over "nevertheless" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(notwithstanding)\b/gi, fix: 'despite', msg: 'Prefer "despite" over "notwithstanding" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(ascertain)\b/gi, fix: 'find out', msg: 'Prefer "find out" over "ascertain" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(demonstrate)\b/gi, fix: 'show', msg: 'Prefer "show" over "demonstrate" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(consequently)\b/gi, fix: 'so', msg: 'Prefer "so" over "consequently" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(assistance)\b/gi, fix: 'help', msg: 'Prefer "help" over "assistance" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(sufficient)\b/gi, fix: 'enough', msg: 'Prefer "enough" over "sufficient" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(obtain)\b/gi, fix: 'get', msg: 'Prefer "get" over "obtain" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(require)\b/gi, fix: 'need', msg: 'Prefer "need" over "require" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(requirement)\b/gi, fix: 'need', msg: 'Prefer "need" over "requirement" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(modify)\b/gi, fix: 'change', msg: 'Prefer "change" over "modify" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(submit)\b/gi, fix: 'send', msg: 'Prefer "send" over "submit" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(upon)\b/gi, fix: 'on', msg: 'Prefer "on" over "upon" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(whilst)\b/gi, fix: 'while', msg: 'Prefer "while" over "whilst" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(amongst)\b/gi, fix: 'among', msg: 'Prefer "among" over "amongst" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(attempt)\b/gi, fix: 'try', msg: 'Prefer "try" over "attempt" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(initiate)\b/gi, fix: 'start', msg: 'Prefer "start" over "initiate" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(implement)\b/gi, fix: 'carry out', msg: 'Prefer "carry out" or "set up" over "implement" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
      { regex: /\b(indicate)\b/gi, fix: 'show', msg: 'Prefer "show" or "suggest" over "indicate" for plain English', cat: 'Plain English', title: 'Use plain English', modes: ['govuk'] },
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
      { regex: /\betc\.?\b/gi, fix: null, msg: 'GOV.UK style: avoid "etc" — list the items or say "for example"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\bie\b/gi, fix: 'that is', msg: 'Write "that is" or rephrase instead of "ie"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\beg\b/gi, fix: 'for example', msg: 'Write "for example" instead of "eg"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\bvia\b/gi, fix: 'through', msg: 'GOV.UK style: use "through" or "by" instead of "via"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\bi\.e\.\b/gi, fix: 'that is', msg: 'Write "that is" or rephrase instead of "i.e."', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },
      { regex: /\be\.g\.\b/gi, fix: 'for example', msg: 'Write "for example" instead of "e.g."', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] },

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
      { regex: /\bfinancial\s+penalt(?:y|ies)\b/gi, fix: 'fine', msg: 'GOV.UK style: use "fine" instead of "financial penalty"', cat: 'GOV.UK style', title: 'GOV.UK style', group: 'style', modes: ['govuk'] }
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
