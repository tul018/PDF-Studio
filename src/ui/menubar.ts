/**
 * Classic menu bar (File, Edit, View, Tools, Settings, Help), like regular
 * desktop programs. Items are buttons carrying the same attributes as the
 * old toolbar buttons (data-action, data-page-op, data-pro...), so the app's
 * single click handler runs them and data-needs-doc disables them with no
 * document open. Menus open on click, then follow the mouse; Esc closes.
 */
export type MenuItem =
  | "-"
  | {
      label: string;
      /** e.g. { action: "save" } or { pageOp: "merge" } or { pro: "word" } or { view: "spread" } */
      run?: { action?: string; pageOp?: string; pro?: string; view?: string };
      keys?: string;
      needsDoc?: boolean;
      sub?: MenuItem[];
      /** Filled when the submenu opens (e.g. recent files). */
      dynamic?: string;
    };

export interface Menu {
  label: string;
  items?: MenuItem[];
  /** A top-level entry that is a command itself (Settings). */
  run?: { action: string };
}

export const MENUS: Menu[] = [
  {
    label: "File",
    items: [
      { label: "New PDF from photos…", run: { action: "fromPhotos" } },
      { label: "Merge PDFs…", run: { action: "mergeFiles" } },
      { label: "Open…", run: { action: "open" }, keys: "Ctrl+O" },
      { label: "Open recent", sub: [], dynamic: "recent" },
      { label: "Search a folder of PDFs…", run: { action: "folderSearch" }, keys: "Ctrl+Shift+F" },
      "-",
      { label: "Save", run: { action: "save" }, keys: "Ctrl+S", needsDoc: true },
      { label: "Save as…", run: { action: "saveAs" }, keys: "Ctrl+Shift+S", needsDoc: true },
      { label: "Save with password…", run: { action: "protect" }, needsDoc: true },
      { label: "Save smaller copy…", run: { action: "shrink" }, needsDoc: true },
      { label: "Revert to saved", run: { action: "revert" }, needsDoc: true },
      "-",
      {
        label: "Import",
        needsDoc: true,
        sub: [
          { label: "Pages from other PDF…", run: { pageOp: "merge" }, needsDoc: true },
          { label: "Image…", run: { action: "image" }, needsDoc: true },
          { label: "Blank page", run: { pageOp: "blank" }, needsDoc: true },
        ],
      },
      {
        label: "Export",
        needsDoc: true,
        sub: [
          { label: "Pages as images (PNG/JPG)…", run: { pageOp: "exportImages" }, needsDoc: true },
          { label: "Extract / split pages…", run: { pageOp: "extract" }, needsDoc: true },
          "-",
          { label: "Word document…", run: { pro: "word" }, needsDoc: true },
          { label: "Excel workbook…", run: { pro: "excel" }, needsDoc: true },
          { label: "PDF/A archive copy…", run: { pro: "archive" }, needsDoc: true },
        ],
      },
      "-",
      { label: "Print…", run: { action: "print" }, keys: "Ctrl+P", needsDoc: true },
      "-",
      { label: "Close tab", run: { action: "closeTab" }, needsDoc: true },
    ],
  },
  {
    label: "Edit",
    items: [
      { label: "Undo", run: { action: "undo" }, keys: "Ctrl+Z", needsDoc: true },
      { label: "Redo", run: { action: "redo" }, keys: "Ctrl+Y", needsDoc: true },
      "-",
      { label: "Find…", run: { action: "search" }, keys: "Ctrl+F", needsDoc: true },
      { label: "Delete selected", run: { action: "deleteSel" }, keys: "Del", needsDoc: true },
      "-",
      { label: "Stamp…", run: { action: "stamp" }, needsDoc: true },
      { label: "Page numbers…", run: { action: "pageNumbers" }, needsDoc: true },
      { label: "Watermark…", run: { action: "watermark" }, needsDoc: true },
      { label: "Headers / footers / Bates…", run: { pro: "headers" }, needsDoc: true },
      "-",
      { label: "Edit existing text…", run: { pro: "editText" }, needsDoc: true },
      { label: "Create form fields…", run: { pro: "forms" }, needsDoc: true },
      { label: "Comments…", run: { pro: "comments" }, needsDoc: true },
      { label: "Bookmarks…", run: { pro: "bookmarks" }, needsDoc: true },
      "-",
      { label: "Redact by search…", run: { pro: "redactSearch" }, needsDoc: true },
      { label: "Remove hidden information…", run: { pro: "sanitize" }, needsDoc: true },
      "-",
      {
        label: "Pages",
        needsDoc: true,
        sub: [
          { label: "Rotate left", run: { pageOp: "rotL" }, needsDoc: true },
          { label: "Rotate right", run: { pageOp: "rotR" }, needsDoc: true },
          { label: "Move to page…", run: { pageOp: "moveTo" }, needsDoc: true },
          { label: "Cut pages…", run: { pageOp: "cut" }, needsDoc: true },
          { label: "Page labels…", run: { pageOp: "labels" }, needsDoc: true },
          { label: "Crop pages", run: { action: "cropTool" }, needsDoc: true },
          { label: "Remove crop", run: { pageOp: "uncrop" }, needsDoc: true },
          "-",
          { label: "Copy pages", run: { pageOp: "copy" }, keys: "Ctrl+C", needsDoc: true },
          { label: "Cut pages to paste", run: { pageOp: "cutClip" }, keys: "Ctrl+X", needsDoc: true },
          { label: "Paste pages", run: { pageOp: "paste" }, keys: "Ctrl+V", needsDoc: true },
          "-",
          { label: "Delete pages", run: { pageOp: "delete" }, needsDoc: true },
        ],
      },
    ],
  },
  {
    label: "View",
    items: [
      { label: "Sidebar", run: { action: "sidebar" }, needsDoc: true },
      "-",
      { label: "Scroll", run: { view: "continuous" }, needsDoc: true },
      { label: "One page", run: { view: "single" }, needsDoc: true },
      { label: "Two pages", run: { view: "spread" }, needsDoc: true },
      "-",
      { label: "Zoom in", run: { action: "zoomIn" }, keys: "Ctrl++", needsDoc: true },
      { label: "Zoom out", run: { action: "zoomOut" }, keys: "Ctrl+-", needsDoc: true },
      { label: "Fit width", run: { action: "fitWidth" }, keys: "Ctrl+0", needsDoc: true },
      { label: "Fit page", run: { action: "fitPage" }, needsDoc: true },
      "-",
      { label: "Split view", run: { action: "split" }, keys: "Ctrl+\\", needsDoc: true },
      { label: "Compare with another PDF…", run: { pro: "compare" }, needsDoc: true },
      "-",
      { label: "Night reading", run: { action: "nightPages" }, needsDoc: true },
      "-",
      { label: "Read aloud", run: { action: "readAloud" }, needsDoc: true },
      { label: "Mark this position", run: { action: "mark" }, keys: "Ctrl+D", needsDoc: true },
    ],
  },
  {
    label: "Tools",
    items: [
      { label: "Recognize text (OCR)…", run: { action: "ocr" }, needsDoc: true },
      { label: "Measure distance / area…", run: { pro: "measure" }, needsDoc: true },
      { label: "Find QR codes", run: { pro: "qr" }, needsDoc: true },
      { label: "Add QR code…", run: { pro: "qrStamp" }, needsDoc: true },
      { label: "Certificate signature…", run: { pro: "certificate" }, needsDoc: true },
      { label: "Batch actions…", run: { pro: "batch" } },
      { label: "All professional tools…", run: { action: "professional" } },
      "-",
      { label: "Work together live…", run: { action: "live" } },
      { label: "Connect Claude…", run: { action: "connector" } },
      "-",
      { label: "PDF engine settings…", run: { action: "engineSettings" } },
    ],
  },
  { label: "Settings", run: { action: "settings" } },
  {
    label: "Help",
    items: [
      { label: "Find a command…", run: { action: "palette" }, keys: "Ctrl+K" },
      { label: "Keyboard shortcuts", run: { action: "shortcuts" } },
      { label: "Check for updates…", run: { action: "updates" } },
      "-",
      { label: "About PDF Studio & credits", run: { action: "about" } },
    ],
  },
];

