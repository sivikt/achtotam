// Assemble the app's Trail[] and vocabulary label maps from the in-memory graph
// at runtime, replacing the build-time compile_ttl.mjs → generated/trails.ts
// output. The maps consume Trail[] positionally (index = colour = identity), so
// this produces one shared, stably-ordered array — the runtime equivalent of the
// old generated module, kept byte-identical to it so shared links (colour/index)
// stay stable.
import type { LangMap } from "../lib/lang";
import { getGraph, PREFIXES, NS } from "./store";

interface Bag { [k: string]: string | undefined; }

// The app's data shapes are INFERRED from what assemble() actually returns — the
// ontology (via the SPARQL assembly below) is the single source of truth, so
// there is no hand-written Trail/Segment/… interface to drift from it. Consumers
// import these derived aliases instead of a standalone types module.
export type BuiltData = Awaited<ReturnType<typeof assemble>>;
export type Trail = BuiltData["trails"][number];
export type Segment = Trail["segments"][number];
export type Author = BuiltData["authors"][string];
export type Quantity = NonNullable<Trail["distance"]>;
export type RoutePoint = NonNullable<Trail["start"]>;

// first and last vertex of a WKT geometry (path order), as [lng,lat] — mirrors
// endpointsFromWKT() in compile_ttl.mjs.
function endpointsFromWKT(wkt: string): { start: [number, number]; finish: [number, number] } | null {
  const re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null, first: [number, number] | null = null, last: [number, number] | null = null;
  while ((m = re.exec(wkt))) {
    const lng = parseFloat(m[1]), lat = parseFloat(m[2]);
    if (!isFinite(lng) || !isFinite(lat)) continue;
    if (!first) first = [lng, lat];
    last = [lng, lat];
  }
  return first && last ? { start: first, finish: last } : null;
}

let built: ReturnType<typeof assemble> | null = null;

// Build once, memoized. Runs a handful of SELECTs and stitches the rows into the
// Trail[] shape the views expect. The return type is inferred from assemble() —
// no annotation, so BuiltData (below) reflects exactly what is produced.
export function buildTrails() {
  if (!built) built = assemble();
  return built;
}

