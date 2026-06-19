#!/usr/bin/env python3
"""Step 1b — scrape the Balts' Road routes from baltukelias.lt.

The whole route catalogue ships inside the Lithuanian "all routes" page as a
single JS object handed to a Leaflet plugin:

    var map = $('#map').LeafletMap({ ..., routes: { "<id>": { ... }, ... } });

Each route carries multilingual name/description (1=LT, 2=EN, 5=LV, 6=PL — no
native RU), the full track as a `filterpoints` array of [lat, lng] pairs,
distance (m), time (s) and a `pics` list. That single page is everything we
need, so we fetch it once, extract the `routes` object verbatim into
source_data/baltukelias/routes.json, and archive each route's photos under
source_data/baltukelias/images/<slug>/. Step 2 (load_baltukelias) turns this
raw JSON into ontology trail entries.
"""
import os, re, json, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT  = os.path.join(ROOT, "source_data", "baltukelias")
IMGS = os.path.join(OUT, "images")
LIST_URL = "https://www.baltukelias.lt/lt/visi-marsrutai/"
# The same catalogue in English: route names/descriptions are multilingual in the
# LT page already, but each point-of-interest (`segments[].objects[]`) carries only
# the page-language name/description — so we fetch the EN page too and harvest the
# native English point text (keyed by object_id) instead of machine-translating it.
LIST_URL_EN = "https://www.baltukelias.lt/en/all-routes/"
IMG_BASE = "https://www.baltukelias.lt/data/tourism_objects/large/"
UA = {"User-Agent": "Mozilla/5.0 (compatible; trail-archiver/1.0)"}
# every Balts' Road route is published by the Baltukelias project; stamp each route
# with this author record so authorship lives in the raw data, not the build step.
SITE_AUTHOR = {
    "id": "baltukelias", "name": "Baltukelias", "type": "Organization",
    "website": "https://www.baltukelias.lt/",
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
    namespaced with a bk- prefix so it can't collide with other sources."""
    url = (route.get("view_url") or "").rstrip("/")
    seg = url.rsplit("/", 1)[-1] if url else ("route-" + str(route.get("id")))
    return "bk-" + (seg or ("route-" + str(route.get("id"))))


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
    print(f"fetching {LIST_URL}")
    routes = extract_routes(fetch(LIST_URL))
    print(f"found {len(routes)} routes")

    for route in routes.values():
        route["author"] = SITE_AUTHOR

    json.dump(routes, open(os.path.join(OUT, "routes.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    # native English point text, keyed by object_id, from the EN catalogue page
    print(f"fetching {LIST_URL_EN}")
    objects_en = {}
    try:
        en_routes = extract_routes(fetch(LIST_URL_EN))
        for route in en_routes.values():
            for seg in route.get("segments") or []:
                for o in seg.get("objects") or []:
                    oid = o.get("object_id") or o.get("id")
                    if oid and oid not in objects_en:
                        objects_en[oid] = {"name": o.get("name") or "",
                                           "description": o.get("description") or ""}
        print(f"  harvested EN text for {len(objects_en)} points")
    except Exception as e:
        print(f"  ! EN catalogue failed ({e}); points will fall back to machine translation")
    json.dump(objects_en, open(os.path.join(OUT, "objects_en.json"), "w", encoding="utf-8"),
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
        print(f"  {s}: {len((route.get('filterpoints') or []))} pts, {len(pics)} pics — {name.strip()[:50]}")

    print(f"wrote routes.json and {total_imgs} images under {OUT}")


if __name__ == "__main__":
    main()
