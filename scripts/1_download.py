#!/usr/bin/env python3
"""Step 1 — download all cognitive trails from nesedeknamuose.lt.

For every trail it collects: Lithuanian name, description, structured amenity
features, gallery images, GPS coordinates, length / duration / route type, and
the GPX track. GPX files and (capped) gallery images are saved locally; the
structured result is written to build/tracks_raw.json.

Re-running is cheap: existing GPX / image files are skipped.
"""
import os, re, json, html, urllib.request, urllib.parse, concurrent.futures

ROOT      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC       = os.path.join(ROOT, "source_data")   # raw downloaded inputs
LIST_URL  = "https://nesedeknamuose.lt/pazintiniai-takai/"
GPX_DIR   = os.path.join(SRC, "gpx")
IMG_DIR   = os.path.join(SRC, "images")
OUT       = os.path.join(SRC, "tracks_raw.json")
IMG_CAP   = 6          # gallery images to download per trail
UA        = {"User-Agent": "Mozilla/5.0 (compatible; trail-archiver/1.0)"}

# stable amenity icon key -> canonical RDF property name
FEATURE_PROP = {
    "privaziavimas": "asphaltAccess", "visuomeninis": "publicTransportAccess",
    "papludimys": "bathingSpot", "poilsiaviete": "restArea",
    "stovyklaviete": "campsite", "suoliukai": "benches",
    "stovejimo-aikstele": "carPark", "apzvalgos-vieta": "viewpoint",
    "apzvalgos-bokstelis": "observationTower", "wc": "toilet",
    "slaitas": "steepSlope", "laiptai": "stairs",
    "vezimelis": "strollerAccessible", "gerimai-ir-uzkandziai": "refreshments",
    "stendas": "infoBoards", "neigaliesiems": "wheelchairAccessible",
    "audio-info": "audioInfo",
}


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=45).read()


def clean(t):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", t))).strip()


def slug(link):
    return link.rstrip("/").split("/")[-1]


def get_markers():
    h = fetch(LIST_URL).decode("utf-8", "ignore")
    m = re.search(r"var markersData\s*=\s*(\[.*?\]);", h, re.S)
    arr = json.loads(m.group(1))
    for t in arr:
        t["name"] = html.unescape(t["title"]).strip()
    return arr


AJAX_URL = "https://nesedeknamuose.lt/wp-admin/admin-ajax.php"


def get_categories():
    """The catalog page tags every trail with one or more themed categories
    (taxonomy term_type=793: scenic, barefoot, viewpoints, themed, wild nature,
    pleasant walks). The taxonomy isn't in markersData — it lives behind the
    ajax filter — so query each category term and collect the trail slugs it
    returns. Returns [{id, name_lt, slugs:set}] in the page's filter order."""
    h = fetch(LIST_URL).decode("utf-8", "ignore")
    block = re.search(r'js-check-all.*?</ul>', h, re.S)
    if not block:
        return []
    terms = re.findall(
        r'name="cat_f\[\]"\s+value="(\d+)">\s*<span class="check-label">\s*(.*?)\s*</span>',
        block.group(0), re.S)
    cats = []
    for cid, name in terms:
        slugs = set()
        for page in range(1, 20):
            data = urllib.parse.urlencode(
                {"action": "filter_list", "term_type": "793",
                 "paged": str(page), "cat_f[]": cid}, doseq=True).encode()
            try:
                req = urllib.request.Request(AJAX_URL, data=data,
                    headers={**UA, "X-Requested-With": "XMLHttpRequest"})
                r = json.loads(urllib.request.urlopen(req, timeout=45).read().decode("utf-8", "ignore"))
            except Exception:
                break
            links = re.findall(
                r'href=\\?"(https://nesedeknamuose\.lt/pazintiniai-takai/[^"\\]+)', r.get(".results-row", ""))
            page_slugs = {l.rstrip("/").split("/")[-1] for l in links}
            before = len(slugs); slugs |= page_slugs
            if not page_slugs or len(slugs) == before:
                break
        cats.append({"id": cid, "name_lt": clean(name), "slugs": slugs})
    return cats


