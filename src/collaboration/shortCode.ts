/**
 * Short invitation / reply codes (about 100 characters) for connecting two
 * apps directly. A WebRTC connection description is ~1-2 KB of text, but
 * only a few parts of it are unique to this connection:
 *   - the ICE username and password (letters and digits)
 *   - the DTLS certificate fingerprint (32 bytes, it proves who you connect to)
 *   - one or two network addresses to try
 * We pack just those, and rebuild a standard description from them on the
 * other side. The session's encryption key is not in the code: the host
 * sends it over the connection once it is up (DTLS encrypted, and the
 * fingerprint in the code guarantees it's the right app).
 */

export const SHORT_PREFIX = "PS-";
const VERSION = 3;

const ICE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const SETUPS = ["actpass", "active", "passive"] as const;

/** Candidate kinds, in the order we prefer them. */
const enum Kind {
  Srflx4 = 0, // public IPv4 (what the internet sees)
  Host4 = 1, // local IPv4
  Mdns = 2, // local address hidden behind a random name (<uuid>.local)
  Srflx6 = 3,
  Host6 = 4,
}

interface Cand {
  kind: Kind;
  addr: string;
  port: number;
}

export interface Described {
  type: "offer" | "answer";
  sdp: string;
}

// ------------------------------------------------------------------ pack

export function packDescription(d: RTCSessionDescriptionInit): string {
  const sdp = d.sdp ?? "";
  const ufrag = /^a=ice-ufrag:(\S+)/m.exec(sdp)?.[1];
  const pwd = /^a=ice-pwd:(\S+)/m.exec(sdp)?.[1];
  const fp = /^a=fingerprint:sha-256 ([0-9A-F:]+)/im.exec(sdp)?.[1];
  const setup = /^a=setup:(\S+)/m.exec(sdp)?.[1] as (typeof SETUPS)[number] | undefined;
  if (!ufrag || !pwd || !fp || !setup || !SETUPS.includes(setup) || ufrag.length < 4 || ufrag.length > 19 || pwd.length < 22 || pwd.length > 37 || ![...ufrag + pwd].every((c) => ICE.includes(c)))
    throw new Error("This device made a connection description PDF Studio can't shorten.");
  const cands = pickCandidates(sdp);
  if (!cands.length) throw new Error("No network connection found. Check that this device is online.");

  // Lengths in one byte: ICE allows ufrag 4+ and password 22+ characters (Chrome: 4 and 24).
  const out: number[] = [(VERSION << 4) | SETUPS.indexOf(setup), ((ufrag.length - 4) << 4) | (pwd.length - 22), ...pack6(ufrag + pwd)];
  out.push(...fp.split(":").map((h) => parseInt(h, 16)));
  for (const c of cands) {
    out.push(c.kind);
    out.push(...(c.kind === Kind.Mdns ? uuidBytes(c.addr) : c.kind === Kind.Srflx4 || c.kind === Kind.Host4 ? ip4Bytes(c.addr) : ip6Bytes(c.addr)));
    out.push(c.port >> 8, c.port & 255);
  }
  return SHORT_PREFIX + toB64url(out);
}

export function unpackDescription(code: string): Described {
  const s = code.trim().replace(/\s+/g, "");
  if (!s.startsWith(SHORT_PREFIX)) {
    if (s.startsWith("PDFS2.") || s.startsWith("PDFS3-")) throw new Error("This code was made by an older PDF Studio. Ask for a new one.");
    throw new Error("This isn't a PDF Studio code.");
  }
  try {
    const b = fromB64url(s.slice(SHORT_PREFIX.length));
    let i = 0;
    const head = b[i++];
    if (head >> 4 !== VERSION) throw new Error("version");
    const setup = SETUPS[head & 3];
    const ul = (b[i] >> 4) + 4,
      pl = (b[i++] & 15) + 22;
    const nBytes = Math.ceil(((ul + pl) * 6) / 8);
    const chars = unpack6(b.slice(i, i + nBytes), ul + pl);
    i += nBytes;
    const fp = Array.from(b.slice(i, i + 32), (x) => x.toString(16).toUpperCase().padStart(2, "0")).join(":");
    i += 32;
    if (fp.length !== 95) throw new Error("short");
    const cands: Cand[] = [];
    while (i < b.length) {
      const kind = b[i++] as Kind;
      const len = kind === Kind.Srflx4 || kind === Kind.Host4 ? 4 : 16;
      const raw = b.slice(i, i + len);
      i += len;
      const port = (b[i] << 8) | b[i + 1];
      i += 2;
      if (raw.length !== len || !port) throw new Error("short");
      cands.push({ kind, port, addr: kind === Kind.Mdns ? uuidString(raw) : len === 4 ? Array.from(raw).join(".") : ip6String(raw) });
    }
    return { type: setup === "actpass" ? "offer" : "answer", sdp: buildSdp(chars.slice(0, ul), chars.slice(ul), fp, setup, cands) };
  } catch {
    throw new Error("The code is incomplete or damaged. Copy the whole code and try again.");
  }
}

