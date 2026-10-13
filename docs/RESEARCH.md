# Why PDF viewers crash, and how PDF Studio avoids it

This note covers the failure modes that show up again and again in PDF viewers and editors: crashes on big or image-heavy files, slow opening, lost or corrupted saves, broken rendering, and awkward navigation. For each one it gives the root cause and the design choice PDF Studio makes, with a pointer to the code.

---

## 1. Crashes with large files or many pictures

This is the most common complaint. It almost always comes down to **unbounded memory**, not the file size itself.

| Root cause | Why it kills the app | What PDF Studio does |
|---|---|---|
| **Rendering every page up front** (or keeping every rendered page). | One rendered A4 page at 200% on a 3× retina screen is about 5000×7000 px × 4 bytes = **140 MB**. A few dozen of those use up all RAM. | **Virtualized pages.** Only the pages in view, plus one or two on each side, get DOM nodes and canvases. Every other page is just a number in a `Float64Array`. In the 400-page / 261 MB test file, at most 6 pages are mounted at any time. → `src/viewer/viewer.ts`, `src/core/layout.ts` |
| **Canvas memory is never released** (WebKit/iOS especially). | iOS holds a canvas's backing store until garbage collection runs, and enforces a hard limit on total canvas memory. When that limit is hit, the system kills the app ("A problem repeatedly occurred"). | When a page scrolls out of view, its canvas is **released explicitly** (`width = height = 0`), its render is cancelled, and `page.cleanup()` frees the PDF.js operator list. After many pages have been scrolled past and nothing is rendering, `pdf.cleanup()` frees fonts and decoded images in the worker. → `freeCanvas`, `scheduleDocCleanup` |
| **Huge bitmaps at high zoom.** | WebKit cannot draw a canvas above **16.7 megapixels**: it silently goes blank or throws. Zooming to 400% creates a canvas like this on almost any page. | **Per-device pixel caps** (iOS 8 Mpx per canvas and 32–48 Mpx in total; desktop 16 Mpx per canvas and 48–128 Mpx in total, scaled by `deviceMemory`). Above the cap, the page renders at the capped scale and a **viewport-sized "detail tile"** renders only the visible area at full sharpness. → `src/core/deviceProfile.ts`, `clampRenderScale`, `renderDetail` |
| **Decoding scans and photos at full resolution.** | One 600 dpi scanned page is about 35 Mpx (140 MB decoded). Photo-heavy PDFs repeat this on every page. | Pages are decoded only when needed and only at the scale being shown. Rendering is bounded by the same budget. Images *inserted* by the user are downscaled to at most 2400 px (a 48 MP iPhone photo is about 190 MB decoded). → `App.storeImage` |
| **Loading the whole file into memory.** | A 1 GB file becomes at least 1 GB of RAM, often 2–3× that once copied between threads. | **Byte-range streaming.** PDF.js asks for 256 KB ranges as it needs them. They come from `File.slice()` (browser and iOS picker) or straight from disk through Rust (`read_range`) on Windows. Opening a 2 GB file costs a few MB. → `src/core/source.ts`, `src-tauri/src/lib.rs` |
| **Fast scrolling floods the renderer.** | Dragging the scrollbar across 1 000 pages starts 1 000 renders. | A **priority render queue** with bounded concurrency. The page closest to the viewport always renders first, and pages that leave the viewport are cancelled before they allocate anything. → `src/core/renderQueue.ts` |
| **Thumbnails at full resolution / all at once.** | The sidebar of a 5 000-page document alone can use GBs. | Virtualized thumbnail list, rendered at the lowest priority. Thumbnails live in a **pixel-budgeted LRU** (4–10 Mpx in total). → `src/viewer/thumbnails.ts` |
| **Undo keeps a full copy of the document per step.** | 50 undo steps on a 200 MB file is 10 GB. | **Non-destructive edit model.** Edits are a small JSON description layered over the untouched file. Undo snapshots share structure, so a step costs only what changed. → `src/edit/model.ts`, `src/edit/history.ts` |
| **Parsing or saving on the UI thread.** | The window freezes, and the OS may flag it "Not responding" and kill it. | PDF parsing runs in the PDF.js worker. Saving (pdf-lib) runs in a **separate Web Worker**, and buffers are *transferred* to it, not copied. → `src/save/save.worker.ts` |
| **No recovery path when memory runs out anyway.** | One failed allocation takes down the whole app. | If a canvas allocation fails, the budgets are **halved and the page re-renders smaller** instead of crashing. Pages that still fail show an inline error, and everything else keeps working. → `degradeProfile` |

