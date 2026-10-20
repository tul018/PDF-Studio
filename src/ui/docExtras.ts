import { buttons, modal, title } from "./dialogs";

/** What the dialogs need from PDF.js's optional content config. */
interface LayerConfig extends Iterable<[string, { name: string | null; visible: boolean }]> {
  setVisibility(id: string, visible: boolean): void;
}

/**
 * View › Layers: turn the PDF's layers (optional content, e.g. a drawing's
 * dimensions or a form's background) on and off. Only the view changes;
 * saving and printing keep the file's own layer settings.
 */
export function layersDialog(config: LayerConfig, onChange: () => void): void {
  const groups = [...config];
  modal((box, close) => {
    title(box, "Layers", groups.length ? "Show or hide parts of the document. Only the view changes, not the file." : "This document has no layers.");
    const list = document.createElement("div");
    list.className = "layer-list";
    for (const [id, g] of groups) {
      const l = document.createElement("label");
      l.className = "check form-check";
      const c = document.createElement("input");
      c.type = "checkbox";
      c.checked = g.visible;
      c.addEventListener("change", () => {
        config.setVisibility(id, c.checked);
        onChange();
      });
      l.append(c, document.createTextNode(" " + (g.name || "(unnamed layer)")));
      list.append(l);
    }
    box.append(list);
    box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") close();
    });
    buttons(box, [{ label: "Close", primary: true, onClick: close }]);
  });
}

export interface Attachment {
  filename: string;
  content: Uint8Array;
}

/** View › Attachments: files embedded in the PDF, each can be saved. */
export function attachmentsDialog(files: Attachment[], save: (f: Attachment) => void): void {
  modal((box, close) => {
    title(box, "Attachments", files.length ? `${files.length} file${files.length === 1 ? "" : "s"} inside this PDF.` : "This document has no attached files.");
    const list = document.createElement("ul");
    list.className = "attach-list";
    for (const f of files) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.className = "attach-name";
      name.textContent = f.filename;
      const size = document.createElement("span");
      size.className = "muted small";
      size.textContent = f.content.length < 1024 * 1024 ? `${Math.max(1, Math.round(f.content.length / 1024))} KB` : `${(f.content.length / 1048576).toFixed(1)} MB`;
      const b = document.createElement("button");
      b.className = "btn small";
      b.textContent = "Save…";
      b.addEventListener("click", () => save(f));
      li.append(name, size, b);
      list.append(li);
    }
    box.append(list);
    box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") close();
    });
    buttons(box, [{ label: "Close", primary: true, onClick: close }]);
  });
}
