import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFObjectCopier,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFObject,
} from "pdf-lib";

/**
 * Document-level structure for saves that rebuild the file (delete, reorder,
 * insert, merge, redact). pdf-lib's copyPages only copies pages, so without
 * this the bookmarks, title/author and attachments are silently lost.
 *
 * It also closes a redaction leak: a link pointing at another page makes
 * copyPages drag that whole page (content streams included) into the output,
 * even when the page itself was deleted or redacted. Links are detached from
 * page objects before copying and re-pointed afterwards, and anything
 * unreachable is pruned before writing.
 */

/** (docId, source page index) -> page in the output, or undefined if it was deleted. */
export type PageTarget = (docId: string, srcIndex: number) => PDFRef | undefined;

const N = (s: string) => PDFName.of(s);

function text(o: PDFObject | undefined): string | undefined {
  if (o instanceof PDFString || o instanceof PDFHexString) return o.decodeText();
  if (o instanceof PDFName) return o.decodeText();
  return undefined;
}

/** Named destinations of a document: catalog /Dests (PDF 1.1) and the /Names /Dests tree. */
function namedDests(doc: PDFDocument): Map<string, PDFObject> {
  const out = new Map<string, PDFObject>();
  const ctx = doc.context;
  const old = doc.catalog.lookupMaybe(N("Dests"), PDFDict);
  if (old) for (const [k, v] of old.entries()) out.set(k.decodeText(), v);
  const walk = (node: PDFDict | undefined, depth: number) => {
    if (!node || depth > 32) return;
    const names = node.lookupMaybe(N("Names"), PDFArray);
    if (names) {
      for (let i = 0; i + 1 < names.size(); i += 2) {
        const key = text(names.lookup(i));
        if (key !== undefined && !out.has(key)) out.set(key, names.get(i + 1));
      }
    }
    const kids = node.lookupMaybe(N("Kids"), PDFArray);
    if (kids) for (let i = 0; i < kids.size(); i++) walk(ctx.lookupMaybe(kids.get(i), PDFDict), depth + 1);
  };
  walk(doc.catalog.lookupMaybe(N("Names"), PDFDict)?.lookupMaybe(N("Dests"), PDFDict), 0);
  return out;
}

/** Resolve a destination (array, name, string or {D: ...}) to an explicit array. */
function explicitDest(doc: PDFDocument, dest: PDFObject | undefined, names: Map<string, PDFObject>): PDFArray | undefined {
  for (let hop = 0; hop < 4 && dest; hop++) {
    const v = doc.context.lookup(dest);
    if (v instanceof PDFArray) return v;
    if (v instanceof PDFDict) dest = v.get(N("D"));
    else {
      const key = text(v);
      dest = key === undefined ? undefined : names.get(key);
    }
  }
  return undefined;
}

/** Only keep the view parameters (/XYZ left top zoom, /Fit...) - never references. */
function viewParams(dest: PDFArray): PDFObject[] {
  const rest = dest.asArray().slice(1);
  return rest.every((o) => o instanceof PDFName || o instanceof PDFNumber || o === PDFNull) ? rest : [N("Fit")];
}

/**
 * Run on each SOURCE document before copyPages: replace page references in
 * link annotations by the page index (a number), resolve named destinations,
 * and drop annotation /P and article-thread back-pointers. Nothing then leads
 * from a copied page to any other page.
 *
 * Annotations on pages that are NOT copied as-is (deleted or redacted) are
 * emptied: a form field shared across pages would otherwise reach them
 * through its /Kids and carry their appearance into the file.
 */
export function detachPageLinks(doc: PDFDocument, kept: ReadonlySet<number>): void {
  const pages = doc.getPages();
  const index = new Map(pages.map((p, i) => [p.ref.tag, i]));
  const names = namedDests(doc);
  const detach = (holder: PDFDict, key: string) => {
    const raw = holder.get(N(key));
    if (!raw) return;
    const dest = explicitDest(doc, raw, names);
    const target = dest?.get(0);
    const i = target instanceof PDFRef ? index.get(target.tag) : undefined;
    if (dest && i !== undefined) {
      holder.set(N(key), doc.context.obj([PDFNumber.of(i), ...viewParams(dest)]));
    } else {
      holder.delete(N(key)); // unresolvable: keep the annotation, drop the jump
    }
  };
  pages.forEach((page, pi) => {
    page.node.delete(N("B"));
    const annots = page.node.lookupMaybe(N("Annots"), PDFArray);
    if (!annots) return;
    for (let k = 0; k < annots.size(); k++) {
      const a = annots.lookupMaybe(k, PDFDict);
      if (!a) continue;
      if (!kept.has(pi)) {
        for (const key of a.keys()) if (key !== N("Type")) a.delete(key);
        continue;
      }
      a.delete(N("P"));
      detach(a, "Dest");
      const action = a.lookupMaybe(N("A"), PDFDict);
      if (action?.lookup(N("S")) === N("GoTo")) detach(action, "D");
    }
  });
}

