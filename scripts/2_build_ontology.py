#!/usr/bin/env python3
"""Step 2 — translate (LT -> EN, RU) and build the RDF ontology.

Reads build/tracks_raw.json, machine-translates names / descriptions / route
types / amenity labels into English and Russian (cached in
build/translations_cache.json), then writes two Turtle files:

  ontology.ttl  — the schema (classes + properties with lt/en/ru labels)
  data.ttl      — one instance per trail, multilingual literals, WKT geometry,
                  amenity booleans and image depictions.

Translation uses the free Google endpoint (no API key). Swap `translate()`
for a paid engine if you need higher quality.
"""
import os, re, json, time, html, zipfile, unicodedata, urllib.request, urllib.parse, urllib.error

ROOT  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC   = os.path.join(ROOT, "source_data")
RAW   = os.path.join(SRC, "tracks_raw.json")
TRACKS_DIR = os.path.join(SRC, "yurii_hiking_tracks")   # loose KML/KMZ track files
BK_DIR = os.path.join(SRC, "baltukelias")               # scraped baltukelias.lt routes
BK_IMG_BASE = "https://www.baltukelias.lt/data/tourism_objects/large/"
CACHE = os.path.join(SRC, "translations_cache.json")
UA    = {"User-Agent": "Mozilla/5.0"}
LANGS = ["en", "ru"]

NS = "https://nesedeknamuose.lt/ontology/cognitive-trails#"

# property -> Lithuanian label (English label is machine-translated like the rest)
PROP_LABEL_LT = {
    "asphaltAccess": "Asfaltuotas privažiavimas",
    "publicTransportAccess": "Galima atvykti visuomeniniu transportu",
    "bathingSpot": "Maudymosi vieta", "restArea": "Poilsiavietė",
    "campsite": "Stovyklavietė", "benches": "Suoliukai, atokvėpio vietos",
    "carPark": "Automobilių stovėjimo aikštelė", "viewpoint": "Apžvalgos vieta",
    "observationTower": "Apžvalgos bokštelis", "toilet": "Tualetas",
    "steepSlope": "Šlaitas ar stati įkalnė", "stairs": "Laiptai",
    "strollerAccessible": "Pravažiuojama vaikišku vežimėliu",
    "refreshments": "Gėrimai ir užkandžiai",
    "infoBoards": "Interaktyvūs informaciniai stendai",
    "wheelchairAccessible": "Pritaikyta neįgaliesiems",
    "audioInfo": "Audio informacija",
    "suitableForCycling": "Tinka dviratininkams",
}
PROP_ORDER = list(PROP_LABEL_LT)

# ---------------------------------------------------------------- translation
_cache = json.load(open(CACHE, encoding="utf-8")) if os.path.exists(CACHE) else {}


def _save_cache():
    json.dump(_cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False, indent=0)


def _hard_split(s, limit):
    """Break a single overlong sentence (no . ! ? to split on) into <=limit
    pieces on word boundaries, falling back to a raw character cut for one
    pathologically long token, so no chunk can ever exceed the limit."""
    out, cur = [], ""
    for word in s.split(" "):
        while len(word) > limit:                    # single token longer than the limit
            if cur:
                out.append(cur); cur = ""
            out.append(word[:limit]); word = word[limit:]
        if len(cur) + len(word) + 1 > limit and cur:
            out.append(cur); cur = ""
        cur += (word + " ")
    if cur.strip():
        out.append(cur)
    return out


def _chunks(text, limit=1800):
    parts, cur = [], ""

    def flush():
        nonlocal cur
        if cur.strip():
            parts.append(cur)
        cur = ""

    for para in text.split("\n\n"):
        if len(cur) + len(para) + 2 > limit and cur:
            flush()
        if len(para) > limit:                       # split very long paragraph
            for sent in re.split(r"(?<=[.!?])\s+", para):
                for piece in (_hard_split(sent, limit) if len(sent) > limit else [sent]):
                    if len(cur) + len(piece) + 1 > limit and cur:
                        flush()
                    cur += piece + " "
        else:
            cur += para + "\n\n"
    flush()
    return parts


_google_blocked_until = 0.0   # epoch until which Google is skipped after a hard block
_mymemory_fails = 0     # consecutive MyMemory failures; trips a circuit breaker
_MYMEMORY_MAX_FAILS = 4
_lingva_fails = 0       # consecutive Lingva failures; trips a circuit breaker
_LINGVA_MAX_FAILS = 3


def _g_translate(text, tl):
    """Free Google endpoint — the only reliably-up engine (Lingva mirrors are
    frequently dead, MyMemory has a daily quota), so we lean on it hard. A 429
    is just Google's short burst limit: back off and retry the SAME endpoint
    rather than falling through to the slow/dead alternatives. To avoid tripping
    that limit when translating a long burst (e.g. hundreds of points of
    interest) we pace ~1 req/s. Only a genuine CAPTCHA block (HTTP 403, or the
    /sorry HTML page that fails JSON decoding) parks Google for a 60 s cooldown,
    so a single block doesn't doom the run."""
    global _google_blocked_until
    data = urllib.parse.urlencode(
        {"client": "gtx", "sl": "lt", "tl": tl, "dt": "t", "q": text}).encode()
    url = "https://translate.googleapis.com/translate_a/single"
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, data=data, headers=UA)
            res = json.loads(urllib.request.urlopen(req, timeout=15).read().decode("utf-8"))
            out = "".join(seg[0] for seg in res[0] if seg and seg[0])
            time.sleep(0.7)
            return out
        except urllib.error.HTTPError as e:
            if e.code == 429:                  # burst limit — wait it out and retry Google
                time.sleep(2 * (attempt + 1))
                continue
            if e.code == 403:                  # hard CAPTCHA block — park Google briefly
                _google_blocked_until = time.time() + 60
            raise
        except ValueError:                     # JSON decode failed → /sorry HTML block page
            _google_blocked_until = time.time() + 60
            raise
    _google_blocked_until = time.time() + 60   # sustained 429s — back off Google a while
    raise RuntimeError("google 429 burst limit")