function itemEl(it: MenuItem, dyn: (name: string) => MenuItem[]): HTMLElement {
  if (it === "-") {
    const hr = document.createElement("div");
    hr.className = "menu-sep";
    hr.setAttribute("role", "separator");
    return hr;
  }
  const b = document.createElement("button");
  b.className = "menu-item";
  b.setAttribute("role", "menuitem");
  const label = document.createElement("span");
  label.className = "menu-label";
  label.textContent = it.label;
  b.dataset.label = it.label; // English name, for the command palette
  b.appendChild(label);
  if (it.run?.action) b.dataset.action = it.run.action;
  if (it.run?.pageOp) b.dataset.pageOp = it.run.pageOp;
  if (it.run?.pro) b.dataset.pro = it.run.pro;
  if (it.run?.view) b.dataset.view = it.run.view;
  if (it.needsDoc) b.dataset.needsDoc = "";
  if (it.keys) {
    const k = document.createElement("span");
    k.className = "menu-keys";
    k.textContent = it.keys;
    b.appendChild(k);
  }
  if (it.sub) {
    b.classList.add("has-sub");
    b.setAttribute("aria-haspopup", "true");
    const list = document.createElement("div");
    list.className = "menu-list submenu";
    list.setAttribute("role", "menu");
    const fill = () => list.replaceChildren(...(it.dynamic ? dyn(it.dynamic) : it.sub!).map((x) => itemEl(x, dyn)));
    fill();
    const wrap = document.createElement("div");
    wrap.className = "menu-subwrap";
    wrap.append(b, list);
    wrap.addEventListener("mouseenter", () => {
      if (it.dynamic) fill();
      wrap.classList.add("open");
    });
    wrap.addEventListener("mouseleave", () => wrap.classList.remove("open"));
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (it.dynamic) fill();
      wrap.classList.toggle("open");
    });
    return wrap;
  }
  return b;
}

