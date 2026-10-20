import { updateAnnotation, removeAnnotations, type Annotation, type EditState, type NoteAnnot } from "../edit/model";

/**
 * Sidebar › Comments: every comment in page order, with its replies. Filter
 * open / done, reply, mark done, delete; clicking one jumps to it. The name
 * typed at the top goes on new comments and replies.
 */
export interface CommentsDeps {
  state(): EditState;
  push(s: EditState): void;
  /** 1-based page number of a page id (0 if gone). */
  pageNumber(pageId: string): number;
  goTo(a: NoteAnnot): void;
  askText(title: string, initial: string): Promise<string | null>;
  setAuthor(name: string): void;
}

const AUTHOR_KEY = "pdfstudio:author";

export function savedAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR_KEY) ?? "";
  } catch {
    return "";
  }
}

type Filter = "all" | "open" | "done";

export class CommentsPanel {
  private filter: Filter = "all";
  private list: HTMLElement;
  private empty: HTMLElement;

  constructor(
    root: HTMLElement,
    private deps: CommentsDeps,
  ) {
    root.innerHTML = `
      <label class="comments-author small">Your name <input type="text" class="comments-name" placeholder="Shown on your comments" /></label>
      <div class="comments-filter" role="radiogroup" aria-label="Show">
        <button data-filter="all" class="on">All</button><button data-filter="open">Open</button><button data-filter="done">Done</button>
      </div>
      <ul class="comments-list"></ul>
      <p class="muted empty-note comments-empty">No comments. Use the Comment tool (N) and click on the page.</p>`;
    this.list = root.querySelector(".comments-list")!;
    this.empty = root.querySelector(".comments-empty")!;
    const name = root.querySelector<HTMLInputElement>(".comments-name")!;
    name.value = savedAuthor();
    deps.setAuthor(name.value);
    name.addEventListener("change", () => {
      const v = name.value.trim();
      try {
        localStorage.setItem(AUTHOR_KEY, v);
      } catch {
        /* private mode */
      }
      deps.setAuthor(v);
    });
    root.querySelectorAll<HTMLElement>("[data-filter]").forEach((b) =>
      b.addEventListener("click", () => {
        this.filter = b.dataset.filter as Filter;
        root.querySelectorAll("[data-filter]").forEach((x) => x.classList.toggle("on", x === b));
        this.render();
      }),
    );
  }

  /** Comments in page order, then top to bottom. */
  private notes(): NoteAnnot[] {
    const notes = this.deps.state().annotations.filter((a): a is NoteAnnot => a.type === "note");
    return notes
      .map((a) => ({ a, n: this.deps.pageNumber(a.pageId) }))
      .filter((x) => x.n > 0)
      .sort((p, q) => p.n - q.n || q.a.y - p.a.y)
      .map((x) => x.a);
  }

  render(): void {
    const all = this.notes();
    const shown = all.filter((a) => this.filter === "all" || (this.filter === "done") === !!a.done);
    this.empty.hidden = all.length > 0;
    this.list.replaceChildren(...shown.map((a) => this.item(a)));
  }

  private item(a: NoteAnnot): HTMLElement {
    const li = document.createElement("li");
    li.className = "comment-item" + (a.done ? " done" : "");
    li.dataset.id = a.id;
    const head = document.createElement("div");
    head.className = "comment-head small muted";
    head.textContent = [`p. ${this.deps.pageNumber(a.pageId)}`, a.author || "", a.at ? when(a.at) : ""].filter(Boolean).join(" · ");
    const body = document.createElement("div");
    body.className = "comment-text";
    body.textContent = a.text;
    li.append(head, body);
    for (const r of a.replies ?? []) {
      const rep = document.createElement("div");
      rep.className = "comment-reply";
      const who = document.createElement("span");
      who.className = "small muted";
      who.textContent = [r.author, when(r.at)].filter(Boolean).join(" · ");
      const t = document.createElement("div");
      t.textContent = r.text;
      rep.append(who, t);
      li.append(rep);
    }
    const acts = document.createElement("div");
    acts.className = "comment-acts";
    const btn = (label: string, fn: () => void) => {
      const b = document.createElement("button");
      b.className = "btn small";
      b.textContent = label;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        fn();
      });
      acts.append(b);
    };
    btn("Reply", () => void this.reply(a));
    btn(a.done ? "Reopen" : "Done", () => this.deps.push(updateAnnotation(this.deps.state(), a.id, { done: !a.done } as Partial<Annotation>)));
    btn("Delete", () => this.deps.push(removeAnnotations(this.deps.state(), new Set([a.id]))));
    li.append(acts);
    li.addEventListener("click", () => this.deps.goTo(a));
    return li;
  }

  private async reply(a: NoteAnnot): Promise<void> {
    const text = (await this.deps.askText("Reply", ""))?.trim();
    if (!text) return;
    const cur = this.deps.state().annotations.find((x) => x.id === a.id) as NoteAnnot | undefined;
    if (!cur) return;
    const replies = [...(cur.replies ?? []), { author: savedAuthor(), text, at: Date.now() }];
    this.deps.push(updateAnnotation(this.deps.state(), a.id, { replies } as Partial<Annotation>));
  }
}

function when(t: number): string {
  const d = new Date(t);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString();
}