LINGVA_HOSTS = ["lingva.ml", "lingva.lunar.icu"]
_lingva_i = 0   # round-robin index across instances


def _lingva(text, tl):
    """Lingva proxies Google Translate from its own servers, so it works even
    when this IP is CAPTCHA-blocked. GET, text URL-encoded in the path. Rotates
    hosts and backs off on the brief 429 burst-limit instead of giving up, so
    fields get translated rather than silently degraded to the source text."""
    global _lingva_i, _lingva_fails
    if _lingva_fails >= _LINGVA_MAX_FAILS:     # mirrors are down — stop wasting 10 s/attempt
        raise RuntimeError("lingva circuit open")
    enc = urllib.parse.quote(text, safe="")
    last = None
    for attempt in range(2):
        host = LINGVA_HOSTS[_lingva_i % len(LINGVA_HOSTS)]
        _lingva_i += 1
        try:
            url = f"https://{host}/api/v1/lt/{tl}/{enc}"
            res = json.loads(urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=8).read().decode("utf-8"))
            out = res.get("translation", "")
            if out:
                _lingva_fails = 0
                time.sleep(0.4)
                return out
            raise RuntimeError("empty translation")
        except Exception as e:
            last = e
            time.sleep(1.0 * (attempt + 1))   # wait out 429 / transient errors
    _lingva_fails += 1
    raise RuntimeError(f"lingva failed: {last}")


_MYMEMORY_LIMIT = 480   # API hard-rejects q over 500 chars; stay safely under


def _mymemory_one(text, tl):
    global _mymemory_fails
    if _mymemory_fails >= _MYMEMORY_MAX_FAILS:
        raise RuntimeError("mymemory circuit open")
    url = "https://api.mymemory.translated.net/get?" + urllib.parse.urlencode(
        {"q": text, "langpair": f"lt|{tl}"})
    try:
        req = urllib.request.Request(url, headers=UA)
        res = json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))
        out = (res.get("responseData") or {}).get("translatedText", "") or ""
        up = out.upper()
        if not out or "MYMEMORY WARNING" in up or "QUOTA" in up or "QUERY LENGTH LIMIT" in up:
            raise RuntimeError(out[:60] or "empty")
        _mymemory_fails = 0
        time.sleep(0.3)
        return html.unescape(out)
    except Exception:
        _mymemory_fails += 1
        raise


def _mymemory(text, tl):
    """Fallback engine (api.mymemory.translated.net). Hard 500-char/request limit
    and a daily quota — raises on quota/warning/length errors so the caller can
    degrade gracefully. Sub-chunks long input so any chunk size is handled."""
    if len(text) <= _MYMEMORY_LIMIT:
        return _mymemory_one(text, tl)
    return " ".join(_mymemory_one(p.strip(), tl) for p in _chunks(text, _MYMEMORY_LIMIT))


def _translate_chunk(text, tl):
    if time.time() >= _google_blocked_until:
        try:
            return _g_translate(text, tl)
        except Exception:
            pass
    try:
        return _lingva(text, tl)         # Google quality via proxy, bypasses IP block
    except Exception:
        pass
    return _mymemory(text, tl)           # last-resort fallback (daily quota)


def translate(text, tl):
    text = (text or "").strip()
    if not text:
        return ""
    key = f"{tl}{text}"
    if key in _cache:
        return _cache[key]
    try:
        out = "\n\n".join(_translate_chunk(c, tl).strip() for c in _chunks(text, limit=1200))
        out = re.sub(r"\n{3,}", "\n\n", out).strip()
    except Exception:
        return text   # all engines failed — degrade to source, do NOT cache so a later run retries
    if not out or "QUERY LENGTH LIMIT" in out.upper() or "MYMEMORY WARNING" in out.upper():
        return text   # engine leaked an error string — degrade, don't poison the cache
    _cache[key] = out
    return out


