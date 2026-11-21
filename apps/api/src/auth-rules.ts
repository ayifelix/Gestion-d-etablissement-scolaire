import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(secret: string) {
  const clean = secret.toUpperCase().replace(/=+$/g, "");
  const result: number[] = [];
  let accumulator = 0;
  let bitCount = 0;
  for (const character of clean) {
    const value = BASE32.indexOf(character);
    if (value < 0) return Buffer.alloc(0);
    accumulator = (accumulator << 5) | value;
    bitCount += 5;
    if (bitCount >= 8) {
      result.push((accumulator >>> (bitCount - 8)) & 0xff);
      bitCount -= 8;
      accumulator &= (1 << bitCount) - 1;
    }
  }
  return Buffer.from(result);
}

export function generateTotpSecret() {
  const bytes = randomBytes(20);
  let accumulator = 0;
  let bitCount = 0;
  let encoded = "";
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      encoded += BASE32[(accumulator >>> (bitCount - 5)) & 31];
      bitCount -= 5;
      accumulator &= (1 << bitCount) - 1;
    }
  }
  if (bitCount > 0) encoded += BASE32[(accumulator << (5 - bitCount)) & 31];
  return encoded;
}

export function encryptTotpSecret(secret: string, key: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptTotpSecret(value: string, key: Buffer) {
  const [version, encodedIv, encodedTag, encodedSecret, ...extra] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedTag || !encodedSecret || extra.length) {
    throw new Error("Secret TOTP chiffré invalide");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedSecret, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function totpCode(secret: string, counter: number) {
  if (!Number.isSafeInteger(counter) || counter < 0) return null;
  const key = decodeBase32(secret);
  if (!key.length) return null;
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  ) % 1_000_000;
  return String(value).padStart(6, "0");
}

export function verifyTotp(secret: string, token: string, timeMs = Date.now()) {
  if (!/^\d{6}$/.test(token)) return false;
  const counter = Math.floor(timeMs / 30_000);
  const supplied = Buffer.from(token);
  for (const offset of [-1, 0, 1]) {
    const expectedCode = totpCode(secret, counter + offset);
    if (!expectedCode) continue;
    const expected = Buffer.from(expectedCode);
    if (timingSafeEqual(supplied, expected)) return true;
  }
  return false;
}
