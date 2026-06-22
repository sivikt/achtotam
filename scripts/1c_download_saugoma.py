#!/usr/bin/env python3
"""Step 1c — download cognitive trails / routes from saugoma.lt.

saugoma.lt (the State Service for Protected Areas) publishes each object behind a
numeric id, with three machine-readable endpoints we stitch together:

  * the multilingual record   /<lang>/objekty/export?format=xml&object=<id>
        — native LT/EN/RU/DE title-type-description plus a `;`-separated `media`
          photo list and `updated_at`. The `title_` is always Lithuanian, so the
          native display name in other languages comes from the page <title>.
  * the geometry              /api/gis/object?id=<id>
        — `geojson.MultiLineString` for the trails that own a track, otherwise an
          empty geojson and a single `geodata.geometry` Point (campsites, the bike
          routes published as a point only).
  * the human page            /ru/objekty/<slug>  (the URL the catalogue links to)
        — used only for the native RU name and as the object's external `link`.

These objects are NOT enumerable from any list endpoint (the /objekty catalogue and
the /api/gis/* feeds only return natural monuments and brand holders), so the set of
trails to archive is the curated OBJECTS list below. We write every object verbatim
into source_data/saugoma/objects.json and archive its photos under
source_data/saugoma/images/<slug>/. Step 2 turns this raw JSON into trail entries,
seeding the translation cache with the native EN/RU text so only the missing strings
are machine-translated.
"""
import os, re, json, html, urllib.request, urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT  = os.path.join(ROOT, "source_data", "saugoma")
IMGS = os.path.join(OUT, "images")
XML_URL = "https://saugoma.lt/ru/objekty/export?format=xml&object={id}"
GIS_URL = "https://saugoma.lt/api/gis/object?id={id}"
UA = {"User-Agent": "Mozilla/5.0 (compatible; trail-archiver/1.0)"}
# every saugoma.lt object is published by the State Service for Protected Areas;
# stamp each one with this author record so authorship lives in the raw data.
SITE_AUTHOR = {
    "id": "saugoma", "name": "Valstybinė saugomų teritorijų tarnyba",
    "type": "Organization", "website": "https://saugoma.lt/",
}

# the curated objects to archive: (numeric id, the /ru/ page URL the user picked).
OBJECTS = [
    (4419, "https://saugoma.lt/ru/objekty/objekty-poznavatelnaya-tropa-parshezheris"),
    (3649, "https://saugoma.lt/ru/objekty/objekty-poznavatelnaya-tropa-iomantayskogo-lesa"),
    (5012, "https://saugoma.lt/ru/objekty/objekty-poznavatelnaya-tropa-roga-spiginas"),
    (4019, "https://saugoma.lt/ru/objekty/objekty-tropa-yantarya-luksto"),
    (5920, "https://saugoma.lt/ru/objekty/aushtagari-velosipednyi-marshrut"),
    (5926, "https://saugoma.lt/ru/objekty/zhasugaly-velosipednyi-marshrut"),
    (4018, "https://saugoma.lt/ru/objekty/objekty-letniy-lager-ozera-luksto"),
    (4418, "https://saugoma.lt/ru/objekty/objekty-letniy-lager-ozera-parshezherio"),
]


def fetch(url):
    return urllib.request.urlopen(
        urllib.request.Request(url, headers=UA), timeout=60).read().decode("utf-8", "replace")


def cdata(xml, tag):
    m = re.search(rf'<{tag}[^>]*>(?:<!\[CDATA\[(.*?)\]\]>)?</{tag}>', xml, re.S)
    return (m.group(1) or "").strip() if m else ""


def langs(xml, base):
    """Pull the per-language ({base}_lt/_en/_ru/_de) CDATA fields into a dict,
    dropping the empties."""
    return {lc: v for lc in ("lt", "en", "ru", "de")
            if (v := cdata(xml, f"{base}_{lc}"))}


CROP_RE = re.compile(r"/\d+x\d+_crop/")


