import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

// Allidroid wraps user plugins as `vendetta => { return <index.js> }`, so the
// bundle has to be one expression that evaluates to the plugin object.
await build({
    entryPoints: ["src/index.tsx"],
    outfile: "index.js",
    bundle: true,
    format: "iife",
    globalName: "$",
    banner: { js: "(()=>{" },
    footer: { js: "return $;})();" },
    target: "es2020",
    jsx: "transform",
    legalComments: "none",
    minifyWhitespace: true,
    minifySyntax: true
});

const js = await readFile("index.js", "utf8");
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));

manifest.main = "index.js";
manifest.hash = createHash("sha256").update(js).digest("hex");

await writeFile("manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built index.js (${js.length} bytes), hash ${manifest.hash}`);
