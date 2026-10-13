/**
 * Read aloud with the system's voices (Windows: Settings › Time & language ›
 * Speech; Thai and Chinese voices can be added there). Reads page after page
 * from a starting page, in short chunks (long utterances get cut off in some
 * engines), choosing a Thai / Chinese / English voice per chunk.
 */
export type Lang = "th" | "zh" | "en";

export function langOf(text: string): Lang {
  const thai = (text.match(/[฀-๿]/g) ?? []).length;
  const cjk = (text.match(/[㐀-鿿]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (thai >= cjk && thai > latin * 0.3) return "th";
  if (cjk > latin * 0.3) return "zh";
  return "en";
}

/** Split text into chunks of at most ~max characters, at sentence / line / space boundaries. */
export function chunks(text: string, max = 220): string[] {
  const out: string[] = [];
  const parts = text.replace(/\s+\n/g, "\n").split(/(?<=[.!?。！？\n])\s*/);
  let cur = "";
  for (const p of parts) {
    if (!p.trim()) continue;
    if ((cur + " " + p).length <= max) {
      cur = cur ? `${cur} ${p}` : p;
      continue;
    }
    if (cur) out.push(cur);
    // Thai and Chinese have no sentence spaces: cut long runs at spaces or every `max` chars.
    let rest = p;
    while (rest.length > max) {
      const cut = rest.lastIndexOf(" ", max);
      const at = cut > max / 2 ? cut : max;
      out.push(rest.slice(0, at));
      rest = rest.slice(at).trimStart();
    }
    cur = rest;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

export class ReadAloud {
  onPage: (index: number) => void = () => {};
  onStop: () => void = () => {};
  onMissingVoice: (lang: Lang) => void = () => {};
  rate = 1;
  private token = 0;

  constructor(
    private pageText: (index: number) => Promise<string>,
    private pageCount: () => number,
  ) {}

  get supported(): boolean {
    return typeof speechSynthesis !== "undefined";
  }

  get playing(): boolean {
    return this.token % 2 === 1;
  }

  stop(): void {
    if (!this.playing) return;
    this.token++;
    speechSynthesis.cancel();
    this.onStop();
  }

  async start(from: number): Promise<void> {
    if (!this.supported) return;
    if (this.playing) this.stop();
    const token = ++this.token; // odd = playing
    const warned = new Set<Lang>();
    for (let i = from; i < this.pageCount() && token === this.token; i++) {
      this.onPage(i);
      const text = await this.pageText(i).catch(() => "");
      for (const c of chunks(text)) {
        if (token !== this.token) return;
        const lang = langOf(c);
        const voice = await voiceFor(lang);
        if (!voice && lang !== "en" && !warned.has(lang)) {
          warned.add(lang);
          this.onMissingVoice(lang);
        }
        await speak(c, voice, lang, this.rate);
      }
    }
    if (token === this.token) {
      this.token++;
      this.onStop();
    }
  }
}

const LOCALE: Record<Lang, string> = { th: "th-TH", zh: "zh-CN", en: "en-US" };

let voicesReady: Promise<SpeechSynthesisVoice[]> | null = null;
function voices(): Promise<SpeechSynthesisVoice[]> {
  voicesReady ??= new Promise((resolve) => {
    const v = speechSynthesis.getVoices();
    if (v.length) return resolve(v);
    speechSynthesis.addEventListener("voiceschanged", () => resolve(speechSynthesis.getVoices()), { once: true });
    setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
  });
  return voicesReady;
}

async function voiceFor(lang: Lang): Promise<SpeechSynthesisVoice | undefined> {
  const list = await voices();
  const prefix = lang === "zh" ? "zh" : lang;
  return list.find((v) => v.lang.toLowerCase().startsWith(prefix) && v.localService) ?? list.find((v) => v.lang.toLowerCase().startsWith(prefix));
}

function speak(text: string, voice: SpeechSynthesisVoice | undefined, lang: Lang, rate: number): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? LOCALE[lang];
    u.rate = rate;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}
