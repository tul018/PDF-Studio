import {
  PDFArray,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFInvalidObject,
  PDFName,
  PDFNumber,
  PDFObjectParser,
  PDFObjectStreamParser,
  PDFRawStream,
  PDFRef,
  PDFString,
  decodePDFRawStream,
  PDFWriter,
  type PDFObject,
} from "pdf-lib";
import { hash2B } from "./encrypt";

/**
 * Removes standard-security encryption so pdf-lib can edit the file.
 * Many forms (bank and government ones especially) are encrypted with an
 * empty open password just to set permissions; pdf-lib can't read their
 * object streams, so without this the only way to save them was as page
 * images - which loses the fillable form. Supports RC4 40/128 (R2-R4),
 * AES-128 (AESV2) and AES-256 (R5/R6). The open password (or the owner
 * password) is needed; most such files have an empty one.
 */
export class UnsupportedEncryptionError extends Error {
  name = "UnsupportedEncryptionError";
}

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

const PAD = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08, 0x2e, 0x2e, 0x00,
  0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

// ---------------------------------------------------------------- MD5 / RC4 (not in WebCrypto)

const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(data: Uint8Array): Uint8Array {
  const len = data.length;
  const n = ((len + 8) >> 6) + 1;
  const buf = new Uint8Array(n * 64);
  buf.set(data);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(n * 64 - 8, (len * 8) >>> 0, true);
  dv.setUint32(n * 64 - 4, Math.floor(len / 0x20000000), true);
  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;
  const m = new Uint32Array(16);
  for (let blk = 0; blk < n; blk++) {
    for (let i = 0; i < 16; i++) m[i] = dv.getUint32(blk * 64 + i * 4, true);
    let a = a0,
      b = b0,
      c = c0,
      d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) (f = (b & c) | (~b & d)), (g = i);
      else if (i < 32) (f = (d & b) | (~d & c)), (g = (5 * i + 1) % 16);
      else if (i < 48) (f = b ^ c ^ d), (g = (3 * i + 5) % 16);
      else (f = c ^ (b | ~d)), (g = (7 * i) % 16);
      const t = d;
      d = c;
      c = b;
      const x = (a + f + K[i] + m[g]) | 0;
      const s = S[(i >> 4) * 4 + (i % 4)];
      b = (b + ((x << s) | (x >>> (32 - s)))) | 0;
      a = t;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((w, i) => ov.setUint32(i * 4, w >>> 0, true));
  return out;
}

export function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = new Uint8Array(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

// ---------------------------------------------------------------- AES-CBC

async function aesDecrypt(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  // Strings/streams: 16-byte IV, then PKCS#7-padded ciphertext.
  if (data.length < 32 || data.length % 16) return new Uint8Array(0);
  const iv = data.subarray(0, 16);
  const body = data.subarray(16);
  const k = await subtle.importKey("raw", key as BufferSource, "AES-CBC", false, ["decrypt", "encrypt"]);
  try {
    return new Uint8Array(await subtle.decrypt({ name: "AES-CBC", iv: iv as BufferSource }, k, body as BufferSource));
  } catch {
    // Bad padding (some writers omit it): decrypt without removing any.
    return aesDecryptNoPad(k, iv, body);
  }
}

/** WebCrypto always checks padding: append a block that decrypts to a full pad block, then drop it. */
async function aesDecryptNoPad(k: CryptoKey, iv: Uint8Array, body: Uint8Array): Promise<Uint8Array> {
  const last = body.subarray(body.length - 16);
  const extra = new Uint8Array(
    await subtle.encrypt({ name: "AES-CBC", iv: last as BufferSource }, k, new Uint8Array(16).fill(16) as BufferSource),
  ).subarray(0, 16);
  const out = new Uint8Array(
    await subtle.decrypt({ name: "AES-CBC", iv: iv as BufferSource }, k, cat(body, extra) as BufferSource),
  );
  return out.subarray(0, body.length);
}

async function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  return subtle.importKey("raw", raw as BufferSource, "AES-CBC", false, ["decrypt", "encrypt"]);
}