/** Run on each copied OUTPUT page: point the detached links at their new pages. */
export function relinkPage(out: PDFDocument, page: PDFRef, docId: string, target: PageTarget): void {
  const node = out.context.lookupMaybe(page, PDFDict);
  const annots = node?.lookupMaybe(N("Annots"), PDFArray);
  if (!annots) return;
  const relink = (holder: PDFDict, key: string): boolean => {
    const dest = holder.lookupMaybe(N(key), PDFArray);
    const i = dest?.get(0);
    if (!dest || !(i instanceof PDFNumber)) return false;
    const ref = target(docId, i.asNumber());
    if (ref) holder.set(N(key), out.context.obj([ref, ...dest.asArray().slice(1)]));
    else holder.delete(N(key));
    return !ref;
  };
  for (let k = 0; k < annots.size(); k++) {
    const a = annots.lookupMaybe(k, PDFDict);
    if (!a) continue;
    a.set(N("P"), page);
    relink(a, "Dest");
    const action = a.lookupMaybe(N("A"), PDFDict);
    if (action?.lookup(N("S")) === N("GoTo") && relink(action, "D")) a.delete(N("A"));
  }
}

interface OutlineNode {
  title: string;
  dest?: PDFObject[]; // [pageRef, ...view]
  uri?: PDFObject;
  open: boolean;
  color?: PDFObject;
  flags?: PDFObject;
  children: OutlineNode[];
}

/** Read a source outline, keeping only entries whose page survived (or that have surviving children). */
function readOutline(doc: PDFDocument, docId: string, target: PageTarget): OutlineNode[] {
  const ctx = doc.context;
  const pageIndex = new Map(doc.getPages().map((p, i) => [p.ref.tag, i]));
  const names = namedDests(doc);
  const seen = new Set<PDFDict>();
  const level = (first: PDFObject | undefined, depth: number): OutlineNode[] => {
    const items: OutlineNode[] = [];
    let cur = first ? ctx.lookupMaybe(first, PDFDict) : undefined;
    while (cur && !seen.has(cur) && depth < 64) {
      seen.add(cur);
      const children = level(cur.get(N("First")), depth + 1);
      const action = cur.lookupMaybe(N("A"), PDFDict);
      const kind = action?.lookup(N("S"));
      const dest = explicitDest(doc, cur.get(N("Dest")) ?? (kind === N("GoTo") ? action!.get(N("D")) : undefined), names);
      const p = dest?.get(0);
      const idx = p instanceof PDFRef ? pageIndex.get(p.tag) : undefined;
      const ref = idx !== undefined ? target(docId, idx) : undefined;
      const uri = kind === N("URI") ? action!.lookup(N("URI")) : undefined;
      const node: OutlineNode = {
        title: text(cur.lookup(N("Title"))) ?? "",
        dest: ref && dest ? [ref, ...viewParams(dest)] : undefined,
        uri: uri instanceof PDFString || uri instanceof PDFHexString ? uri : undefined,
        open: (cur.lookupMaybe(N("Count"), PDFNumber)?.asNumber() ?? 0) > 0,
        color: cur.lookupMaybe(N("C"), PDFArray),
        flags: cur.lookupMaybe(N("F"), PDFNumber),
        children,
      };
      if (node.dest || node.uri || children.length) items.push(node);
      cur = ctx.lookupMaybe(cur.get(N("Next")) ?? PDFNull, PDFDict);
    }
    return items;
  };
  const root = doc.catalog.lookupMaybe(N("Outlines"), PDFDict);
  return root ? level(root.get(N("First")), 0) : [];
}

