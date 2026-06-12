// Build-time RDF → TS compiler.
// Parses ontology.ttl (TBox) + data.ttl (ABox) with N3 and emits a typed module
// at src/generated/trails.ts, so the React app ships plain JS data with no
// runtime RDF parsing. Mirrors the legacy buildTrailsFromStore() logic.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import N3 from "n3";

const { DataFactory } = N3;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = path.join(ROOT, "src", "generated");
const OUT = path.join(OUT_DIR, "trails.ts");

const NS = {
  ct: "https://nesedeknamuose.lt/ontology/cognitive-trails#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  dcterms: "http://purl.org/dc/terms/",
  foaf: "http://xmlns.com/foaf/0.1/",
  schema: "https://schema.org/",
  geo: "http://www.w3.org/2003/01/geo/wgs84_pos#",
  geosparql: "http://www.opengis.net/ont/geosparql#",
};

const store = new N3.Store();
for (const name of ["ontology.ttl", "data.ttl"]) {
  const text = readFileSync(path.join(ROOT, "source_data", name), "utf-8");
  store.addQuads(new N3.Parser().parse(text));
}

const objs = (s, p) => store.getObjects(DataFactory.namedNode(s), DataFactory.namedNode(p), null);
const one = (s, p) => { const o = objs(s, p); return o.length ? o[0] : null; };
function byLang(s, p) {
  const m = {};
  for (const t of objs(s, p)) if (t.termType === "Literal") m[t.language || "lt"] = t.value;
  return m;
}
// first and last vertex of a WKT geometry (vertices are listed in path order in
// both LINESTRING and MULTILINESTRING), as [lng,lat]
function endpointsFromWKT(wkt) {
  const re = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g;
  let m, first = null, last = null;
  while ((m = re.exec(wkt))) {
    const lng = parseFloat(m[1]), lat = parseFloat(m[2]);
    if (!isFinite(lng) || !isFinite(lat)) continue;
    if (!first) first = [lng, lat];
    last = [lng, lat];
  }
  return first ? { start: first, finish: last } : null;
}

// schema:QuantitativeValue blank node → { value, localized unit labels }.
// The subject is a blank node, so query by the term itself (named-node helpers
// won't match). The unit is a QUDT IRI whose labels live in the ontology.
function quantity(node) {
  if (!node) return null;
  const v = store.getObjects(node, DataFactory.namedNode(NS.schema + "value"), null)[0];
  if (!v) return null;
  const u = store.getObjects(node, DataFactory.namedNode(NS.schema + "unitCode"), null)[0];
  return { value: v.value, unit: u ? byLang(u.value, NS.rdfs + "label") : {} };
}

// TBox: amenity property labels + themed category labels
const propLabels = {};
for (const q of store.getQuads(null, NS.rdf + "type", DataFactory.namedNode(NS.ct + "TrailProperty"), null)) {
  propLabels[q.subject.value.replace(NS.ct, "")] = byLang(q.subject.value, NS.rdfs + "label");
}
const catLabels = {};
for (const q of store.getQuads(null, NS.rdf + "type", DataFactory.namedNode(NS.ct + "Category"), null)) {
  catLabels[q.subject.value] = byLang(q.subject.value, NS.rdfs + "label");
}
// route geometry vocabulary: node URI → multilingual label (like catLabels)
const routeTypeLabels = {};
for (const q of store.getQuads(null, NS.rdf + "type", DataFactory.namedNode(NS.ct + "RouteType"), null)) {
  routeTypeLabels[q.subject.value] = byLang(q.subject.value, NS.rdfs + "label");
}
// authors: foaf:Person node URI → { name, facebook?, instagram? }; social profiles
// come from schema:sameAs and are bucketed by host.
const authors = {};
for (const q of store.getQuads(null, NS.rdf + "type", DataFactory.namedNode(NS.foaf + "Person"), null)) {
  const s = q.subject.value;
  const sameAs = objs(s, NS.schema + "sameAs").map((o) => o.value);
  const a = { name: one(s, NS.foaf + "name")?.value || "" };
  const fb = sameAs.find((u) => /facebook\.com/i.test(u));
  const ig = sameAs.find((u) => /instagram\.com/i.test(u));
  if (fb) a.facebook = fb;
  if (ig) a.instagram = ig;
  authors[s] = a;
}

