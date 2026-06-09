import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import cesium from "vite-plugin-cesium";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Local trail photos in source_data/images are served at /images in dev only
// (a fallback for trails without a remote URL). They are NOT copied into dist/;
// the UI loads images from nesedeknamuose.lt.
const imagesDir = fileURLToPath(new URL("./source_data/images", import.meta.url));

function sourceImages() {
  return {
    name: "source-images",
    configureServer(server: any) {
      server.middlewares.use("/images", (req: any, res: any, next: any) => {
        const rel = decodeURIComponent((req.url || "").split("?")[0]);
        const file = path.normalize(path.join(imagesDir, rel));
        if (file.startsWith(imagesDir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
          fs.createReadStream(file).pipe(res);
        } else next();
      });
    },
  };
}

export default defineConfig({
  // index.html lives in src/, so that is the Vite project root
  root: "src",
  // relative asset URLs so the built site works when hosted from any subpath
  base: "./",
  plugins: [react(), cesium(), sourceImages()],
  // outDir is relative to root; emit dist/ at the repo root, not src/dist
  build: { outDir: "../dist", emptyOutDir: true, target: "es2020", chunkSizeWarningLimit: 6000 },
});
