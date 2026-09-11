// Per-view SPARQL queries. Each view imports the query it needs and runs it with
// useSparql(); the shared PREFIXES header is prepended in store.ts.

// TBox vocabularies -------------------------------------------------------

// Themed subjective characteristics (ct:Category) → localized labels.
export const CATEGORIES = `
SELECT ?cat ?label WHERE {
  ?cat a ct:Category ; rdfs:label ?label .
}`;

// Amenity / accessibility flags (ct:TrailProperty) → localized labels. The
// short local name (e.g. "asphaltAccess") is the stable key used on trails.
export const PROPERTIES = `
SELECT ?prop ?label WHERE {
  ?prop a ct:TrailProperty ; rdfs:label ?label .
}`;

// Route geometry types. ct:routeType carries lang-tagged literals inline on each
// trail; DISTINCT collapses them to the vocabulary of distinct labels.
export const ROUTE_TYPES = `
SELECT DISTINCT ?label WHERE {
  ?trail a ct:Trail ; ct:routeType ?label .
}`;

// Authors (foaf:Person / foaf:Organization) with optional site + socials.
export const AUTHORS = `
SELECT ?author ?name ?url ?sameAs WHERE {
  ?author a ?type ; foaf:name ?name .
  VALUES ?type { foaf:Person foaf:Organization }
  OPTIONAL { ?author schema:url ?url }
  OPTIONAL { ?author schema:sameAs ?sameAs }
}`;

// The detail view ---------------------------------------------------------
// Each concern is a small query scoped to the selected trail's URI, so the
// panel sources its own labels from the graph instead of the generated maps.

// Subjective-characteristic badges: the trail's ct:Category individuals + labels.
export const trailCategories = (uri: string) => `
SELECT ?cat ?label WHERE {
  <${uri}> ct:category ?cat . ?cat rdfs:label ?label .
}`;

// Amenity badges: boolean ct:TrailProperty flags set true on the trail + labels.
// ?prop is the property URI; the short local name is derived in the view.
export const trailProps = (uri: string) => `
SELECT ?prop ?label WHERE {
  <${uri}> ?prop true . ?prop a ct:TrailProperty ; rdfs:label ?label .
}`;

// Route-type label for the meta line (lang-tagged; the view picks the locale).
export const trailRouteType = (uri: string) => `
SELECT ?label WHERE {
  <${uri}> ct:routeType/rdfs:label ?label .
}`;

// Author details: name + optional website (schema:url) + social profiles
// (schema:sameAs, one row each — the view buckets facebook/instagram by host).
export const trailAuthor = (uri: string) => `
SELECT ?name ?url ?sameAs WHERE {
  <${uri}> ct:author ?a . ?a foaf:name ?name .
  OPTIONAL { ?a schema:url ?url }
  OPTIONAL { ?a schema:sameAs ?sameAs }
}`;

// The trail list view -----------------------------------------------------

// Escape a user string for embedding in a SPARQL double-quoted literal.
const lit = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export interface TrailFilters {
  search: string;
  themes: string[]; // ct:Category URIs — match ANY (OR)
  cats: string[];   // ct:RouteType URIs — match ANY (OR)
  attrs: string[];  // ct:TrailProperty local names — require ALL (AND)
}

// Build a SELECT returning the slug of every trail matching the active content
// filters. Each facet becomes a graph pattern: search → any label CONTAINS the
// term; themes/cats → a VALUES set matched via FILTER EXISTS (OR within a facet);
// attrs → one boolean-true pattern per attribute (AND across attributes). Sorting
// and map-view narrowing stay in the client (locale collation / geometry).
export function filteredTrails({ search, themes, cats, attrs }: TrailFilters): string {
  const where: string[] = ["?t a ct:Trail ."];
  const term = search.trim().toLowerCase();
  if (term) {
    where.push(
      `FILTER EXISTS { ?t rdfs:label ?_n . FILTER(CONTAINS(LCASE(STR(?_n)), "${lit(term)}")) }`);
  }
  if (themes.length) {
    where.push(
      `FILTER EXISTS { VALUES ?_c { ${themes.map((u) => `<${u}>`).join(" ")} } ?t ct:category ?_c }`);
  }
  if (cats.length) {
    where.push(
      `FILTER EXISTS { VALUES ?_rt { ${cats.map((u) => `<${u}>`).join(" ")} } ?t ct:routeType ?_rt }`);
  }
  for (const a of attrs) where.push(`?t ct:${a} true .`);
  return `SELECT DISTINCT (REPLACE(STR(?t), "^.*trail-", "") AS ?slug) WHERE {\n  ${where.join("\n  ")}\n}`;
}