**Measured:** 400 pages, each with a 3200×2400 photo (261 MB file). After flinging from the first page to the last, peak render memory was **13.5 MB** on desktop. The iPad profile stayed within its 32 Mpx budget. Both checks are automated in `tests/e2e/app.spec.ts`.

## 2. Slow opening and laggy scrolling

* **Whole-file reads before first paint.** Fixed by range streaming (see above). The first page renders as soon as its objects arrive.
* **Computing every page size up front.** Layout uses page 1's size as an estimate and refines it in idle time, in batches. The scroll position stays anchored while sizes change, so nothing jumps. → `DocumentStore.scanSizes`
* **Zoom re-renders every frame.** During a pinch or Ctrl+wheel, the existing bitmaps are CSS-scaled. The real re-render happens about 160 ms after the gesture settles, and the new bitmap is swapped in atomically, so there are no white flashes.
* **Text layer for all pages.** The selectable text layer is built only for visible pages, and only once scrolling stops.

## 3. Lost work and corrupted files

* **Non-atomic saves.** Writing straight over the original means a crash or power cut mid-save destroys it. The native layer writes to a temp file, calls `fsync`, then renames it over the target, so the original stays intact until the new file is complete. → `atomic_write`
* **App killed with unsaved edits.** Edits are autosaved to IndexedDB every few seconds and whenever the app goes to the background (iOS can kill background apps at any time). Reopening the same file offers to restore them. → `src/edit/recovery.ts`
* **"Fake" redaction.** Many tools draw a black box but leave the text underneath, so it can still be selected, searched and copied. PDF Studio's Redact tool **rasterizes the page with the boxes burned in and drops the original content**, which is real removal. The test suite checks that redacted text is gone from the saved file.
* **Editing the file in place while reading from it.** After an in-place save, the document is re-opened from disk, so the reader never sees a half-replaced file.

## 4. Compatibility ("it renders wrong / won't open")

| Problem | Handling |
|---|---|
| Missing CJK / Thai / Arabic fonts, non-embedded fonts | PDF.js CMaps and standard font data ship with the app, and system fonts are allowed. Works offline. |
| Scanned PDFs (JPEG2000, JBIG2), ICC color | PDF.js WebAssembly decoders and ICC profiles ship locally (`public/pdfjs/`). |
| Damaged files and broken xref tables | PDF.js recovery parser. If a single page fails to render, that page shows an inline error and the rest stay usable. |
| Password-protected PDFs | Password prompt, with a retry on a wrong password. Edits to encrypted files are saved as an image-based copy **without the password**, because pdf-lib cannot encrypt (see roadmap item 5). |
| Older WebViews (iOS 15/16 WKWebView, older WebView2) | Uses the **PDF.js legacy build**, which includes polyfills. The modern build calls APIs such as `Map.getOrInsertComputed` that these WebViews lack. This was found during testing. |
| Annotations made here, viewed elsewhere | Shapes, ink, text and images are written into the page content, so they look identical in every viewer. Comments are written as **real PDF sticky-note annotations**, editable in Acrobat, Preview and Edge. |
| Non-Latin text typed by the user (Thai, CJK, emoji) | The standard PDF font can't encode these characters, so text boxes containing them are rendered with system fonts (which handle complex scripts correctly) into a 288-dpi image. |
| Forms | AcroForm text, checkbox, radio, dropdown and list fields can be filled. If no pages were moved, fields stay editable after saving. Otherwise they are flattened. Form text that Helvetica can't encode (e.g. Thai) falls back to `NeedAppearances`. |

## 5. Usability gaps people complain about