# ---------------------------------------------------------------- geometry
def wkt_from_gpx(path):
    if not os.path.exists(path):
        return None
    h = open(path, encoding="utf-8", errors="ignore").read()
    # one coordinate list per <trkseg>, keeping every point. A merged "whole
    # route" GPX (e.g. the Vilnius loop) holds several disconnected tracks — the
    # main loop plus spur loops kilometres away. Joining them into one LINESTRING
    # would draw long straight lines across the gaps, so each trkseg becomes its
    # own part of a MULTILINESTRING — nothing connected that isn't connected on
    # the ground.
    segs = [re.findall(r'lat="([-\d.]+)"[^>]*lon="([-\d.]+)"', s)
            for s in re.findall(r'<trkseg>(.*?)</trkseg>', h, re.S)]
    segs = [p for p in segs if len(p) >= 2]
    if not segs:                                   # routes (rtept) or no trkseg wrapper
        p = re.findall(r'<rtept[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"', h) \
            or re.findall(r'<trkpt[^>]*lat="([-\d.]+)"[^>]*lon="([-\d.]+)"', h)
        if len(p) >= 2:
            segs = [p]
    if not segs:
        return None

    def line(p):
        return ", ".join(f"{lon} {lat}" for lat, lon in p)

    if len(segs) == 1:
        return f"LINESTRING({line(segs[0])})"
    return "MULTILINESTRING(" + ", ".join(f"({line(p)})" for p in segs) + ")"


# one LINESTRING (with start vertex and centroid) per <trk> in a bundled GPX —
# used to split a multi-track "all trails" file back into its individual routes.
def wkt_per_trk(path):
    if not os.path.exists(path):
        return []
    h = open(path, encoding="utf-8", errors="ignore").read()
    out = []
    for trk in re.findall(r"<trk>(.*?)</trk>", h, re.S):
        pts = [(float(a), float(b)) for a, b in
               re.findall(r'lat="([-\d.]+)"[^>]*lon="([-\d.]+)"', trk)]
        if len(pts) < 2:
            continue
        lats = [a for a, _ in pts]
        lons = [b for _, b in pts]
        out.append({
            "wkt": "LINESTRING(" + ", ".join(f"{b} {a}" for a, b in pts) + ")",
            "start": (lons[0], lats[0]),                        # (lng, lat)
            "centroid": (sum(lons) / len(lons), sum(lats) / len(lats)),
        })
    return out


# ---------------------------------------------------------------- KML / KMZ tracks
def _kml_text(path):
    """Raw KML markup, transparently unzipping a .kmz (the geometry lives in the
    single .kml entry, usually doc.kml)."""
    if path.lower().endswith(".kmz"):
        with zipfile.ZipFile(path) as z:
            name = next((n for n in z.namelist() if n.lower().endswith(".kml")), None)
            return z.read(name).decode("utf-8", "ignore") if name else ""
    return open(path, encoding="utf-8", errors="ignore").read()


def wkt_from_kml(path):
    """Track geometry from a Google-Earth KML/KMZ. Each <LineString> or
    <LinearRing> (loop routes are exported as rings) coordinate list becomes one
    line; <Point> placemarks (start pins, POIs) are ignored. KML coordinates are
    "lng,lat[,alt]" triples separated by whitespace."""
    h = _kml_text(path)
    lines = []
    for tag in ("LineString", "LinearRing"):
        for block in re.findall(rf"<{tag}\b.*?>(.*?)</{tag}>", h, re.S):
            m = re.search(r"<coordinates>(.*?)</coordinates>", block, re.S)
            if not m:
                continue
            pts = []
            for tok in m.group(1).split():
                c = tok.split(",")
                if len(c) >= 2:
                    pts.append((c[0], c[1]))            # (lng, lat)
            if len(pts) >= 2:
                lines.append(pts)
    if not lines:
        return None

    def seg(p):
        return ", ".join(f"{lng} {lat}" for lng, lat in p)

    if len(lines) == 1:
        return f"LINESTRING({seg(lines[0])})"
    return "MULTILINESTRING(" + ", ".join(f"({seg(p)})" for p in lines) + ")"


def _wkt_centroid(wkt):
    """(lat, lng) average of every vertex in a WKT geometry."""
    pts = re.findall(r"(-?\d+\.\d+)\s+(-?\d+\.\d+)", wkt)
    if not pts:
        return None
    xs = [float(a) for a, _ in pts]
    ys = [float(b) for _, b in pts]
    return sum(ys) / len(ys), sum(xs) / len(xs)


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "track"


# subjective category tagged on every loose club track (a proper noun, so its
# label is fixed across languages rather than machine-translated)
EPAM_CATEGORY = {"id": "epam-hiking-club", "name_lt": "EPAM Hiking club",
                 "label": {"lt": "EPAM Hiking club", "en": "EPAM Hiking club",
                           "ru": "EPAM Hiking club"}}
# this file is not an EPAM club route, so it is not tagged with the category
NON_EPAM_FILES = {"25 km Toyota Ėjimas Vilniuje 2026 Pavasaris F.kmz"}


def load_track_files():
    """Ingest the loose KML/KMZ files in source_data/yurii_hiking_tracks/ as
    minimal trail entries — these are just tracks: a name (the file name) and a
    geometry, no description / amenities. All but the listed non-club files are
    tagged with the EPAM Hiking club subjective category."""
    out, seen = [], set()
    if not os.path.isdir(TRACKS_DIR):
        return out
    for fn in sorted(os.listdir(TRACKS_DIR)):
        if not fn.lower().endswith((".kml", ".kmz")):
            continue
        wkt = wkt_from_kml(os.path.join(TRACKS_DIR, fn))
        if not wkt:
            continue
        name = os.path.splitext(fn)[0]
        slug, base, n = "track-" + slugify(name), "track-" + slugify(name), 2
        while slug in seen:
            slug = f"{base}-{n}"; n += 1
        seen.add(slug)
        c = _wkt_centroid(wkt) or (0.0, 0.0)
        cats = [] if fn in NON_EPAM_FILES else [EPAM_CATEGORY]
        out.append({"slug": slug, "name_lt": name, "lat": c[0], "lng": c[1],
                    "description_lt": "", "type_lt": "", "features": [],
                    "categories": cats, "wkt": wkt})
    return out