// ---------------------------------------------------------------- keys

type Method = "rc4" | "aes" | "none";

interface Security {
  fileKey: Uint8Array;
  r: number;
  strM: Method;
  stmM: Method;
  encryptMetadata: boolean;
}

function bytesOf(o: PDFObject | undefined): Uint8Array {
  if (o instanceof PDFHexString) return o.asBytes();
  if (o instanceof PDFString) return o.asBytes();
  return new Uint8Array(0);
}

const num = (d: PDFDict, k: string, def: number) => {
  const v = d.lookup(PDFName.of(k));
  return v instanceof PDFNumber ? v.asNumber() : def;
};

function methodOf(dict: PDFDict, filterKey: "StmF" | "StrF", v: number): Method {
  if (v < 4) return "rc4";
  const name = dict.lookup(PDFName.of(filterKey));
  if (!(name instanceof PDFName) || name.asString() === "/Identity") return "none";
  const cf = dict.lookup(PDFName.of("CF"));
  const f = cf instanceof PDFDict ? cf.lookup(name) : undefined;
  const cfm = f instanceof PDFDict ? f.lookup(PDFName.of("CFM")) : undefined;
  const m = cfm instanceof PDFName ? cfm.asString() : "/None";
  if (m === "/V2") return "rc4";
  if (m === "/AESV2" || m === "/AESV3") return "aes";
  if (m === "/None") return "none";
  throw new UnsupportedEncryptionError(`Unsupported crypt filter ${m}`);
}

/** Algorithm 2: the RC4/AES-128 file key from a (user) password. */
function legacyKey(password: Uint8Array, o: Uint8Array, p: number, id0: Uint8Array, r: number, len: number, meta: boolean) {
  const pw = cat(password.subarray(0, 32), PAD).subarray(0, 32);
  const pBytes = new Uint8Array(4);
  new DataView(pBytes.buffer).setInt32(0, p, true);
  let h = md5(cat(pw, o.subarray(0, 32), pBytes, id0, r >= 4 && !meta ? new Uint8Array([255, 255, 255, 255]) : new Uint8Array(0)));
  const n = r === 2 ? 5 : len;
  if (r >= 3) for (let i = 0; i < 50; i++) h = md5(h.subarray(0, n));
  return h.subarray(0, n);
}

/** Algorithms 4/5: does this key produce the stored U? */
function checksUser(key: Uint8Array, u: Uint8Array, id0: Uint8Array, r: number): boolean {
  if (r === 2) return same(rc4(key, PAD), u.subarray(0, 32));
  let x = rc4(key, md5(cat(PAD, id0)));
  for (let i = 1; i <= 19; i++) x = rc4(key.map((b) => b ^ i), x);
  return same(x, u.subarray(0, 16));
}

/** Algorithm 7: recover the user password from the owner password. */
function userFromOwner(owner: Uint8Array, o: Uint8Array, r: number, len: number): Uint8Array {
  let h = md5(cat(owner.subarray(0, 32), PAD).subarray(0, 32));
  if (r >= 3) for (let i = 0; i < 50; i++) h = md5(h);
  const key = h.subarray(0, r === 2 ? 5 : len);
  let x = o.subarray(0, 32);
  if (r === 2) return rc4(key, x);
  for (let i = 19; i >= 0; i--) x = rc4(key.map((b) => b ^ i), x);
  return x;
}

async function aes256Unwrap(key: Uint8Array, wrapped: Uint8Array): Promise<Uint8Array> {
  return aesDecryptNoPad(await aesKey(key), new Uint8Array(16), wrapped.subarray(0, 32));
}

