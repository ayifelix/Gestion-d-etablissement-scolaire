import assert from "node:assert/strict";
import test from "node:test";
import { decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotp } from "../src/auth-rules";

test("vérifie un code TOTP RFC 6238 et rejette les codes mal formés", () => {
  const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(verifyTotp(rfcSecret, "287082", 30_000), true);
  assert.equal(verifyTotp(rfcSecret, "287083", 30_000), false);
  assert.equal(verifyTotp(rfcSecret, "28708", 30_000), false);
});

test("génère des secrets TOTP aléatoires encodés en base32", () => {
  const first = generateTotpSecret();
  const second = generateTotpSecret();
  assert.match(first, /^[A-Z2-7]+$/);
  assert.notEqual(first, second);
  assert.equal(verifyTotp(first, "000000", 0), false);
  assert.equal(verifyTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "755224", 0), true);
});

test("chiffre les secrets TOTP au repos et rejette une clé incorrecte", () => {
  const secret = generateTotpSecret();
  const key = Buffer.alloc(32, 7);
  const encrypted = encryptTotpSecret(secret, key);
  assert.notEqual(encrypted, secret);
  assert.equal(decryptTotpSecret(encrypted, key), secret);
  assert.throws(() => decryptTotpSecret(encrypted, Buffer.alloc(32, 9)));
});
