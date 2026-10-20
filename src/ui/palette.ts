/**
 * Command palette (Ctrl+K): type a few letters of any menu command and press
 * Enter. Commands come from the menu bar itself, so the palette always offers
 * exactly what the menus do, in the current language (English names match too).
 * Choosing one clicks its menu item, so the app runs it the usual way.
 */
interface Command {
  el: HTMLElement;
  label: string;
  path: string;
  keys: string;
  /** Lower-case text the search matches: translated and English names. */
  hay: string;
}

function commands(): Command[] {
  const out: Command[] = [];
  const items = document.querySelectorAll<HTMLElement>(".menubar .menu-item:not(.has-sub), .menubar .menu-top[data-action]");
  for (const el of items) {
    if ((el as HTMLButtonElement).disabled || !(el.dataset.action || el.dataset.pageOp || el.dataset.pro || el.dataset.view)) continue;
    const label = (el.querySelector(".menu-label")?.textContent ?? el.textContent ?? "").trim();
    // The menus above it, outermost first (File › Import).
    const heads: HTMLElement[] = [];
    for (let w = el.parentElement?.closest<HTMLElement>(".menu-subwrap"); w; w = w.parentElement?.closest<HTMLElement>(".menu-subwrap") ?? null) {
      const h = w.querySelector<HTMLElement>(":scope > .menu-item");
      if (h && h !== el) heads.unshift(h);
    }
    const path = heads.map((h) => h.querySelector(".menu-label")?.textContent ?? "").filter(Boolean).join(" › ");
    const english = [...heads.map((h) => h.dataset.menu ?? ""), el.dataset.label ?? ""].join(" ");
    out.push({ el, label, path, keys: el.querySelector(".menu-keys")?.textContent ?? "", hay: `${label} ${path} ${english}`.toLowerCase() });
  }
  return out;
}

/** Every word typed must appear somewhere; earlier matches in the name rank first. */
function rank(list: Command[], q: string): Command[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list
    .filter((c) => words.every((w) => c.hay.includes(w)))
    .map((c) => ({ c, at: c.label.toLowerCase().indexOf(words[0]) }))
    .sort((a, b) => (a.at < 0 ? 999 : a.at) - (b.at < 0 ? 999 : b.at))
    .map((x) => x.c);
}

let open: HTMLElement | null = null;

export function openPalette(): void {
  if (open) return;
  const all = commands();
  const root = document.createElement("div");
  root.className = "palette-backdrop";
  root.innerHTML = `<div class="palette" role="dialog" aria-label="Commands">
    <input class="palette-input" type="text" placeholder="Type a command…" aria-label="Type a command" />
    <div class="palette-list" role="listbox"></div></div>`;
  const input = root.querySelector<HTMLInputElement>(".palette-input")!;
  const listEl = root.querySelector<HTMLElement>(".palette-list")!;
  let shown: Command[] = [];
  let sel = 0;

  const close = () => {
    root.remove();
    open = null;
  };
  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    c.el.click();
  };
  const draw = () => {
    shown = rank(all, input.value).slice(0, 50);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    listEl.replaceChildren(
      ...shown.map((c, i) => {
        const row = document.createElement("button");
        row.className = "palette-item" + (i === sel ? " active" : "");
        row.setAttribute("role", "option");
        row.innerHTML = `<span class="palette-label"></span><span class="palette-path"></span><span class="palette-keys"></span>`;
        row.children[0].textContent = c.label;
        row.children[1].textContent = c.path;
        row.children[2].textContent = c.keys;
        row.addEventListener("click", () => run(c));
        row.addEventListener("mousemove", () => {
          if (sel !== i) {
            sel = i;
            draw();
          }
        });
        return row;
      }),
    );
    if (!shown.length) {
      const none = document.createElement("div");
      none.className = "palette-none muted";
      none.textContent = "No matching command";
      listEl.append(none);
    }
    listEl.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  };

  input.addEventListener("input", () => {
    sel = 0;
    draw();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length) sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % shown.length;
      draw();
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(shown[sel]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });
  root.addEventListener("mousedown", (e) => {
    if (e.target === root) close();
  });
  document.body.append(root);
  open = root;
  draw();
  input.focus();
}