async function security(dict: PDFDict, id0: Uint8Array, password: string): Promise<Security> {
  const filter = dict.lookup(PDFName.of("Filter"));
  if (!(filter instanceof PDFName) || filter.asString() !== "/Standard") throw new UnsupportedEncryptionError("Not standard security");
  const v = num(dict, "V", 0);
  const r = num(dict, "R", 2);
  const o = bytesOf(dict.lookup(PDFName.of("O")));
  const u = bytesOf(dict.lookup(PDFName.of("U")));
  const p = num(dict, "P", -1) | 0;
  const meta = dict.lookup(PDFName.of("EncryptMetadata"))?.toString() !== "false";
  const base = { r, strM: methodOf(dict, "StrF", v), stmM: methodOf(dict, "StmF", v), encryptMetadata: meta };

  if (r >= 5) {
    const pw = enc.encode(password.normalize("NFKC")).slice(0, 127);
    const h = (salt: Uint8Array, extra: Uint8Array) =>
      r === 5 ? subtle.digest("SHA-256", cat(pw, salt, extra) as BufferSource).then((b) => new Uint8Array(b)) : hash2B(pw, salt, extra);
    const uu = u.subarray(0, 48);
    if (same((await h(u.subarray(32, 40), new Uint8Array(0))).subarray(0, 32), u.subarray(0, 32))) {
      const fileKey = await aes256Unwrap(await h(u.subarray(40, 48), new Uint8Array(0)), bytesOf(dict.lookup(PDFName.of("UE"))));
      return { ...base, fileKey };
    }
    if (same((await h(o.subarray(32, 40), uu)).subarray(0, 32), o.subarray(0, 32))) {
      const fileKey = await aes256Unwrap(await h(o.subarray(40, 48), uu), bytesOf(dict.lookup(PDFName.of("OE"))));
      return { ...base, fileKey };
    }
    throw new UnsupportedEncryptionError("Wrong password");
  }
  if (r < 2 || r > 4) throw new UnsupportedEncryptionError(`Unsupported revision ${r}`);
  const len = v === 1 ? 5 : Math.max(5, Math.min(16, num(dict, "Length", 40) / 8));
  const pw = latin1(password);
  let key = legacyKey(pw, o, p, id0, r, len, meta);
  if (!checksUser(key, u, id0, r)) {
    key = legacyKey(userFromOwner(pw, o, r, len), o, p, id0, r, len, meta);
    if (!checksUser(key, u, id0, r)) throw new UnsupportedEncryptionError("Wrong password");
  }
  return { ...base, fileKey: key };
}

function latin1(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
}

// ---------------------------------------------------------------- objects

function objectKey(sec: Security, ref: PDFRef, aes: boolean): Uint8Array {
  if (sec.r >= 5) return sec.fileKey;
  const n = ref.objectNumber,
    g = ref.generationNumber;
  const extra = new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, g & 255, (g >> 8) & 255]);
  const h = md5(cat(sec.fileKey, extra, aes ? enc.encode("sAlT") : new Uint8Array(0)));
  return h.subarray(0, Math.min(sec.fileKey.length + 5, 16));
}