* **Losing your place, and jumping between distant sections.** *Marks* save the current page and scroll position under a name. Click one in the Marks list to jump straight back. Marks persist per file and show as a ribbon on the page. The app also remembers the last page and zoom for each file.
* **Comparing two distant pages (for example page 3 and page 70).** *Split view* shows two independent panes of the same document, each with its own scroll position, zoom and page box. They sit side by side on wide screens and stacked on a portrait phone. Edits made in either pane appear in both.
* **Touch and pen.** One Pointer Events code path serves mouse, touch, Apple Pencil and Windows Ink. Ink uses coalesced events for smooth strokes. Two-finger pinch zooms around your fingers and pans, even while a drawing tool is active. Native page zoom is blocked so the UI never rescales. Touch targets are at least 40 px.
* **Keyboard (Windows).** Ctrl+O/S/Shift+S/P/Z/Y/F/D, Ctrl+\ for split view, Ctrl+wheel and Ctrl+± for zoom, Home/End, single-letter tools (V H T P R O L A N U), M to add a mark, Del to delete the selection, Esc to cancel.

## 6. Security

* In PDF.js 6 the font engine never calls `eval`, and PDF JavaScript is **not executed** (no scripting sandbox is loaded).
* Links from PDFs open only if they are `http(s)`/`mailto`. `file:` and `javascript:` links are ignored.
* A strict CSP is set in `tauri.conf.json`. Nothing loads from the network at runtime.
* The native write command accepts only `.pdf` paths. iOS saves are sanitized into the app's Documents folder.

---

## Feature checklist

**View:** continuous scroll · fit width/page · zoom 10–800% · pinch and Ctrl+wheel zoom · thumbnails · outline (TOC) · links · full-text search with highlighted hits · text selection and copy · dark mode · remembers position per file · **split view** · **marks** · print.

**Edit:** highlight (from selected text or by drawing a box) · free text · freehand ink · rectangle · ellipse · line · arrow · sticky-note comments · images · drawn signature (saved on the device) · white-out · **true redaction** · move, resize and restyle annotations · undo/redo.

**Pages:** rotate · delete · reorder (drag and drop or buttons) · insert blank page · merge other PDFs · extract selected pages to a new PDF · multi-select (Shift/Ctrl).

**Forms:** fill text, checkbox, radio, dropdown and list fields.

**Reliability:** streaming open · bounded memory · worker-based save · atomic writes · crash recovery.

## Planned features (requested)

Picked for everyday shop work: Shopee/Lazada shipping labels on a TSC label printer, receipts, and Thai/Chinese supplier catalogs. Suggested order: 1, 2, 3 first.

1. ✅ **Label printing mode** (done: **Labels** button / Ctrl+L; Shopee, Lazada, grid and whole-page layouts; sharp barcodes, larger SPX order number; prints PNG at the printer dpi on stock-sized paper). One button: find each shipping label on the page (often several per A4 sheet, or with wide margins), crop it, rotate it, fit it to the label size (e.g. 100×150 mm) and print them all to the TSC printer. Effort: medium.
2. ✅ **Search a whole folder of PDFs** (done: **Folder** tab / Ctrl+Shift+F, also from the start screen; subfolders included; texts remembered in IndexedDB per file version; scans and locked files reported). Type a part number or car model once and search all supplier catalogs together; results list file + page and open there. Reuses the single-file search (shared text cache). Effort: medium.
3. ✅ **Stamps and company seal** (done: **Stamp** tool with Thai/English stamps, optional date in the Thai calendar, custom text, saved seal/logo images with the white paper made transparent, this page or every page; **Numbers** and **Watermark** on every page, re-running replaces them). Save the company seal (ตราประทับ), signature or a "PAID" / "ได้รับเงินแล้ว" stamp once and place it in one click; add page numbers or a watermark to many pages at once. Builds on the existing image/signature tools. Effort: small.
4. **OCR in Thai, Chinese and English** for scanned catalogs, receipts and photo PDFs, so they can be searched and copied (see item 1 of the list below). Should work offline (e.g. Tesseract with `tha`, `chi_sim`, `eng`) so documents never leave the PC. Effort: medium-large.
5. ✅ **Export pages as images (JPG/PNG)** (done: Pages panel, current / selected / all, 96-300 dpi; saved into a chosen folder, never overwriting) to post on Shopee, Lazada or LINE without screenshots. Effort: small.
6. **Several files open at once (tabs) and a recent-files list.** Today opening a file closes the current one. Effort: medium.
7. **Shrink PDF size** for sending by LINE or email (see "Compress" below). Effort: medium.
8. ✅ **Split a PDF into several files** (done: every N pages or ranges like 1-3, 4-10, 11-; split in a worker; each part keeps its bookmarks and metadata) by page ranges or every N pages (today: extract selected pages only). Effort: small.
9. ✅ **Cut pages into pieces** (done: Pages panel; vertical + horizontal cut by %, live preview, current/selected/all pages): a vertical and a horizontal cut at the same time, each set by percentage, on selected pages or all; each piece becomes its own page (2-up scans, A3 spreads, label sheets). Non-destructive (crop per page), undoable, saved as cropped pages.
10. **Translate Chinese supplier documents to Thai or English.** Optional, opt-in only: needs an AI service, so documents would leave the PC (see "AI features" below).
11. **Password protection on save** (item 5 below).

