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
import os, re, json, time, html, urllib.request, urllib.parse

ROOT  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC   = os.path.join(ROOT, "source_data")
RAW   = os.path.join(SRC, "tracks_raw.json")
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


_google_alive = True   # flipped off once Google serves a /sorry CAPTCHA block
_mymemory_fails = 0     # consecutive MyMemory failures; trips a circuit breaker
_MYMEMORY_MAX_FAILS = 4


def _g_translate(text, tl):
    """Free Google endpoint. One shot — on any failure (incl. the /sorry block
    that returns non-JSON HTML) mark Google dead so we stop wasting attempts."""
    global _google_alive
    data = urllib.parse.urlencode(
        {"client": "gtx", "sl": "lt", "tl": tl, "dt": "t", "q": text}).encode()
    url = "https://translate.googleapis.com/translate_a/single"
    try:
        req = urllib.request.Request(url, data=data, headers=UA)
        res = json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8"))
        out = "".join(seg[0] for seg in res[0] if seg and seg[0])
        time.sleep(0.3)
        return out
    except Exception:
        _google_alive = False
        raise


LINGVA_HOSTS = ["lingva.ml", "lingva.lunar.icu"]
_lingva_i = 0   # round-robin index across instances


def _lingva(text, tl):
    """Lingva proxies Google Translate from its own servers, so it works even
    when this IP is CAPTCHA-blocked. GET, text URL-encoded in the path. Rotates
    hosts and backs off on the brief 429 burst-limit instead of giving up, so
    fields get translated rather than silently degraded to the source text."""
    global _lingva_i
    enc = urllib.parse.quote(text, safe="")
    last = None
    for attempt in range(6):
        host = LINGVA_HOSTS[_lingva_i % len(LINGVA_HOSTS)]
        _lingva_i += 1
        try:
            url = f"https://{host}/api/v1/lt/{tl}/{enc}"
            res = json.loads(urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=30).read().decode("utf-8"))
            out = res.get("translation", "")
            if out:
                time.sleep(0.4)
                return out
            raise RuntimeError("empty translation")
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))   # wait out 429 / transient errors
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
    if _google_alive:
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
    rdfs:label "route type"@en , "maršruto tipas"@lt , "тип маршрута"@ru .

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

# --- themed categories (source taxonomy: scenic, barefoot, viewpoints, etc.) ---
ct:Category a owl:Class ;
    rdfs:label "Trail category"@en , "Tako kategorija"@lt , "Категория тропы"@ru ;
    rdfs:comment "A themed grouping a trail belongs to, from the source catalog."@en .
ct:category a owl:ObjectProperty ; rdfs:domain ct:Trail ; rdfs:range ct:Category ;
    rdfs:label "category"@en , "kategorija"@lt , "категория"@ru .
"""
    blocks = [P]
    for prop in PROP_ORDER:
        labels = prop_labels[prop]   # {lt,en,ru}
        comment = ""
        if prop == "suitableForCycling":
            comment = '    rdfs:comment "Inferred from the trail\'s free-text description."@en ;\n'
        blocks.append(
            f"ct:{prop} a owl:DatatypeProperty , ct:TrailProperty ;\n"
            f"    rdfs:domain ct:Trail ; rdfs:range xsd:boolean ;\n"
            f"{comment}"
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
    geoms = 0
    for t in trails:
        s = t["slug"]; uri = f"ct:trail-{s}"
        L = [f"{uri} a ct:Trail ;"]
        L.append(f"    rdfs:label {lit_langs(t['name'])} ;")
        L.append(f"    schema:name {lit_langs(t['name'])} ;")
        L.append(f'    schema:url <{t["link"]}> ;')
        if t.get("address_lt"):
            L.append(f'    schema:address "{esc1(t["address_lt"])}"@lt ;')
        if any(t["type"].values()):
            L.append(f"    ct:routeType {lit_langs(t['type'])} ;")
        for c in t.get("categories", []):
            L.append(f"    ct:category ct:cat-{c['id']} ;")
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
        wkt = wkt_from_gpx(os.path.join(ROOT, t["gpx_file"])) if t.get("gpx_file") else None
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
                 f"    schema:name {lit_langs(p['name'])} ;",
                 f'    ct:gpxFile "{p["gpx_source"]}"^^xsd:anyURI ;']
            for url in p.get("images", []):
                S.append(f"    foaf:depiction <{url}> ;")
            for rel in p.get("local_images", []):
                S.append(f"    schema:image <{rel}> ;")
            pwkt = wkt_from_gpx(os.path.join(ROOT, p["gpx_file"])) if p.get("gpx_file") else None
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
            categories.append({"id": c["id"], "name_lt": c["name_lt"],
                               "label": {"lt": c["name_lt"],
                                         "en": translate(c["name_lt"], "en"),
                                         "ru": translate(c["name_lt"], "ru")}})
    _save_cache()
    print(f"category labels translated ({len(categories)})")

    trails = []
    for i, r in enumerate(raw, 1):
        name = {"lt": r["name_lt"], "en": translate(r["name_lt"], "en"), "ru": translate(r["name_lt"], "ru")}
        desc = {"lt": r["description_lt"]}
        for l in LANGS:
            desc[l] = translate(r["description_lt"], l)
        rtype = {"lt": r["type_lt"]}
        for l in LANGS:
            rtype[l] = translate(r["type_lt"], l)
        props = {f["prop"]: True for f in r["features"]}
        props["suitableForCycling"] = bool(re.search(r"dvira[čc]i", r["description_lt"].lower()))
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
