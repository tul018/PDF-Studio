import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFObject,
} from "pdf-lib";

/**
 * Password protection: standard PDF AES-256 encryption (PDF 2.0 / ISO
 * 32000-2, "R6", AESV3), which Adobe Reader, Edge, Chrome, macOS/iOS and
 * Android open. pdf-lib can't encrypt, so this does it on the finished
 * document: every string and stream is AES-256-CBC encrypted with a random
 * file key, and the key is wrapped for the open password (and an owner
 * password) as the standard describes. Uses only WebCrypto (works in the
 * app, in workers and in Node 20+).
 */
export interface Protection {
  /** Needed to open the file. */
  userPassword: string;
  /** Needed to change permissions; defaults to a random one. */
  ownerPassword?: string;
  /** Allowed without the owner password (default: everything). */
  allowPrint?: boolean;
  allowCopy?: boolean;
  allowEdit?: boolean;
}

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

/** Passwords are SASLprep'd UTF-8, at most 127 bytes (PDF 2.0, 7.6.4.3.3). */
function pw(p: string): Uint8Array {
  return enc.encode(p.normalize("NFKC")).slice(0, 127);
}

const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

async function digest(alg: "SHA-256" | "SHA-384" | "SHA-512", data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest(alg, data as BufferSource));
}

/** AES-CBC without padding (input is a multiple of 16): WebCrypto pads, so drop the extra block. */
async function aesCbcNoPad(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await subtle.importKey("raw", key as BufferSource, "AES-CBC", false, ["encrypt"]);
  const out = new Uint8Array(await subtle.encrypt({ name: "AES-CBC", iv: iv as BufferSource }, k, data as BufferSource));
  return out.subarray(0, data.length);
}

/** Algorithm 2.B: the hash used for R6 keys and checks. */
export async function hash2B(password: Uint8Array, salt: Uint8Array, udata: Uint8Array): Promise<Uint8Array> {
  let k = await digest("SHA-256", cat(password, salt, udata));
  for (let round = 0; ; round++) {
    const k1 = cat(password, k, udata);
    const block = new Uint8Array(k1.length * 64);
    for (let i = 0; i < 64; i++) block.set(k1, i * k1.length);
    const e = await aesCbcNoPad(k.subarray(0, 16), k.subarray(16, 32), block);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i];
    const alg = (["SHA-256", "SHA-384", "SHA-512"] as const)[sum % 3];
    k = await digest(alg, e);
    // Rounds count from 1 in the standard: stop after round 64 or later once
    // E's last byte <= round - 32. (Was one off: ~4% of files wouldn't open.)
    if (round >= 63 && e[e.length - 1] <= round + 1 - 32) break;
  }
  return k.subarray(0, 32);
}

const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** The encryption dictionary values for a file key and passwords (Algorithms 8, 9, 10). */
async function encryptionValues(fileKey: Uint8Array, user: Uint8Array, owner: Uint8Array, perms: number) {
  const uVal = random(8),
    uKey = random(8);
  const U = cat(await hash2B(user, uVal, new Uint8Array(0)), uVal, uKey);
  const UE = await aesCbcNoPad(await hash2B(user, uKey, new Uint8Array(0)), new Uint8Array(16), fileKey);
  const oVal = random(8),
    oKey = random(8);
  const O = cat(await hash2B(owner, oVal, U), oVal, oKey);
  const OE = await aesCbcNoPad(await hash2B(owner, oKey, U), new Uint8Array(16), fileKey);
  // Perms: P (little-endian, high bits set), "T" = metadata encrypted, "adb", random.
  const p = new Uint8Array(16);
  new DataView(p.buffer).setInt32(0, perms, true);
  p.set([0xff, 0xff, 0xff, 0xff], 4);
  p.set(enc.encode("Tadb"), 8);
  p.set(random(4), 12);
  const Perms = await aesEcbBlock(fileKey, p);
  return { U, UE, O, OE, Perms };
}

/** AES-256 of one block with no chaining (ECB) = CBC with a zero IV over one block. */
async function aesEcbBlock(key: Uint8Array, block: Uint8Array): Promise<Uint8Array> {
  return aesCbcNoPad(key, new Uint8Array(16), block);
}

