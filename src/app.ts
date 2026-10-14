import { Workbench } from "./professional/workbench";
import { Connector } from "./connector/client";
import { LiveSession } from "./collaboration/live";
import { advancedSettings } from "./professional/settings";
import { checkUpdates, updateSettings } from "./platform/updates";
import { getDocument, OPS } from "pdfjs-dist";
import { cropViewport, CSS_UNITS, DocumentStore, pdfjsAssets, type LoadedDoc } from "./core/documents";
import { getProfile, type DeviceProfile } from "./core/deviceProfile";
import { nextZoom } from "./core/layout";
import { FileSource, fileKeyOf, fileVersionOf, type PdfSource } from "./core/source";
import { History } from "./edit/history";
import { Marks } from "./edit/marks";
import {
  deletePages,
  emptyState,
  insertPages,
  movePages,
  pagesForDoc,
  rotatePages,
  TEXT_FONTS,
  uid,
  type EditState,
  type PageRef,
  type StoredImage,
} from "./edit/model";
import { AnnotationOverlay, type Tool } from "./edit/overlay";
import {
  imageOnPages,
  PAGE_NUMBER_PREFIX,
  pageNumberAnnotations,
  replaceByPrefix,
  STAMP_PREFIX,
  WATERMARK_PREFIX,
  type PageGeom,
} from "./edit/pageDecor";
import { renderWatermark } from "./edit/stamps";
import type { Protection } from "./save/encrypt";
import { imagesToPdf } from "./save/fromImages";
import { BytesSource } from "./core/source";
import { currentLanguage, initialLanguage, setLanguage } from "./ui/i18n";
import { ocrPdf } from "./save/ocr";
import { cutDialog, ocrDialog, protectDialog, photosDialog, settingsDialog, shrinkDialog, exportImagesDialog, pageNumbersDialog, splitDialog, stampDialog, watermarkDialog } from "./ui/decorDialogs";
import { cutPages } from "./edit/cut";
import { forgetRecent, mapDocIds, newTab, recentFiles, rememberRecent, TabBar, type Tab, type TabSnapshot } from "./tabs";
import { pagesToImages, shrinkInWorker, splitInWorker } from "./save/pages";
import { splitParts } from "./save/split";
import { clearDraft, loadDraft, saveDraft } from "./edit/recovery";
import { labelDialog } from "./labels/labelDialog";
import { buildLabelPdf } from "./labels/labels";
import { NativeSource, Platform } from "./platform/platform";
import { buildPdf } from "./save/saver";
import { choiceDialog, confirmDialog, progressOverlay, promptText, signaturePad, toast } from "./ui/dialogs";
import { icon } from "./ui/icons";
import { printPdf } from "./ui/print";
import { FormLinkLayer } from "./viewer/formLayer";
import { attachGestures } from "./viewer/gestures";
import { FolderPanel } from "./viewer/folderPanel";
import { ReadAloud } from "./viewer/readAloud";
import { extractPageText } from "./viewer/search";
import { newTextCache, Search } from "./viewer/search";
import { Thumbnails } from "./viewer/thumbnails";
import { Viewer, type Decorator, type Slot, type ViewMode } from "./viewer/viewer";

interface Pane {
  root: HTMLDivElement;
  head: HTMLDivElement;
  scroller: HTMLDivElement;
  viewer: Viewer;
  overlay: AnnotationOverlay;
  forms: FormLinkLayer;
  /** Each pane searches on its own (split view: different queries side by side). */
  search: Search;
  bar: HTMLDivElement;
  searchTimer: number;
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T;

/** Marks shown as a small ribbon on the page edge. */
class MarkRibbons implements Decorator {
  constructor(private app: App) {}
  decorate(slot: Slot): void {
    slot.layers.querySelectorAll(".mark-ribbon").forEach((e) => e.remove());
    const doc = this.app.mainDoc;
    if (!doc || slot.ref.docId !== doc.id) return;
    for (const m of this.app.marks.onPage(slot.ref.srcIndex)) {
      const r = document.createElement("div");
      r.className = "mark-ribbon";
      r.style.top = `${m.fy * 100}%`;
      r.style.setProperty("--mark", m.color);
      r.title = m.label;
      r.textContent = m.label;
      slot.layers.appendChild(r);
    }
  }
  undecorate(slot: Slot): void {
    slot.layers.querySelectorAll(".mark-ribbon").forEach((e) => e.remove());
  }
}

export class App {
  readonly workbench = new Workbench(this);
  readonly connector = new Connector(this);
  readonly live = new LiveSession(this);
  readonly profile: DeviceProfile = getProfile();
  readonly platform = new Platform(this.profile.isIOS);
  readonly store = new DocumentStore();
  readonly history = new History(emptyState());
  readonly images = new Map<string, StoredImage>();
  readonly marks = new Marks();
  /** Page text extracted for search, shared by the panes' searches. */
  private readonly textCache = newTextCache();
  mainDoc: LoadedDoc | null = null;
  private fileKey = "";
  private fileVersion = "";
  private canvasChangePending = false;
  private folderPanel!: FolderPanel;
  /** Next open goes to a given place (folder search result): skip restoring the last position. */
  private skipRestoreView = false;
  private reader = new ReadAloud(
    async (i) => {
      const ref = this.history.state.pages[i];
      const page = ref && (await this.store.getPage(ref));
      return page ? (await extractPageText(page)).text : "";
    },
    () => this.history.state.pages.length,
  );
  private tabs: Tab[] = [];
  private activeTab = -1;
  private tabBar!: TabBar;
  private panes: Pane[] = [];
  private active = 0;
  private thumbs!: Thumbnails;
  private ribbons = new MarkRibbons(this);
  private lastPages: readonly PageRef[] | null = null;
  private draftTimer = 0;
  private viewSaveTimer = 0;
  private tool: Tool = "select";

  constructor() {
    this.renderIcons();
    this.panes.push(this.createPane());
    this.panes[0].root.classList.add("active");
    const v0 = this.panes[0].viewer;
    this.thumbs = new Thumbnails(
      $("#thumbs"),
      this.store,
      v0.queue,
      Math.min(2, window.devicePixelRatio || 1),
      this.profile.isIOS ? 4 * 1024 * 1024 : 10 * 1024 * 1024,
    );
    this.thumbs.onNavigate = (i) => this.activeViewer.scrollToPage(i);
    this.thumbs.onMove = (ids, to) => this.history.push(movePages(this.history.state, ids, to));
    this.thumbs.onSelectionChange = () => this.updatePageOpsState();
    // Thumbnails are copied from pages the main view has drawn, not rendered twice.
    this.thumbs.renderedPage = (ref) => {
      for (const p of this.panes) {
        const c = p.viewer.renderedCanvas(ref);
        if (c) return c;
      }
      return undefined;
    };
    this.thumbs.mainWillDraw = (ref) => this.panes.some((p) => p.viewer.willDraw(ref));

    this.history.subscribe((s) => this.onState(s));
    this.marks.onChange = () => {
      this.renderMarks();
      for (const p of this.panes) p.viewer.redecorate();
    };
    this.store.onReadProblem = (source, err) => {
      if (err === null) return toast(`"${source.name}" can be read again.`, "ok");
      toast(
        `Can't read "${source.name}" right now (${(err as Error)?.message ?? err}). Retrying — pages will appear once the file is available (e.g. OneDrive finished downloading, drive reconnected).`,
        "error",
        15_000,
      );
    };

    // Page layout (scroll / one page / two pages) and night reading, remembered.
    const viewMode = $<HTMLSelectElement>("#view-mode");
    viewMode.value = localStorage.getItem("pdfstudio:viewmode") ?? "continuous";
    if (viewMode.value !== "continuous") for (const p of this.panes) p.viewer.setViewMode(viewMode.value as ViewMode);
    viewMode.addEventListener("change", () => {
      for (const p of this.panes) p.viewer.setViewMode(viewMode.value as ViewMode);
      try {
        localStorage.setItem("pdfstudio:viewmode", viewMode.value);
      } catch {
        /* ignore */
      }
    });
    if (localStorage.getItem("pdfstudio:night") === "1") {
      document.body.classList.add("night-pages");
      $('[data-action="nightPages"]').classList.add("on");
    }
    this.reader.onPage = (i) => this.activeViewer.scrollToPage(i);
    this.reader.onStop = () => $('[data-action="readAloud"]').classList.remove("on");
    this.reader.onMissingVoice = (lang) =>
      toast(
        `No ${lang === "th" ? "Thai" : "Chinese"} voice is installed. Windows: Settings › Time & language › Speech › Add voices, then try again.`,
        "info",
        9000,
      );
    setLanguage(initialLanguage());
    this.reader.rate = Number(localStorage.getItem("pdfstudio:readrate")) || 1;
    this.tabBar = new TabBar($("#tabbar"));
    this.tabBar.onSelect = (i) => void this.switchTab(i);
    this.tabBar.onClose = (i) => void this.closeTab(i);
    this.tabBar.onNew = () => void this.open();
    this.folderPanel = new FolderPanel($('[data-panel="folder"]'), this.platform);
    this.folderPanel.onOpen = (source, pageIndex, query) => void this.openSearchResult(source, pageIndex, query);
    this.bindToolbar();
    void checkUpdates(() => this.history.dirty || this.tabs.some(t => !!t.snapshot?.dirty));
    this.bindKeyboard();
    this.bindDragDrop();
    this.bindSidebarTabs();
    // Live diagnostics for automated tests and support.
    const app = this;
    (window as unknown as { __pdfstudio: unknown }).__pdfstudio = {
      get canvasPixels() {
        return app.panes.reduce((n, p) => n + p.viewer.canvasPixels, 0);
      },
      get budget() {
        return app.profile.canvasBudgetPixels;
      },
      get mounted() {
        return app.panes.reduce((n, p) => n + p.viewer.mountedSlots().length, 0);
      },
      get pages() {
        return app.history.state.pages.length;
      },
      get annotations() {
        return app.history.state.annotations.length;
      },
    };
    window.addEventListener("beforeunload", (e) => {
      if (this.history.dirty || this.tabs.some((t) => t.snapshot?.dirty)) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden" && this.history.dirty) this.writeDraftNow();
    });
    this.applyTheme(localStorage.getItem("pdfstudio:theme"));
    this.setTool("select");
    this.updateChrome();
    void this.platform.initialFiles().then((files) => {
      if (files.length) void this.openSources(files);
    });
  }