async function decryptBytes(sec: Security, m: Method, ref: PDFRef, data: Uint8Array): Promise<Uint8Array> {
  if (m === "none") return data;
  const key = objectKey(sec, ref, m === "aes");
  return m === "aes" ? aesDecrypt(key, data) : rc4(key, data);
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

async function decryptStrings(sec: Security, ref: PDFRef, obj: PDFObject): Promise<PDFObject> {
  if (obj instanceof PDFString || obj instanceof PDFHexString) {
    return PDFHexString.of(toHex(await decryptBytes(sec, sec.strM, ref, obj.asBytes())));
  }
  if (obj instanceof PDFArray) {
    for (let i = 0; i < obj.size(); i++) obj.set(i, await decryptStrings(sec, ref, obj.get(i)));
  } else if (obj instanceof PDFDict) {
    for (const [k, v] of obj.entries()) obj.set(k, await decryptStrings(sec, ref, v));
  }
  return obj;
}

/**
 * The current cross-reference entry of each object (newest revision first,
 * following /Prev and /XRefStm): `stream` is set for objects stored in an
 * object stream. Empty when the chain can't be read.
 */
export function readXref(bytes: Uint8Array): Map<number, { stream?: number }> {
  const map = new Map<number, { stream?: number }>();
  const text = (from: number, len: number) => String.fromCharCode(...bytes.subarray(from, Math.min(bytes.length, from + len)));
  const tail = text(Math.max(0, bytes.length - 1024), 1024);
  const m = /startxref\s+(\d+)\s*%%EOF\s*$/.exec(tail) ?? /startxref\s+(\d+)(?![\s\S]*startxref)/.exec(tail);
  if (!m) return map;
  const tmp = PDFContext.create();
  const seen = new Set<number>();
  const queue = [Number(m[1])];
  try {
    while (queue.length) {
      const offset = queue.shift()!;
      if (seen.has(offset) || offset <= 0 || offset >= bytes.length) continue;
      seen.add(offset);
      let trailer: PDFDict | undefined;
      const head = text(offset, 32);
      if (/^\s*xref/.test(head)) {
        // Classic table: "first count" subsections of 20-byte "offset gen n|f" lines.
        let pos = offset + head.indexOf("xref") + 4;
        for (;;) {
          const line = /^\s*(\d+)\s+(\d+)[ \t]*\r?\n?/.exec(text(pos, 40));
          if (!line) break;
          pos += line[0].length;
          const first = Number(line[1]);
          const count = Number(line[2]);
          for (let i = 0; i < count; i++) if (!map.has(first + i)) map.set(first + i, {});
          pos += count * 20;
        }
        const t = text(pos, 64).indexOf("trailer");
        if (t < 0) break;
        const obj = PDFObjectParser.forBytes(bytes.subarray(pos + t + 7), tmp).parseObject();
        if (obj instanceof PDFDict) trailer = obj;
      } else {
        const hdr = /^\s*\d+\s+\d+\s+obj/.exec(head);
        if (!hdr) break;
        const stream = PDFObjectParser.forBytes(bytes.subarray(offset + hdr[0].length), tmp).parseObject();
        if (!(stream instanceof PDFRawStream) || !isType(stream.dict, "XRef")) break;
        for (const [n, e] of xrefStreamEntries(stream)) if (!map.has(n)) map.set(n, e);
        trailer = stream.dict;
      }
      const stm = trailer?.lookup(PDFName.of("XRefStm"));
      if (stm instanceof PDFNumber) queue.unshift(stm.asNumber());
      const prev = trailer?.lookup(PDFName.of("Prev"));
      if (prev instanceof PDFNumber) queue.push(prev.asNumber());
    }
  } catch {
    return new Map();
  }
  return map;
}

/** Entries of a cross-reference stream (pdf-lib's own reader ignores PNG predictors, which most writers use). */
function xrefStreamEntries(stream: PDFRawStream): [number, { stream?: number }][] {
  const d = stream.dict;
  const ints = (k: string) => {
    const a = d.lookup(PDFName.of(k));
    return a instanceof PDFArray ? a.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0)) : undefined;
  };
  const w = ints("W") ?? [1, 2, 1];
  const index = ints("Index") ?? [0, num(d, "Size", 0)];
  let data = decodePDFRawStream(stream).decode();
  const parms = d.lookup(PDFName.of("DecodeParms"));
  const predictor = parms instanceof PDFDict ? num(parms, "Predictor", 1) : 1;
  const rowLen = w[0] + w[1] + w[2];
  if (predictor >= 10) {
    // PNG predictors: each row starts with its filter type byte (bpc 8, one colour).
    const cols = parms instanceof PDFDict ? num(parms, "Columns", rowLen) : rowLen;
    const rows = Math.floor(data.length / (cols + 1));
    const out = new Uint8Array(rows * cols);
    for (let r = 0; r < rows; r++) {
      const type = data[r * (cols + 1)];
      for (let c = 0; c < cols; c++) {
        const x = data[r * (cols + 1) + 1 + c];
        const left = c > 0 ? out[r * cols + c - 1] : 0;
        const up = r > 0 ? out[(r - 1) * cols + c] : 0;
        const ul = r > 0 && c > 0 ? out[(r - 1) * cols + c - 1] : 0;
        let pred = 0;
        if (type === 1) pred = left;
        else if (type === 2) pred = up;
        else if (type === 3) pred = (left + up) >> 1;
        else if (type === 4) {
          const p = left + up - ul;
          const pa = Math.abs(p - left),
            pb = Math.abs(p - up),
            pc = Math.abs(p - ul);
          pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
        }
        out[r * cols + c] = (x + pred) & 255;
      }
    }
    data = out;
  }
  const field = (pos: number, width: number) => {
    let v = 0;
    for (let i = 0; i < width; i++) v = v * 256 + data[pos + i];
    return v;
  };
  const entries: [number, { stream?: number }][] = [];
  let pos = 0;
  for (let s = 0; s + 1 < index.length; s += 2) {
    for (let i = 0; i < index[s + 1] && pos + rowLen <= data.length; i++, pos += rowLen) {
      const type = w[0] ? field(pos, w[0]) : 1;
      entries.push([index[s] + i, type === 2 ? { stream: field(pos + w[0], w[1]) } : {}]);
    }
  }
  return entries;
}