# ---------------------------------------------------------------- baltukelias.lt
# every Balts' Road route is tagged with this fixed subjective category (a proper
# noun, so its label is curated rather than machine-translated)
BK_CATEGORY = {"id": "baltu-kelias", "name_lt": "Baltų kelias",
               "label": {"lt": "Baltų kelias", "en": "Balts’ Road", "ru": "Путь балтов"}}

def _html_to_text(h):
    """Flatten the CMS rich-text (descriptions ship as HTML) to the plain,
    paragraph-separated prose the rest of the pipeline expects."""
    if not h:
        return ""
    h = re.sub(r"(?i)<\s*br\s*/?>", "\n", h)
    h = re.sub(r"(?i)</(p|li|h[1-6]|div)\s*>", "\n\n", h)
    h = re.sub(r"<[^>]+>", "", h)
    h = html.unescape(h).replace("\xa0", " ")
    h = re.sub(r"[ \t]+", " ", h)
    h = re.sub(r" *\n *", "\n", h)
    return re.sub(r"\n{3,}", "\n\n", h).strip()


def _fix_caps(s):
    """The source presents route names in ALL CAPS; title-case them for display."""
    s = (s or "").strip()
    return s.title() if s and s.isupper() else s


def _wkt_from_points(pts):
    """LINESTRING from a baltukelias `filterpoints` list of [lat, lng] strings."""
    coords = [(p[0], p[1]) for p in pts if len(p) >= 2]
    if len(coords) < 2:
        return None
    return "LINESTRING(" + ", ".join(f"{lng} {lat}" for lat, lng in coords) + ")"


def _bk_slug(route):
    url = (route.get("view_url") or "").rstrip("/")
    seg = url.rsplit("/", 1)[-1] if url else ""
    return "bk-" + (seg or ("route-" + str(route.get("id"))))


def _bk_parts(route, en):
    """Each route's segments carry an `objects` list — the curated "points to
    see" (piliakalniai, sacred sites, museums…), each with its own LT name,
    HTML description, coordinates and a representative photo. Flatten them into
    ordered trail parts, de-duplicating by object_id within the route (the same
    site can recur across track segments). The point's single `pic` lives under
    the same `large/` image base as the route photos. `en` maps object_id →
    native English {name, description} harvested from the EN catalogue page; we
    seed the translation cache with it so EN is the site's own wording and only
    RU is machine-translated."""
    parts, seen = [], set()
    for seg in route.get("segments") or []:
        for o in seg.get("objects") or []:
            oid = o.get("object_id") or o.get("id")
            if not oid or oid in seen:
                continue
            seen.add(oid)
            name_lt = _fix_caps((o.get("name") or "").strip())
            if not name_lt:
                continue
            desc_lt = _html_to_text(o.get("description") or "")
            e = en.get(str(oid)) or {}
            name_en = _fix_caps((e.get("name") or "").strip())
            desc_en = _html_to_text(e.get("description") or "")
            if name_lt and name_en:
                _cache["en" + name_lt] = name_en
            if desc_lt and desc_en:
                _cache["en" + desc_lt] = desc_en
            pic = o.get("pic")
            # a point-of-interest has no track of its own — give it a POINT geometry
            # at its own coordinates so it can be marked on the route's map.
            wkt = None
            try:
                lat, lng = float(o.get("lat")), float(o.get("lng"))
                wkt = f"POINT({lng} {lat})"
            except (TypeError, ValueError):
                pass
            parts.append({
                "slug": f"{_bk_slug(route)}-poi-{oid}",
                "num": len(parts) + 1,
                "name_lt": name_lt,
                "description_lt": desc_lt,
                "images": [BK_IMG_BASE + pic] if pic else [],
                "local_images": [],
                "wkt": wkt,
            })
    return parts