def scrape_detail(t):
    try:
        h = fetch(t["link"]).decode("utf-8", "ignore")
    except Exception as e:
        t["error"] = str(e); return t
    # amenity features (structured "Papildoma informacija" block)
    feats = []
    m = re.search(r"section-extra-info.*?</ul>", h, re.S)
    if m:
        for svg, label in re.findall(
            r'<li>\s*<div class="icon">\s*<img src="([^"]+\.svg)"[^>]*>\s*</div>\s*(.*?)\s*</li>',
            m.group(0), re.S):
            key = svg.split("/")[-1].replace(".svg", "")
            if key in FEATURE_PROP:
                feats.append({"key": key, "prop": FEATURE_PROP[key], "label_lt": clean(label)})
    t["features"] = feats
    # gallery images (full-resolution links)
    imgs = []
    for u in re.findall(
        r'<figure class="wp-block-image[^"]*">\s*<a href="(https://nesedeknamuose\.lt/wp-content/uploads/[^"]+\.(?:jpg|jpeg|png|webp))"', h):
        if u not in imgs:
            imgs.append(u)
    t["images"] = imgs
    JUNK = re.compile(r"googletag|cmd\.push|adsbygoogle|gtag\(|Kopijuoti|Papildoma informacija", re.I)
    # multipart trails: each <h2 class="wp-block-heading"> section that owns its
    # own GPX is a named segment (atkarpa / kilpa) with its own gallery and,
    # sometimes, its own prose. The whole-route GPX sits before the first such
    # segment heading; the segments carry the rest.
    heads = list(re.finditer(r'<h2[^>]*class="wp-block-heading"[^>]*>(.*?)</h2>', h, re.S))
    gpx_all = re.findall(r'data-gpx-source="([^"]+)"', h)
    segs, seg_pos = [], []
    for i, m in enumerate(heads):
        region = h[m.end():(heads[i + 1].start() if i + 1 < len(heads) else len(h))]
        pg = re.findall(r'data-gpx-source="([^"]+)"', region)
        if not pg:
            continue
        pimgs = []
        for u in re.findall(
            r'<figure class="wp-block-image[^"]*">\s*<a href="(https://nesedeknamuose\.lt/wp-content/uploads/[^"]+\.(?:jpg|jpeg|png|webp))"', region):
            if u not in pimgs:
                pimgs.append(u)
        pdesc = "\n\n".join(
            clean(x) for x in re.findall(
                r'<p[^>]*class="wp-block-paragraph"[^>]*>(.*?)</p>', region, re.S)
            if x and not JUNK.search(x))
        segs.append({"name_lt": clean(m.group(1)), "gpx_source": pg[0],
                     "description_lt": pdesc.strip(), "images": pimgs})
        seg_pos.append(m.start())
    seg_gpx = {p["gpx_source"] for p in segs}
    multipart = len(segs) >= 2 and len(gpx_all) > len(segs)
    t["parts"] = segs if multipart else []

    # trail-level description: the Gutenberg article body. For multipart trails
    # that is only the intro text before the first segment heading, so segment
    # titles don't bleed into the whole-trail description.
    scope = h[:seg_pos[0]] if multipart else h
    parts = re.findall(
        r'<(h[1-6]|p)[^>]*class="wp-block-(?:heading|paragraph)"[^>]*>(.*?)</\1>', scope, re.S)
    chunks = [clean(x) for _, x in parts]
    if not any(chunks):                       # old/sparse pages: fall back to .entry body
        mm = re.search(r'<div class="entry">(.*)', scope, re.S)
        body = mm.group(1) if mm else scope
        chunks = [clean(x) for tag, x in re.findall(r'<(h[1-6]|p)[^>]*>(.*?)</\1>', body, re.S)
                  if not JUNK.search(x)]
    desc = "\n\n".join(c for c in chunks if c and not JUNK.search(c))
    desc = re.sub(r"googletag\.cmd\.push\([^;]*\);?", "", desc)   # safety net
    t["description_lt"] = desc.strip()

    # trail GPX: the whole-route track for the main map. For multipart that's the
    # GPX not owned by any segment; otherwise the first (only) GPX on the page.
    if multipart:
        t["gpx_source"] = next((g for g in gpx_all if g not in seg_gpx), gpx_all[0])
        reps = [p["images"][0] for p in segs if p["images"]]   # one thumb per segment
        if reps:
            t["images"] = reps
    else:
        t["gpx_source"] = gpx_all[0] if gpx_all else None
    return t


