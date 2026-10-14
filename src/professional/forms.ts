import { modal, title, buttons } from "../ui/dialogs";
export interface InputSpec { key: string; label: string; value?: string; type?: string; options?: string[]; multiline?: boolean }
export function formDialog(heading: string, description: string, specs: InputSpec[], submit = "Apply"): Promise<Record<string, string> | null> {
  return new Promise(resolve => modal((box, close) => {
    title(box, heading, description);
    const form = document.createElement("form"); box.append(form);
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
    for (const s of specs) {
      const label = document.createElement("label"); label.className = "pro-field"; label.append(document.createTextNode(s.label));
      const input = s.options ? document.createElement("select") : s.multiline ? document.createElement("textarea") : document.createElement("input");
      if (input instanceof HTMLSelectElement) for (const o of s.options!) input.add(new Option(o, o));
      if (input instanceof HTMLInputElement) input.type = s.type || "text";
      input.className = "modal-input"; input.setAttribute("aria-label", s.label); input.value = s.value ?? s.options?.[0] ?? "";
      label.append(input); form.append(label); inputs.set(s.key, input);
    }
    const done = () => { if (!form.reportValidity()) return; const values = Object.fromEntries([...inputs].map(([k,v]) => [k,v.value])); close(); resolve(values); };
    form.addEventListener("submit", e => { e.preventDefault(); done(); });
    box.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape") { close(); resolve(null); } });
    buttons(box, [{ label: "Cancel", onClick: () => { close(); resolve(null); } }, { label: submit, primary: true, onClick: done }]);
    requestAnimationFrame(() => inputs.values().next().value?.focus());
  }));
}
