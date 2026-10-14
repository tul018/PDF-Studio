/**
 * Fonts installed on this computer, for added text.
 *
 * The full list comes from the Local Font Access API (Windows WebView2,
 * Chrome, Edge), which asks the user once. Until that's allowed, or where it
 * doesn't exist (iPad), we offer the common fonts this device actually has,
 * found by measuring text in each.
 */

interface LocalFont {
  family: string;
  style: string;
  postscriptName: string;
  blob(): Promise<Blob>;
}
type QueryLocalFonts = () => Promise<LocalFont[]>;

const query = (): QueryLocalFonts | undefined =>
  (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts?.bind(window);

/** Fonts commonly found on Windows, macOS and iPadOS. */
const COMMON = [
  "Arial", "Arial Black", "Bahnschrift", "Calibri", "Cambria", "Candara", "Cascadia Code", "Comic Sans MS", "Consolas",
  "Constantia", "Corbel", "Courier New", "Ebrima", "Franklin Gothic Medium", "Gabriola", "Gadugi", "Georgia", "Impact",
  "Ink Free", "Leelawadee UI", "Lucida Console", "Lucida Sans Unicode", "Malgun Gothic", "Microsoft JhengHei",
  "Microsoft YaHei", "MS Gothic", "Palatino Linotype", "Segoe Print", "Segoe Script", "Segoe UI", "SimSun",
  "Sitka Text", "Sylfaen", "Tahoma", "Times New Roman", "Trebuchet MS", "Verdana", "Angsana New", "Browallia New",
  "Cordia New", "EucrosiaUPC", "IrisUPC", "JasmineUPC", "KodchiangUPC", "Leelawadee", "TH Sarabun New", "TH SarabunPSK",
  "Helvetica", "Helvetica Neue", "Avenir", "Avenir Next", "Baskerville", "Futura", "Gill Sans", "Optima", "Didot",
  "American Typewriter", "Menlo", "Thonburi", "Noto Sans", "Noto Serif", "Roboto", "Open Sans", "Lato",
];

let full: string[] | null = null;
let common: string[] | null = null;
let fontFiles: Promise<LocalFont[]> | null = null;

/** True when the full list can be asked for (and isn't loaded yet). */
export function canListAllFonts(): boolean {
  return !!query() && !full;
}

/** Installed font families: the full list if allowed, otherwise the common ones present. */
export function installedFonts(): string[] {
  return full ?? (common ??= COMMON.filter(isInstalled).sort((a, b) => a.localeCompare(b)));
}

/** Ask for every installed font (shows the browser's permission prompt once). */
export async function loadAllFonts(): Promise<string[]> {
  const q = query();
  if (!q) return installedFonts();
  try {
    fontFiles ??= q();
    const fonts = await fontFiles;
    if (fonts.length) full = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
  } catch {
    fontFiles = null; // refused: keep the common list
  }
  return installedFonts();
}

/** Load the full list without prompting if permission was already given. */
export async function loadFontsIfAllowed(): Promise<void> {
  try {
    const st = await navigator.permissions.query({ name: "local-fonts" as PermissionName });
    if (st.state === "granted") await loadAllFonts();
  } catch {
    /* permission name unknown here */
  }
}

/**
 * The font file of a family's regular style, for embedding in a saved PDF.
 * Null when the file can't be read (not allowed, or not available).
 */
export async function fontFileBytes(family: string): Promise<Uint8Array | null> {
  const q = query();
  if (!q) return null;
  try {
    fontFiles ??= q();
    const faces = (await fontFiles).filter((f) => f.family === family);
    if (!faces.length) return null;
    const rank = (f: LocalFont) => (/^(regular|normal|book|roman)$/i.test(f.style) ? 0 : /italic|oblique/i.test(f.style) ? 2 : 1);
    const face = faces.sort((a, b) => rank(a) - rank(b))[0];
    return new Uint8Array(await (await face.blob()).arrayBuffer());
  } catch {
    fontFiles = null;
    return null;
  }
}

let ctx: CanvasRenderingContext2D | null = null;
/** Text drawn in the font is a different width than in all three generic fallbacks. */
function isInstalled(family: string): boolean {
  ctx ??= document.createElement("canvas").getContext("2d");
  if (!ctx) return false;
  const sample = "mmmmmmmmmmlliWWQ@#ก中";
  return ["monospace", "serif", "sans-serif"].some((base) => {
    ctx!.font = `72px ${base}`;
    const w0 = ctx!.measureText(sample).width;
    ctx!.font = `72px "${family}", ${base}`;
    return ctx!.measureText(sample).width !== w0;
  });
}
