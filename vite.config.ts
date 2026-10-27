import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const cMapDirectory = new URL("./node_modules/pdfjs-dist/cmaps/", import.meta.url);

export default defineConfig({
  plugins: [{
    name: "pdfjs-cmaps",
    configureServer(server) {
      server.middlewares.use("/cmaps/", (request, response, next) => {
        const name = request.url?.slice(1);
        if (!name || !/^[A-Za-z0-9-]+\.bcmap$/.test(name)) {
          next();
          return;
        }
        response.setHeader("Content-Type", "application/octet-stream");
        const stream = createReadStream(fileURLToPath(new URL(name, cMapDirectory)));
        stream.on("error", next);
        stream.pipe(response);
      });
    },
    async generateBundle() {
      for (const name of await readdir(cMapDirectory)) {
        if (!name.endsWith(".bcmap")) continue;
        this.emitFile({
          type: "asset",
          fileName: `cmaps/${name}`,
          source: await readFile(new URL(name, cMapDirectory)),
        });
      }
    },
  }],
});