async function assemble() {
  const { store, engine } = await getGraph();
  const select = async (q: string): Promise<Bag[]> => {
    const stream = await engine.queryBindings(PREFIXES + q, { sources: [store] });
    return (await stream.toArray()).map((b) => {
      const row: Bag = {};
      for (const [v, term] of b) {
        row[v.value] = term.value;
        if (term.termType === "Literal" && term.language) row[`${v.value}_lang`] = term.language;
      }
      return row;
    });
  };
  // group lang-tagged label rows into { key → { lang → label } }
  const langBy = (rows: Bag[], key: string, val: string): Record<string, LangMap> => {
    const m: Record<string, LangMap> = {};
    for (const r of rows) {
      if (r[key] == null || r[val] == null) continue;
      (m[r[key]!] ??= {})[r[`${val}_lang`] || "lt"] = r[val]!;
    }
    return m;
  };

  // --- TBox vocabularies ---
  const propLabels: Record<string, LangMap> = {};
  for (const [uri, labels] of Object.entries(
    langBy(await select(`SELECT ?p ?label WHERE { ?p a ct:TrailProperty ; rdfs:label ?label }`), "p", "label")))
    propLabels[uri.replace(NS, "")] = labels;
  const catLabels = langBy(await select(`SELECT ?c ?label WHERE { ?c a ct:Category ; rdfs:label ?label }`), "c", "label");
  const routeTypeLabels = langBy(await select(`SELECT ?rt ?label WHERE { ?rt a ct:RouteType ; rdfs:label ?label }`), "rt", "label");
  // UI strings: ct:ui-<key> individuals → { key → langmap }, stripping the prefix
  const ui: Record<string, LangMap> = {};
  for (const [uri, labels] of Object.entries(
    langBy(await select(`SELECT ?u ?label WHERE { ?u a ct:UILabel ; rdfs:label ?label }`), "u", "label")))
    ui[uri.replace(NS + "ui-", "")] = labels;

  // --- authors ---
  const authorRows = await select(`SELECT ?a ?name ?url ?sameAs WHERE {
    ?a a ?type ; foaf:name ?name . VALUES ?type { foaf:Person foaf:Organization }
    OPTIONAL { ?a schema:url ?url } OPTIONAL { ?a schema:sameAs ?sameAs } }`);
  // gather each author's rows, then build one literal with optional fields
  // present only when set (so the inferred Author type marks them optional).
  const authorAcc: Record<string, { name: string; website?: string; facebook?: string; instagram?: string }> = {};
  for (const r of authorRows) {
    const a = (authorAcc[r.a!] ??= { name: r.name || "" });
    if (r.url) a.website = r.url;
    if (r.sameAs && /facebook\.com/i.test(r.sameAs)) a.facebook = r.sameAs;
    if (r.sameAs && /instagram\.com/i.test(r.sameAs)) a.instagram = r.sameAs;
  }
  const authors = Object.fromEntries(Object.entries(authorAcc).map(([uri, a]) => [uri, {
    name: a.name,
    ...(a.website ? { website: a.website } : {}),
    ...(a.facebook ? { facebook: a.facebook } : {}),
    ...(a.instagram ? { instagram: a.instagram } : {}),
  }]));

  // --- per-trail scalar fields (one row per trail; OPTIONALs for sparse ones) ---
  const scalar = await select(`SELECT ?t ?lat ?lng ?link ?map ?address ?author ?rt ?wkt
      ?distV ?distU ?durV ?durU WHERE {
    ?t a ct:Trail .
    OPTIONAL { ?t geo:lat ?lat } OPTIONAL { ?t geo:long ?lng }
    OPTIONAL { ?t schema:url ?link } OPTIONAL { ?t schema:hasMap ?map }
    OPTIONAL { ?t schema:address ?address }
    OPTIONAL { ?t ct:author ?author } OPTIONAL { ?t ct:routeType ?rt }
    OPTIONAL { ?t ct:distance ?dn . ?dn ct:value ?distV . OPTIONAL { ?dn ct:unit ?distU } }
    OPTIONAL { ?t ct:duration ?rn . ?rn ct:value ?durV . OPTIONAL { ?rn ct:unit ?durU } }
    OPTIONAL { ?t geosparql:hasGeometry/geosparql:asWKT ?wkt }
  }`);

  // multi-valued fields, collected per trail
  const labels = langBy(await select(`SELECT ?t ?label WHERE { ?t a ct:Trail ; rdfs:label ?label }`), "t", "label");
  const descs = langBy(await select(`SELECT ?t ?d WHERE { ?t a ct:Trail ; dcterms:description ?d }`), "t", "d");
  const collect = (rows: Bag[], k: string, v: string): Record<string, string[]> => {
    const m: Record<string, string[]> = {};
    for (const r of rows) if (r[k] && r[v]) (m[r[k]!] ??= []).push(r[v]!);
    return m;
  };
  const images = collect(await select(`SELECT ?t ?img WHERE { ?t a ct:Trail ; foaf:depiction ?img }`), "t", "img");
  const localImages = collect(await select(`SELECT ?t ?img WHERE { ?t a ct:Trail ; schema:image ?img }`), "t", "img");
  const cats = collect(await select(`SELECT ?t ?c WHERE { ?t a ct:Trail ; ct:category ?c }`), "t", "c");
  const props = collect(await select(`SELECT ?t ?p WHERE { ?t a ct:Trail ; ?p true . ?p a ct:TrailProperty }`), "t", "p");
  const unitLabelMap = langBy(await select(`SELECT ?u ?label WHERE { ?u a ct:Unit ; rdfs:label ?label }`), "u", "label");

  // --- segments per trail ---
  const segRows = await select(`SELECT ?t ?seg ?num ?wkt WHERE {
    ?t ct:hasSegment ?seg .
    OPTIONAL { ?seg ct:segmentNumber ?num }
    OPTIONAL { ?seg geosparql:hasGeometry/geosparql:asWKT ?wkt }
  }`);
  const segLabels = langBy(await select(`SELECT ?seg ?label WHERE { ?seg a ct:TrailSegment ; rdfs:label ?label }`), "seg", "label");
  const segDescs = langBy(await select(`SELECT ?seg ?d WHERE { ?seg a ct:TrailSegment ; dcterms:description ?d }`), "seg", "d");
  const segImages = collect(await select(`SELECT ?seg ?img WHERE { ?seg a ct:TrailSegment ; foaf:depiction ?img }`), "seg", "img");
  const segLocal = collect(await select(`SELECT ?seg ?img WHERE { ?seg a ct:TrailSegment ; schema:image ?img }`), "seg", "img");
  const mkSeg = (r: Bag) => ({
    num: parseInt(r.num || "0", 10),
    name: segLabels[r.seg!] || {} as LangMap,
    desc: segDescs[r.seg!] || {} as LangMap,
    images: segImages[r.seg!] || [],
    localImages: segLocal[r.seg!] || [],
    ...(r.wkt ? { wkt: r.wkt } : {}),
  });
  const segsByTrail: Record<string, ReturnType<typeof mkSeg>[]> = {};
  const seenSeg = new Set<string>();
  for (const r of segRows) {
    if (!r.t || !r.seg || seenSeg.has(r.t + r.seg)) continue;
    seenSeg.add(r.t + r.seg);
    (segsByTrail[r.t] ??= []).push(mkSeg(r));
  }

  // one scalar row per trail (dedupe: OPTIONAL joins can multiply rows)
  const byUri: Record<string, Bag> = {};
  for (const r of scalar) byUri[r.t!] ??= r;

  interface Qty { value: string; unit: LangMap; }
  const quantity = (v?: string, unit?: string): Qty | null =>
    v == null ? null : { value: v, unit: unit ? unitLabelMap[unit] || {} : {} };
  interface Point { lng: number; lat: number; address?: string; }

  const trails = Object.keys(byUri).map((uri) => {
    const r = byUri[uri];
    const wkt = r.wkt;
    const lat = parseFloat(r.lat ?? ""), lng = parseFloat(r.lng ?? "");
    const address = r.address || "";
    // start / finish markers from geometry endpoints, else the single point
    let ends = wkt ? endpointsFromWKT(wkt) : null;
    if (!ends && isFinite(lat) && isFinite(lng)) ends = { start: [lng, lat], finish: [lng, lat] };
    let start: Point | undefined, finish: Point | undefined;
    if (ends) {
      const [a, b] = [ends.start, ends.finish];
      const circular = Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.0003;
      start = { lng: a[0], lat: a[1], ...(address ? { address } : {}) };
      if (!circular) finish = { lng: b[0], lat: b[1] };
    }
    return {
      uri,
      slug: uri.replace(NS + "trail-", ""),
      name: labels[uri] || {} as LangMap,
      desc: descs[uri] || {} as LangMap,
      routeType: r.rt || "",
      author: r.author || "",
      distance: quantity(r.distV, r.distU),
      duration: quantity(r.durV, r.durU),
      lat, lng,
      link: r.link || "",
      map: r.map || "",
      address,
      images: images[uri] || [],
      localImages: localImages[uri] || [],
      props: (props[uri] || []).map((p) => p.replace(NS, "")),
      categories: cats[uri] || [],
      segments: (segsByTrail[uri] || []).sort((a, b) => a.num - b.num),
      ...(wkt ? { wkt } : {}),
      ...(start ? { start } : {}),
      ...(finish ? { finish } : {}),
    };
  });

  // stable default order: alphabetical by LT name (matches compile_ttl.mjs, so
  // the positional colour/index used in shared links stays put)
  trails.sort((a, b) => (a.name.lt || "").toLowerCase().localeCompare((b.name.lt || "").toLowerCase(), "lt"));

  return { trails, propLabels, catLabels, routeTypeLabels, authors, ui };
}
