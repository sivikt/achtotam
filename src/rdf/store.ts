// Runtime RDF layer. The ontology (TBox) + data (ABox) TTL are inlined into the
// bundle as text (Vite `?raw`), parsed into a single in-memory N3.Store on first
// use, and queried with SPARQL via Comunica. This replaces the build-time
// compile_ttl.mjs → src/generated/trails.ts path: the graph is the live data
// source and every view issues its own SPARQL against it.
import N3 from "n3";
import { QueryEngine } from "@comunica/query-sparql-rdfjs";
// eslint-disable-next-line import/no-unresolved
import ontologyTtl from "../../source_data/ontology.ttl?raw";
// eslint-disable-next-line import/no-unresolved
import dataTtl from "../../source_data/data.ttl?raw";

// Shared prefix header prepended to every query so per-view SPARQL stays short.
export const PREFIXES = `
PREFIX ct:        <https://nesedeknamuose.lt/ontology/cognitive-trails#>
PREFIX rdf:       <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs:      <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dcterms:   <http://purl.org/dc/terms/>
PREFIX foaf:      <http://xmlns.com/foaf/0.1/>
PREFIX schema:    <https://schema.org/>
PREFIX geo:       <http://www.w3.org/2003/01/geo/wgs84_pos#>
PREFIX geosparql: <http://www.opengis.net/ont/geosparql#>
`;

export const NS = "https://nesedeknamuose.lt/ontology/cognitive-trails#";

let storePromise: Promise<{ store: N3.Store; engine: QueryEngine }> | null = null;

// Parse both TTL documents into one store and wrap a Comunica engine over it.
// Memoized: the parse (~38k triples) runs once per page load.
export function getGraph() {
  if (!storePromise) {
    storePromise = (async () => {
      const store = new N3.Store();
      const parser = new N3.Parser();
      for (const text of [ontologyTtl, dataTtl]) store.addQuads(parser.parse(text));
      return { store, engine: new QueryEngine() };
    })();
  }
  return storePromise;
}

// A single result row: variable name → its RDF term's string value. Language tag
// (for lang-tagged literals) is exposed under `${name}_lang` so views can bucket
// multilingual labels without a second query.
export type Row = Record<string, string | undefined>;

// Run a SELECT and return plain rows. The shared PREFIXES are prepended, so
// callers write only their WHERE clause and projection.
export async function select(query: string): Promise<Row[]> {
  const { store, engine } = await getGraph();
  const stream = await engine.queryBindings(PREFIXES + query, { sources: [store] });
  const bindings = await stream.toArray();
  return bindings.map((b) => {
    const row: Row = {};
    for (const [variable, term] of b) {
      row[variable.value] = term.value;
      if (term.termType === "Literal" && term.language) row[`${variable.value}_lang`] = term.language;
    }
    return row;
  });
}
