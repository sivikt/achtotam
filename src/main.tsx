import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "cesium/Build/Cesium/Widgets/widgets.css";
import "./styles.css";
import App from "./App";
import { RdfProvider } from "./rdf/RdfProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RdfProvider fallback={<div className="rdf-loading">Loading trails…</div>}>
      <App />
    </RdfProvider>
  </StrictMode>
);