const isType = (d: PDFDict, t: string) => d.lookup(PDFName.of("Type")) === PDFName.of(t);

/** The same file without encryption; unencrypted input comes back unchanged. */
export async function decryptPdf(bytes: Uint8Array, password = ""): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const ctx = doc.context;
  const encRef = ctx.trailerInfo.Encrypt;
  const encDict = encRef && ctx.lookup(encRef);
  if (!(encDict instanceof PDFDict)) return bytes;
  const ids = ctx.trailerInfo.ID ? ctx.lookup(ctx.trailerInfo.ID) : undefined;
  const id0 = ids instanceof PDFArray ? bytesOf(ids.lookup(0)) : new Uint8Array(0);
  const sec = await security(encDict, id0, password);

  const objStms: [number, PDFRawStream][] = [];
  for (const [ref, raw] of ctx.enumerateIndirectObjects()) {
    if (ref === encRef || raw === encDict) continue;
    let obj: PDFObject = raw;
    // Encrypted object streams fail to parse on load: pdf-lib keeps their bytes.
    if (obj instanceof PDFInvalidObject) {
      try {
        obj = PDFObjectParser.forBytes((obj as unknown as { data: Uint8Array }).data, ctx).parseObject();
      } catch {
        continue;
      }
    }
    if (obj instanceof PDFRawStream) {
      if (isType(obj.dict, "XRef")) continue;
      const contents =
        isType(obj.dict, "Metadata") && !sec.encryptMetadata
          ? obj.contents
          : await decryptBytes(sec, sec.stmM, ref, obj.contents);
      await decryptStrings(sec, ref, obj.dict);
      const plain = PDFRawStream.of(obj.dict, contents);
      ctx.assign(ref, plain);
      if (isType(obj.dict, "ObjStm")) objStms.push([ref.objectNumber, plain]);
    } else {
      ctx.assign(ref, await decryptStrings(sec, ref, obj));
    }
  }
  // Objects inside object streams (their strings aren't encrypted separately).
  // After incremental updates an object can have several copies: the
  // cross-reference chain says which one is current.
  const xref = readXref(bytes);
  for (const [stmNum, stm] of objStms) {
    const tmp = PDFContext.create();
    try {
      await PDFObjectStreamParser.forStream(PDFRawStream.of(stm.dict.clone(tmp), stm.contents)).parseIntoContext();
    } catch {
      continue;
    }
    for (const [ref, obj] of tmp.enumerateIndirectObjects()) {
      const where = xref.get(ref.objectNumber);
      const cur = ctx.lookup(ref);
      if (where ? where.stream === stmNum : cur === undefined || cur instanceof PDFInvalidObject) ctx.assign(ref, obj);
    }
  }
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && isType(obj.dict, "ObjStm")) ctx.delete(ref);
  }
  delete ctx.trailerInfo.Encrypt;
  if (encRef instanceof PDFRef) ctx.delete(encRef);
  return PDFWriter.forContext(ctx, 50).serializeToBuffer();
}
