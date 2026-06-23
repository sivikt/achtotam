#!/usr/bin/env python3
"""Step 1d — scrape the Žemaitija / Telšiai region routes from visit.telsiai.lt.

visit.telsiai.lt runs the same CMS as baltukelias.lt: the whole route catalogue
ships inside the "all routes" page as a single JS object handed to a Leaflet
plugin:

    var map = $('#map').LeafletMap({ ..., routes: { "<id>": { ... }, ... } });

Each route carries name/description (keyed by language id: 1=LT, 2=EN, 3=RU),
the full track as a `filterpoints` array of [lat, lng] pairs, distance (m),
time (s) and a `pics` list. Unlike baltukelias, each language page populates only
its own language's text, so we fetch the LT, EN and RU catalogue pages and merge
the native EN/RU name+description (by route id) into the LT routes. That merged
object is written verbatim to source_data/telsiai/routes.json, and each route's
photos are archived under source_data/telsiai/images/<slug>/. Step 2
(load_telsiai) turns this raw JSON into ontology trail entries.
"""
import os, json, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT  = os.path.join(ROOT, "source_data", "telsiai")
IMGS = os.path.join(OUT, "images")
# the catalogue per language; route text lives under the page-language key
# (1=LT, 2=EN, 3=RU), so we merge all three into one multilingual routes object.
LIST_URLS = {"1": "https://visit.telsiai.lt/lt/marsrutai/",
             "2": "https://visit.telsiai.lt/en/routes/",
             "3": "https://visit.telsiai.lt/ru/marshrut/"}
IMG_BASE = "https://visit.telsiai.lt/data/tourism_objects/large/"
UA = {"User-Agent": "Mozilla/5.0 (compatible; trail-archiver/1.0)"}
# every route is published by the regional tourism information centre; stamp each
# route with this author record so authorship lives in the raw data.
SITE_AUTHOR = {
    "id": "telsiai", "name": "Žemaitijos turizmo informacijos centras",
    "type": "Organization", "website": "https://visit.telsiai.lt/",
}


def fetch(url):
    return urllib.request.urlopen(
        urllib.request.Request(url, headers=UA), timeout=60).read().decode("utf-8", "replace")


def extract_routes(html):
    """Pull the `routes: { ... }` object out of the LeafletMap(...) init by
    brace-matching from the first '{' after the `routes:` key."""
    i = html.find("LeafletMap(")
    if i < 0:
        raise RuntimeError("LeafletMap init not found")
    r = html.find("routes:", i)
    b = html.find("{", r)
    depth, j = 0, b
    while j < len(html):
        c = html[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    return json.loads(html[b:j + 1])


def slug_of(route):
    """Stable slug from the route's own view_url (its last path segment),
    namespaced with a tl- prefix so it can't collide with other sources."""
    url = (route.get("view_url") or "").rstrip("/")
    seg = url.rsplit("/", 1)[-1] if url else ("route-" + str(route.get("id")))
    return "tl-" + (seg or ("route-" + str(route.get("id"))))


def download(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return True
    try:
        data = urllib.request.urlopen(
            urllib.request.Request(url, headers=UA), timeout=60).read()
        if not data:
            return False
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "wb").write(data)
        return True
    except Exception as e:
        print(f"    ! image failed {url}: {e}")
        return False


def main():
    os.makedirs(IMGS, exist_ok=True)
    print(f"fetching {LIST_URLS['1']}")
    routes = extract_routes(fetch(LIST_URLS["1"]))   # LT is the base catalogue
    print(f"found {len(routes)} routes")

    # merge native EN/RU name + description (by route id) from the other pages
    for lang in ("2", "3"):
        print(f"fetching {LIST_URLS[lang]}")
        try:
            other = extract_routes(fetch(LIST_URLS[lang]))
        except Exception as e:
            print(f"  ! {lang} catalogue failed ({e}); that language falls back to machine translation")
            continue
        by_id = {str(v.get("id")): v for v in other.values()}
        merged = 0
        for route in routes.values():
            o = by_id.get(str(route.get("id")))
            if not o:
                continue
            for field in ("name", "description"):
                val = (o.get(field) or {}).get(lang)
                if val:
                    route.setdefault(field, {})[lang] = val
                    merged += 1
        print(f"  merged {merged} native {('','LT','EN','RU')[int(lang)]} strings")

    for route in routes.values():
        route["author"] = SITE_AUTHOR

    json.dump(routes, open(os.path.join(OUT, "routes.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    total_imgs = 0
    for route in routes.values():
        s = slug_of(route)
        pics = route.get("pics") or []
        for n, pic in enumerate(pics):
            fn = pic.get("file_name")
            if not fn:
                continue
            ext = os.path.splitext(fn)[1] or ".jpg"
            dst = os.path.join(IMGS, s, f"{n:02d}{ext}")
            if download(IMG_BASE + fn, dst):
                total_imgs += 1
        name = (route.get("name") or {}).get("1") or (route.get("name") or {}).get("2") or s
        print(f"  {s}: {len(route.get('filterpoints') or [])} pts, {len(pics)} pics — {name.strip()[:50]}")

    print(f"wrote routes.json and {total_imgs} images under {OUT}")


if __name__ == "__main__":
    main()
