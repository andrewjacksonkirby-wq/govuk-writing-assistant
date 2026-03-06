#!/usr/bin/env python3
"""
Expand a Hunspell .dic + .aff into a flat word list of all valid forms.
Also supplements with additional common English words to ensure coverage.
Outputs a sorted, deduplicated, one-word-per-line text file.
"""

import re
import sys
import json


def parse_aff(aff_path):
    """Parse .aff file to extract prefix and suffix rules."""
    prefixes = {}  # flag -> list of (strip, add, condition_regex)
    suffixes = {}
    cross_product = {}  # flag -> bool (Y = can combine with other affixes)

    with open(aff_path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue

            parts = line.split()
            if len(parts) < 4:
                continue

            if parts[0] in ('PFX', 'SFX'):
                kind = parts[0]
                flag = parts[1]

                # Header line: PFX/SFX flag cross_product count
                if len(parts) == 4 and parts[3].isdigit():
                    cross_product[flag] = (parts[2] == 'Y')
                    if kind == 'PFX' and flag not in prefixes:
                        prefixes[flag] = []
                    elif kind == 'SFX' and flag not in suffixes:
                        suffixes[flag] = []
                    continue

                # Rule line: PFX/SFX flag strip add condition
                if len(parts) >= 5:
                    strip = parts[2]
                    add = parts[3]
                    condition = parts[4] if len(parts) > 4 else '.'

                    if strip == '0':
                        strip = ''
                    if add == '0':
                        add = ''

                    # Convert condition to regex
                    if condition == '.':
                        cond_re = re.compile('.*')
                    else:
                        if kind == 'SFX':
                            cond_re = re.compile(condition + '$')
                        else:
                            cond_re = re.compile('^' + condition)

                    if kind == 'PFX':
                        if flag not in prefixes:
                            prefixes[flag] = []
                        prefixes[flag].append((strip, add, cond_re))
                    else:
                        if flag not in suffixes:
                            suffixes[flag] = []
                        suffixes[flag].append((strip, add, cond_re))

    return prefixes, suffixes, cross_product


def apply_suffix(word, strip, add):
    if strip:
        if word.endswith(strip):
            return word[:-len(strip)] + add
        return None
    return word + add


def apply_prefix(word, strip, add):
    if strip:
        if word.startswith(strip):
            return add + word[len(strip):]
        return None
    return add + word


def expand_word(word, flags, prefixes, suffixes, cross_product):
    """Generate all valid forms of a word given its flags."""
    forms = {word}

    # Apply suffixes
    suffix_forms = set()
    for flag in flags:
        if flag in suffixes:
            for strip, add, cond_re in suffixes[flag]:
                if cond_re.search(word):
                    result = apply_suffix(word, strip, add)
                    if result:
                        suffix_forms.add(result)

    forms.update(suffix_forms)

    # Apply prefixes
    prefix_forms = set()
    for flag in flags:
        if flag in prefixes:
            for strip, add, cond_re in prefixes[flag]:
                if cond_re.search(word):
                    result = apply_prefix(word, strip, add)
                    if result:
                        prefix_forms.add(result)

    forms.update(prefix_forms)

    # Cross-product: apply prefixes to suffixed forms (and vice versa)
    for pflag in flags:
        if pflag in prefixes and cross_product.get(pflag, False):
            for sflag in flags:
                if sflag in suffixes and cross_product.get(sflag, False):
                    # Apply suffix first, then prefix
                    for sstrip, sadd, scond in suffixes[sflag]:
                        if scond.search(word):
                            suffixed = apply_suffix(word, sstrip, sadd)
                            if suffixed:
                                for pstrip, padd, pcond in prefixes[pflag]:
                                    if pcond.search(suffixed):
                                        result = apply_prefix(suffixed, pstrip, padd)
                                        if result:
                                            forms.add(result)

    return forms


def parse_dic(dic_path):
    """Parse .dic file into list of (word, flags) tuples."""
    words = []
    with open(dic_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    # First line is word count
    for line in lines[1:]:
        line = line.strip()
        if not line:
            continue
        slash_idx = line.find('/')
        if slash_idx != -1:
            word = line[:slash_idx]
            flags = line[slash_idx + 1:]
        else:
            word = line
            flags = ''
        words.append((word, flags))

    return words


# Additional common English words that are often missing from small dictionaries.
# These are all valid British English words.
SUPPLEMENTAL_WORDS = {
    # Common words that get flagged
    "about", "above", "actually", "after", "again", "against", "all", "also",
    "always", "among", "another", "any", "anything", "around", "away",
    "back", "because", "been", "before", "being", "below", "between", "both",
    "but", "by", "came", "can", "cannot", "come", "could",
    "day", "days", "did", "different", "do", "does", "done", "down", "during",
    "each", "end", "enough", "even", "every", "example",
    "far", "few", "find", "first", "for", "found", "from",
    "get", "give", "go", "going", "gone", "good", "got", "great",
    "had", "has", "have", "having", "he", "help", "her", "here", "him",
    "his", "home", "how", "however",
    "if", "important", "in", "into", "is", "it", "its",
    "just", "keep", "kind", "know", "known",
    "large", "last", "left", "let", "life", "like", "line", "little",
    "long", "look", "made", "make", "man", "many", "may", "me",
    "might", "more", "most", "much", "must", "my",
    "name", "need", "never", "new", "next", "no", "not", "now", "number",
    "of", "off", "often", "old", "on", "once", "one", "only", "or",
    "other", "our", "out", "over", "own",
    "part", "people", "place", "point", "put",
    "quite", "really", "right", "run",
    "said", "same", "say", "see", "set", "she", "should", "show",
    "side", "since", "small", "so", "some", "something", "still", "such",
    "take", "tell", "than", "that", "the", "their", "them", "then",
    "there", "these", "they", "thing", "think", "this", "those", "three",
    "through", "time", "to", "together", "too", "turn", "two",
    "under", "until", "up", "upon", "us", "use", "used", "using",
    "very", "want", "was", "way", "we", "well", "went", "were",
    "what", "when", "where", "whether", "which", "while", "who",
    "why", "will", "with", "without", "word", "work", "world", "would",
    "year", "yes", "yet", "you", "your",
    # Common verbs (all forms)
    "accept", "accepted", "accepting", "accepts",
    "achieve", "achieved", "achieving", "achieves", "achievement", "achievements",
    "add", "added", "adding", "adds",
    "agree", "agreed", "agreeing", "agrees", "agreement", "agreements",
    "allow", "allowed", "allowing", "allows",
    "apply", "applied", "applying", "applies", "application", "applications",
    "ask", "asked", "asking", "asks",
    "become", "became", "becomes", "becoming",
    "begin", "began", "begins", "beginning", "begun",
    "believe", "believed", "believes", "believing",
    "bring", "brought", "brings", "bringing",
    "build", "built", "builds", "building", "buildings",
    "buy", "bought", "buys", "buying",
    "call", "called", "calling", "calls",
    "carry", "carried", "carries", "carrying",
    "change", "changed", "changes", "changing",
    "check", "checked", "checking", "checks",
    "choose", "chose", "chosen", "chooses", "choosing",
    "close", "closed", "closes", "closing",
    "complete", "completed", "completes", "completing", "completely",
    "consider", "considered", "considering", "considers",
    "continue", "continued", "continues", "continuing",
    "create", "created", "creates", "creating",
    "cut", "cuts", "cutting",
    "decide", "decided", "decides", "deciding", "decision", "decisions",
    "describe", "described", "describes", "describing", "description",
    "develop", "developed", "developing", "develops", "development",
    "discuss", "discussed", "discusses", "discussing", "discussion",
    "draw", "drew", "drawn", "draws", "drawing",
    "drive", "drove", "driven", "drives", "driving",
    "eat", "ate", "eaten", "eats", "eating",
    "ensure", "ensured", "ensures", "ensuring",
    "establish", "established", "establishes", "establishing",
    "expect", "expected", "expecting", "expects",
    "explain", "explained", "explaining", "explains", "explanation",
    "fall", "fell", "fallen", "falls", "falling",
    "feel", "felt", "feels", "feeling",
    "fill", "filled", "filling", "fills",
    "follow", "followed", "following", "follows",
    "grow", "grew", "grown", "grows", "growing", "growth",
    "happen", "happened", "happening", "happens",
    "hear", "heard", "hears", "hearing",
    "hold", "held", "holds", "holding",
    "identify", "identified", "identifies", "identifying",
    "include", "included", "includes", "including",
    "increase", "increased", "increases", "increasing",
    "involve", "involved", "involves", "involving",
    "keep", "kept", "keeps", "keeping",
    "lead", "led", "leads", "leading",
    "learn", "learnt", "learned", "learns", "learning",
    "leave", "leaves", "leaving",
    "lose", "lost", "loses", "losing",
    "maintain", "maintained", "maintaining", "maintains", "maintenance",
    "manage", "managed", "manages", "managing", "management",
    "mean", "meant", "means", "meaning",
    "meet", "met", "meets", "meeting", "meetings",
    "move", "moved", "moves", "moving",
    "offer", "offered", "offering", "offers",
    "open", "opened", "opening", "opens",
    "pay", "paid", "pays", "paying", "payment", "payments",
    "plan", "planned", "planning", "plans",
    "play", "played", "playing", "plays",
    "produce", "produced", "produces", "producing",
    "provide", "provided", "provides", "providing",
    "publish", "published", "publishes", "publishing",
    "pull", "pulled", "pulling", "pulls",
    "push", "pushed", "pushes", "pushing",
    "raise", "raised", "raises", "raising",
    "read", "reads", "reading",
    "receive", "received", "receives", "receiving",
    "record", "recorded", "recording", "records",
    "reduce", "reduced", "reduces", "reducing",
    "remain", "remained", "remaining", "remains",
    "remember", "remembered", "remembering", "remembers",
    "remove", "removed", "removes", "removing",
    "report", "reported", "reporting", "reports",
    "require", "required", "requires", "requiring", "requirement", "requirements",
    "respond", "responded", "responding", "responds", "response", "responses",
    "review", "reviewed", "reviewing", "reviews",
    "run", "ran", "runs", "running",
    "save", "saved", "saves", "saving",
    "seek", "sought", "seeks", "seeking",
    "sell", "sold", "sells", "selling",
    "send", "sent", "sends", "sending",
    "serve", "served", "serves", "serving", "service", "services",
    "sit", "sat", "sits", "sitting",
    "speak", "spoke", "spoken", "speaks", "speaking",
    "spend", "spent", "spends", "spending",
    "stand", "stood", "stands", "standing",
    "start", "started", "starting", "starts",
    "stay", "stayed", "staying", "stays",
    "stop", "stopped", "stopping", "stops",
    "submit", "submitted", "submitting", "submits", "submission",
    "suggest", "suggested", "suggesting", "suggests", "suggestion",
    "support", "supported", "supporting", "supports",
    "take", "took", "taken", "takes", "taking",
    "talk", "talked", "talking", "talks",
    "teach", "taught", "teaches", "teaching",
    "tell", "told", "tells", "telling",
    "think", "thought", "thinks", "thinking",
    "try", "tried", "tries", "trying",
    "turn", "turned", "turning", "turns",
    "understand", "understood", "understands", "understanding",
    "update", "updated", "updates", "updating",
    "walk", "walked", "walking", "walks",
    "watch", "watched", "watches", "watching",
    "win", "won", "wins", "winning",
    "wish", "wished", "wishes", "wishing",
    "wonder", "wondered", "wondering", "wonders",
    "write", "wrote", "written", "writes", "writing",
    # Common adjectives
    "able", "available", "bad", "best", "better", "big", "black", "blue",
    "certain", "clear", "common", "complete", "current", "dark", "dead",
    "deep", "different", "difficult", "early", "easy", "economic",
    "effective", "entire", "environmental", "essential", "existing",
    "final", "financial", "fine", "free", "full", "general", "green",
    "half", "hard", "happy", "high", "hot", "huge", "human",
    "important", "international", "key", "known", "large", "late",
    "legal", "likely", "local", "long", "low", "main", "major",
    "military", "modern", "national", "natural", "necessary", "new",
    "normal", "obvious", "official", "old", "open", "particular",
    "past", "personal", "physical", "political", "poor", "popular",
    "possible", "potential", "present", "previous", "primary",
    "private", "professional", "proper", "public", "ready", "real",
    "recent", "red", "regional", "relevant", "responsible", "right",
    "rural", "safe", "serious", "short", "significant", "similar",
    "simple", "single", "small", "social", "special", "specific",
    "standard", "strong", "successful", "sure", "technical",
    "traditional", "true", "various", "white", "whole", "wide",
    "wrong", "young",
    # Common nouns
    "access", "account", "action", "activity", "address", "advice",
    "age", "agency", "amount", "analysis", "answer", "approach",
    "area", "argument", "authority",
    "basis", "behaviour", "benefit", "board", "body", "book", "border",
    "business",
    "capacity", "capital", "care", "case", "cause", "centre", "challenge",
    "chapter", "charge", "child", "children", "choice", "citizen",
    "city", "claim", "class", "colour", "commission", "committee",
    "community", "company", "concern", "condition", "confidence",
    "consequence", "control", "cost", "council", "country", "county",
    "course", "court", "crime", "culture", "customer",
    "damage", "data", "date", "death", "debate", "defence", "degree",
    "demand", "department", "design", "detail", "director", "document",
    "doubt", "duty",
    "economy", "education", "effect", "effort", "election", "element",
    "employee", "employment", "energy", "environment", "equipment",
    "estate", "event", "evidence", "exchange", "exercise", "experience",
    "extent", "eye",
    "face", "fact", "failure", "family", "farm", "farmer", "feature",
    "field", "figure", "file", "floor", "focus", "food", "force",
    "form", "framework", "friend", "front", "function", "fund",
    "future",
    "garden", "government", "ground", "group", "guide", "guidance",
    "hand", "head", "health", "heart", "history", "hospital", "hour",
    "house", "household",
    "idea", "image", "impact", "income", "individual", "industry",
    "information", "interest", "investment", "island", "issue",
    "job", "journey", "judge", "justice",
    "knowledge",
    "labour", "land", "language", "law", "leader", "level",
    "library", "light", "limit", "list", "loss",
    "market", "matter", "measure", "media", "member", "memory",
    "message", "method", "mind", "minister", "minute", "model",
    "moment", "money", "month", "morning", "mother", "movement",
    "nature", "news", "night", "note", "notice", "number",
    "object", "office", "officer", "operation", "opinion", "opportunity",
    "option", "order", "organisation", "owner",
    "page", "paper", "parent", "parliament", "partner", "party",
    "patient", "pattern", "period", "permission", "person", "picture",
    "piece", "place", "player", "police", "policy", "population",
    "position", "power", "practice", "pressure", "price", "principle",
    "problem", "procedure", "process", "product", "production",
    "programme", "project", "property", "proposal", "protection",
    "provision", "purpose",
    "quality", "question", "range", "rate", "reason", "record",
    "region", "regulation", "relation", "relationship", "research",
    "resource", "result", "right", "risk", "road", "role", "room",
    "rule",
    "safety", "sale", "scheme", "school", "science", "section",
    "security", "series", "share", "site", "situation", "size",
    "society", "solution", "source", "space", "staff", "stage",
    "standard", "state", "statement", "status", "step", "stock",
    "strategy", "structure", "student", "study", "subject", "success",
    "supply", "surface", "survey", "system",
    "table", "target", "tax", "team", "technology", "term", "test",
    "theory", "title", "top", "town", "trade", "training", "travel",
    "treatment", "trial", "trust", "truth", "type",
    "union", "unit", "university", "user",
    "value", "version", "view", "village", "visit", "voice", "volume",
    "war", "water", "week", "weight", "west", "window", "woman",
    "women",
    # British English specific
    "colour", "colours", "coloured", "colouring",
    "favour", "favours", "favoured", "favouring", "favourite",
    "honour", "honours", "honoured", "honouring", "honourable",
    "labour", "labours", "laboured", "labouring",
    "neighbour", "neighbours", "neighbouring", "neighbourhood",
    "behaviour", "behaviours",
    "centre", "centres", "centred",
    "defence", "defences",
    "licence", "licences", "licenced",
    "offence", "offences",
    "practise", "practised", "practises", "practising",
    "programme", "programmes", "programmed",
    "organisation", "organisations", "organise", "organised", "organising",
    "recognise", "recognised", "recognises", "recognising",
    "realise", "realised", "realises", "realising",
    "analyse", "analysed", "analyses", "analysing",
    "apologise", "apologised", "apologises", "apologising",
    "authorise", "authorised", "authorises", "authorising",
    "categorise", "categorised", "categorises", "categorising",
    "characterise", "characterised", "characterises",
    "criticise", "criticised", "criticises", "criticising",
    "emphasise", "emphasised", "emphasises", "emphasising",
    "finalise", "finalised", "finalises", "finalising",
    "generalise", "generalised", "generalises",
    "initialise", "initialised", "initialises", "initialising",
    "maximise", "maximised", "maximises", "maximising",
    "minimise", "minimised", "minimises", "minimising",
    "normalise", "normalised", "normalises", "normalising",
    "optimise", "optimised", "optimises", "optimising",
    "prioritise", "prioritised", "prioritises", "prioritising",
    "specialise", "specialised", "specialises", "specialising",
    "standardise", "standardised", "standardises", "standardising",
    "summarise", "summarised", "summarises", "summarising",
    "utilise", "utilised", "utilises", "utilising",
    "visualise", "visualised", "visualises", "visualising",
    "travelled", "travelling", "traveller", "travellers",
    "cancelled", "cancelling", "cancellation",
    "counsellor", "counsellors",
    "modelling", "modelled",
    "signalling", "signalled",
    "fuelled", "fuelling",
    "jewellery", "catalogue", "catalogues",
    "cheque", "cheques",
    "grey", "kerb", "tyre", "tyres",
    "plough", "ploughs", "ploughed",
    "draught", "draughts",
    "gaol",
    "maths", "whilst", "amongst",
    "towards", "forwards", "backwards", "afterwards", "upwards", "downwards",
    # GOV.UK / government terms
    "applicant", "applicants", "claimant", "claimants",
    "biodiversity", "sustainability", "sustainable",
    "compliance", "compliant",
    "consultation", "consultations",
    "coronavirus", "covid",
    "councillor", "councillors",
    "criteria", "criterion",
    "decommission", "decommissioned",
    "devolution", "devolved",
    "digitalisation", "digitisation",
    "eligibility", "eligible",
    "enforcement",
    "expenditure",
    "governance",
    "implementation", "implemented", "implementing",
    "infrastructure",
    "interoperability",
    "legislation", "legislative",
    "methodology", "methodologies",
    "mitigation",
    "notification", "notifications",
    "ombudsman",
    "oversight",
    "pandemic",
    "procurement",
    "reimbursement",
    "safeguarding",
    "scrutiny",
    "stakeholder", "stakeholders",
    "stewardship",
    "subsidy", "subsidies",
    "transparency", "transparent",
    "tribunal", "tribunals",
    "wellbeing",
    "whistleblower", "whistleblowers", "whistleblowing",
    # Technology terms
    "app", "apps", "blog", "blogs", "browser", "browsers",
    "click", "clicked", "clicking",
    "cookie", "cookies",
    "cyber", "cybersecurity",
    "dashboard", "dashboards",
    "database", "databases",
    "dataset", "datasets",
    "digital", "digitally",
    "download", "downloaded", "downloading", "downloads",
    "email", "emails", "emailed", "emailing",
    "feedback",
    "homepage",
    "login", "logout",
    "offline", "online",
    "password", "passwords",
    "podcast", "podcasts",
    "screenshot", "screenshots",
    "signup",
    "smartphone", "smartphones",
    "software",
    "upload", "uploaded", "uploading", "uploads",
    "username", "usernames",
    "webpage", "webpages", "website", "websites",
    "wifi",
    "workflow", "workflows",
}


def main():
    aff_path = sys.argv[1] if len(sys.argv) > 1 else 'dictionaries/en_GB.aff'
    dic_path = sys.argv[2] if len(sys.argv) > 2 else 'dictionaries/en_GB.dic'
    out_path = sys.argv[3] if len(sys.argv) > 3 else 'dictionaries/words.txt'

    print(f'Parsing {aff_path}...')
    prefixes, suffixes, cross_product = parse_aff(aff_path)
    print(f'  Prefixes: {len(prefixes)} flags, Suffixes: {len(suffixes)} flags')

    print(f'Parsing {dic_path}...')
    words = parse_dic(dic_path)
    print(f'  Base words: {len(words)}')

    print('Expanding all word forms...')
    all_words = set()
    for word, flags in words:
        # Only include alphabetic words
        if not word or not all(c.isalpha() or c == "'" or c == '-' for c in word):
            continue
        expanded = expand_word(word, flags, prefixes, suffixes, cross_product)
        for w in expanded:
            # Only keep words that are purely alphabetic (no digits, no special chars except apostrophe)
            if w and all(c.isalpha() for c in w):
                all_words.add(w.lower())

    print(f'  Expanded to {len(all_words)} unique word forms')

    # Add supplemental words
    before = len(all_words)
    for w in SUPPLEMENTAL_WORDS:
        all_words.add(w.lower())
    print(f'  Added {len(all_words) - before} supplemental words')

    # Sort and write
    sorted_words = sorted(all_words)
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(sorted_words))
        f.write('\n')

    print(f'Written {len(sorted_words)} words to {out_path}')
    print(f'File size: {len(chr(10).join(sorted_words)) / 1024:.0f} KB')


if __name__ == '__main__':
    main()
