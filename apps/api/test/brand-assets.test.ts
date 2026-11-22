import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import test from "node:test";

const publicDirectory = path.resolve(process.cwd(), "../web/public");
const schoolDirectory = path.join(publicDirectory, "assets/etablissement");
const armsPath = path.join(publicDirectory, "assets/officiel/armoiries-togo.png");

test("les originaux de marque restent intacts et les dérivés respectent leurs tailles", async () => {
  const schoolLogo = await readFile(path.join(schoolDirectory, "logo-original.png"));
  const arms = await readFile(armsPath);
  assert.equal(
    createHash("sha256").update(schoolLogo).digest("hex").toUpperCase(),
    "CDFC734188DFFE8BF28C8109FEB54D9DCAA0A3C70FBC81F372B96CE1E259EE04",
  );
  assert.equal(
    createHash("sha256").update(arms).digest("hex").toUpperCase(),
    "4B23E13971557F6EE11F61125C40438A40604086CA7C8CFB10204ECF96D12DB4",
  );

  const sourceMetadata = await sharp(schoolLogo).metadata();
  assert.equal(sourceMetadata.width, 840);
  assert.equal(sourceMetadata.height, 768);
  for (const width of [64, 128, 256, 512, 1024]) {
    for (const extension of ["webp", "png"]) {
      const imagePath = path.join(schoolDirectory, `logo-${width}.${extension}`);
      const metadata = await sharp(imagePath).metadata();
      assert.equal(metadata.width, width);
      assert.ok(metadata.height && Math.abs(metadata.width / metadata.height - 840 / 768) < 0.01);
    }
  }
  assert.ok((await readFile(path.join(schoolDirectory, "logo-128.webp"))).byteLength < 15 * 1024);
  for (const [filename, size] of [["favicon-32.png", 32], ["pwa-192.png", 192], ["pwa-512.png", 512], ["pwa-maskable-512.png", 512]] as const) {
    const metadata = await sharp(path.join(schoolDirectory, filename)).metadata();
    assert.deepEqual([metadata.width, metadata.height], [size, size]);
  }

  const transparentPath = path.join(schoolDirectory, "logo-transparent.png");
  const transparent = await sharp(transparentPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const innerWhitePixel = (Math.floor(transparent.info.height * 0.44) * transparent.info.width +
    Math.floor(transparent.info.width * 0.5)) * transparent.info.channels;
  assert.ok(transparent.data[innerWhitePixel + 3] > 240, "le disque intérieur blanc doit rester opaque");
  assert.equal((await sharp(arms).metadata()).width, 768);
  assert.equal((await sharp(arms).metadata()).height, 1106);

  const sourceDirectory = path.resolve(publicDirectory, "../src");
  const sourceFiles = await readdir(sourceDirectory);
  for (const filename of sourceFiles.filter((entry) => /\.(tsx?|jsx?)$/.test(entry) && entry !== "branding.tsx")) {
    const content = await readFile(path.join(sourceDirectory, filename), "utf8");
    assert.equal(content.includes("/assets/officiel/armoiries-togo.png"), false, `${filename} ne doit pas charger directement les armoiries`);
  }
});