def load_baltukelias():
    """Turn the scraped source_data/baltukelias/routes.json into trail entries.
    The source carries native LT + EN names/descriptions (no RU), so we seed the
    translation cache with the native English and let RU be machine-translated
    from Lithuanian like everything else. Geometry comes from `filterpoints`,
    distance/duration from the numeric `distance` (m) / `time` (s) fields, and
    photos are the remote `large/` image URLs. Each route is attributed to the
    Baltukelias project and its `segments[].objects` become "points to see"
    trail parts."""
    path = os.path.join(BK_DIR, "routes.json")
    if not os.path.exists(path):
        return []
    routes = json.load(open(path, encoding="utf-8"))
    en_path = os.path.join(BK_DIR, "objects_en.json")
    objects_en = json.load(open(en_path, encoding="utf-8")) if os.path.exists(en_path) else {}
    out = []
    for route in routes.values():
        wkt = _wkt_from_points(route.get("filterpoints") or [])
        if not wkt:
            continue
        c = _wkt_centroid(wkt) or (0.0, 0.0)
        nm = route.get("name") or {}
        name_lt = _fix_caps(nm.get("1") or nm.get("2") or "")
        name_en = _fix_caps(nm.get("2") or "")
        ds = route.get("description") or {}
        desc_lt = _html_to_text(ds.get("1") or ds.get("2") or "")
        desc_en = _html_to_text(ds.get("2") or "")
        if name_lt and name_en:                       # native EN beats machine translation
            _cache["en" + name_lt] = name_en
        if desc_lt and desc_en:
            _cache["en" + desc_lt] = desc_en
        m = str(route.get("distance") or "")
        sec = str(route.get("time") or "")
        km = round(int(m) / 1000, 1) if m.isdigit() else None
        hrs = round(int(sec) / 3600, 1) if sec.isdigit() else None
        imgs = [BK_IMG_BASE + p["file_name"]
                for p in (route.get("pics") or []) if p.get("file_name")]
        out.append({
            "slug": _bk_slug(route), "name_lt": name_lt, "description_lt": desc_lt,
            "type_lt": "", "features": [], "categories": [BK_CATEGORY],
            "lat": c[0], "lng": c[1], "wkt": wkt,
            "length": f"{km} km" if km else "",
            "duration_lt": f"{hrs} val." if hrs else "",
            "link": route.get("view_url") or "", "images": imgs, "local_images": [],
            "author": route.get("author"), "parts": _bk_parts(route, objects_en),
        })
    return out


# coordinate pair as it appears inline in the Lithuanian prose ("lat, lng")
COORD_RE = re.compile(r"(\d{2}\.\d{3,})\s*,?\s*(\d{2}\.\d{3,})")


def _dist(a, b):
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5


def synthesize_parts(r):
    """Some pages bundle several *named* sub-trails — each introduced by its own
    heading and an inline coordinate — into a single GPX of multiple <trk>s, with
    no structured parts. Detect that shape (>=2 inline coordinates) and split it:
    keep the intro as the trail's own description and pair every sub-trail section
    to its <trk> by coordinate proximity (coordinate-less sections take leftover
    tracks in document order). Returns (main_description_lt, parts) or None.

    Article-style pages whose headings are sections ("Route and surface", "Where
    is it?") carry no inline coordinates, so they never trigger this."""
    desc = r.get("description_lt", "")
    if len(COORD_RE.findall(desc)) < 2:
        return None
    trks = wkt_per_trk(os.path.join(ROOT, r.get("gpx_file") or ""))
    if len(trks) < 2:
        return None
    paras = [p.strip() for p in desc.split("\n\n") if p.strip()]
    heads = [i for i, p in enumerate(paras) if len(p) < 60]
    if len(heads) < 3:                                  # title + >=2 sub-trails
        return None

    first = heads[1]                                    # first sub-trail heading
    main_desc = "\n\n".join(paras[:first])
    sections = []
    for hi, h in enumerate(heads[1:]):
        nxt = heads[2 + hi] if 2 + hi < len(heads) else len(paras)
        body = "\n\n".join(paras[h + 1:nxt])
        m = COORD_RE.search(body)
        sections.append({
            "name": paras[h], "body": body,
            "coord": (float(m.group(2)), float(m.group(1))) if m else None,  # lng,lat
        })

    used = [False] * len(trks)

    def claim_nearest(coord):
        best, bi = 1e9, -1
        for i, tk in enumerate(trks):
            if used[i]:
                continue
            d = min(_dist(coord, tk["start"]), _dist(coord, tk["centroid"]))
            if d < best:
                best, bi = d, i
        if bi >= 0:
            used[bi] = True
        return bi

    for sec in sections:                                # coordinate sections first
        sec["trk"] = trks[claim_nearest(sec["coord"])]["wkt"] if sec["coord"] else None
    free = [i for i, u in enumerate(used) if not u]
    for sec in sections:                                # then coordinate-less ones
        if not sec["trk"] and free:
            sec["trk"] = trks[free.pop(0)]["wkt"]

    parts, n = [], 0
    for sec in sections:
        if not sec["trk"]:
            continue
        n += 1
        parts.append({"slug": f"{r['slug']}-p{n:02d}", "num": n,
                      "name_lt": sec["name"], "description_lt": sec["body"],
                      "wkt": sec["trk"]})
    return (main_desc, parts) if len(parts) >= 2 else None


# ---------------------------------------------------------------- output helpers
def write_ttl(name, text):
    """Write the generated Turtle file into source_data/. The Turtle is itself a
    derived part of the source data; the React build (scripts/compile_ttl.mjs)
    compiles it into a typed TS module at build time."""
    open(os.path.join(SRC, name), "w", encoding="utf-8").write(text)


# ---------------------------------------------------------------- turtle helpers
def esc1(s):
    return s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ").strip()


def esc_ml(s):
    return s.replace("\\", "\\\\").replace('"""', '\\"\\"\\"').strip()


def lit_langs(values):
    """values: {lang: text} -> turtle literal list  '"x"@lt , "y"@en , "z"@ru'"""
    return " , ".join(f'"{esc1(v)}"@{l}' for l, v in values.items() if v)


def num(s):
    m = re.search(r"([\d]+(?:[.,]\d+)?)", s or "")
    return m.group(1).replace(",", ".") if m else None


