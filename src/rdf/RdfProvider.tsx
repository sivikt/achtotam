import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getGraph } from "./store";

// Provider gates the app on the one-time TTL parse + engine construction, so
// every view underneath can query synchronously-available infrastructure (the
// queries themselves are still async). Rendered once, at the root.
const ReadyContext = createContext(false);

export function RdfProvider({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    getGraph().then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  if (!ready) return <>{fallback ?? null}</>;
  return <ReadyContext.Provider value={ready}>{children}</ReadyContext.Provider>;
}

export const useRdfReady = () => useContext(ReadyContext);