def page_info(url):
    """(native name, [original image urls]) from the object's /ru/ page. The name
    is the <title> (minus the " | site" suffix); the gallery ships only resized
    `…/<w>x<h>_crop/<file>` images, so strip the crop segment to recover the
    full-size original. Reading filenames here sidesteps the XML `media` field,
    which collapses repeated spaces in some filenames (e.g. "takas  (1).jpg")."""
    try:
        h = fetch(url)
    except Exception:
        return "", []
    m = re.search(r"<title>(.*?)</title>", h, re.S)
    name = html.unescape(m.group(1).split("|")[0]).strip() if m else ""
    imgs, seen = [], set()
    for raw in re.findall(r"/uploads/objects/images/[^\"'<>]+?\.(?:jpg|jpeg|png|webp)", h, re.I):
        o = CROP_RE.sub("/", raw)
        if o not in seen:
            seen.add(o)
            imgs.append("https://saugoma.lt" + o)
    return name, imgs


def geometry(obj_id):
    """(wkt, lat, lng) for an object: a MULTILINESTRING when the track is present,
    otherwise the single POINT. Coordinates arrive as GeoJSON [lng, lat] strings."""
    d = json.loads(fetch(GIS_URL.format(id=obj_id)))
    gj = d.get("geojson")
    if isinstance(gj, dict) and gj.get("MultiLineString"):
        lines = gj["MultiLineString"]["coordinates"]
        parts, pts = [], []
        for line in lines:
            cs = [(float(c[0]), float(c[1])) for c in line if len(c) >= 2]
            if len(cs) >= 2:
                parts.append("(" + ", ".join(f"{x} {y}" for x, y in cs) + ")")
                pts.extend(cs)
        if parts:
            wkt = "MULTILINESTRING(" + ", ".join(parts) + ")"
            lat = sum(p[1] for p in pts) / len(pts)
            lng = sum(p[0] for p in pts) / len(pts)
            return wkt, lat, lng
    # point-only object: read geodata.geometry (a GeoJSON Point [lng, lat])
    geo = (d.get("geodata") or {}).get("geometry") or {}
    if geo.get("type") == "Point":
        lng, lat = float(geo["coordinates"][0]), float(geo["coordinates"][1])
        return f"POINT({lng} {lat})", lat, lng
    return None, None, None


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
    out, total_imgs = [], 0
    for obj_id, url in OBJECTS:
        slug = "sg-" + url.rstrip("/").rsplit("/", 1)[-1]
        print(f"fetching {obj_id} ({slug})")
        xml = fetch(XML_URL.format(id=obj_id))
        name = {"lt": cdata(xml, "title_")}
        ru_name, gallery = page_info(url)
        if ru_name:
            name["ru"] = ru_name
        wkt, lat, lng = geometry(obj_id)

        # photos: the page gallery carries the true filenames; fall back to the
        # XML `media` ("; "-joined //saugoma.lt/… urls) when the page has none.
        media = gallery or [("https:" + u.strip()) if u.strip().startswith("//") else u.strip()
                            for u in cdata(xml, "media").split(";") if u.strip()]
        local_imgs = []
        for n, src in enumerate(media):
            ext = os.path.splitext(urllib.parse.urlparse(src).path)[1] or ".jpg"
            rel = f"images/{slug}/{n:02d}{ext}"
            if download(urllib.parse.quote(src, safe="/:"), os.path.join(OUT, rel)):
                local_imgs.append(rel)
                total_imgs += 1

        out.append({
            "id": obj_id, "slug": slug, "link": url,
            "name": name,
            "object_type": langs(xml, "object_type"),
            "description": langs(xml, "description"),
            "address": langs(xml, "address"),
            "updated_at": cdata(xml, "updated_at"),
            "wkt": wkt, "lat": lat, "lng": lng,
            "images": media,
            "local_images": local_imgs,
            "author": SITE_AUTHOR,
        })
        geom = "POINT" if (wkt or "").startswith("POINT") else ("LINE" if wkt else "—")
        print(f"  {geom} | {len(media)} pics | {name.get('lt','')[:50]}")

    json.dump(out, open(os.path.join(OUT, "objects.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"wrote objects.json ({len(out)} objects) and {total_imgs} images under {OUT}")


if __name__ == "__main__":
    main()
