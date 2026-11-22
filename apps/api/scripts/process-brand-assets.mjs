import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const assetsRoot = path.join(repositoryRoot, "apps/web/public/assets");
const schoolDirectory = path.join(assetsRoot, "etablissement");
const originalPath = path.join(schoolDirectory, "logo-original.png");
const armsPath = path.join(assetsRoot, "officiel/armoiries-togo.png");

await mkdir(schoolDirectory, { recursive: true });

const original = await readFile(originalPath);
const originalHash = createHash("sha256").update(original).digest("hex").toUpperCase();
const armsHash = createHash("sha256").update(await readFile(armsPath)).digest("hex").toUpperCase();
const metadata = await sharp(original).metadata();
if (!metadata.width || !metadata.height) throw new Error("Dimensions du logo illisibles");

for (const width of [64, 128, 256, 512, 1024]) {
  const image = sharp(original).resize({ width, fit: "inside" });
  await image.clone().webp({ quality: 82, effort: 6 }).toFile(path.join(schoolDirectory, `logo-${width}.webp`));
  await image.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(path.join(schoolDirectory, `logo-${width}.png`));
}

const compactSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><text x="120" y="126" text-anchor="middle" font-family="Georgia,serif" font-size="118" font-weight="700"><tspan fill="#011E61">A</tspan><tspan fill="#B20202">G</tspan></text></svg>`;
await writeFile(path.join(schoolDirectory, "logo-compact.svg"), `${compactSvg}\n`);
const compactBuffer = await sharp(Buffer.from(compactSvg)).png().toBuffer();
await sharp(compactBuffer).webp({ quality: 84, effort: 6 }).toFile(path.join(schoolDirectory, "logo-compact.webp"));
await sharp(compactBuffer).png({ compressionLevel: 9 }).toFile(path.join(schoolDirectory, "logo-compact.png"));

await sharp(original).withMetadata({ density: 300 }).png({ compressionLevel: 9 })
  .toFile(path.join(schoolDirectory, "logo-print-300dpi.png"));

async function createAppIcon(size, filename, maskable = false) {
  const safeInset = Math.round(size * (maskable ? 0.16 : 0.12));
  const icon = await sharp(compactBuffer)
    .resize({ width: size - safeInset * 2, height: size - safeInset * 2, fit: "inside" })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: "#FBF6EA" },
  }).composite([{ input: icon, gravity: "centre" }]).png().toFile(path.join(schoolDirectory, filename));
}

await createAppIcon(32, "favicon-32.png");
await createAppIcon(192, "pwa-192.png");
await createAppIcon(512, "pwa-512.png");
await createAppIcon(512, "pwa-maskable-512.png", true);
await sharp({
  create: { width: 1200, height: 630, channels: 4, background: "#FBF6EA" },
}).composite([{
  input: await sharp(original).resize({ width: 460, height: 460, fit: "inside" }).png().toBuffer(),
  gravity: "centre",
}]).png().toFile(path.join(schoolDirectory, "og-image.png"));

const raw = await sharp(original).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { data, info } = raw;
const pixelCount = info.width * info.height;
const visited = new Uint8Array(pixelCount);
const queue = new Int32Array(pixelCount);
let queueStart = 0;
let queueEnd = 0;
const isOuterWhite = (index) => {
  const offset = index * info.channels;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return Math.min(red, green, blue) >= 225 &&
    Math.max(red, green, blue) - Math.min(red, green, blue) <= 42;
};
const enqueue = (index) => {
  if (!visited[index] && isOuterWhite(index)) {
    visited[index] = 1;
    queue[queueEnd++] = index;
  }
};

for (let x = 0; x < info.width; x += 1) {
  enqueue(x);
  enqueue((info.height - 1) * info.width + x);
}
for (let y = 0; y < info.height; y += 1) {
  enqueue(y * info.width);
  enqueue(y * info.width + info.width - 1);
}
while (queueStart < queueEnd) {
  const index = queue[queueStart++];
  const x = index % info.width;
  const y = Math.floor(index / info.width);
  if (x > 0) enqueue(index - 1);
  if (x + 1 < info.width) enqueue(index + 1);
  if (y > 0) enqueue(index - info.width);
  if (y + 1 < info.height) enqueue(index + info.width);
}

for (let index = 0; index < pixelCount; index += 1) {
  if (!visited[index]) continue;
  const offset = index * info.channels;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const alpha = 255 - Math.min(red, green, blue);
  if (alpha === 0) {
    data[offset + 3] = 0;
    continue;
  }
  for (const channel of [0, 1, 2]) {
    data[offset + channel] = Math.max(0, Math.min(255,
      Math.round((data[offset + channel] - (255 - alpha)) * 255 / alpha)));
  }
  data[offset + 3] = alpha;
}

const probeX = Math.floor(info.width * 0.5);
const probeY = Math.floor(info.height * 0.44);
const probeOffset = (probeY * info.width + probeX) * info.channels;
if (Math.min(data[probeOffset], data[probeOffset + 1], data[probeOffset + 2]) > 245 &&
    data[probeOffset + 3] < 240) {
  console.warn("Fond transparent non généré : le point blanc intérieur est relié au fond extérieur.");
} else {
  const transparentPath = path.join(schoolDirectory, "logo-transparent.png");
  await sharp(data, { raw: info }).png().toFile(transparentPath);
  const transparent = await readFile(transparentPath);
  const previewPath = path.join(os.tmpdir(), `school-logo-transparent-${process.pid}.png`);
  const previewBackgrounds = ["#FFFFFF", "#FBF6EA", "#1C1B18"];
  const previews = await Promise.all(previewBackgrounds.map((background) =>
    sharp({ create: { width: metadata.width, height: metadata.height, channels: 4, background } })
      .composite([{ input: transparent }]).png().toBuffer(),
  ));
  await sharp({
    create: { width: metadata.width * 3, height: metadata.height, channels: 4, background: "#FFFFFF" },
  }).composite(previews.map((input, index) => ({ input, left: index * metadata.width, top: 0 })))
    .png().toFile(previewPath);
  console.log(`Aperçu de contrôle du fond transparent : ${previewPath}`);
}

const armsMetadata = await sharp(armsPath).metadata();
const manifest = {
  schoolLogoOriginal: {
    path: "/assets/etablissement/logo-original.png",
    sha256: originalHash,
    width: metadata.width,
    height: metadata.height,
  },
  togoArmsOriginal: {
    path: "/assets/officiel/armoiries-togo.png",
    sha256: armsHash,
    width: armsMetadata.width,
    height: armsMetadata.height,
    sourceFormat: "PNG",
  },
};
await writeFile(path.join(assetsRoot, "asset-integrity.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Dérivés du logo créés. Original : ${metadata.width}x${metadata.height}, SHA-256 ${originalHash}`);
