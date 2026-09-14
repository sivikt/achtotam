import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { buildTrails, type BuiltData } from "./buildTrails";

// Provider gates the app on the one-time TTL parse + Trail[] assembly, then
// exposes the built data via context so App can read it synchronously (the maps
// and list consume a plain array, same as the old generated import). Per-view
// SPARQL (Sidebar/DetailPanel filters) still queries the live store directly.
const DataContext = createContext<BuiltData | null>(null);

export function RdfProvider({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const [data, setData] = useState<BuiltData | null>(null);
  useEffect(() => {
    let alive = true;
    buildTrails().then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, []);
  if (!data) return <>{fallback ?? null}</>;
  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
}

// Read the built data. Safe to call unconditionally inside the provider — it only
// renders children once data is ready, so this is never null there.
export function useTrailData(): BuiltData {
  const data = useContext(DataContext);
  if (!data) throw new Error("useTrailData must be used within a ready RdfProvider");
  return data;
}
