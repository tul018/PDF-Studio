/** Small, dependency-free modal dialogs that work with mouse, touch and keyboard. */

export function modal(build: (box: HTMLDivElement, close: () => void) => void): () => void {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  const box = document.createElement("div");
  box.className = "modal";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  backdrop.appendChild(box);
  const close = () => backdrop.remove();
  build(box, close);
  document.body.appendChild(backdrop);
  return close;
}

export function buttons(box: HTMLElement, defs: { label: string; primary?: boolean; onClick: () => void }[]): HTMLButtonElement[] {
  const row = document.createElement("div");
  row.className = "modal-actions";
  const out = defs.map((d) => {
    const b = document.createElement("button");
    b.textContent = d.label;
    b.className = d.primary ? "btn primary" : "btn";
    b.addEventListener("click", d.onClick);
    row.appendChild(b);
    return b;
  });
  box.appendChild(row);
  return out;
}

export function title(box: HTMLElement, text: string, sub?: string): void {
  const h = document.createElement("h2");
  h.textContent = text;
  box.appendChild(h);
  if (sub) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = sub;
    box.appendChild(p);
  }
}

export function promptText(
  heading: string,
  initial = "",
  opts: { multiline?: boolean; placeholder?: string; okLabel?: string; password?: boolean; sub?: string } = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    modal((box, close) => {
      title(box, heading, opts.sub);
      const input = opts.multiline ? document.createElement("textarea") : document.createElement("input");
      input.className = "modal-input";
      input.value = initial;
      if (opts.placeholder) input.placeholder = opts.placeholder;
      if (opts.password && input instanceof HTMLInputElement) input.type = "password";
      box.appendChild(input);
      const done = (v: string | null) => {
        close();
        resolve(v);
      };
      buttons(box, [
        { label: "Cancel", onClick: () => done(null) },
        { label: opts.okLabel ?? "OK", primary: true, onClick: () => done(input.value) },
      ]);
      input.addEventListener("keydown", (ev) => {
        const e = ev as KeyboardEvent;
        e.stopPropagation();
        if (e.key === "Escape") done(null);
        if (e.key === "Enter" && (!opts.multiline || e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          done(input.value);
        }
      });
      requestAnimationFrame(() => {
        input.focus();
        if (input instanceof HTMLInputElement) input.select();
      });
    });
  });
}

export function confirmDialog(heading: string, sub: string, ok = "OK", cancel = "Cancel"): Promise<boolean> {
  return new Promise((resolve) => {
    modal((box, close) => {
      title(box, heading, sub);
      const [, okBtn] = buttons(box, [
        { label: cancel, onClick: () => (close(), resolve(false)) },
        { label: ok, primary: true, onClick: () => (close(), resolve(true)) },
      ]);
      requestAnimationFrame(() => okBtn.focus());
    });
  });
}

/** Choice among several actions; resolves with the index or -1. */
export function choiceDialog(heading: string, sub: string, labels: string[]): Promise<number> {
  return new Promise((resolve) => {
    modal((box, close) => {
      title(box, heading, sub);
      buttons(
        box,
        labels.map((label, i) => ({ label, primary: i === labels.length - 1, onClick: () => (close(), resolve(i)) })),
      );
    });
  });
}

const SIG_KEY = "pdfstudio:signature";

/**
 * Signature pad. Pressure-aware for Apple Pencil / Windows Ink pens. The
 * result is a trimmed transparent PNG. The last signature is remembered
 * locally (opt-in) for one-tap reuse.
 */
export function signaturePad(): Promise<Blob | null> {
  return new Promise((resolve) => {
    modal((box, close) => {
      title(box, "Signature", "Draw with your finger, pen or mouse.");
      const saved = safeGet(SIG_KEY);
      if (saved) {
        const reuse = document.createElement("button");
        reuse.className = "btn sig-reuse";
        const img = document.createElement("img");
        img.src = saved;
        img.alt = "Saved signature";
        reuse.append(img, document.createTextNode("Use saved signature"));
        reuse.addEventListener("click", async () => {
          close();
          resolve(await (await fetch(saved)).blob());
        });
        box.appendChild(reuse);
      }
      const canvas = document.createElement("canvas");
      canvas.className = "sig-canvas";
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.min(560, window.innerWidth - 64),
        H = 200;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      box.appendChild(canvas);
      const ctx = canvas.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.strokeStyle = "#0d1b4c";
      let drawing = false,
        lx = 0,
        ly = 0,
        any = false;
      canvas.addEventListener("pointerdown", (e) => {
        drawing = true;
        canvas.setPointerCapture(e.pointerId);
        const r = canvas.getBoundingClientRect();
        lx = e.clientX - r.left;
        ly = e.clientY - r.top;
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!drawing) return;
        const r = canvas.getBoundingClientRect();
        for (const ev of e.getCoalescedEvents?.() ?? [e]) {
          const x = ev.clientX - r.left,
            y = ev.clientY - r.top;
          const p = ev.pointerType === "pen" && ev.pressure > 0 ? ev.pressure : 0.5;
          ctx.lineWidth = 1.2 + p * 2.8;
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(x, y);
          ctx.stroke();
          lx = x;
          ly = y;
          any = true;
        }
      });
      canvas.addEventListener("pointerup", () => (drawing = false));
      const remember = document.createElement("label");
      remember.className = "check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      remember.append(cb, document.createTextNode(" Remember on this device"));
      box.appendChild(remember);
      buttons(box, [
        {
          label: "Clear",
          onClick: () => {
            ctx.clearRect(0, 0, W, H);
            any = false;
          },
        },
        { label: "Cancel", onClick: () => (close(), resolve(null)) },
        {
          label: "Place signature",
          primary: true,
          onClick: async () => {
            if (!any) return;
            const trimmed = trimCanvas(canvas);
            const blob = await new Promise<Blob | null>((r) => trimmed.toBlob(r, "image/png"));
            if (blob && cb.checked) safeSet(SIG_KEY, trimmed.toDataURL("image/png"));
            close();
            resolve(blob);
          },
        },
      ]);
    });
  });
}

function trimCanvas(c: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = c.getContext("2d")!;
  const { width, height } = c;
  const data = ctx.getImageData(0, 0, width, height).data;
  let x0 = width,
    y0 = height,
    x1 = 0,
    y1 = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  const pad = 6;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement("canvas");
  out.width = Math.max(1, x1 - x0 + 1);
  out.height = Math.max(1, y1 - y0 + 1);
  out.getContext("2d")!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function safeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

let toastTimer = 0;
export function toast(msg: string, kind: "info" | "error" | "ok" = "info", ms = 3200): void {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove("show"), ms);
}

export function progressOverlay(label: string): { update: (label: string, f: number) => void; close: () => void } {
  let bar!: HTMLDivElement, text!: HTMLParagraphElement;
  const close = modal((box) => {
    box.classList.add("progress-modal");
    text = document.createElement("p");
    text.textContent = label;
    const track = document.createElement("div");
    track.className = "progress-track";
    bar = document.createElement("div");
    bar.className = "progress-bar";
    track.appendChild(bar);
    box.append(text, track);
  });
  return {
    update: (l, f) => {
      text.textContent = l;
      bar.style.width = `${Math.round(Math.min(1, Math.max(0, f)) * 100)}%`;
    },
    close,
  };
}
