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
  /** True when readAll() returns a fresh buffer that may be transferred. */
  readonly freshReadAll: boolean;
  readRange(begin: number, end: number): Promise<Uint8Array>;
  readAll(): Promise<Uint8Array>;
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
  override requestDataRange(begin: number, end: number): void {
    this.source.readRange(begin, end).then(
      (chunk) => {
        if (!this.aborted) {
          // PDF.js may transfer the buffer to its worker; give it its own copy
          // when the chunk is a view into a larger buffer.
          const owned =
            chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength ? chunk : chunk.slice();
          this.onDataRange(begin, owned);
        }
      },
      (err) => console.error("range read failed", begin, end, err),
    );
  }
  override abort(): void {
    this.aborted = true;
  }
}