# ---------------------------------------------------------------- build
def build_ontology(prop_labels, categories):
    P = f"""@prefix ct:        <{NS}> .
@prefix rdf:       <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:      <http://www.w3.org/2000/01/rdf-schema#> .
@prefix owl:       <http://www.w3.org/2002/07/owl#> .
@prefix xsd:       <http://www.w3.org/2001/XMLSchema#> .
@prefix dcterms:   <http://purl.org/dc/terms/> .
@prefix foaf:      <http://xmlns.com/foaf/0.1/> .
@prefix schema:    <https://schema.org/> .
@prefix geo:       <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix geosparql: <http://www.opengis.net/ont/geosparql#> .

ct: a owl:Ontology ;
    dcterms:title "Cognitive Trails Ontology"@en , "Pažintinių takų ontologija"@lt , "Онтология познавательных троп"@ru ;
    dcterms:description "Hiking / educational trails: geometry, multilingual descriptions, amenities and image depictions. Source: nesedeknamuose.lt"@en ;
    dcterms:source <https://nesedeknamuose.lt/pazintiniai-takai/> ;
    owl:versionInfo "2.0" .

ct:Trail a owl:Class ;
    rdfs:subClassOf schema:Place , geosparql:Feature ;
    rdfs:label "Trail"@en , "Takas"@lt , "Тропа"@ru .

ct:gpxFile a owl:DatatypeProperty ; rdfs:domain ct:Trail ; rdfs:range xsd:anyURI ;
    rdfs:label "GPX file"@en , "GPX failas"@lt , "GPX файл"@ru .
ct:routeType a owl:DatatypeProperty ; rdfs:domain ct:Trail ; rdfs:range rdf:langString ;
    rdfs:label "geometry"@en , "geometrija"@lt , "геометрия"@ru .

# --- measured quantities (value + unit) ---
ct:Quantity a owl:Class ;
    rdfs:label "Quantity"@en , "Dydis"@lt , "Величина"@ru ;
    rdfs:comment "A measured value paired with its unit of measure."@en .
ct:Unit a owl:Class ;
    rdfs:label "Unit of measure"@en , "Matavimo vienetas"@lt , "Единица измерения"@ru .
ct:value a owl:DatatypeProperty ; rdfs:domain ct:Quantity ; rdfs:range xsd:decimal ;
    rdfs:label "value"@en , "reikšmė"@lt , "значение"@ru .
ct:unit a owl:ObjectProperty ; rdfs:domain ct:Quantity ; rdfs:range ct:Unit ;
    rdfs:label "unit"@en , "matavimo vienetas"@lt , "единица измерения"@ru .
ct:distance a owl:ObjectProperty ; rdfs:domain ct:Trail ; rdfs:range ct:Quantity ;
    rdfs:label "distance"@en , "atstumas"@lt , "расстояние"@ru .
ct:duration a owl:ObjectProperty ; rdfs:domain ct:Trail ; rdfs:range ct:Quantity ;
    rdfs:label "duration"@en , "trukmė"@lt , "продолжительность"@ru .

# unit individuals — each carries a multilingual rdfs:label
ct:unit-km a ct:Unit ;
    rdfs:label "km"@en , "km"@lt , "км"@ru .
ct:unit-hour a ct:Unit ;
    rdfs:label "h"@en , "val."@lt , "ч"@ru .

# --- map / external links ---
schema:hasMap a owl:ObjectProperty ; rdfs:domain ct:Trail ; rdfs:range xsd:anyURI ;
    rdfs:label "map view"@en , "žemėlapis"@lt , "карта"@ru ;
    rdfs:comment "Link that opens the trail location on an external web map (Google Maps)."@en .

ct:TrailProperty a owl:Class ; rdfs:subClassOf owl:DatatypeProperty ;
    rdfs:label "Trail amenity / accessibility property"@en .

# --- multipart trails: named segments (atkarpos / kilpos) ---
ct:TrailSegment a owl:Class ;
    rdfs:subClassOf geosparql:Feature ;
    rdfs:label "Trail segment"@en , "Tako atkarpa"@lt , "Участок тропы"@ru ;
    rdfs:comment "A named part of a multipart trail, with its own geometry, gallery and (optionally) description."@en .
ct:hasSegment a owl:ObjectProperty ; rdfs:domain ct:Trail ; rdfs:range ct:TrailSegment ;
    rdfs:label "has segment"@en , "turi atkarpą"@lt , "имеет участок"@ru .
ct:segmentNumber a owl:DatatypeProperty ; rdfs:domain ct:TrailSegment ; rdfs:range xsd:integer ;
    rdfs:label "segment order"@en , "atkarpos numeris"@lt , "номер участка"@ru .

# --- attribution: who curated/published the route ---
ct:author a owl:ObjectProperty ; rdfs:domain ct:Trail ; rdfs:range foaf:Agent ;
    rdfs:label "author"@en , "autorius"@lt , "автор"@ru .

# --- subjective characteristics (source taxonomy: scenic, barefoot, viewpoints, etc.) ---
ct:Category a owl:Class ;
    rdfs:label "Subjective characteristic"@en , "Subjektyvi savybė"@lt , "Субъективная характеристика"@ru ;
    rdfs:comment "A subjective, themed grouping a trail belongs to, from the source catalog."@en .
ct:category a owl:ObjectProperty ; rdfs:domain ct:Trail ; rdfs:range ct:Category ;
    rdfs:label "subjective characteristic"@en , "subjektyvi savybė"@lt , "субъективная характеристика"@ru .
"""
    blocks = [P]
    for prop in PROP_ORDER:
        labels = prop_labels[prop]   # {lt,en,ru}
        blocks.append(
            f"ct:{prop} a owl:DatatypeProperty , ct:TrailProperty ;\n"
            f"    rdfs:domain ct:Trail ; rdfs:range xsd:boolean ;\n"
            f"    rdfs:label {lit_langs(labels)} .\n")
    # category individuals (controlled vocabulary, multilingual labels)
    for c in categories:
        blocks.append(
            f"ct:cat-{c['id']} a ct:Category ;\n"
            f"    rdfs:label {lit_langs(c['label'])} .\n")
    write_ttl("ontology.ttl", "\n".join(blocks))
    print("wrote ontology.ttl")