### General and professional users

Suggested next after the shop items, marked ★: they are used often, set a professional PDF app apart from a basic viewer, and mostly build on what the app already does.

**Everyone**

1. ★ **Make a PDF from photos or scans.** Pick phone photos or scanner images; pages are straightened, cropped and saved as one clean PDF.
2. ★ **App menus in Thai and Chinese** (today only document content supports them; the UI is English).
3. **Reading modes:** two pages side by side (book), single page at a time, and a night mode that darkens the pages themselves.
4. **Read aloud** in Thai and English with the voices built into Windows.
5. **Settings page:** default zoom, page colour, save folder, keyboard shortcuts.
6. **Automatic updates** (Tauri updater).

**Professional (office, legal, accounting, engineering)**

7. ★ **Compare two PDFs:** show what changed between two versions of a contract or quote, side by side (split view is half of this).
8. ★ **Redact by search:** black out every phone number, ID card number, bank account or chosen word in one step (true redaction exists; this adds pattern search).
9. ★ **Remove hidden information** before sending: author, editing history, comments, attachments, hidden layers.
10. **Comments panel:** all comments in one list, reply, mark resolved, export.
11. **Create fillable forms:** add text boxes and checkboxes, not only fill existing ones.
12. **Headers, footers and Bates numbering** (running document numbers on every page, for legal files).
13. **Edit bookmarks:** add, rename and reorder the table of contents.
14. **Measuring tools** for drawings and floor plans: distance and area at a set scale.
15. **Convert to Word or Excel.** Hard to do well; a later item.
16. **Batch actions:** apply the same steps (stamp, compress, password) to many files at once.

### AI assistant: Claude (and later ChatGPT) controls PDF Studio (requested)

Chat in the Claude app as usual ("open the catalog in PDF Studio and add a cover page") and Claude operates PDF Studio directly. It uses the user's existing Claude subscription: no API key in PDF Studio, no extra billing. (Third-party apps can't log in with a Claude.ai or ChatGPT subscription; this connector is the supported way.)

- **How:** PDF Studio runs a local **MCP server** (Model Context Protocol). Claude Desktop and Claude Code connect to local MCP servers directly.
- **What Claude can do:** we choose which functions to expose; plan is nearly all of them:
  - open, save, save as, merge, extract, print;
  - go to a page, zoom, split view, search, read any page's text;
  - see a page as an image (to check layouts it made);
  - add text, highlights, shapes, comments, images, stamps, white-out, redaction;
  - rotate, delete, reorder, insert and create pages with content;
  - read and fill forms; marks, bookmarks, metadata;
  - every new feature as it is added (label mode, OCR, password...).
- **Limits:** cannot draw a signature by hand (places the saved signature/seal); cannot open a protected PDF without the password.
- **Safety:** saving over a file, deleting pages and redaction ask for confirmation in PDF Studio; all edits stay undoable until saved. The MCP server only listens on this PC.
- **Privacy:** pages Claude reads or sees are sent to Anthropic, as in any Claude chat. Off until the user turns the connector on.
- **ChatGPT later:** as far as known today, ChatGPT only connects to MCP servers reachable over the internet, so it would need a secure tunnel/relay to this PC (more setup and security work). Check OpenAI's current rules first. Design the tools so the same set serves both.
- **Option A (later, optional):** an AI panel inside PDF Studio using the user's own Claude/OpenAI API key (stored in Windows Credential Manager, pay per use).