  get activePane(): Pane {
    return this.panes[Math.min(this.active, this.panes.length - 1)];
  }

  get activeViewer(): Viewer {
    return this.activePane.viewer;
  }

  // ================================================================ panes

  private createPane(): Pane {
    const root = document.createElement("div");
    root.className = "pane";
    const head = document.createElement("div");
    head.className = "pane-head";
    head.innerHTML = `
      <span class="pane-title"></span>
      <button class="icon-btn" data-pane-act="prev" title="Previous page">${icon("prev")}</button>
      <input class="page-input" inputmode="numeric" aria-label="Page number" />
      <span class="page-total"></span>
      <button class="icon-btn" data-pane-act="next" title="Next page">${icon("next")}</button>
      <button class="icon-btn" data-pane-act="zoomOut" title="Zoom out">${icon("zoomOut")}</button>
      <span class="pane-zoom"></span>
      <button class="icon-btn" data-pane-act="zoomIn" title="Zoom in">${icon("zoomIn")}</button>
      <button class="icon-btn" data-pane-act="fit" title="Fit width">${icon("fitWidth")}</button>
      <button class="icon-btn pane-close" data-pane-act="close" title="Close this pane">${icon("close")}</button>`;
    const scroller = document.createElement("div");
    scroller.className = "viewer";
    scroller.tabIndex = 0;
    root.append(head, scroller);
    $("#panes").appendChild(root);

    const viewer = new Viewer(scroller, this.store, this.profile);
    const mode = document.querySelector<HTMLSelectElement>("#view-mode")?.value as ViewMode | undefined;
    if (mode && mode !== "continuous") viewer.setViewMode(mode);
    const search = new Search(this.store, this.textCache);
    const bar = this.createSearchBar();
    root.appendChild(bar);
    const overlay = new AnnotationOverlay(viewer, this.history, this.images, search);
    const forms = new FormLinkLayer(this.store, this.history);
    viewer.addDecorator(overlay);
    viewer.addDecorator(forms);
    viewer.addDecorator(this.ribbons);
    attachGestures(viewer);
    const pane: Pane = { root, head, scroller, viewer, overlay, forms, search, bar, searchTimer: 0 };
    search.onUpdate = (done, scanned, total) => this.onSearchUpdate(pane, done, scanned, total);
    this.bindSearchBar(pane);

    overlay.onRequestNoteText = (initial) =>
      promptText(initial ? "Edit comment" : "Add comment", initial, { multiline: true, placeholder: "Comment…" });
    overlay.onSelectionChange = (a) => {
      if (a) for (const p of this.panes) if (p !== pane) p.overlay.select(null);
      document.body.classList.toggle("has-selection", !!a);
    };
    forms.onLink = (url) => void this.platform.openExternal(url);
    forms.onGoto = (docId, index) => {
      const i = this.history.state.pages.findIndex((p) => p.docId === docId && p.srcIndex === index);
      if (i >= 0) viewer.scrollToPage(i);
    };
    forms.onFormsDetected = () => toast("This PDF has fillable form fields — click a field to type.");
    viewer.onPageChange = () => {
      this.updatePageIndicators();
      this.scheduleViewSave();
    };
    viewer.onZoomChange = () => this.updatePageIndicators();
    viewer.onRenderError = (m) => toast(m, "error");
    viewer.onCanvasChange = () => this.onCanvasChange();
    viewer.placeholderFor = (ref) => this.thumbs?.cached(ref);

    root.addEventListener("pointerdown", () => this.activate(pane), { capture: true });
    root.addEventListener("focusin", () => this.activate(pane));
    const input = $<HTMLInputElement>(".page-input", head);
    input.addEventListener("change", () => this.gotoPageInput(input, viewer));
    input.addEventListener("keydown", (e) => e.stopPropagation());
    head.addEventListener("click", (e) => {
      const act = (e.target as Element).closest<HTMLElement>("[data-pane-act]")?.dataset.paneAct;
      if (!act) return;
      if (act === "prev") viewer.prev();
      if (act === "next") viewer.next();
      if (act === "zoomIn") viewer.setZoom(nextZoom(viewer.zoom, 1));
      if (act === "zoomOut") viewer.setZoom(nextZoom(viewer.zoom, -1));
      if (act === "fit") viewer.setFit("width");
      if (act === "close") this.closePane(pane);
    });
    for (const o of [overlay]) {
      o.tool = this.tool;
    }
    return pane;
  }

  private activate(p: Pane): void {
    const i = this.panes.indexOf(p);
    if (i < 0 || i === this.active) return;
    this.active = i;
    this.panes.forEach((x, k) => x.root.classList.toggle("active", k === i));
    this.updatePageIndicators();
  }

  /** Split view: a second, independent view of the same document. */
  toggleSplit(): void {
    if (this.panes.length > 1) {
      this.closePane(this.panes[1]);
      return;
    }
    if (!this.mainDoc) return;
    const first = this.panes[0];
    const p = this.createPane();
    this.panes.push(p);
    p.overlay.tool = this.tool;
    p.overlay.options = first.overlay.options;
    p.viewer.setPages(this.history.state.pages, false);
    for (const x of this.panes) x.viewer.budgetShare = 0.5;
    document.body.classList.add("split");
    requestAnimationFrame(() => {
      p.viewer.setFit("width");
      // Start the second pane where the first one is; the user then jumps.
      p.viewer.scrollToPage(first.viewer.currentIndex);
      this.activate(p);
      $<HTMLInputElement>(".page-input", p.head).focus();
      $<HTMLInputElement>(".page-input", p.head).select();
    });
    this.updateChrome();
    toast("Split view: each side scrolls and zooms on its own. Type a page number in the pane header to jump.");
  }

  private closePane(p: Pane): void {
    if (this.panes.length < 2) return;
    p.search.clear();
    clearTimeout(p.searchTimer);
    p.viewer.destroy();
    p.root.remove();
    this.panes = this.panes.filter((x) => x !== p);
    this.active = 0;
    this.panes[0].root.classList.add("active");
    this.panes[0].viewer.budgetShare = 1;
    document.body.classList.remove("split");
    this.updateChrome();
  }

  // ================================================================ open

  async open(multiple = false): Promise<void> {
    const files = await this.platform.pickFiles(multiple);
    if (files.length) await this.openSources(files);
  }

  /**
   * Open files. "replace": into a new tab when a file is already open (that
   * one stays in its tab, edits and all), or into the current tab when none
   * is; a file that is already open in a tab is switched to instead.
   * "merge": add their pages to the open document.
   */
  async openSources(sources: PdfSource[], mode: "replace" | "merge" = "replace"): Promise<void> {
    if (mode === "replace") {
      const key = fileKeyOf(sources[0]);
      const already = this.tabs.findIndex((t) => t.sources[0] && fileKeyOf(t.sources[0]) === key);
      if (already >= 0 && sources.length === 1) {
        // Reopened after saving over it: load the new version into its own tab.
        if (already === this.activeTab && !this.mainDoc) return this.loadIntoTab(sources, null);
        if (already !== this.activeTab) await this.switchTab(already);
        return;
      }
      if (this.mainDoc) {
        this.stashCurrent();
        this.tabs.push(newTab(sources));
        this.activeTab = this.tabs.length - 1;
      } else if (this.activeTab < 0) {
        this.tabs.push(newTab(sources));
        this.activeTab = this.tabs.length - 1;
      }
      await this.closeDocument();
      return this.loadIntoTab(sources, null);
    }
    return this.loadIntoTab(sources, null, "merge");
  }

  /** Put the open document away into its tab (a snapshot), freeing it. */
  private stashCurrent(): void {
    const tab = this.tabs[this.activeTab];
    if (!tab || !this.mainDoc) return;
    for (const p of this.panes) p.overlay.commitTextEdit();
    const ids = [...this.store.docs.keys()];
    tab.sources = ids.map((id) => this.store.docs.get(id)!.source);
    const pos = this.activeViewer.position();
    tab.snapshot = {
      state: mapDocIds(this.history.state, (id) => `#${ids.indexOf(id)}`),
      images: new Map(this.images),
      dirty: this.history.dirty,
      view: { ...pos, zoom: this.activeViewer.zoom },
    };
    if (tab.snapshot.dirty) this.writeDraftNow(); // crash safety for the tab's edits
    this.images.clear(); // keep their blob URLs alive for the snapshot
  }

  async switchTab(i: number): Promise<void> {
    if (i < 0 || i >= this.tabs.length) return;
    if (i === this.activeTab && this.mainDoc) return;
    this.stashCurrent();
    await this.closeDocument();
    this.activeTab = i;
    const tab = this.tabs[i];
    const snap = tab.snapshot;
    tab.snapshot = null;
    await this.loadIntoTab(tab.sources, snap);
  }