def build_data(trails, prop_labels):
    head = f"""@prefix ct:        <{NS}> .
@prefix rdf:       <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:      <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:       <http://www.w3.org/2001/XMLSchema#> .
@prefix dcterms:   <http://purl.org/dc/terms/> .
@prefix foaf:      <http://xmlns.com/foaf/0.1/> .
@prefix schema:    <https://schema.org/> .
@prefix geo:       <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix geosparql: <http://www.opengis.net/ont/geosparql#> .

"""
    out = [head]
    # authorship lives in the raw track data: each entry carries an author record
    # ({id, name, type, website?, facebook?, instagram?}). Collect the distinct
    # authors and emit one foaf agent individual per id.
    authors_by_id = {}
    for t in trails:
        a = t.get("author")
        if a and a.get("id"):
            authors_by_id[a["id"]] = a
    for aid, a in authors_by_id.items():
        preds = [f'a foaf:{a.get("type", "Organization")}',
                 f'foaf:name "{esc1(a["name"])}"']
        if a.get("website"):
            preds.append(f'schema:url <{a["website"]}>')
        # compile_ttl derives website/facebook/instagram from schema:url + schema:sameAs
        for key in ("website", "facebook", "instagram"):
            if a.get(key):
                preds.append(f'schema:sameAs <{a[key]}>')
        out.append(f"ct:author-{aid} " + " ;\n    ".join(preds) + " .\n")
    geoms = 0
    for t in trails:
        s = t["slug"]; uri = f"ct:trail-{s}"
        L = [f"{uri} a ct:Trail ;"]
        L.append(f"    rdfs:label {lit_langs(t['name'])} ;")
        L.append(f"    schema:name {lit_langs(t['name'])} ;")
        if t.get("link"):
            L.append(f'    schema:url <{t["link"]}> ;')
        if t.get("address_lt"):
            L.append(f'    schema:address "{esc1(t["address_lt"])}"@lt ;')
        if any(t["type"].values()):
            L.append(f"    ct:routeType {lit_langs(t['type'])} ;")
        for c in t.get("categories", []):
            L.append(f"    ct:category ct:cat-{c['id']} ;")
        if t.get("author") and t["author"].get("id"):
            L.append(f"    ct:author ct:author-{t['author']['id']} ;")
        km = num(t.get("length", ""))
        if km:
            L.append(f"    ct:distance ct:dist-{s} ;")
        hrs = num(t.get("duration_lt", ""))
        if hrs:
            L.append(f"    ct:duration ct:dur-{s} ;")
        L.append(f'    geo:lat "{t["lat"]}"^^xsd:decimal ;')
        L.append(f'    geo:long "{t["lng"]}"^^xsd:decimal ;')
        L.append(f'    schema:hasMap <https://www.google.com/maps/search/?api=1&query={t["lat"]},{t["lng"]}> ;')
        if t.get("gpx_source"):
            L.append(f'    ct:gpxFile "{t["gpx_source"]}"^^xsd:anyURI ;')
        for prop in PROP_ORDER:
            if t["props"].get(prop):
                L.append(f"    ct:{prop} true ;")
        for url in t.get("images", []):
            L.append(f"    foaf:depiction <{url}> ;")
        for rel in t.get("local_images", []):
            L.append(f"    schema:image <{rel}> ;")
        wkt = t.get("wkt") or (
            wkt_from_gpx(os.path.join(ROOT, t["gpx_file"])) if t.get("gpx_file") else None)
        if wkt:
            L.append(f"    geosparql:hasGeometry ct:geom-{s} ;")
        for p in t.get("parts", []):
            L.append(f"    ct:hasSegment ct:seg-{p['slug']} ;")
        # description closes the statement
        if any(t["description"].values()):
            descs = " ,\n        ".join(
                f'"""{esc_ml(v)}"""@{l}' for l, v in t["description"].items() if v)
            L.append(f"    dcterms:description {descs} .")
        else:
            L[-1] = L[-1].rstrip(" ;") + " ."
        out.append("\n".join(L))
        if km:
            out.append(f'\nct:dist-{s} a ct:Quantity ;\n'
                       f'    ct:value "{km}"^^xsd:decimal ;\n'
                       f'    ct:unit ct:unit-km .')
        if hrs:
            out.append(f'\nct:dur-{s} a ct:Quantity ;\n'
                       f'    ct:value "{hrs}"^^xsd:decimal ;\n'
                       f'    ct:unit ct:unit-hour .')
        if wkt:
            geoms += 1
            out.append(f'\nct:geom-{s} a geosparql:Geometry ;\n    geosparql:asWKT "{wkt}"^^geosparql:wktLiteral .')
        # multipart segments
        for p in t.get("parts", []):
            ps = p["slug"]
            S = [f"\nct:seg-{ps} a ct:TrailSegment ;",
                 f"    ct:segmentNumber {p['num']} ;",
                 f"    rdfs:label {lit_langs(p['name'])} ;",
                 f"    schema:name {lit_langs(p['name'])} ;"]
            if p.get("gpx_source"):
                S.append(f'    ct:gpxFile "{p["gpx_source"]}"^^xsd:anyURI ;')
            for url in p.get("images", []):
                S.append(f"    foaf:depiction <{url}> ;")
            for rel in p.get("local_images", []):
                S.append(f"    schema:image <{rel}> ;")
            # geometry: a precomputed WKT (split from a bundled GPX) wins, else the
            # part's own GPX file.
            pwkt = p.get("wkt") or (
                wkt_from_gpx(os.path.join(ROOT, p["gpx_file"])) if p.get("gpx_file") else None)
            if pwkt:
                S.append(f"    geosparql:hasGeometry ct:geom-seg-{ps} ;")
            if any(p["description"].values()):
                descs = " ,\n        ".join(
                    f'"""{esc_ml(v)}"""@{l}' for l, v in p["description"].items() if v)
                S.append(f"    dcterms:description {descs} .")
            else:
                S[-1] = S[-1].rstrip(" ;") + " ."
            out.append("\n".join(S))
            if pwkt:
                geoms += 1
                out.append(f'\nct:geom-seg-{ps} a geosparql:Geometry ;\n    geosparql:asWKT "{pwkt}"^^geosparql:wktLiteral .')
        out.append("")
    write_ttl("data.ttl", "\n".join(out))
    print(f"wrote data.ttl ({len(trails)} trails, {geoms} geometries)")


