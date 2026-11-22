import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("les feuilles de styles n'animént que transform et opacity", async () => {
  const stylesDirectory = path.resolve(process.cwd(), "../web/src");
  for (const filename of ["home.css", "styles.css"]) {
    const css = await readFile(path.join(stylesDirectory, filename), "utf8");
    const animationRules = css.match(/(?:animation|transition)\s*:[^;}]+/g) ?? [];
    for (const rule of animationRules) {
      if (/^transition\s*:/.test(rule)) {
        assert.doesNotMatch(rule, /\b(?:width|height|margin|padding|top|left|right|bottom|box-shadow)\b/i);
      }
    }
  }
});