  async closeTab(i: number): Promise<void> {
    const tab = this.tabs[i];
    if (!tab) return;
    const name = tab.sources[0]?.name ?? "this file";
    if (i === this.activeTab && this.history.dirty) {
      const c = await choiceDialog("Unsaved changes", `Save your changes to "${name}" before closing it?`, ["Cancel", "Discard", "Save"]);
      if (c === 0) return;
      if (c === 2 && !(await this.save(false))) return;
      void clearDraft(this.fileKey);
    } else if (i !== this.activeTab && tab.snapshot?.dirty) {
      if (!(await confirmDialog("Discard changes?", `"${name}" has unsaved changes. Close it and lose them?`, "Discard and close"))) return;
    }
    if (i === this.activeTab) await this.closeDocument();
    for (const im of tab.snapshot?.images.values() ?? []) URL.revokeObjectURL(im.url);
    this.tabs.splice(i, 1);
    if (i < this.activeTab) this.activeTab--;
    else if (i === this.activeTab) {
      this.activeTab = -1;
      if (this.tabs.length) return this.switchTab(Math.min(i, this.tabs.length - 1));
    }
    this.renderTabs();
    this.updateChrome();
  }

  private renderTabs(): void {
    this.tabBar.render(this.tabs, this.activeTab, this.history.dirty);
  }

  /** The start screen's list of recent files (desktop). */
  private renderRecent(): void {
    const list = recentFiles();
    $("#recent").hidden = !list.length || this.platform.kind !== "desktop";
    const items = list.map((r) => {
      const li = document.createElement("li");
      li.className = "recent-item";
      const b = document.createElement("button");
      b.className = "recent-open";
      const n = document.createElement("span");
      n.className = "recent-name";
      n.textContent = r.name;
      const p = document.createElement("span");
      p.className = "recent-path";
      p.textContent = r.path;
      b.append(n, p);
      b.addEventListener("click", async () => {
        try {
          await this.openSources([await NativeSource.open(r.path)]);
        } catch {
          forgetRecent(r.path);
          this.renderRecent();
          toast(`"${r.name}" was moved or deleted.`, "error");
        }
      });
      const x = document.createElement("button");
      x.className = "tab-close";
      x.textContent = "×";
      x.title = "Remove from the list";
      x.addEventListener("click", () => (forgetRecent(r.path), this.renderRecent()));
      li.append(b, x);
      return li;
    });
    $("#recent-list").replaceChildren(...items);
  }

  private async loadIntoTab(sources: PdfSource[], restore: TabSnapshot | null, mode: "replace" | "merge" = "replace"): Promise<void> {
    const tab = this.tabs[this.activeTab];
    const busy = progressOverlay(`Opening ${sources[0].name}…`);
    try {
      const loaded: LoadedDoc[] = [];
      for (const s of sources) {
        busy.update(`Opening ${s.name}…`, 0);
        loaded.push(
          await this.store.open(
            s,
            async (reason) => {
              // Reopening a tab: use the password typed earlier this session.
              const known = tab?.passwords.get(fileKeyOf(s));
              if (known !== undefined && reason === "need") return known;
              const pw = await promptText(reason === "incorrect" ? "Incorrect password — try again" : "Password required", "", {
                password: true,
                sub: `"${s.name}" is protected.`,
                okLabel: "Unlock",
              });
              if (pw !== null) tab?.passwords.set(fileKeyOf(s), pw);
              return pw;
            },
            (f) => busy.update(`Opening ${s.name}…`, f),
          ),
        );
      }
      busy.close();
      if (mode === "replace" || !this.mainDoc) {
        const [main, ...rest] = loaded;
        this.mainDoc = main;
        this.fileKey = fileKeyOf(main.source);
        this.fileVersion = fileVersionOf(main.source);
        let pages = pagesForDoc(main.id, main.numPages);
        for (const d of rest) pages = pages.concat(pagesForDoc(d.id, d.numPages));
        this.lastPages = null;
        for (const p of this.panes) p.forms.reset();
        this.history.reset({ ...emptyState(), pages });
        if (tab) tab.sources = sources;
        rememberRecent(main.source);
        if (restore) {
          // Back to a tab: its edits, images and place, exactly as left.
          const ids = loaded.map((d) => d.id);
          const state = mapDocIds(restore.state, (tok) => ids[Number(tok.slice(1))] ?? tok);
          for (const [k, v] of restore.images) this.images.set(k, v);
          if (restore.dirty) this.history.push(state);
          else this.history.reset(state);
        }
        if (main.numPages <= 20000) this.store.scanSizes(main.id);
        this.marks.load(this.fileKey, `${main.source.name}:${main.source.size}`);
        this.renderOutline();
        document.title = `${main.source.name} — PDF Studio`;
        requestAnimationFrame(() => {
          if (restore) {
            this.activeViewer.setZoom(restore.view.zoom);
            this.activeViewer.scrollToPosition(restore.view.index, restore.view.fy);
            return;
          }
          if (this.skipRestoreView) this.skipRestoreView = false;
          else this.restoreView();
          void this.offerRecovery();
        });
        if (main.encrypted) toast("Protected PDF: saving edits removes the password (pages saved as images).", "info", 6000);
      } else {
        let s = this.history.state;
        for (const d of loaded) s = insertPages(s, s.pages.length, pagesForDoc(d.id, d.numPages));
        this.history.push(s);
        toast(`Added ${loaded.reduce((n, d) => n + d.numPages, 0)} pages from ${loaded.length} file(s).`, "ok");
        this.activeViewer.scrollToPage(this.history.state.pages.length - loaded.reduce((n, d) => n + d.numPages, 0));
      }
    } catch (e) {
      busy.close();
      console.error(e);
      const name = (e as Error)?.name;
      toast(
        name === "InvalidPDFException"
          ? "This file is not a valid PDF or is damaged."
          : name === "PasswordException"
            ? "The document could not be unlocked."
            : `Could not open file: ${(e as Error)?.message ?? e}`,
        "error",
        6000,
      );
    }
    this.updateChrome();
  }

  private async closeDocument(): Promise<void> {
    this.reader.stop();
    for (const p of this.panes) {
      p.search.clear();
      $(".search-count", p.bar).textContent = "";
    }
    this.textCache.clear();
    for (const p of this.panes) {
      p.overlay.select(null);
      p.viewer.setPages([], false);
    }
    this.thumbs.setPages([]);
    this.history.reset(emptyState());
    for (const im of this.images.values()) URL.revokeObjectURL(im.url);
    this.images.clear();
    this.marks.clear();
    await this.store.closeAll();
    this.mainDoc = null;
    $("#outline").replaceChildren();
    document.title = "PDF Studio";
  }

  private async offerRecovery(): Promise<void> {
    if (!this.mainDoc) return;
    const draft = await loadDraft(this.fileKey, this.fileVersion, this.mainDoc.id);
    if (!draft || (!draft.state.annotations.length && !Object.keys(draft.state.formValues).length && draft.state.pages.length === this.mainDoc.numPages && draft.state.pages.every((p, i) => p.srcIndex === i && !p.rotation))) return;
    const when = new Date(draft.savedAt).toLocaleString();
    const ok = await confirmDialog(
      "Restore unsaved edits?",
      `PDF Studio found edits to this file from ${when} that were never saved (the app may have been closed unexpectedly).`,
      "Restore",
      "Discard",
    );
    if (!ok) {
      void clearDraft(this.fileKey);
      return;
    }
    for (const [id, im] of Object.entries(draft.images)) {
      const url = URL.createObjectURL(new Blob([im.bytes as BlobPart], { type: im.mime }));
      this.images.set(id, { ...im, url });
    }
    this.history.push(draft.state);
    toast("Edits restored.", "ok");
  }

  // ================================================================ state

  private onState(s: EditState): void {
    if (s.pages !== this.lastPages) {
      this.lastPages = s.pages;
      for (const p of this.panes) p.viewer.setPages(s.pages, true);
      this.thumbs.setPages(s.pages);
    }
    for (const p of this.panes) {
      p.viewer.redecorate();
      p.forms.refreshValues(p.viewer.mountedSlots());
    }
    this.updateChrome();
    if (this.history.dirty && this.mainDoc) {
      clearTimeout(this.draftTimer);
      this.draftTimer = window.setTimeout(() => this.writeDraftNow(), 3000);
    }
  }

  private writeDraftNow(): void {
    clearTimeout(this.draftTimer);
    if (this.mainDoc && this.history.dirty) {
      void saveDraft(this.fileKey, this.fileVersion, this.mainDoc.id, this.history.state, this.images);
    }
  }

  // ================================================================ save

