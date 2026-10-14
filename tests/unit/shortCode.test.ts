import { describe, expect, it } from "vitest";
import { packDescription, unpackDescription } from "../../src/collaboration/shortCode";

const FP = "6B:8B:F0:65:5F:78:E2:51:3B:AC:6F:F3:3F:46:1B:35:DC:B8:5F:64:1A:24:C2:43:F0:A1:58:D0:A1:2C:19:08";

const offer = (cands: string[], setup = "actpass") =>
  [
    "v=0",
    "o=- 1234567890 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    ...cands,
    "a=ice-ufrag:Xq3+",
    "a=ice-pwd:fJ0/Kd9vPq2LmN8sTu4WxYz1",
    "a=ice-options:trickle",
    `a=fingerprint:sha-256 ${FP}`,
    `a=setup:${setup}`,
    "a=mid:0",
    "a=sctp-port:5000",
  ].join("\r\n") + "\r\n";

describe("short connection codes", () => {
  it("round-trips the parts that matter, in about 100 characters", () => {
    const sdp = offer([
      "a=candidate:1 1 udp 2113937151 5f1c2a3b-1d2e-4f50-8a9b-0c1d2e3f4a5b.local 54400 typ host generation 0",
      "a=candidate:2 1 tcp 1518280447 192.168.1.20 9 typ host tcptype active generation 0",
      "a=candidate:3 1 udp 1677729535 203.0.113.7 61234 typ srflx raddr 0.0.0.0 rport 0 generation 0",
    ]);
    const code = packDescription({ type: "offer", sdp });
    expect(code).toMatch(/^PS-[A-Za-z0-9_-]+$/);
    expect(code.length).toBeLessThanOrEqual(112);
    const back = unpackDescription(code);
    expect(back.type).toBe("offer");
    expect(back.sdp).toContain("a=ice-ufrag:Xq3+\r\n");
    expect(back.sdp).toContain("a=ice-pwd:fJ0/Kd9vPq2LmN8sTu4WxYz1\r\n");
    expect(back.sdp).toContain(`a=fingerprint:sha-256 ${FP}\r\n`);
    expect(back.sdp).toContain("a=setup:actpass");
    expect(back.sdp).toContain(" 203.0.113.7 61234 typ srflx");
    expect(back.sdp).toContain(" 5f1c2a3b-1d2e-4f50-8a9b-0c1d2e3f4a5b.local 54400 typ host");
    expect(back.sdp).not.toContain("tcp");
  });

  it("one address: under 90 characters", () => {
    const code = packDescription({ type: "offer", sdp: offer(["a=candidate:3 1 udp 1677729535 203.0.113.7 61234 typ srflx raddr 0.0.0.0 rport 0 generation 0"]) });
    expect(code.length).toBeLessThan(90);
  });

  it("replies are answers; IPv6 is kept when there's no IPv4", () => {
    const sdp = offer(["a=candidate:1 1 udp 1677729535 2001:db8::8a2e:370:7334 50000 typ srflx raddr :: rport 0 generation 0"], "active");
    const back = unpackDescription(packDescription({ type: "answer", sdp }));
    expect(back.type).toBe("answer");
    expect(back.sdp).toContain(" 2001:db8:0:0:0:8a2e:370:7334 50000 typ srflx");
  });

  it("explains damaged, old or wrong codes", () => {
    const code = packDescription({ type: "offer", sdp: offer(["a=candidate:3 1 udp 1 203.0.113.7 61234 typ srflx generation 0"]) });
    expect(() => unpackDescription(code.slice(0, 40))).toThrow(/incomplete or damaged/);
    expect(() => unpackDescription("PDFS2.abc")).toThrow(/older PDF Studio/);
    expect(() => unpackDescription("hello")).toThrow(/isn't a PDF Studio code/);
  });
});