/** Build the menu bar into `host`; `dynamic` supplies changing submenus (recent files). */
export function buildMenuBar(host: HTMLElement, dynamic: (name: string) => MenuItem[]): void {
  const bar = document.createElement("nav");
  bar.className = "menubar";
  bar.setAttribute("role", "menubar");
  let openMenu: HTMLElement | null = null;
  const close = () => {
    openMenu?.classList.remove("open");
    openMenu = null;
  };
  for (const m of MENUS) {
    const wrap = document.createElement("div");
    wrap.className = "menu";
    const top = document.createElement("button");
    top.className = "menu-top";
    top.textContent = m.label;
    top.dataset.menu = m.label;
    wrap.appendChild(top);
    if (m.run) {
      top.dataset.action = m.run.action;
      top.addEventListener("click", close);
    } else {
      top.setAttribute("aria-haspopup", "true");
      const list = document.createElement("div");
      list.className = "menu-list";
      list.setAttribute("role", "menu");
      list.append(...m.items!.map((x) => itemEl(x, dynamic)));
      wrap.appendChild(list);
      top.addEventListener("click", (e) => {
        e.stopPropagation();
        const was = openMenu === wrap;
        close();
        if (!was) {
          wrap.classList.add("open");
          openMenu = wrap;
        }
      });
      // Like real menus: once one is open, hovering another switches to it.
      top.addEventListener("mouseenter", () => {
        if (openMenu && openMenu !== wrap) {
          close();
          wrap.classList.add("open");
          openMenu = wrap;
        }
      });
      // Choosing an item closes the menu (the app's click handler runs it).
      list.addEventListener("click", (e) => {
        const item = (e.target as Element).closest(".menu-item");
        if (item && !item.classList.contains("has-sub") && !(item as HTMLButtonElement).disabled) close();
      });
    }
    bar.appendChild(wrap);
  }
  document.addEventListener("click", (e) => {
    if (openMenu && !openMenu.contains(e.target as Node)) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openMenu) {
      close();
      e.stopPropagation();
    }
  }, true);
  host.prepend(bar);
}