  /** Returns true when saved. */
  async save(asNew: boolean, protect?: Protection): Promise<boolean> {
    if (!this.mainDoc) return false;
    for (const p of this.panes) p.overlay.commitTextEdit();
    const usedDocs = [...new Set(this.history.state.pages.map((p) => p.docId))];
    const locked = usedDocs.map((id) => (id ? this.store.docs.get(id) : undefined)).find((d) => d?.encrypted);
    if (locked && !protect) {
      // Keep the protection by default, with the password it was opened with.
      const c = await choiceDialog(
        "This PDF is password-protected",
        "Save it with the same password? (Its pages are saved as images, so text can't be selected or searched yet.)",
        ["Cancel", "Remove the password", "Keep the password"],
      );
      if (c === 0) return false;
      if (c === 2) {
        if (locked.password) protect = { userPassword: locked.password };
        else {
          const p = await protectDialog();
          if (!p) return false;
          protect = p;
        }
      }
    }
    const totalBytes = usedDocs
      .map((id) => (id ? (this.store.docs.get(id)?.source.size ?? 0) : 0))
      .reduce((a, b) => a + b, 0);
    const limit = (this.profile.isIOS ? 350 : 1500) * 1024 * 1024;
    if (totalBytes > limit) {
      const ok = await confirmDialog(
        "Very large file",
        `Saving needs to load the full ${(totalBytes / 1048576).toFixed(0)} MB into memory, which may fail on this device. Continue?`,
        "Save anyway",
      );
      if (!ok) return false;
    }
    const busy = progressOverlay("Preparing…");
    try {
      const bytes = await buildPdf(this.history.state, this.store, this.images, {
        onProgress: (l, f) => busy.update(l, f),
        protect,
      });
      busy.close();
      const name = this.mainDoc.source.name.replace(/(\.pdf)?$/i, ".pdf");
      const res = await this.platform.save(bytes, asNew ? name.replace(/\.pdf$/i, " (edited).pdf") : name, this.mainDoc.source, asNew);
      if (!res) return false;
      void clearDraft(this.fileKey);
      if (res.inPlace && res.path) {
        // The source file changed on disk: reopen it (edits are now part of it).
        const pos = this.activeViewer.position();
        const zoom = this.activeViewer.zoom;
        // Page numbers changed if pages were moved or deleted: carry the marks along.
        const mainId = this.mainDoc.id;
        const newIndex = new Map<number, number>();
        this.history.state.pages.forEach((p, i) => {
          if (p.docId === mainId && !newIndex.has(p.srcIndex)) newIndex.set(p.srcIndex, i);
        });
        this.marks.remap((srcIndex) => newIndex.get(srcIndex));
        this.history.markSaved();
        await this.closeDocument();
        await this.openSources([await NativeSource.open(res.path)]);
        this.activeViewer.setZoom(zoom);
        this.activeViewer.scrollToPosition(pos.index, pos.fy);
      } else {
        this.history.markSaved();
      }
      toast(`Saved ${res.name}${this.platform.kind === "ios" ? " to Files › On My iPhone/iPad › PDF Studio" : ""}`, "ok", 4500);
      return true;
    } catch (e) {
      busy.close();
      console.error(e);
      toast(`Save failed: ${(e as Error)?.message ?? e}`, "error", 8000);
      return false;
    }
  }

  /** Label printing mode: shipping labels cut out onto label-stock pages (see labels/labels.ts). */
  async printLabels(): Promise<void> {
    if (!this.mainDoc) return;
    for (const p of this.panes) p.overlay.commitTextEdit();
    const choice = await labelDialog();
    if (!choice) return;
    const { options } = choice;
    const busy = progressOverlay("Finding labels…");
    try {
      // The edited document, exactly as Save would write it (annotations, stamps, page changes).
      const bytes = await buildPdf(this.history.state, this.store, this.images, {
        onProgress: (_l, f) => busy.update("Preparing…", f * 0.2),
      });
      // pdf.js may take over the buffer it is given: pass it a copy.
      const task = getDocument({ data: bytes.slice(), ...pdfjsAssets } as Parameters<typeof getDocument>[0]);
      let result: { bytes: Uint8Array; count: number };
      try {
        result = await buildLabelPdf(bytes, await task.promise, options, OPS, (f) => busy.update("Making labels…", 0.2 + f * 0.4));
      } finally {
        await task.destroy();
      }
      if (!result.count) {
        busy.close();
        toast("No labels found on these pages. Try another layout.", "error", 6000);
        return;
      }
      if (choice.action === "save") {
        busy.close();
        const name = `${this.mainDoc.source.name.replace(/\.pdf$/i, "")} (labels).pdf`;
        const res = await this.platform.save(result.bytes, name, undefined, true);
        if (res) toast(`Saved ${result.count} label${result.count === 1 ? "" : "s"} to ${res.name}`, "ok", 4500);
        return;
      }
      // Lossless, at the printer's own resolution, on paper the size of the stock.
      await printPdf(result.bytes, (f) => busy.update("Rendering labels for the printer…", 0.6 + f * 0.4), new AbortController().signal, {
        dpi: options.printerDpi,
        format: "png",
        pageMm: options.stockMm,
      });
      toast(`${result.count} label${result.count === 1 ? "" : "s"} sent to the printer. Choose the label printer and its ${options.stockMm.width} × ${options.stockMm.height} mm paper, at 100% scale.`, "ok", 8000);
    } catch (e) {
      console.error(e);
      toast(`Labels failed: ${(e as Error)?.message ?? e}`, "error", 8000);
    } finally {
      busy.close();
    }
  }

  /** OCR: a searchable copy (invisible text over scanned pages), opened in a new tab. */
  async recognizeText(): Promise<void> {
    if (!this.mainDoc) return;
    const s = this.history.state;
    const sel = this.thumbs.selected;
    const o = await ocrDialog(sel.size, s.pages.length);
    if (!o) return;
    const pages =
      o.pages === "all" ? s.pages.map((_, i) => i) : o.pages === "selected" ? s.pages.flatMap((p, i) => (sel.has(p.id) ? [i] : [])) : [this.activeViewer.currentIndex];
    const busy = progressOverlay("Preparing…");
    try {
      const bytes = await buildPdf(s, this.store, this.images, { onProgress: (_l, f) => busy.update("Preparing…", f * 0.1) });
      const r = await ocrPdf(bytes, { langs: o.langs, pages, skipText: o.skipText }, (label, f) => busy.update(label, 0.1 + f * 0.9));
      busy.close();
      if (!r.recognized) return toast(`Nothing to recognize: ${r.skipped} page${r.skipped === 1 ? "" : "s"} already have text.`, "info", 6000);
      await this.openSources([new BytesSource(`${this.outputBase().base} (searchable).pdf`, r.bytes)]);
      toast(`Text recognized on ${r.recognized} page${r.recognized === 1 ? "" : "s"}. This searchable copy opened in a new tab: save it with Ctrl+S.`, "ok", 8000);
    } catch (e) {
      console.error(e);
      toast(`Text recognition failed: ${(e as Error)?.message ?? e}`, "error", 8000);
    } finally {
      busy.close();
    }
  }

  /** Save a smaller copy (pictures re-compressed in a worker). */
  async shrink(): Promise<void> {
    if (!this.mainDoc) return;
    const before = this.mainDoc.source.size;
    const level = await shrinkDialog(before / 1048576);
    if (!level) return;
    const busy = progressOverlay("Preparing…");
    try {
      const bytes = await buildPdf(this.history.state, this.store, this.images, { onProgress: (_l, f) => busy.update("Preparing…", f * 0.3) });
      const r = await shrinkInWorker(bytes, level, (f) => busy.update("Compressing pictures…", 0.3 + f * 0.7));
      busy.close();
      const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
      if (r.bytes.length >= before * 0.95) {
        return toast(`This PDF can't get much smaller (${r.images ? "its pictures are already compact" : "it has no pictures"}).`, "info", 6000);
      }
      const res = await this.platform.save(r.bytes, `${this.outputBase().base} (small).pdf`, undefined, true);
      if (res) toast(`Saved ${res.name}: ${mb(before)} → ${mb(r.bytes.length)} (${Math.round((1 - r.bytes.length / before) * 100)}% smaller).`, "ok", 7000);
    } catch (e) {
      console.error(e);
      toast(`Shrink failed: ${(e as Error)?.message ?? e}`, "error", 8000);
    } finally {
      busy.close();
    }
  }

  async openSettings(): Promise<void> {
    const viewMode = $<HTMLSelectElement>("#view-mode");
    const v = await settingsDialog({
      language: currentLanguage(),
      viewMode: viewMode.value as ViewMode,
      night: document.body.classList.contains("night-pages"),
      readRate: this.reader.rate,
    });
    if (!v) return;
    if (v.reset) {
      // Remembered choices (dialogs, layout, language...) - not documents, marks or recent files.
      for (const k of Object.keys(localStorage)) {
        if (/^pdfstudio:(labels|stamp-dialog|page-numbers|watermark|export-images|split|cut|photos|shrink|folder|viewmode|night|lang|readrate|sidebar|theme)$/.test(k)) localStorage.removeItem(k);
      }
      return toast("Remembered choices were reset.", "ok");
    }
    const save = (k: string, val: string) => {
      try {
        localStorage.setItem(k, val);
      } catch {
        /* ignore */
      }
    };
    setLanguage(v.language);
    save("pdfstudio:lang", v.language);
    if (viewMode.value !== v.viewMode) {
      viewMode.value = v.viewMode;
      viewMode.dispatchEvent(new Event("change"));
    }
    if (document.body.classList.contains("night-pages") !== v.night) this.action("nightPages");
    this.reader.rate = v.readRate;
    save("pdfstudio:readrate", String(v.readRate));
  }

  /** Pick photos/scans and make a new PDF of them (opens in a tab, unsaved). */
  async pdfFromPhotos(): Promise<void> {
    const files = await this.platform.pickImages();
    if (!files.length) return;
    const o = await photosDialog(files.length);
    if (!o) return;
    const busy = progressOverlay("Making PDF…");
    try {
      const bytes = await imagesToPdf(files, o, (f) => busy.update("Making PDF…", f));
      busy.close();
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".");
      await this.openSources([new BytesSource(`Photos ${stamp}.pdf`, bytes)]);
      toast(`PDF made from ${files.length} picture${files.length === 1 ? "" : "s"}. Save it with Ctrl+S.`, "ok", 5000);
    } catch (e) {
      console.error(e);
      toast(`Could not make the PDF: ${(e as Error)?.message ?? e}`, "error", 8000);
    } finally {
      busy.close();
    }
  }

