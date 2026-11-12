// Pixel Acre Arcade — asset compression + assets.json (which variant each page should load).
//
//   npm i -D sharp @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions draco3dgltf
//   # KTX2 needs `toktx` (KTX-Software ≥ 4.3) on PATH, or TOKTX=/path/to/toktx
//   node tools/compress-assets.mjs            # writes img/opt/*, *.draco.glb and assets.json
//
// For every texture: a WebP resized to the size it is shown at, and a KTX2 (Basis ETC1S, mipmapped,
// GPU-compressed: ~6× less video memory than RGBA). For every GLB: a DRACO-compressed copy.
//
// Then it DECIDES, per group, what the page should download, by bytes over the wire (gzip, as any
// host serves it): a DRACO or KTX2 variant is chosen only if the group saves more than the decoder
// it requires (DRACO ≈ 75 KB, KTX2 ≈ 260 KB gzipped, downloaded once per page). Small assets keep
// the plain file — on a phone, an extra 260 KB of transcoder costs more than it saves.
// Override with --prefer-ktx2 / --prefer-draco (e.g. when video memory matters more than bytes),
// or per visit with ?assets=ktx2 / ?assets=draco / ?assets=plain.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, unlinkSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = new Set(process.argv.slice(2));
const DECODER_GZ = { ktx2: 260e3, draco: 75e3 };
const gz = (buf) => gzipSync(buf, { level: 9 }).length;
const rel = (p) => relative(ROOT, p).split("\\").join("/");
const kb = (n) => (n / 1024).toFixed(1) + " KB";

// what to process
const TEXTURE_GROUPS = [
  { name: "hub billboards", files: readdirSync(join(ROOT, "img")).filter((f) => /^thumb-.*\.jpg$/.test(f)).map((f) => join(ROOT, "img", f)), width: 640, height: 400, out: join(ROOT, "img/opt") },
];
const MODEL_GROUPS = [
  { name: "frontier soldiers", files: ["musketeer", "pikeman"].map((n) => join(ROOT, `games/frontier/models/${n}.glb`)) },
];

const manifest = existsSync(join(ROOT, "assets.json")) ? JSON.parse(readFileSync(join(ROOT, "assets.json"), "utf8")) : {};
const report = [];

// ---------------------------------------------------------------- textures
let sharp = null;
try { sharp = (await import("sharp")).default; } catch { console.warn("sharp not installed: textures skipped"); }
const TOKTX = process.env.TOKTX || "toktx";
let hasToktx = true;
try { execFileSync(TOKTX, ["--version"], { stdio: "pipe" }); } catch { hasToktx = false; console.warn("toktx not found: KTX2 variants skipped"); }

for (const g of TEXTURE_GROUPS) {
  if (!sharp) break;
  mkdirSync(g.out, { recursive: true });
  let plainGz = 0, webpGz = 0, ktxGz = 0;
  const rows = [];
  for (const src of g.files) {
    const name = basename(src).replace(/\.\w+$/, ""), raw = readFileSync(src);
    // resized to display size (multiple of 4 for block compression)
    const resized = sharp(raw).resize(g.width, g.height, { fit: "cover" });
    const webp = await resized.clone().webp({ quality: 80, effort: 6 }).toBuffer();
    const webpPath = join(g.out, name + ".webp"); writeFileSync(webpPath, webp);
    let ktx = null, ktxPath = join(g.out, name + ".ktx2");
    if (hasToktx) {
      const png = join(g.out, name + ".tmp.png"); await resized.clone().png().toFile(png);
      // ETC1S (BasisLZ), mipmaps, sRGB, rows flipped to GL's bottom-left origin (KTX2 textures are not flipped on upload)
      execFileSync(TOKTX, ["--t2", "--encode", "etc1s", "--clevel", "4", "--qlevel", "160", "--genmipmap", "--assign_oetf", "srgb", "--lower_left_maps_to_s0t0", ktxPath, png], { stdio: "pipe" });
      ktx = readFileSync(ktxPath);
      try { unlinkSync(png); } catch {}
    }
    const e = { bytes: raw.length, variants: { webp: { url: rel(webpPath), bytes: webp.length } } };
    if (ktx) e.variants.ktx2 = { url: rel(ktxPath), bytes: ktx.length };
    manifest[rel(src)] = e;
    plainGz += gz(raw); webpGz += gz(webp); if (ktx) ktxGz += gz(ktx);
    rows.push([rel(src), kb(raw.length), kb(webp.length), ktx ? kb(ktx.length) : "-"]);
  }
  // decision for the group: the cheapest download, decoder included
  const options = [["plain", plainGz], ["webp", webpGz]];
  if (ktxGz) options.push(["ktx2", ktxGz + (ARGS.has("--prefer-ktx2") ? 0 : DECODER_GZ.ktx2)]);
  options.sort((a, b) => a[1] - b[1]);
  const use = options[0][0];
  for (const src of g.files) manifest[rel(src)].use = use;
  report.push({ group: g.name, use, wire: Object.fromEntries(options.map(([k, v]) => [k, kb(v)])), files: rows });
}

// ---------------------------------------------------------------- models (DRACO)
let io = null, draco = null, weld, dedup, prune;
try {
  const core = await import("@gltf-transform/core"), ext = await import("@gltf-transform/extensions"), fn = await import("@gltf-transform/functions");
  const draco3d = (await import("draco3dgltf")).default;
  ({ draco, weld, dedup, prune } = fn);
  io = new core.NodeIO().registerExtensions(ext.ALL_EXTENSIONS).registerDependencies({ "draco3d.encoder": await draco3d.createEncoderModule(), "draco3d.decoder": await draco3d.createDecoderModule() });
} catch { console.warn("@gltf-transform / draco3dgltf not installed: models skipped"); }

for (const g of MODEL_GROUPS) {
  if (!io) break;
  let plainGz = 0, dracoGz = 0;
  const rows = [];
  for (const src of g.files) {
    const doc = await io.read(src);
    await doc.transform(dedup(), weld(), draco({ method: "edgebreaker", quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8, quantizeGeneric: 12 }), prune());
    const out = src.replace(/\.glb$/, ".draco.glb"), buf = Buffer.from(await io.writeBinary(doc));
    writeFileSync(out, buf);
    const raw = readFileSync(src);
    manifest[rel(src)] = { bytes: raw.length, variants: { draco: { url: rel(out), bytes: buf.length } } };
    plainGz += gz(raw); dracoGz += gz(buf);
    rows.push([rel(src), kb(raw.length), kb(buf.length)]);
  }
  const use = dracoGz + (ARGS.has("--prefer-draco") ? 0 : DECODER_GZ.draco) < plainGz ? "draco" : "plain";
  for (const src of g.files) manifest[rel(src)].use = use;
  report.push({ group: g.name, use, wire: { plain: kb(plainGz), draco: kb(dracoGz) + ` + decoder ${kb(DECODER_GZ.draco)}` }, files: rows });
}

// critical engine files (their decoded size lets the loader show real byte progress)
for (const f of ["lib/three.module.min.js", "world.js"]) manifest[f] = { bytes: statSync(join(ROOT, f)).size, use: "plain" };
writeFileSync(join(ROOT, "assets.json"), JSON.stringify(manifest, null, 1) + "\n");
console.log(JSON.stringify(report, null, 1));
console.log("assets.json written");