def download(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return True
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for _ in range(3):
        try:
            b = fetch(url)
            if b:
                open(path, "wb").write(b); return True
        except Exception:
            pass
    return False


def main():
    os.makedirs(SRC, exist_ok=True)
    markers = get_markers()
    print(f"listing: {len(markers)} trails")

    cats = get_categories()
    slug_cats = {}                       # slug -> [{id, name_lt}] in page order
    for c in cats:
        for sl in c["slugs"]:
            slug_cats.setdefault(sl, []).append({"id": c["id"], "name_lt": c["name_lt"]})
    print(f"categories: {len(cats)} themes, {len(slug_cats)} trails tagged")

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        markers = list(ex.map(scrape_detail, markers))
    markers = [t for t in markers if not t.get("error")]

    out = []
    img_jobs, gpx_jobs = [], []
    for t in markers:
        s = slug(t["link"])
        has_gpx = bool(t.get("gpx_source"))   # point-only trails have no track
        if has_gpx:
            gpx_jobs.append((t["gpx_source"], os.path.join(GPX_DIR, s + ".gpx")))
        local_imgs = []
        for n, url in enumerate(t["images"][:IMG_CAP]):
            ext = os.path.splitext(urllib.parse.urlparse(url).path)[1] or ".jpg"
            rel = f"images/{s}/{n:02d}{ext}"           # web path (served from /images)
            local_imgs.append(rel)
            img_jobs.append((url, os.path.join(SRC, rel)))
        # multipart segments: own gpx track + own (capped) gallery
        parts_out = []
        for pi, p in enumerate(t.get("parts", []), 1):
            ps = f"{s}-p{pi:02d}"
            gpx_jobs.append((p["gpx_source"], os.path.join(GPX_DIR, ps + ".gpx")))
            p_imgs, p_local = p["images"][:IMG_CAP], []
            for n, url in enumerate(p_imgs):
                ext = os.path.splitext(urllib.parse.urlparse(url).path)[1] or ".jpg"
                rel = f"images/{ps}/{n:02d}{ext}"
                p_local.append(rel)
                img_jobs.append((url, os.path.join(SRC, rel)))
            parts_out.append({
                "slug": ps, "num": pi, "name_lt": p["name_lt"],
                "description_lt": p["description_lt"],
                "gpx_source": p["gpx_source"], "gpx_file": f"source_data/gpx/{ps}.gpx",
                "images": p_imgs, "local_images": p_local,
            })
        out.append({
            "slug": s, "name_lt": t["name"], "link": t["link"],
            "lat": float(t["lat"]), "lng": float(t["lng"]),
            "address_lt": t.get("address", ""),
            "length": t.get("length", ""), "duration_lt": t.get("duration", ""),
            "type_lt": t.get("type", ""),
            "description_lt": t.get("description_lt", ""),
            "features": t["features"],
            "images": t["images"],
            "local_images": local_imgs,
            "gpx_source": t["gpx_source"] if has_gpx else None,
            "gpx_file": f"source_data/gpx/{s}.gpx" if has_gpx else "",
            "categories": slug_cats.get(s, []),
            "parts": parts_out,
        })

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as ex:
        ok_g = sum(ex.map(lambda j: download(*j), gpx_jobs))
        ok_i = sum(ex.map(lambda j: download(*j), img_jobs))
    print(f"gpx: {ok_g}/{len(gpx_jobs)} | images: {ok_i}/{len(img_jobs)}")

    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"wrote {OUT} ({len(out)} trails)")


if __name__ == "__main__":
    main()