/** AES-256-CBC with a random IV prepended and PKCS#7 padding: how R6 encrypts each string and stream. */
async function encryptData(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = random(16);
  return cat(iv, new Uint8Array(await subtle.encrypt({ name: "AES-CBC", iv: iv as BufferSource }, key, data as BufferSource)));
}

/** Permission bits (Table 22): bit 3 print, 4 modify, 5 copy, 6 annotate, 9 fill forms, 10 extract, 11 assemble, 12 print high. */
function permissions(o: Protection): number {
  let p = 0xfffff0c0 | 0; // reserved bits that must be 1
  if (o.allowPrint !== false) p |= (1 << 2) | (1 << 11);
  if (o.allowEdit !== false) p |= (1 << 3) | (1 << 5) | (1 << 8) | (1 << 10);
  if (o.allowCopy !== false) p |= (1 << 4) | (1 << 9);
  return p | 0;
}

/**
 * Save `doc` protected with a password. Object streams are not used (each
 * object is encrypted on its own, which every reader supports).
 */
export async function saveEncrypted(doc: PDFDocument, o: Protection): Promise<Uint8Array> {
  if (!o.userPassword) throw new Error("A password is needed.");
  const fileKey = random(32);
  const key = await subtle.importKey("raw", fileKey as BufferSource, "AES-CBC", false, ["encrypt"]);
  const ctx = doc.context;
  // pdf-lib writes fonts, images and page content on save: flush first so they get encrypted too.
  await doc.flush();

  const encryptDeep = async (obj: PDFObject): Promise<PDFObject> => {
    if (obj instanceof PDFString || obj instanceof PDFHexString) {
      const bytes = obj instanceof PDFHexString ? obj.asBytes() : stringBytes(obj);
      return PDFHexString.of(toHex(await encryptData(key, bytes)));
    }
    if (obj instanceof PDFArray) {
      for (let i = 0; i < obj.size(); i++) obj.set(i, await encryptDeep(obj.get(i)));
      return obj;
    }
    if (obj instanceof PDFDict) {
      for (const [k, v] of obj.entries()) obj.set(k, await encryptDeep(v));
      return obj;
    }
    return obj;
  };

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFStream) {
      const dict = obj.dict;
      // The cross-reference stream is never encrypted; pdf-lib doesn't write one without object streams.
      if (dict.get(PDFName.of("Type")) === PDFName.of("XRef")) continue;
      await encryptDeep(dict);
      const contents = obj.getContents();
      const encrypted = await encryptData(key, contents);
      const copy = PDFRawStream.of(dict, encrypted);
      // Length is rewritten by pdf-lib from the new contents.
      ctx.assign(ref, copy);
    } else {
      ctx.assign(ref, await encryptDeep(obj));
    }
  }

  const v = await encryptionValues(fileKey, pw(o.userPassword), pw(o.ownerPassword ?? toHex(random(16))), permissions(o));
  const hex = (b: Uint8Array) => PDFHexString.of(toHex(b));
  const encryptDict = ctx.obj({
    Filter: "Standard",
    V: 5,
    R: 6,
    Length: 256,
    P: PDFNumber.of(permissions(o)),
    CF: { StdCF: { CFM: "AESV3", AuthEvent: "DocOpen", Length: 32 } },
    StmF: "StdCF",
    StrF: "StdCF",
    EncryptMetadata: true,
  }) as PDFDict;
  encryptDict.set(PDFName.of("U"), hex(v.U));
  encryptDict.set(PDFName.of("UE"), hex(v.UE));
  encryptDict.set(PDFName.of("O"), hex(v.O));
  encryptDict.set(PDFName.of("OE"), hex(v.OE));
  encryptDict.set(PDFName.of("Perms"), hex(v.Perms));
  ctx.trailerInfo.Encrypt = ctx.register(encryptDict);
  // A file ID is required for encrypted files (not encrypted itself).
  const id = hex(random(16));
  ctx.trailerInfo.ID = ctx.obj([id, id]);
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
}

function stringBytes(s: PDFString): Uint8Array {
  // PDFString holds the literal's characters; each is one byte (PDFDocEncoding or UTF-16 BOM bytes).
  const t = s.asString();
  const out = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i) & 0xff;
  return out;
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

void PDFRef;