function writeOutline(out: PDFDocument, items: OutlineNode[]): void {
  if (!items.length) return;
  const ctx = out.context;
  const rootRef = ctx.nextRef();
  /** Returns the number of visible descendants (for /Count). */
  const write = (nodes: OutlineNode[], parent: PDFRef, holder: PDFDict): number => {
    const refs = nodes.map(() => ctx.nextRef());
    let visible = 0;
    nodes.forEach((n, i) => {
      const d = ctx.obj({}) as PDFDict;
      d.set(N("Title"), PDFHexString.fromText(n.title));
      d.set(N("Parent"), parent);
      if (i > 0) d.set(N("Prev"), refs[i - 1]);
      if (i < nodes.length - 1) d.set(N("Next"), refs[i + 1]);
      if (n.dest) d.set(N("Dest"), ctx.obj(n.dest));
      else if (n.uri) d.set(N("A"), ctx.obj({ S: "URI", URI: n.uri }));
      if (n.color instanceof PDFArray) d.set(N("C"), ctx.obj(n.color.asArray().filter((c) => c instanceof PDFNumber)));
      if (n.flags) d.set(N("F"), n.flags);
      if (n.children.length) {
        const sub = write(n.children, refs[i], d);
        d.set(N("Count"), PDFNumber.of(n.open ? sub : -n.children.length));
        if (n.open) visible += sub;
      }
      ctx.assign(refs[i], d);
      visible++;
    });
    holder.set(N("First"), refs[0]);
    holder.set(N("Last"), refs[refs.length - 1]);
    return visible;
  };
  const root = ctx.obj({ Type: "Outlines" }) as PDFDict;
  root.set(N("Count"), PDFNumber.of(write(items, rootRef, root)));
  ctx.assign(rootRef, root);
  out.catalog.set(N("Outlines"), rootRef);
}

/**
 * Carry document-level structure into a rebuilt document: bookmarks of every
 * source (in order), plus metadata, language and attachments of the first.
 * With `sections` (merging whole files), each source gets a top bookmark with
 * that title at its first page, holding the source's own bookmarks, so you
 * can see which pages came from which file.
 */
export function copyDocumentStructure(
  out: PDFDocument,
  sources: [docId: string, doc: PDFDocument][],
  target: PageTarget,
  sections?: string[],
): void {
  writeOutline(
    out,
    sources.flatMap(([id, doc], k) => {
      const items = readOutline(doc, id, target);
      if (!sections) return items;
      let first: PDFRef | undefined;
      for (let i = 0; !first && i < doc.getPageCount(); i++) first = target(id, i);
      if (!first && !items.length) return [];
      return [{ title: sections[k] ?? `File ${k + 1}`, dest: first ? [first, N("Fit")] : undefined, open: false, children: items }];
    }),
  );
  const first = sources[0]?.[1];
  if (!first) return;

  const info = first.context.lookupMaybe(first.context.trailerInfo.Info ?? PDFNull, PDFDict);
  const outInfo = out.context.obj({}) as PDFDict;
  if (info) {
    for (const [k, v] of info.entries()) {
      if (v instanceof PDFString || v instanceof PDFHexString || v instanceof PDFName) outInfo.set(k, v);
    }
  }
  out.context.trailerInfo.Info = out.context.register(outInfo);
  out.setModificationDate(new Date());

  const lang = first.catalog.lookup(N("Lang"));
  if (lang instanceof PDFString || lang instanceof PDFHexString) out.catalog.set(N("Lang"), lang);

  // Attachments and XMP metadata never point at pages, so a deep copy is safe.
  const copier = PDFObjectCopier.for(first.context, out.context);
  const files = first.catalog.lookupMaybe(N("Names"), PDFDict)?.get(N("EmbeddedFiles"));
  if (files) out.catalog.set(N("Names"), out.context.obj({ EmbeddedFiles: copier.copy(files) }));
  const xmp = first.catalog.get(N("Metadata"));
  if (xmp) out.catalog.set(N("Metadata"), copier.copy(xmp));
}

/**
 * Delete every object the saved file can't reach from its catalog or info
 * dictionary (pdf-lib otherwise writes them all). Belt and braces for
 * redaction: an orphaned copy of an original page can't end up in the file.
 */
export function pruneUnreachable(doc: PDFDocument): void {
  const ctx = doc.context;
  const seen = new Set<string>();
  const stack: PDFObject[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter((o): o is PDFObject => !!o);
  while (stack.length) {
    const o = stack.pop()!;
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue;
      seen.add(o.tag);
      const v = ctx.lookup(o);
      if (v) stack.push(v);
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v);
    } else if (o instanceof PDFArray) {
      stack.push(...o.asArray());
    } else if (o instanceof PDFStream) {
      stack.push(o.dict);
    }
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!seen.has(ref.tag)) ctx.delete(ref);
  }
}