def main():
    raw = json.load(open(RAW, encoding="utf-8"))
    tracks = load_track_files()
    raw += tracks
    print(f"loaded {len(tracks)} loose KML/KMZ tracks")
    bk = load_baltukelias()
    raw += bk
    print(f"loaded {len(bk)} baltukelias.lt routes")

    # property labels (lt + translated en/ru), translated once
    prop_labels = {}
    for prop, lt in PROP_LABEL_LT.items():
        prop_labels[prop] = {"lt": lt,
                             "en": translate(lt, "en"),
                             "ru": translate(lt, "ru")}
    _save_cache()
    print("amenity labels translated")

    # themed category vocabulary (id + lt name from the raw data), translated once
    categories, seen = [], set()
    for r in raw:
        for c in r.get("categories", []):
            if c["id"] in seen:
                continue
            seen.add(c["id"])
            # a category may carry its own fixed multilingual label (proper nouns
            # like a club name); otherwise translate the LT name like everything else
            label = c.get("label") or {"lt": c["name_lt"],
                                        "en": translate(c["name_lt"], "en"),
                                        "ru": translate(c["name_lt"], "ru")}
            categories.append({"id": c["id"], "name_lt": c["name_lt"], "label": label})
    _save_cache()
    print(f"category labels translated ({len(categories)})")

    trails = []
    for i, r in enumerate(raw, 1):
        # pages that bundle several named sub-trails into one multi-track GPX have
        # no structured parts; reconstruct them and trim the trail description to
        # its intro so the sub-trail prose lives on the segments instead.
        if not r.get("parts"):
            syn = synthesize_parts(r)
            if syn:
                r["description_lt"], r["parts"] = syn
        name = {"lt": r["name_lt"], "en": translate(r["name_lt"], "en"), "ru": translate(r["name_lt"], "ru")}
        desc = {"lt": r["description_lt"]}
        for l in LANGS:
            desc[l] = translate(r["description_lt"], l)
        rtype = {"lt": r["type_lt"]}
        for l in LANGS:
            rtype[l] = translate(r["type_lt"], l)
        props = {f["prop"]: True for f in r["features"]}
        # cycling suitability is a stored fact, decided once here from the English
        # description text; the client never infers it.
        en_text = desc["en"].lower()
        props["suitableForCycling"] = any(k in en_text for k in ("cycl", "bike"))
        parts = []
        for p in r.get("parts", []):
            pname = {"lt": p["name_lt"], "en": translate(p["name_lt"], "en"), "ru": translate(p["name_lt"], "ru")}
            pdesc = {"lt": p["description_lt"]}
            for l in LANGS:
                pdesc[l] = translate(p["description_lt"], l)
            parts.append({**p, "name": pname, "description": pdesc})
        trails.append({**r, "name": name, "description": desc, "type": rtype,
                       "props": props, "parts": parts})
        if i % 20 == 0:
            _save_cache(); print(f"  translated {i}/{len(raw)} trails")
    _save_cache()
    print("all translations done")

    build_ontology(prop_labels, categories)
    build_data(trails, prop_labels)


if __name__ == "__main__":
    main()
