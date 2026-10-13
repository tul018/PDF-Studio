import { PDFDataRangeTransport } from "pdfjs-dist";

/**
 * A random-access byte source for a PDF. The viewer NEVER needs the whole
 * file in memory: PDF.js asks for byte ranges as it needs them (xref table,
 * the objects of the visible pages, ...). A 2 GB scanned PDF opens as fast as
 * a 200 KB one and costs a few MB of RAM.
 *
 * Only "Save" (pdf-lib) needs the complete file, and it runs in a Worker.
 */
export interface PdfSource {
  readonly name: string;
  readonly size: number;
  /** Native path (Tauri desktop) when the file can be saved in place. */
  readonly path?: string;
  /** Last-modified time (ms since 1970), when known. */
  readonly modified?: number;
  /** True when readAll() returns a fresh buffer that may be transferred. */
  readonly freshReadAll: boolean;
  readRange(begin: number, end: number): Promise<Uint8Array>;
  readAll(): Promise<Uint8Array>;
}

/**
 * Key for what is remembered per file (marks, last position, unsaved edits).
 * On desktop it's the path, so it survives saving (which changes the size);
 * elsewhere name + size + modified time, so two different "scan.pdf" files
 * of the same size don't share marks.
 */
export function fileKeyOf(s: PdfSource): string {
  if (s.path) return `path:${/^([a-z]:|\\\\)/i.test(s.path) ? s.path.toLowerCase() : s.path}`;
  return `${s.name}:${s.size}:${s.modified ?? 0}`;
}

/** Fingerprint of the file's current contents (to validate autosaved edits). */
export function fileVersionOf(s: PdfSource): string {
  return `${s.size}:${s.modified ?? 0}`;
}

/** Browser/WebView File (input[type=file], drag & drop, iOS document picker). */
export class FileSource implements PdfSource {
  readonly freshReadAll = true;
  constructor(private file: File) {}
  get name() {
    return this.file.name;
  }
  get size() {
    return this.file.size;
  }
  get modified() {
    return this.file.lastModified;
  }
  async readRange(begin: number, end: number): Promise<Uint8Array> {
    // File.slice is lazy: only these bytes are read from disk.
    return new Uint8Array(await this.file.slice(begin, end).arrayBuffer());
  }
  async readAll(): Promise<Uint8Array> {
    return new Uint8Array(await this.file.arrayBuffer());
  }
}

/** In-memory bytes (freshly saved document, generated content, tests). */
export class BytesSource implements PdfSource {
  readonly freshReadAll = false;
  constructor(
    public readonly name: string,
    private bytes: Uint8Array,
    public readonly path?: string,
  ) {}
  get size() {
    return this.bytes.byteLength;
  }
  async readRange(begin: number, end: number) {
    return this.bytes.subarray(begin, end);
  }
  async readAll() {
    return this.bytes;
  }
}

/** Bridges a PdfSource to PDF.js' range-request protocol. */
export class SourceRangeTransport extends PDFDataRangeTransport {
  private aborted = false;
  constructor(private source: PdfSource) {
    super(source.size, null);
  }
  /**
   * Called on each failed read (with the error and how many reads have
   * failed in a row) and once with `null` when reading works again.
   */
  onReadProblem: (err: unknown, failures: number) => void = () => {};
  private failures = 0;

  override requestDataRange(begin: number, end: number): void {
    this.read(begin, end, 0);
  }

  /**
   * PDF.js has no way to report a failed range: the page would just wait
   * forever. So keep retrying (with back-off) - an online-only OneDrive file,
   * a USB stick plugged back in or a network drive reconnecting then simply
   * finishes loading - and tell the app meanwhile.
   */
  private read(begin: number, end: number, attempt: number): void {
    this.source.readRange(begin, end).then(
      (chunk) => {
        if (this.aborted) return;
        if (this.failures) {
          this.failures = 0;
          this.onReadProblem(null, 0);
        }
        // PDF.js may transfer the buffer to its worker; give it its own copy
        // when the chunk is a view into a larger buffer.
        const owned = chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength ? chunk : chunk.slice();
        this.onDataRange(begin, owned);
      },
      (err) => {
        if (this.aborted) return;
        console.warn("range read failed", begin, end, err);
        this.onReadProblem(err, ++this.failures);
        setTimeout(() => this.aborted || this.read(begin, end, attempt + 1), Math.min(10_000, 500 * 2 ** attempt));
      },
    );
  }
  override abort(): void {
    this.aborted = true;
  }
}