  /** Folder search result: open that file (unless it's the open one) at that page, word highlighted. */
  private async openSearchResult(source: PdfSource, pageIndex: number, query: string): Promise<void> {
    const same = () => !!this.mainDoc && fileKeyOf(this.mainDoc.source) === fileKeyOf(source);
    if (!same()) {
      this.skipRestoreView = true; // cleared by the open, once it has placed the view
      await this.openSources([source]);
      if (!same()) {
        this.skipRestoreView = false;
        return;
      } // cancelled (unsaved changes) or failed
      // Opening restores the last reading position on the next frames; go to the result after that.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    const i = this.history.state.pages.findIndex((p) => p.docId === this.mainDoc!.id && p.srcIndex === pageIndex);
    const pane = this.activePane;
    if (i >= 0) pane.viewer.scrollToPage(i);
    pane.bar.hidden = false;
    $<HTMLInputElement>(".search-input", pane.bar).value = query;
    this.runSearch(pane, Math.max(0, i));
  }

  async print(): Promise<void> {
    if (!this.mainDoc) return;
    for (const p of this.panes) p.overlay.commitTextEdit();
    const busy = progressOverlay("Preparing to print…");
    const ac = new AbortController();
    try {
      const bytes = await buildPdf(this.history.state, this.store, this.images, {
        onProgress: (_l, f) => busy.update("Preparing to print…", f * 0.3),
      });
      await printPdf(bytes, (f) => busy.update("Rendering pages for printing…", 0.3 + f * 0.7), ac.signal);
    } catch (e) {
      toast(`Print failed: ${(e as Error).message}`, "error");
    } finally {
      busy.close();
    }
  }

  async extractSelected(): Promise<void> {
    const pages = this.selectedPages();
    if (!pages.length || !this.mainDoc) return;
    const busy = progressOverlay("Extracting pages…");
    try {
      const bytes = await buildPdf(this.history.state, this.store, this.images, {
        pages,
        onProgress: (l, f) => busy.update(l, f),
      });
      busy.close();
      const base = this.mainDoc.source.name.replace(/\.pdf$/i, "");
      const res = await this.platform.save(bytes, `${base} (pages).pdf`, undefined, true);
      if (res) toast(`Extracted ${pages.length} page(s) to ${res.name}`, "ok");
    } catch (e) {
      busy.close();
      toast(`Extract failed: ${(e as Error).message}`, "error");
    }
  }

  /** File name without .pdf, and the folder of the open file (desktop), for multi-file saves. */
  private outputBase(): { base: string; folder?: string } {
    const src = this.mainDoc!.source;
    return { base: src.name.replace(/\.pdf$/i, ""), folder: src.path?.replace(/[\\/][^\\/]*$/, "") };
  }

  /** Cut pages into pieces (vertical and/or horizontal cut by %): each piece becomes a page. */
  async cutPagesCmd(): Promise<void> {
    if (!this.mainDoc) return;
    const sel = this.thumbs.selected;
    const current = this.history.state.pages[this.activeViewer.currentIndex];
    const choice = await cutDialog(sel.size, this.history.state.pages.length, (canvas) => this.renderPreview(current, canvas, 300));
    if (!choice) return;
    const s = this.history.state;
    const refs =
      choice.pages === "all" ? s.pages : choice.pages === "selected" ? s.pages.filter((p) => sel.has(p.id)) : current ? [current] : [];
    const targets = refs.filter((p) => p.docId);
    if (!targets.length) return toast("Blank pages can't be cut.", "info");
    // Real page sizes, not the page-1 estimate used before a page was seen.
    await Promise.all(targets.filter((p) => !p.crop).map((p) => this.store.loadMeta(p.docId!, p.srcIndex)));
    const before = this.history.state.pages.length;
    this.history.push(cutPages(this.history.state, new Set(targets.map((p) => p.id)), { x: choice.x, y: choice.y }, this.geom));
    this.thumbs.clearSelection();
    toast(`Cut ${targets.length} page${targets.length === 1 ? "" : "s"}: ${before} → ${this.history.state.pages.length} pages. Undo with Ctrl+Z.`, "ok", 5000);
  }

  /** A page (as shown: cut, rotated) drawn into `canvas`, `maxW` pixels wide. */
  private async renderPreview(ref: PageRef | undefined, canvas: HTMLCanvasElement, maxW: number): Promise<void> {
    if (!ref) return;
    const page = await this.store.getPage(ref);
    if (!page) return;
    const box = this.store.viewBox(ref);
    const rotation = this.store.rotation(ref);
    const base = cropViewport(page, box, 1, rotation);
    const crop = cropViewport(page, box, Math.min(2, maxW / base.width) * Math.min(2, window.devicePixelRatio || 1), rotation);
    canvas.width = Math.max(1, Math.round(crop.width));
    canvas.height = Math.max(1, Math.round(crop.height));
    canvas.style.width = `${Math.round((canvas.width / canvas.height >= 1 ? maxW : (maxW * canvas.width) / canvas.height))}px`;
    await page.render({ canvas, viewport: crop.viewport, background: "white" } as Parameters<typeof page.render>[0]).promise;
  }

  /** Split into several PDFs (every N pages or by ranges), one file per part. */
  async splitIntoFiles(): Promise<void> {
    if (!this.mainDoc) return;
    const s = this.history.state;
    const total = s.pages.length;
    const parts = await splitDialog(total, (how) => splitParts(total, how));
    if (!parts) return;
    const { base, folder } = this.outputBase();
    const busy = progressOverlay("Preparing…");
    try {
      const bytes = await buildPdf(s, this.store, this.images, { onProgress: (_l, f) => busy.update("Preparing…", f * 0.4) });
      const outs = await splitInWorker(bytes, parts, (f) => busy.update("Splitting…", 0.4 + f * 0.5));
      const label = (p: number[]) => (p.length === 1 ? `p${p[0] + 1}` : `p${p[0] + 1}-${p[p.length - 1] + 1}`);
      async function* files() {
        for (const [k, b] of outs.entries()) yield { name: `${base} ${label(parts![k])}.pdf`, bytes: b, mime: "application/pdf" };
      }
      busy.close();
      const res = await this.platform.saveMany(files(), folder);
      if (res) toast(`Saved ${res.count} PDF file${res.count === 1 ? "" : "s"}${res.folder ? ` to ${res.folder}` : ""}.`, "ok", 5000);
    } catch (e) {
      console.error(e);
      toast(`Split failed: ${(e as Error)?.message ?? e}`, "error", 8000);
    } finally {
      busy.close();
    }
  }

  /** Export pages (current / selected / all) as PNG or JPG files. */
  async exportImages(): Promise<void> {
    if (!this.mainDoc) return;
    const s = this.history.state;
    const sel = this.thumbs.selected;
    const choice = await exportImagesDialog(sel.size, s.pages.length);
    if (!choice) return;
    const indices =
      choice.pages === "all"
        ? s.pages.map((_, i) => i)
        : choice.pages === "selected"
          ? s.pages.flatMap((p, i) => (sel.has(p.id) ? [i] : []))
          : [this.activeViewer.currentIndex];
    const { base, folder } = this.outputBase();
    const busy = progressOverlay("Preparing…");
    try {
      const bytes = await buildPdf(s, this.store, this.images, { onProgress: (_l, f) => busy.update("Preparing…", f * 0.3) });
      const ext = choice.format === "png" ? "png" : "jpg";
      const width = String(s.pages.length).length;
      const images = pagesToImages(bytes, indices, choice, (f) => busy.update("Rendering pages…", 0.3 + f * 0.7));
      async function* files() {
        for await (const { index, blob } of images) {
          yield { name: `${base} p${String(index + 1).padStart(width, "0")}.${ext}`, bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
        }
      }
      const res = await this.platform.saveMany(files(), folder);
      if (res) toast(`Saved ${res.count} image${res.count === 1 ? "" : "s"}${res.folder ? ` to ${res.folder}` : ""}.`, "ok", 5000);
    } catch (e) {
      console.error(e);
      toast(`Export failed: ${(e as Error)?.message ?? e}`, "error", 8000);
    } finally {
      busy.close();
    }
  }

  // ================================================================ page ops

  private selectedPages(): PageRef[] {
    const s = this.history.state;
    const sel = this.thumbs.selected;
    if (sel.size) return s.pages.filter((p) => sel.has(p.id));
    const cur = s.pages[this.activeViewer.currentIndex];
    return cur ? [cur] : [];
  }

  private pageOp(op: string): void {
    if (!this.mainDoc) return;
    const s = this.history.state;
    const pages = this.selectedPages();
    const ids = new Set(pages.map((p) => p.id));
    switch (op) {
      case "rotL":
        this.history.push(rotatePages(s, ids, -90));
        break;
      case "rotR":
        this.history.push(rotatePages(s, ids, 90));
        break;
      case "delete":
        if (ids.size >= s.pages.length) return toast("A PDF must keep at least one page.", "error");
        this.history.push(deletePages(s, ids));
        this.thumbs.clearSelection();
        toast(`Deleted ${ids.size} page(s). Undo with Ctrl+Z.`);
        break;
      case "up":
      case "down": {
        const first = s.pages.findIndex((p) => ids.has(p.id));
        const to = op === "up" ? Math.max(0, first - 1) : first + 1;
        this.history.push(movePages(s, ids, to));
        break;
      }
      case "blank": {
        const at = this.activeViewer.currentIndex + 1;
        const cur = s.pages[at - 1];
        const size = cur ? this.store.displaySize(cur) : { width: 612 * CSS_UNITS, height: 792 * CSS_UNITS };
        const rotated = cur ? this.store.rotation(cur) % 180 !== 0 : false;
        const w = (rotated ? size.height : size.width) / CSS_UNITS;
        const h = (rotated ? size.width : size.height) / CSS_UNITS;
        this.history.push(
          insertPages(s, at, [{ id: uid("p"), docId: null, srcIndex: 0, rotation: 0, blank: { width: w, height: h } }]),
        );
        this.activeViewer.scrollToPage(at);
        break;
      }
      case "merge":
        void this.platform.pickFiles(true).then((files) => {
          if (files.length) void this.openSources(files, "merge");
        });
        break;
      case "extract":
        void this.extractSelected();
        break;
      case "splitFiles":
        void this.splitIntoFiles();
        break;
      case "cut":
        void this.cutPagesCmd();
        break;
      case "exportImages":
        void this.exportImages();
        break;
    }
  }

  // ================================================================ tools

  setTool(t: Tool): void {
    this.tool = t;
    for (const p of this.panes) p.overlay.setTool(t);
    document.querySelectorAll<HTMLElement>("[data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === t));
  }

  private async addImage(): Promise<void> {
    if (!this.mainDoc) return;
    const file = await this.platform.pickImage();
    if (!file) return;
    const img = await this.storeImage(file);
    if (img) this.activePane.overlay.placeImage(img.id, img.img);
  }

  private async addSignature(): Promise<void> {
    if (!this.mainDoc) return;
    const blob = await signaturePad();
    if (!blob) return;
    const img = await this.storeImage(blob);
    if (img) this.activePane.overlay.placeImage(img.id, img.img, 160);
  }

  /** How a page is displayed (for placing things where the reader sees them). */
  private geom = (ref: PageRef): PageGeom => ({ viewBox: this.store.viewBox(ref), rotation: this.store.rotation(ref) });

  /** Stamp (PAID, ได้รับเงินแล้ว, company seal...): on this page to drag into place, or on every page. */
  private async addStamp(): Promise<void> {
    if (!this.mainDoc) return;
    const pick = await stampDialog(() => this.platform.pickImage());
    if (!pick) return;
    const img = await this.storeImage(pick.png);
    if (!img) return;
    if (!pick.allPages) return this.activePane.overlay.placeImage(img.id, img.img, 170);
    const s = this.history.state;
    const added = imageOnPages(s.pages, this.geom, img.id, img.img.width, img.img.height, {
      position: "bottom-right",
      widthPt: 150,
      idPrefix: STAMP_PREFIX,
    });
    this.history.push({ ...s, annotations: [...s.annotations, ...added] });
    toast(`Stamp added to ${added.length} page${added.length === 1 ? "" : "s"}. Undo (Ctrl+Z) removes them all.`, "ok", 4500);
  }

  private async addPageNumbers(): Promise<void> {
    if (!this.mainDoc) return;
    const has = this.history.state.annotations.some((a) => a.id.startsWith(PAGE_NUMBER_PREFIX));
    const o = await pageNumbersDialog(has);
    if (!o) return;
    const s = this.history.state;
    if (o === "remove") return this.history.push(replaceByPrefix(s, PAGE_NUMBER_PREFIX, []));
    const ctx = document.createElement("canvas").getContext("2d")!;
    const measure = (text: string, size: number) => {
      ctx.font = `${size}px ${TEXT_FONTS}`;
      return ctx.measureText(text).width;
    };
    this.history.push(replaceByPrefix(s, PAGE_NUMBER_PREFIX, pageNumberAnnotations(s.pages, this.geom, o, measure)));
  }

  private async addWatermark(): Promise<void> {
    if (!this.mainDoc) return;
    const has = this.history.state.annotations.some((a) => a.id.startsWith(WATERMARK_PREFIX));
    const o = await watermarkDialog(has);
    if (!o) return;
    if (o === "remove") return this.history.push(replaceByPrefix(this.history.state, WATERMARK_PREFIX, []));
    const img = await this.storeImage(await renderWatermark(o.text, o.color, o.opacity));
    if (!img) return;
    const s = this.history.state;
    // One image shared by every page: stored (and saved) once.
    const added = imageOnPages(s.pages, this.geom, img.id, img.img.width, img.img.height, {
      position: "middle-center",
      widthFraction: 0.75,
      idPrefix: WATERMARK_PREFIX,
    });
    this.history.push(replaceByPrefix(s, WATERMARK_PREFIX, added));
  }

  /** Decode, downscale huge photos (a 48 MP iPhone photo is 190 MB decoded), re-encode. */
  private async storeImage(blob: Blob): Promise<{ id: string; img: StoredImage } | null> {
    try {
      const bmp = await createImageBitmap(blob);
      const MAX = 2400;
      const k = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * k)),
        h = Math.max(1, Math.round(bmp.height * k));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      const isPng = blob.type === "image/png";
      const out = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), isPng ? "image/png" : "image/jpeg", 0.9));
      canvas.width = canvas.height = 0;
      const bytes = new Uint8Array(await out.arrayBuffer());
      const id = uid("img");
      const img: StoredImage = {
        bytes,
        mime: isPng ? "image/png" : "image/jpeg",
        width: w,
        height: h,
        url: URL.createObjectURL(out),
      };
      this.images.set(id, img);
      return { id, img };
    } catch (e) {
      toast("This image format isn't supported.", "error");
      console.warn(e);
      return null;
    }
  }

  // ================================================================ marks

  async addMark(): Promise<void> {
    const doc = this.mainDoc;
    if (!doc) return;
    const v = this.activeViewer;
    const pos = v.position();
    const ref = this.history.state.pages[pos.index];
    if (!ref || ref.docId !== doc.id) return toast("Marks can be placed on pages of the main document.", "error");
    const label = await promptText("Mark this position", `Page ${pos.index + 1}`, {
      sub: "Give it a name so you can find it again in the Marks list.",
      okLabel: "Add mark",
    });
    if (label === null) return;
    this.marks.add(ref.srcIndex, pos.fy, label.trim() || `Page ${pos.index + 1}`);
    this.showSidebarTab("marks");
    toast("Mark added.", "ok");
  }

  gotoMark(id: string): void {
    const m = this.marks.all.find((x) => x.id === id);
    if (!m || !this.mainDoc) return;
    const i = Marks.locate(m, this.history.state.pages, this.mainDoc.id);
    if (i < 0) return toast("That page was deleted.", "error");
    this.activeViewer.scrollToPosition(i, m.fy);
  }

  private renderMarks(): void {
    const list = $("#marks-list");
    list.replaceChildren();
    const doc = this.mainDoc;
    $("#marks-empty").hidden = this.marks.all.length > 0;
    for (const m of this.marks.all) {
      const i = doc ? Marks.locate(m, this.history.state.pages, doc.id) : -1;
      const li = document.createElement("li");
      li.className = "mark-item";
      li.innerHTML = `
        <button class="mark-go" title="Jump to this mark">
          <span class="mark-dot" style="background:${m.color}"></span>
          <span class="mark-label"></span>
          <span class="mark-page">${i >= 0 ? `p. ${i + 1}` : "deleted"}</span>
        </button>
        <button class="icon-btn small" data-mark-act="rename" title="Rename">✎</button>
        <button class="icon-btn small" data-mark-act="delete" title="Delete">${icon("trash")}</button>`;
      $(".mark-label", li).textContent = m.label;
      $(".mark-go", li).addEventListener("click", () => this.gotoMark(m.id));
      li.querySelector('[data-mark-act="rename"]')!.addEventListener("click", async () => {
        const label = await promptText("Rename mark", m.label);
        if (label) this.marks.update(m.id, { label });
      });
      li.querySelector('[data-mark-act="delete"]')!.addEventListener("click", () => this.marks.remove(m.id));
      list.appendChild(li);
    }
  }

  // ================================================================ outline

  private async renderOutline(): Promise<void> {
    const root = $("#outline");
    root.replaceChildren();
    const doc = this.mainDoc;
    if (!doc) return;
    const outline = await doc.pdf.getOutline().catch(() => null);
    $("#outline-empty").hidden = !!outline?.length;
    if (!outline?.length) return;
    type Node = (typeof outline)[number];
    const build = (items: Node[], depth: number): HTMLUListElement => {
      const ul = document.createElement("ul");
      for (const it of items) {
        const li = document.createElement("li");
        const row = document.createElement("div");
        row.className = "outline-row";
        if (it.items?.length) {
          const t = document.createElement("button");
          t.className = "outline-toggle";
          t.textContent = "▸";
          t.addEventListener("click", () => {
            li.classList.toggle("open");
            t.textContent = li.classList.contains("open") ? "▾" : "▸";
          });
          row.appendChild(t);
        } else {
          const sp = document.createElement("span");
          sp.className = "outline-spacer";
          row.appendChild(sp);
        }
        const a = document.createElement("button");
        a.className = "outline-link";
        a.textContent = it.title || "(untitled)";
        if (it.bold) a.style.fontWeight = "600";
        if (it.italic) a.style.fontStyle = "italic";
        a.addEventListener("click", () => void this.gotoOutline(it));
        row.appendChild(a);
        li.appendChild(row);
        if (it.items?.length) li.appendChild(build(it.items, depth + 1));
        if (depth === 0 && items.length < 12) li.classList.add("open");
        ul.appendChild(li);
      }
      return ul;
    };
    root.appendChild(build(outline, 0));
  }

  private async gotoOutline(it: { dest: string | unknown[] | null; url: string | null }): Promise<void> {
    const doc = this.mainDoc;
    if (!doc) return;
    if (it.url) return void this.platform.openExternal(it.url);
    if (!it.dest) return;
    try {
      const dest = typeof it.dest === "string" ? await doc.pdf.getDestination(it.dest) : it.dest;
      if (!dest) return;
      const index =
        typeof dest[0] === "number" ? dest[0] : await doc.pdf.getPageIndex(dest[0] as Parameters<typeof doc.pdf.getPageIndex>[0]);
      const i = this.history.state.pages.findIndex((p) => p.docId === doc.id && p.srcIndex === index);
      if (i < 0) return;
      const kind = (dest[1] as { name?: string })?.name;
      const top = kind === "XYZ" ? (dest[3] as number | null) : kind === "FitH" || kind === "FitBH" ? (dest[2] as number | null) : null;
      if (typeof top === "number") {
        const view = this.store.viewBox(this.history.state.pages[i]);
        this.activeViewer.scrollToPage(i, [typeof dest[2] === "number" && kind === "XYZ" ? (dest[2] as number) : view[0], top]);
      } else {
        this.activeViewer.scrollToPage(i);
      }
    } catch (e) {
      console.warn(e);
    }
  }

  // ================================================================ search

  private createSearchBar(): HTMLDivElement {
    const bar = document.createElement("div");
    bar.className = "searchbar";
    bar.hidden = true;
    bar.innerHTML = `
      <input class="search-input" type="search" placeholder="Find in document" aria-label="Find" />
      <label class="check small" title="Match case"><input class="search-case" type="checkbox" /> Aa</label>
      <span class="search-count muted small"></span>
      <button class="icon-btn small" data-search-act="prev" title="Previous (Shift+Enter)">${icon("up")}</button>
      <button class="icon-btn small" data-search-act="next" title="Next (Enter)">${icon("down")}</button>
      <button class="icon-btn small" data-search-act="close" title="Close">${icon("close")}</button>`;
    return bar;
  }

  private bindSearchBar(p: Pane): void {
    const input = $<HTMLInputElement>(".search-input", p.bar);
    input.addEventListener("input", () => this.runSearch(p));
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") this.stepSearch(p, e.shiftKey ? -1 : 1);
      if (e.key === "Escape") this.closeSearch(p);
    });
    $<HTMLInputElement>(".search-case", p.bar).addEventListener("change", () => this.runSearch(p));
    p.bar.addEventListener("click", (e) => {
      const act = (e.target as Element).closest<HTMLElement>("[data-search-act]")?.dataset.searchAct;
      if (act === "prev") this.stepSearch(p, -1);
      if (act === "next") this.stepSearch(p, 1);
      if (act === "close") this.closeSearch(p);
    });
  }

  /** Opens the search of the active pane (the one last clicked or scrolled). */
  openSearch(p = this.activePane): void {
    p.bar.hidden = false;
    const input = $<HTMLInputElement>(".search-input", p.bar);
    const sel = window.getSelection()?.toString().trim();
    if (sel && sel.length < 80) input.value = sel;
    input.focus();
    input.select();
    if (input.value) this.runSearch(p);
  }

  closeSearch(p = this.activePane): void {
    p.bar.hidden = true;
    clearTimeout(p.searchTimer);
    p.search.clear();
    $(".search-count", p.bar).textContent = "";
    p.viewer.redecorate();
  }

  /** Search from page `startIndex` (default: the pane's current page); hits before it come last. */
  private runSearch(p: Pane, startIndex?: number): void {
    clearTimeout(p.searchTimer);
    p.searchTimer = window.setTimeout(() => {
      const q = $<HTMLInputElement>(".search-input", p.bar).value;
      const cs = $<HTMLInputElement>(".search-case", p.bar).checked;
      void p.search.run(q, this.history.state.pages, startIndex ?? p.viewer.currentIndex, cs);
    }, 220);
  }

  private onSearchUpdate(p: Pane, done: boolean, scanned: number, total: number): void {
    const n = p.search.hits.length;
    const el = $(".search-count", p.bar);
    if (!p.search.query.trim()) el.textContent = "";
    else if (!done) el.textContent = `${n} found · searching ${Math.round((scanned / Math.max(1, total)) * 100)}%`;
    else el.textContent = n ? `${p.search.currentHit + 1} of ${n}` : "No results";
    p.viewer.redecorate();
    if (done && n && p.search.currentHit >= 0) this.showHit(p, p.search.hits[p.search.currentHit]);
  }

  private stepSearch(p: Pane, dir: 1 | -1): void {
    const hit = p.search.step(dir);
    if (!hit) return;
    $(".search-count", p.bar).textContent = `${p.search.currentHit + 1} of ${p.search.hits.length}`;
    this.showHit(p, hit);
    p.viewer.redecorate();
  }

  private showHit(p: Pane, hit: { pageIndex: number; pageId: string; rects: number[][] }): void {
    const i = this.history.state.pages.findIndex((x) => x.id === hit.pageId);
    const r = hit.rects[0];
    if (i >= 0) p.viewer.scrollToPage(i, r ? [r[0], r[1] + r[3]] : undefined);
  }

  // ================================================================ chrome

  private renderIcons(): void {
    document.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
      el.insertAdjacentHTML("afterbegin", icon(el.dataset.icon!));
    });
  }

  private bindToolbar(): void {
    document.addEventListener("click", (e) => {
      const el = (e.target as Element).closest<HTMLElement>("[data-action],[data-tool],[data-page-op]");
      if (!el || (el as HTMLButtonElement).disabled) return;
      if (el.dataset.tool) {
        const t = el.dataset.tool as Tool;
        if (t === "highlight" && this.tool === "select" && this.activePane.overlay.highlightSelection()) return;
        return this.setTool(t);
      }
      if (el.dataset.pageOp) return this.pageOp(el.dataset.pageOp);
      this.action(el.dataset.action!);
    });
    const pageInput = $<HTMLInputElement>("#page-input");
    pageInput.addEventListener("change", () => this.gotoPageInput(pageInput, this.activeViewer));
    pageInput.addEventListener("keydown", (e) => e.stopPropagation());
    $<HTMLSelectElement>("#zoom-select").addEventListener("change", (e) => {
      const v = (e.target as HTMLSelectElement).value;
      if (v === "width" || v === "page") this.activeViewer.setFit(v);
      else this.activeViewer.setZoom(parseFloat(v));
    });
    const opts = () => this.panes[0].overlay.options;
    $<HTMLInputElement>("#opt-color").addEventListener("input", (e) => {
      const c = (e.target as HTMLInputElement).value;
      opts().color = c;
      if (this.tool === "highlight") opts().highlightColor = c;
      for (const p of this.panes) p.overlay.styleSelected({ color: c });
    });
    $<HTMLSelectElement>("#opt-width").addEventListener("change", (e) => {
      const w = parseFloat((e.target as HTMLSelectElement).value);
      opts().strokeWidth = w;
      for (const p of this.panes) p.overlay.styleSelected({ strokeWidth: w });
    });
    $<HTMLSelectElement>("#opt-font").addEventListener("change", (e) => {
      const f = parseFloat((e.target as HTMLSelectElement).value);
      opts().fontSize = f;
      for (const p of this.panes) p.overlay.styleSelected({ fontSize: f });
    });
  }

  private action(a: string): void {
    if (a === "professional") return this.workbench.menu();
    if (a === "connector") return void this.connector.toggle();
    if (a === "live") return void this.live.toggle();
    if (a === "engineSettings") return void advancedSettings();
    if (a === "updates") return void updateSettings(() => this.history.dirty || this.tabs.some(t => !!t.snapshot?.dirty));
    const v = this.activeViewer;
    switch (a) {
      case "open":
        return void this.open();
      case "save":
        return void this.save(false);
      case "saveAs":
        return void this.save(true);
      case "print":
        return void this.print();
      case "labels":
        return void this.printLabels();
      case "ocr":
        return void this.recognizeText();
      case "shrink":
        return void this.shrink();
      case "settings":
        return void this.openSettings();
      case "readAloud": {
        if (this.reader.playing) return this.reader.stop();
        if (!this.reader.supported) return toast("Read aloud isn't available here.", "error");
        $('[data-action="readAloud"]').classList.add("on");
        toast("Reading aloud… click the speaker again to stop.", "info", 3500);
        return void this.reader.start(this.activeViewer.currentIndex);
      }
      case "nightPages": {
        const on = document.body.classList.toggle("night-pages");
        $('[data-action="nightPages"]').classList.toggle("on", on);
        try {
          localStorage.setItem("pdfstudio:night", on ? "1" : "0");
        } catch {
          /* ignore */
        }
        return;
      }
      case "fromPhotos":
        return void this.pdfFromPhotos();
      case "protect":
        return void protectDialog().then((p) => p && this.save(true, p));
      case "stamp":
        return void this.addStamp();
      case "pageNumbers":
        return void this.addPageNumbers();
      case "watermark":
        return void this.addWatermark();
      case "folderSearch":
        return this.showSidebarTab("folder");
      case "undo":
        return this.history.undo();
      case "redo":
        return this.history.redo();
      case "sidebar":
        document.body.classList.toggle("sidebar-hidden");
        localStorage.setItem("pdfstudio:sidebar", document.body.classList.contains("sidebar-hidden") ? "0" : "1");
        return;
      case "prev":
        return v.prev();
      case "next":
        return v.next();
      case "zoomIn":
        return v.setZoom(nextZoom(v.zoom, 1));
      case "zoomOut":
        return v.setZoom(nextZoom(v.zoom, -1));
      case "fitWidth":
        return v.setFit("width");
      case "fitPage":
        return v.setFit("page");
      case "split":
        return this.toggleSplit();
      case "search":
        return this.activePane.bar.hidden ? this.openSearch() : this.closeSearch();
      case "mark":
        return void this.addMark();
      case "image":
        return void this.addImage();
      case "signature":
        return void this.addSignature();
      case "deleteSel":
        for (const p of this.panes) p.overlay.deleteSelected();
        return;
      case "theme": {
        const cur = document.documentElement.dataset.theme;
        const dark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
        return this.applyTheme(dark ? "light" : "dark");
      }
      case "tools":
        document.body.classList.toggle("tools-open");
        return;
    }
  }

  private applyTheme(t: string | null): void {
    if (t === "light" || t === "dark") {
      document.documentElement.dataset.theme = t;
      localStorage.setItem("pdfstudio:theme", t);
    }
  }

  private bindSidebarTabs(): void {
    if (localStorage.getItem("pdfstudio:sidebar") === "0" || window.innerWidth < 760) {
      document.body.classList.add("sidebar-hidden");
    }
    document.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) =>
      b.addEventListener("click", () => this.showSidebarTab(b.dataset.tab!)),
    );
  }

  private showSidebarTab(tab: string): void {
    document.body.classList.remove("sidebar-hidden");
    document.body.classList.toggle("folder-open", tab === "folder");
    if (tab === "folder") void this.folderPanel.show();
    document.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
    document.querySelectorAll<HTMLElement>("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== tab));
  }

  private bindKeyboard(): void {
    window.addEventListener("keydown", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true], .modal")) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const v = this.activeViewer;
      if (mod) {
        const map: Record<string, () => void> = {
          o: () => void this.open(),
          p: () => void this.print(),
          l: () => void this.printLabels(),
          s: () => void this.save(e.shiftKey),
          z: () => (e.shiftKey ? this.history.redo() : this.history.undo()),
          y: () => this.history.redo(),
          f: () => (e.shiftKey ? this.action("folderSearch") : this.openSearch()),
          d: () => void this.addMark(),
          "\\": () => this.toggleSplit(),
          "=": () => v.setZoom(nextZoom(v.zoom, 1)),
          "+": () => v.setZoom(nextZoom(v.zoom, 1)),
          "-": () => v.setZoom(nextZoom(v.zoom, -1)),
          "0": () => v.setFit("width"),
        };
        if (map[k]) {
          e.preventDefault();
          map[k]();
        }
        return;
      }
      if (e.altKey) return;
      if (k === "delete" || k === "backspace") {
        if (this.panes.some((p) => p.overlay.selectedId)) {
          e.preventDefault();
          for (const p of this.panes) p.overlay.deleteSelected();
        }
        return;
      }
      if (k === "escape") {
        if (!this.activePane.bar.hidden) return this.closeSearch();
        for (const p of this.panes) p.overlay.select(null);
        return this.setTool("select");
      }
      if (k === "f3") {
        e.preventDefault();
        return this.stepSearch(this.activePane, e.shiftKey ? -1 : 1);
      }
      if (k === "home" && !e.shiftKey) return (e.preventDefault(), v.scrollToPage(0));
      if (k === "end" && !e.shiftKey) return (e.preventDefault(), v.scrollToPage(v.pageList.length - 1));
      if (k === "arrowright" && v.scroller.scrollWidth <= v.scroller.clientWidth) return v.next();
      if (k === "arrowleft" && v.scroller.scrollWidth <= v.scroller.clientWidth) return v.prev();
      const tools: Record<string, Tool> = {
        v: "select",
        h: "hand",
        t: "text",
        p: "ink",
        r: "rect",
        o: "ellipse",
        l: "line",
        a: "arrow",
        n: "note",
        u: "highlight",
      };
      if (tools[k] && this.mainDoc) this.setTool(tools[k]);
      if (k === "m" && this.mainDoc) void this.addMark();
    });
  }

  private bindDragDrop(): void {
    const dz = $("#dropzone");
    let depth = 0;
    window.addEventListener("dragenter", (e) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth++;
      dz.classList.add("show");
    });
    window.addEventListener("dragleave", () => {
      depth = Math.max(0, depth - 1);
      if (!depth) dz.classList.remove("show");
    });
    window.addEventListener("dragover", (e) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    });
    window.addEventListener("drop", async (e) => {
      depth = 0;
      dz.classList.remove("show");
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
      if (!files.length) return;
      e.preventDefault();
      const sources = files.map((f) => new FileSource(f));
      const merge = !!this.mainDoc && (e.shiftKey || (await choiceDialog("Open PDF", "Open as a new document or add its pages to this one?", ["Open", "Add pages"])) === 1);
      await this.openSources(sources, merge ? "merge" : "replace");
    });
  }

  private gotoPageInput(input: HTMLInputElement, v: Viewer): void {
    const n = parseInt(input.value, 10);
    if (Number.isFinite(n)) v.scrollToPage(Math.min(v.pageList.length, Math.max(1, n)) - 1);
    v.scroller.focus();
  }

  private updatePageIndicators(): void {
    const n = this.history.state.pages.length;
    const v = this.activeViewer;
    const input = $<HTMLInputElement>("#page-input");
    if (document.activeElement !== input) input.value = n ? String(v.currentIndex + 1) : "";
    $("#page-total").textContent = `/ ${n}`;
    const zs = $<HTMLSelectElement>("#zoom-select");
    const custom = zs.querySelector<HTMLOptionElement>("option[data-custom]")!;
    const pct = `${Math.round(v.zoom * 100)}%`;
    custom.textContent = pct;
    custom.value = String(v.zoom);
    zs.value = String(v.zoom);
    $("#status-page").textContent = n ? `Page ${v.currentIndex + 1} of ${n}` : "";
    $("#status-zoom").textContent = n ? pct : "";
    this.thumbs.setCurrent(v.currentIndex);
    this.panes.forEach((p, i) => {
      const pi = $<HTMLInputElement>(".page-input", p.head);
      if (document.activeElement !== pi) pi.value = n ? String(p.viewer.currentIndex + 1) : "";
      $(".page-total", p.head).textContent = `/ ${n}`;
      $(".pane-zoom", p.head).textContent = `${Math.round(p.viewer.zoom * 100)}%`;
      $(".pane-title", p.head).textContent = this.panes.length > 1 ? (i === 0 ? "A" : "B") : "";
    });
  }

  private updatePageOpsState(): void {
    const n = this.thumbs.selected.size;
    $("#pageops-hint").textContent = n ? `${n} selected` : "Current page";
  }

  private updateChrome(): void {
    const has = !!this.mainDoc;
    document.body.classList.toggle("has-doc", has);
    this.renderTabs();
    if (!has) this.renderRecent();
    $<HTMLButtonElement>('[data-action="undo"]').disabled = !this.history.canUndo;
    $<HTMLButtonElement>('[data-action="redo"]').disabled = !this.history.canRedo;
    document.querySelectorAll<HTMLButtonElement>("[data-needs-doc]").forEach((b) => (b.disabled = !has));
    $('[data-action="split"]').classList.toggle("on", this.panes.length > 1);
    const name = this.mainDoc?.source.name ?? "";
    $("#status-file").textContent = name ? `${this.history.dirty ? "● " : ""}${name}` : "";
    this.updatePageIndicators();
    this.updatePageOpsState();
    this.renderMarks();
  }

  /**
   * Page bitmaps changed. Updates are event-driven (no polling timer), so an
   * idle window uses no CPU; bursts are coalesced to one per frame.
   */
  private onCanvasChange(): void {
    if (this.canvasChangePending) return;
    this.canvasChangePending = true;
    requestAnimationFrame(() => {
      this.canvasChangePending = false;
      this.updateMemoryStatus();
      this.thumbs.refresh();
    });
  }

  private updateMemoryStatus(): void {
    const px = this.panes.reduce((n, p) => n + p.viewer.canvasPixels, 0);
    const mb = (px * 4) / 1048576;
    const el = $("#status-mem");
    el.textContent = this.mainDoc ? `Render memory ${mb.toFixed(0)} MB` : "";
    el.title = `Budget ${(this.profile.canvasBudgetPixels * 4 / 1048576).toFixed(0)} MB · device ~${this.profile.memoryGB} GB`;
  }

  private scheduleViewSave(): void {
    clearTimeout(this.viewSaveTimer);
    this.viewSaveTimer = window.setTimeout(() => {
      if (!this.mainDoc) return;
      const pos = this.activeViewer.position();
      const ref = this.history.state.pages[pos.index];
      if (!ref || ref.docId !== this.mainDoc.id) return;
      try {
        localStorage.setItem(
          `pdfstudio:view:${this.fileKey}`,
          JSON.stringify({ srcIndex: ref.srcIndex, fy: pos.fy, zoom: this.activeViewer.zoom, fit: this.activeViewer.fitMode }),
        );
      } catch {
        /* ignore */
      }
    }, 800);
  }

  private restoreView(): void {
    const v = this.activeViewer;
    try {
      const raw = localStorage.getItem(`pdfstudio:view:${this.fileKey}`);
      if (!raw) return v.setFit("width");
      const s = JSON.parse(raw);
      if (s.fit && s.fit !== "none") v.setFit(s.fit);
      else v.setZoom(s.zoom);
      const i = this.history.state.pages.findIndex((p) => p.docId === this.mainDoc?.id && p.srcIndex === s.srcIndex);
      if (i > 0 || s.fy > 0) v.scrollToPosition(Math.max(0, i), s.fy);
    } catch {
      v.setFit("width");
    }
  }
}