### Future (requested, no AI needed)

1. **Work together live, from anywhere, at no cost.** Two or more people in different places open the same PDF and annotate at the same time, seeing each other's cursors, marks, comments and page edits within about a second; optional "Follow" mode keeps everyone on the presenter's page.
   - **Flow:** the host clicks **Share live** and sends the link or code (e.g. by LINE); others open it in PDF Studio. Any participant can save a copy with all edits.
   - **Introduction (signaling):** a tiny **Cloudflare Worker on the free tier** (one free Cloudflare account, set up once) lets the PCs find each other.
   - **Direct connection:** then the PCs talk **peer-to-peer (WebRTC)**, using free public STUN servers (e.g. Google's). Edits, cursors and the PDF itself go straight from the host to the others; nothing is stored on a server.
   - **Backup relay:** when a network blocks direct connections (common on Thai mobile networks / CGNAT), the same free Worker relays the messages. Edits are tiny, so a shop's use stays far inside the free limits.
   - **Edits merge automatically** with a CRDT (e.g. Yjs); every annotation already has its own ID and the edit model is a small JSON layer over the file, so only small changes travel, never the whole file.
   - **Safety:** link/code only, links can expire, host can make others view-only or comment-only, encrypted in transit, original file unchanged until someone saves.
   - **Limits / to check before building:** the host's PDF Studio must stay open while hosting; confirm the providers' current free-tier limits (they can change).
   - **Build order:** direct connection, then backup relay, then sending the PDF to participants who don't have it; a browser viewer for people without PDF Studio later.
   - **Simpler variants:** same Wi-Fi with the host PC as meeting point (no internet service at all), or Tailscale for staff devices.
2. **QR code detection.** Find QR codes on pages and make them clickable (open the link, copy the text), including in scanned pages; optionally also generate a QR code stamp (e.g. an order tracking link). Uses a standard QR decoder library (e.g. zxing / jsQR) on the rendered page, so it works offline.
3. **GPU rendering.** Draw pages with the graphics card for even smoother scrolling and zooming of huge, image-heavy files and lower CPU use. PDF.js 6 ships early WebGPU support (`webgpu` module) and an `enableHWA` (hardware acceleration) option: measure both with `npm run bench` (CPU x1 and x4) before switching, and keep the current path as a fallback for PCs without a suitable GPU.

## Not done yet (roadmap)

These are significant features that need more work, or a native SDK, to do properly:

1. **OCR** for scanned documents, in Thai, Chinese and English (requested, see "Planned features" 4). Could use Apple's Vision framework on iOS and `Windows.Media.Ocr` on Windows, called from the Rust side, or Tesseract where a language isn't available.
2. **Certificate-based digital signatures** (PAdES/PKI). The current Sign tool places a handwritten signature image, which is legally weaker.
3. **Editing existing text in place.** Today you cover it with white-out and type over it.
4. **Native PDF annotations for every type**, so others can edit them. Only comments are native today; everything else is flattened into the page.
5. **Password protection on save** (requested). Today the app can only *open* protected PDFs. Planned:
   - a "Protect with password" option when saving, with standard AES-256 encryption (opens in Adobe Reader, Edge, phones), probably done on the Rust side so large files stay fast;
   - edited protected PDFs keep their password and stay real, searchable text, instead of becoming an unprotected image-based copy as now (pdf-lib cannot encrypt);
   - ✅ until then, a clear warning before any save that removes protection (done: confirm dialog "Save without the password?").
6. **Compress / optimize** (requested, for LINE/email size limits), **PDF/A export.**
7. **Incremental save**, which appends changes instead of rewriting the file. That would make saving very large files much cheaper.
8. **XFA forms** (a legacy format that PDF.js renders only partially).
9. **AI features** (summarize, ask the document, smart form fill) would fit well as an optional, opt-in panel. They need an API key or service and a privacy decision, so they are deliberately left out of v1.