// ABox: trails
const trails = [];
for (const q of store.getQuads(null, NS.rdf + "type", DataFactory.namedNode(NS.ct + "Trail"), null)) {
  const s = q.subject.value;
  const t = {
    uri: s,
    slug: s.replace(NS.ct + "trail-", ""),
    name: byLang(s, NS.rdfs + "label"),
    desc: byLang(s, NS.dcterms + "description"),
    routeType: one(s, NS.ct + "routeType")?.value || "",
    author: one(s, NS.ct + "author")?.value || "",
    distance: quantity(one(s, NS.ct + "distance")),
    duration: quantity(one(s, NS.ct + "duration")),
    lat: parseFloat(one(s, NS.geo + "lat")?.value),
    lng: parseFloat(one(s, NS.geo + "long")?.value),
    link: one(s, NS.schema + "url")?.value || "",
    map: one(s, NS.schema + "hasMap")?.value || "",
    address: (objs(s, NS.schema + "address")[0] || {}).value || "",
    images: objs(s, NS.foaf + "depiction").map((o) => o.value),
    localImages: objs(s, NS.schema + "image").map((o) => o.value),
    props: [],
    categories: objs(s, NS.ct + "category").map((o) => o.value),
    segments: [],
  };
  for (const prop in propLabels) {
    const v = one(s, NS.ct + prop);
    if (v && v.value === "true") t.props.push(prop);
  }
  const g = one(s, NS.geosparql + "hasGeometry");
  if (g) { const wkt = one(g.value, NS.geosparql + "asWKT"); if (wkt) t.wkt = wkt.value; }

  // start / finish markers: from the geometry endpoints, else the single point.
  // address (which describes where the route begins) is attached to the start;
  // a circular route (start ≈ finish, ~30 m) collapses to a single start marker.
  let ends = t.wkt ? endpointsFromWKT(t.wkt) : null;
  if (!ends && isFinite(t.lat) && isFinite(t.lng)) ends = { start: [t.lng, t.lat], finish: [t.lng, t.lat] };
  if (ends) {
    const [a, b] = [ends.start, ends.finish];
    const circular = Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.0003;
    t.start = { lng: a[0], lat: a[1], address: t.address || undefined };
    if (!circular) t.finish = { lng: b[0], lat: b[1] };
  }
  for (const so of objs(s, NS.ct + "hasSegment")) {
    const su = so.value;
    const seg = {
      num: parseInt((one(su, NS.ct + "segmentNumber") || {}).value || "0", 10),
      name: byLang(su, NS.rdfs + "label"),
      desc: byLang(su, NS.dcterms + "description"),
      images: objs(su, NS.foaf + "depiction").map((o) => o.value),
      localImages: objs(su, NS.schema + "image").map((o) => o.value),
    };
    const sg = one(su, NS.geosparql + "hasGeometry");
    if (sg) { const w = one(sg.value, NS.geosparql + "asWKT"); if (w) seg.wkt = w.value; }
    t.segments.push(seg);
  }
  t.segments.sort((a, b) => a.num - b.num);
  trails.push(t);
}
// stable default order: alphabetical by LT name (UI re-sorts per chosen locale)
trails.sort((a, b) => (a.name.lt || "").toLowerCase().localeCompare((b.name.lt || "").toLowerCase(), "lt"));

const J = (v) => JSON.stringify(v);
const header = `// AUTO-GENERATED by scripts/compile_ttl.mjs from ontology.ttl + data.ttl.
// Do not edit by hand — re-run \`npm run compile:data\`.
import type { Trail, LangMap, Author } from "../data/types";

`;
const body =
  `export const trails: Trail[] = ${J(trails)};\n\n` +
  `export const propLabels: Record<string, LangMap> = ${J(propLabels)};\n\n` +
  `export const catLabels: Record<string, LangMap> = ${J(catLabels)};\n\n` +
  `export const routeTypeLabels: Record<string, LangMap> = ${J(routeTypeLabels)};\n\n` +
  `export const authors: Record<string, Author> = ${J(authors)};\n`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, header + body, "utf-8");

const geomCount = trails.filter((t) => t.wkt).length;
const segCount = trails.reduce((n, t) => n + t.segments.length, 0);
console.log(
  `wrote src/generated/trails.ts — ${trails.length} trails, ${Object.keys(catLabels).length} categories, ` +
  `${Object.keys(routeTypeLabels).length} route types, ${Object.keys(authors).length} authors, ` +
  `${Object.keys(propLabels).length} props, ${geomCount} geometries, ${segCount} segments`
);