// ------------------------------------------------------------------ sdp

function pickCandidates(sdp: string): Cand[] {
  const all: Cand[] = [];
  for (const m of sdp.matchAll(/^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ (host|srflx)/gim)) {
    const [, addr, port, typ] = m;
    const srflx = typ.toLowerCase() === "srflx";
    let kind: Kind | null = null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(addr)) kind = srflx ? Kind.Srflx4 : Kind.Host4;
    else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local$/i.test(addr)) kind = Kind.Mdns;
    else if (addr.includes(":")) kind = srflx ? Kind.Srflx6 : Kind.Host6;
    if (kind !== null) all.push({ kind, addr, port: Number(port) });
  }
  const first = (k: Kind) => all.find((c) => c.kind === k);
  // The internet address, plus one local one (same Wi-Fi / same PC).
  // IPv6 only when there's no IPv4 way in.
  const pick = [first(Kind.Srflx4), first(Kind.Host4) ?? first(Kind.Mdns)];
  if (!pick[0]) pick.push(first(Kind.Srflx6) ?? first(Kind.Host6));
  return pick.filter((c): c is Cand => !!c);
}

function buildSdp(ufrag: string, pwd: string, fp: string, setup: string, cands: Cand[]): string {
  const prio = (k: Kind) => (k === Kind.Srflx4 || k === Kind.Srflx6 ? 1686052607 : 2122260223);
  const lines = [
    "v=0",
    "o=- 4215775240449105457 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    ...cands.map(
      (c, k) =>
        `a=candidate:${k + 1} 1 udp ${prio(c.kind)} ${c.addr} ${c.port} typ ${c.kind === Kind.Srflx4 || c.kind === Kind.Srflx6 ? "srflx raddr 0.0.0.0 rport 0" : "host"} generation 0`,
    ),
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    "a=ice-options:trickle",
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${setup}`,
    "a=mid:0",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
  ];
  return lines.join("\r\n") + "\r\n";
}

// ------------------------------------------------------------------ bytes

function pack6(s: string): number[] {
  const out: number[] = [];
  let acc = 0,
    bits = 0;
  for (const ch of s) {
    acc = (acc << 6) | ICE.indexOf(ch);
    bits += 6;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  if (bits) out.push((acc << (8 - bits)) & 255);
  return out;
}

function unpack6(bytes: Uint8Array, n: number): string {
  let acc = 0,
    bits = 0,
    s = "";
  for (const b of bytes) {
    acc = ((acc << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 6 && s.length < n) {
      bits -= 6;
      s += ICE[(acc >> bits) & 63];
    }
  }
  if (s.length !== n) throw new Error("short");
  return s;
}

function toB64url(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error("chars");
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}

const ip4Bytes = (a: string) => a.split(".").map(Number);

function ip6Bytes(a: string): number[] {
  const [head, tail = ""] = a.replace(/%.*$/, "").split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = a.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  return groups.flatMap((g) => {
    const n = parseInt(g || "0", 16);
    return [n >> 8, n & 255];
  });
}

function ip6String(b: Uint8Array): string {
  const g: string[] = [];
  for (let i = 0; i < 16; i += 2) g.push(((b[i] << 8) | b[i + 1]).toString(16));
  return g.join(":");
}

function uuidBytes(name: string): number[] {
  const hex = name.slice(0, 36).replace(/-/g, "");
  return Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

function uuidString(b: Uint8Array): string {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
}
