/**
 * App menus in English, Thai or Chinese. The interface is written in English;
 * this translates its text as it appears on screen (labels, tooltips,
 * placeholders, dialogs, messages) from a dictionary, watching the page so
 * dialogs and messages created later are translated too. Document content
 * (pages, text layers, search results) is never touched.
 */
export type Lang = "en" | "th" | "zh";

type Dict = Record<string, string>;

/** Messages with numbers or names: "{n}" / "{s}" stand for them. */
type Templates = [string, string][];

const TH: Dict = {
  // toolbar
  Open: "เปิด", "Open (Ctrl+O)": "เปิด (Ctrl+O)", Save: "บันทึก", "Save (Ctrl+S)": "บันทึก (Ctrl+S)", "Save as…": "บันทึกเป็น…",
  "Save a copy (Ctrl+Shift+S)": "บันทึกสำเนา (Ctrl+Shift+S)", "Shrink PDF size (for LINE / email)": "ลดขนาด PDF (สำหรับ LINE / อีเมล)",
  "Save a copy protected with a password": "บันทึกสำเนาพร้อมรหัสผ่าน", "Print (Ctrl+P)": "พิมพ์ (Ctrl+P)", Labels: "ใบปะหน้า",
  "Print shipping labels (Ctrl+L)": "พิมพ์ใบปะหน้าพัสดุ (Ctrl+L)", "Undo (Ctrl+Z)": "เลิกทำ (Ctrl+Z)", "Redo (Ctrl+Y)": "ทำซ้ำ (Ctrl+Y)",
  "Previous page": "หน้าก่อน", "Next page": "หน้าถัดไป", "Page number": "เลขหน้า", "Zoom out (Ctrl+-)": "ย่อ (Ctrl+-)", "Zoom in (Ctrl++)": "ขยาย (Ctrl++)",
  Zoom: "ซูม", "Page layout": "การจัดหน้า", Scroll: "เลื่อนต่อเนื่อง", "One page": "ทีละหน้า", "Two pages": "สองหน้า", "Fit width": "พอดีความกว้าง", "Fit page": "พอดีหน้า",
  Mark: "คั่นหน้า", "Mark this position (Ctrl+D)": "คั่นตำแหน่งนี้ (Ctrl+D)", Split: "แบ่งจอ", "Split view: compare two pages (Ctrl+\\)": "แบ่งจอ: เทียบสองหน้า (Ctrl+\\)",
  "Find (Ctrl+F)": "ค้นหา (Ctrl+F)", "Make a PDF from photos or scans": "สร้าง PDF จากรูปถ่าย/สแกน", "Search all PDFs in a folder (Ctrl+Shift+F)": "ค้นหาทุก PDF ในโฟลเดอร์ (Ctrl+Shift+F)",
  "Read aloud from this page (Thai / English / Chinese voices)": "อ่านออกเสียงจากหน้านี้ (ไทย / อังกฤษ / จีน)", "Night reading: dark pages, light text": "โหมดกลางคืน: หน้ามืด ตัวอักษรสว่าง",
  "Light / dark": "สว่าง / มืด", Settings: "ตั้งค่า", Sidebar: "แถบข้าง",
  // edit tools
  Select: "เลือก", "Select / text (V)": "เลือก / ข้อความ (V)", Pan: "เลื่อน", "Pan (H)": "เลื่อน (H)", Highlight: "ไฮไลต์", "Highlight (U) — or select text first": "ไฮไลต์ (U) — หรือเลือกข้อความก่อน",
  Text: "ข้อความ", "Add text (T)": "เพิ่มข้อความ (T)", Draw: "วาด", "Draw (P)": "วาด (P)", Box: "กรอบ", "Rectangle (R)": "สี่เหลี่ยม (R)", Circle: "วงกลม", "Ellipse (O)": "วงรี (O)",
  Line: "เส้น", "Line (L)": "เส้น (L)", Arrow: "ลูกศร", "Arrow (A)": "ลูกศร (A)", Comment: "ความเห็น", "Comment (N)": "ความเห็น (N)", Image: "รูปภาพ", "Insert image": "แทรกรูปภาพ",
  Sign: "ลายเซ็น", Stamp: "ตรายาง", "Stamp: PAID, ได้รับเงินแล้ว, your company seal…": "ตรายาง: ได้รับเงินแล้ว, ตราบริษัท…", Numbers: "เลขหน้า", "Page numbers on every page": "ใส่เลขหน้าทุกหน้า",
  Watermark: "ลายน้ำ", "Watermark on every page": "ลายน้ำทุกหน้า", "White-out": "ลบขาว", "White-out (cover)": "ลบขาว (ปิดทับ)", Redact: "ปิดข้อมูล",
  "Redact (permanently removes content under the box on save)": "ปิดข้อมูล (ลบเนื้อหาใต้กรอบถาวรเมื่อบันทึก)", Color: "สี", "Line width": "ความหนาเส้น", "Font size": "ขนาดตัวอักษร",
  Delete: "ลบ", "Delete selected (Del)": "ลบที่เลือก (Del)",
  // sidebar
  Pages: "หน้า", Outline: "สารบัญ", Marks: "ที่คั่น", Folder: "โฟลเดอร์", "Current page": "หน้าปัจจุบัน", "Rotate left": "หมุนซ้าย", "Rotate right": "หมุนขวา",
  "Move up": "เลื่อนขึ้น", "Move down": "เลื่อนลง", "Insert blank page after current": "แทรกหน้าว่างหลังหน้านี้", "Add pages from other PDF(s)": "เพิ่มหน้าจาก PDF อื่น",
  "Extract selected pages to a new PDF": "แยกหน้าที่เลือกเป็น PDF ใหม่", "Cut pages into pieces (vertical / horizontal, by %)": "ตัดหน้าเป็นชิ้น (แนวตั้ง / แนวนอน ตาม %)",
  "Split into several PDF files": "แยกเป็นหลายไฟล์ PDF", "Export pages as images (PNG/JPG)": "ส่งออกหน้าเป็นรูปภาพ (PNG/JPG)", "Delete page(s)": "ลบหน้า",
  "This document has no outline (table of contents).": "เอกสารนี้ไม่มีสารบัญ", "+ Mark current position": "+ คั่นตำแหน่งนี้", "Choose folder…": "เลือกโฟลเดอร์…",
  "Search all PDFs in the folder": "ค้นหาทุก PDF ในโฟลเดอร์", "Match case": "ตรงตัวพิมพ์",
  "Choose a folder (for example your supplier catalogs), then type a part number, car model or any word. Every PDF in the folder and its subfolders is searched; click a result to open that page.":
    "เลือกโฟลเดอร์ (เช่น แคตตาล็อกจากซัพพลายเออร์) แล้วพิมพ์รหัสสินค้า รุ่นรถ หรือคำใดก็ได้ ระบบจะค้นทุก PDF ในโฟลเดอร์และโฟลเดอร์ย่อย คลิกผลลัพธ์เพื่อเปิดหน้านั้น",
  "Find in document": "ค้นหาในเอกสาร",
  // start screen
  "Fast, stable viewing and editing — even for huge, image-heavy PDFs.": "ดูและแก้ไข PDF ได้เร็วและเสถียร แม้ไฟล์ใหญ่ที่มีรูปมาก", "Open PDF…": "เปิด PDF…",
  "or drop a file anywhere": "หรือลากไฟล์มาวาง", "Search a folder of PDFs…": "ค้นหาในโฟลเดอร์ PDF…", "PDF from photos…": "PDF จากรูปถ่าย…", Recent: "ล่าสุด", "Drop PDF to open": "วาง PDF เพื่อเปิด",
  // dialogs
  Cancel: "ยกเลิก", OK: "ตกลง", Save_: "บันทึก", Discard: "ไม่บันทึก", "Unsaved changes": "มีการแก้ไขที่ยังไม่บันทึก", Pages_: "หน้า",
  "Print labels": "พิมพ์ใบปะหน้า", "Save label PDF": "บันทึกเป็น PDF ใบปะหน้า", Layout: "รูปแบบ", "Label stock": "ขนาดสติกเกอร์", "Printer resolution (dpi)": "ความละเอียดเครื่องพิมพ์ (dpi)",
  "Sharp barcodes (redrawn on the printer's dot grid)": "บาร์โค้ดคมชัด (วาดใหม่ตามจุดของเครื่องพิมพ์)", "Larger Shopee order number (SPX labels)": "เลขคำสั่งซื้อ Shopee ใหญ่ขึ้น (SPX)",
  "Page numbers": "เลขหน้า", Format: "รูปแบบ", Position: "ตำแหน่ง", "Size (pt)": "ขนาด (pt)", "First number": "เริ่มที่เลข", "No number on the first page (cover)": "ไม่ใส่เลขหน้าแรก (ปก)",
  "Add page numbers": "ใส่เลขหน้า", "Remove page numbers": "ลบเลขหน้า", "Bottom center": "ล่างกลาง", "Bottom right": "ล่างขวา", "Bottom left": "ล่างซ้าย", "Top center": "บนกลาง", "Top right": "บนขวา", "Top left": "บนซ้าย",
  "Add watermark": "ใส่ลายน้ำ", "Remove watermark": "ลบลายน้ำ", Colour: "สี", Strength: "ความเข้ม", "Very light": "จางมาก", Light: "จาง", Medium: "ปานกลาง", Strong: "เข้ม",
  "Add today's date under text stamps": "ใส่วันที่วันนี้ใต้ตรายาง", "Put it on every page (bottom right)": "ใส่ทุกหน้า (มุมขวาล่าง)",
  "Seal/logo images: make the white background transparent": "รูปตรา/โลโก้: ทำพื้นขาวให้โปร่งใส", "+ Custom text…": "+ ข้อความเอง…", "+ Add seal / logo image…": "+ เพิ่มรูปตรา / โลโก้…",
  "Cut pages": "ตัดหน้า", "Vertical cut at": "ตัดแนวตั้งที่", "Horizontal cut at": "ตัดแนวนอนที่", Cut: "ตัด",
  "Split into files": "แยกเป็นไฟล์", "Every N pages": "ทุก N หน้า", "By page ranges": "ตามช่วงหน้า", "Pages per file": "หน้าต่อไฟล์", Ranges: "ช่วงหน้า",
  "Export pages as images": "ส่งออกหน้าเป็นรูปภาพ", Export: "ส่งออก", Quality: "คุณภาพ",
  "Protect with a password": "ป้องกันด้วยรหัสผ่าน", Password: "รหัสผ่าน", "Type it again": "พิมพ์อีกครั้ง", "Show password": "แสดงรหัสผ่าน", "Allow printing": "อนุญาตให้พิมพ์",
  "Allow copying text": "อนุญาตให้คัดลอกข้อความ", "Allow changes": "อนุญาตให้แก้ไข", "Save protected copy": "บันทึกสำเนาที่มีรหัสผ่าน",
  "Use at least 4 characters.": "ใช้อย่างน้อย 4 ตัวอักษร", "The two passwords are different.": "รหัสผ่านสองช่องไม่ตรงกัน",
  "Shrink PDF size": "ลดขนาด PDF", Shrink: "ลดขนาด", Size: "ขนาด", "Smallest (for LINE / email)": "เล็กที่สุด (LINE / อีเมล)", Balanced: "สมดุล", "High quality (for printing)": "คุณภาพสูง (สำหรับพิมพ์)",
  "Make a PDF from photos": "สร้าง PDF จากรูปถ่าย", "Make PDF": "สร้าง PDF", "Trim empty borders around each picture": "ตัดขอบว่างรอบรูป", "Scan look: clean black & white (receipts, documents)": "แบบสแกน: ขาวดำคมชัด (ใบเสร็จ เอกสาร)",
  Language: "ภาษา", "Night reading (dark pages)": "โหมดกลางคืน (หน้ามืด)", "Reading speed": "ความเร็วการอ่าน", "Reset remembered choices": "ล้างค่าที่จำไว้", Close: "ปิด",
  "Remove the password": "ลบรหัสผ่าน", "Keep the password": "คงรหัสผ่าน", "This PDF is password-protected": "PDF นี้มีรหัสผ่าน", "Password required": "ต้องใช้รหัสผ่าน", Unlock: "ปลดล็อก",
  "Incorrect password — try again": "รหัสผ่านไม่ถูกต้อง ลองอีกครั้ง",
};

const ZH: Dict = {
  Open: "打开", "Open (Ctrl+O)": "打开 (Ctrl+O)", Save: "保存", "Save (Ctrl+S)": "保存 (Ctrl+S)", "Save as…": "另存为…", "Save a copy (Ctrl+Shift+S)": "保存副本 (Ctrl+Shift+S)",
  "Shrink PDF size (for LINE / email)": "压缩 PDF（用于 LINE / 邮件）", "Save a copy protected with a password": "保存带密码的副本", "Print (Ctrl+P)": "打印 (Ctrl+P)", Labels: "面单",
  "Print shipping labels (Ctrl+L)": "打印快递面单 (Ctrl+L)", "Undo (Ctrl+Z)": "撤销 (Ctrl+Z)", "Redo (Ctrl+Y)": "重做 (Ctrl+Y)", "Previous page": "上一页", "Next page": "下一页", "Page number": "页码",
  "Zoom out (Ctrl+-)": "缩小 (Ctrl+-)", "Zoom in (Ctrl++)": "放大 (Ctrl++)", Zoom: "缩放", "Page layout": "页面布局", Scroll: "连续滚动", "One page": "单页", "Two pages": "双页", "Fit width": "适合宽度", "Fit page": "适合页面",
  Mark: "书签", "Mark this position (Ctrl+D)": "标记此位置 (Ctrl+D)", Split: "分屏", "Split view: compare two pages (Ctrl+\\)": "分屏：比较两页 (Ctrl+\\)", "Find (Ctrl+F)": "查找 (Ctrl+F)",
  "Make a PDF from photos or scans": "用照片或扫描件制作 PDF", "Search all PDFs in a folder (Ctrl+Shift+F)": "搜索文件夹中的所有 PDF (Ctrl+Shift+F)",
  "Read aloud from this page (Thai / English / Chinese voices)": "从本页朗读（泰语 / 英语 / 中文）", "Night reading: dark pages, light text": "夜间阅读：深色页面、浅色文字", "Light / dark": "浅色 / 深色", Settings: "设置", Sidebar: "侧栏",
  Select: "选择", "Select / text (V)": "选择 / 文字 (V)", Pan: "平移", "Pan (H)": "平移 (H)", Highlight: "高亮", "Highlight (U) — or select text first": "高亮 (U) — 或先选中文字", Text: "文字", "Add text (T)": "添加文字 (T)",
  Draw: "画笔", "Draw (P)": "画笔 (P)", Box: "方框", "Rectangle (R)": "矩形 (R)", Circle: "圆形", "Ellipse (O)": "椭圆 (O)", Line: "直线", "Line (L)": "直线 (L)", Arrow: "箭头", "Arrow (A)": "箭头 (A)",
  Comment: "批注", "Comment (N)": "批注 (N)", Image: "图片", "Insert image": "插入图片", Sign: "签名", Stamp: "印章", "Stamp: PAID, ได้รับเงินแล้ว, your company seal…": "印章：已付款、公司公章…",
  Numbers: "页码", "Page numbers on every page": "每页添加页码", Watermark: "水印", "Watermark on every page": "每页添加水印", "White-out": "涂白", "White-out (cover)": "涂白（覆盖）", Redact: "涂黑",
  "Redact (permanently removes content under the box on save)": "涂黑（保存时永久删除框内内容）", Color: "颜色", "Line width": "线宽", "Font size": "字号", Delete: "删除", "Delete selected (Del)": "删除所选 (Del)",
  Pages: "页面", Outline: "目录", Marks: "书签", Folder: "文件夹", "Current page": "当前页", "Rotate left": "向左旋转", "Rotate right": "向右旋转", "Move up": "上移", "Move down": "下移",
  "Insert blank page after current": "在当前页后插入空白页", "Add pages from other PDF(s)": "从其他 PDF 添加页面", "Extract selected pages to a new PDF": "将所选页面提取为新 PDF",
  "Cut pages into pieces (vertical / horizontal, by %)": "将页面切成几块（垂直 / 水平，按百分比）", "Split into several PDF files": "拆分为多个 PDF 文件", "Export pages as images (PNG/JPG)": "将页面导出为图片 (PNG/JPG)",
  "Delete page(s)": "删除页面", "This document has no outline (table of contents).": "此文档没有目录。", "+ Mark current position": "+ 标记当前位置", "Choose folder…": "选择文件夹…",
  "Search all PDFs in the folder": "搜索文件夹中的所有 PDF", "Match case": "区分大小写", "Find in document": "在文档中查找",
  "Choose a folder (for example your supplier catalogs), then type a part number, car model or any word. Every PDF in the folder and its subfolders is searched; click a result to open that page.":
    "选择一个文件夹（例如供应商目录），然后输入零件号、车型或任何词。将搜索该文件夹及其子文件夹中的每个 PDF；点击结果即可打开该页。",
  "Fast, stable viewing and editing — even for huge, image-heavy PDFs.": "快速、稳定地查看和编辑 PDF，即使是图片很多的大文件。", "Open PDF…": "打开 PDF…", "or drop a file anywhere": "或将文件拖到此处",
  "Search a folder of PDFs…": "搜索 PDF 文件夹…", "PDF from photos…": "用照片制作 PDF…", Recent: "最近", "Drop PDF to open": "放下 PDF 以打开",
  Cancel: "取消", OK: "确定", Discard: "不保存", "Unsaved changes": "有未保存的更改", "Print labels": "打印面单", "Save label PDF": "保存面单 PDF", Layout: "布局", "Label stock": "标签纸尺寸",
  "Printer resolution (dpi)": "打印机分辨率 (dpi)", "Sharp barcodes (redrawn on the printer's dot grid)": "清晰条码（按打印机点阵重绘）", "Larger Shopee order number (SPX labels)": "放大 Shopee 订单号（SPX 面单）",
  "Page numbers": "页码", Format: "格式", Position: "位置", "Size (pt)": "大小 (pt)", "First number": "起始页码", "No number on the first page (cover)": "首页（封面）不加页码", "Add page numbers": "添加页码",
  "Remove page numbers": "删除页码", "Bottom center": "底部居中", "Bottom right": "右下", "Bottom left": "左下", "Top center": "顶部居中", "Top right": "右上", "Top left": "左上",
  "Add watermark": "添加水印", "Remove watermark": "删除水印", Colour: "颜色", Strength: "浓度", "Very light": "很淡", Light: "淡", Medium: "中等", Strong: "浓",
  "Add today's date under text stamps": "在文字印章下加上今天的日期", "Put it on every page (bottom right)": "放在每一页（右下角）", "Seal/logo images: make the white background transparent": "公章/标志图片：白色背景变透明",
  "+ Custom text…": "+ 自定义文字…", "+ Add seal / logo image…": "+ 添加公章 / 标志图片…", "Cut pages": "切分页面", "Vertical cut at": "垂直切分位置", "Horizontal cut at": "水平切分位置", Cut: "切分",
  "Split into files": "拆分为文件", "Every N pages": "每 N 页", "By page ranges": "按页码范围", "Pages per file": "每个文件的页数", Ranges: "页码范围", "Export pages as images": "将页面导出为图片", Export: "导出", Quality: "质量",
  "Protect with a password": "用密码保护", Password: "密码", "Type it again": "再输入一次", "Show password": "显示密码", "Allow printing": "允许打印", "Allow copying text": "允许复制文字", "Allow changes": "允许修改",
  "Save protected copy": "保存受保护的副本", "Use at least 4 characters.": "至少 4 个字符。", "The two passwords are different.": "两次输入的密码不一致。", "Shrink PDF size": "压缩 PDF", Shrink: "压缩", Size: "大小",
  "Smallest (for LINE / email)": "最小（LINE / 邮件）", Balanced: "均衡", "High quality (for printing)": "高质量（打印用）", "Make a PDF from photos": "用照片制作 PDF", "Make PDF": "制作 PDF",
  "Trim empty borders around each picture": "裁掉图片四周的空白", "Scan look: clean black & white (receipts, documents)": "扫描效果：清晰黑白（收据、文件）", Language: "语言", "Night reading (dark pages)": "夜间阅读（深色页面）",
  "Reading speed": "朗读速度", "Reset remembered choices": "重置已记住的选项", Close: "关闭", "Remove the password": "删除密码", "Keep the password": "保留密码", "This PDF is password-protected": "此 PDF 受密码保护",
  "Password required": "需要密码", Unlock: "解锁", "Incorrect password — try again": "密码错误，请重试",
};

const TEMPLATES: Record<Exclude<Lang, "en">, Templates> = {
  th: [
    ["Saved {s}", "บันทึก {s} แล้ว"],
    ["{n} labels sent to the printer. {s}", "ส่งใบปะหน้า {n} ใบไปที่เครื่องพิมพ์แล้ว {s}"],
    ["Searching… {n} of {n} files{s}", "กำลังค้นหา… {n} จาก {n} ไฟล์{s}"],
    ["{n} matches in {n} of {n} files{s}", "พบ {n} รายการ ใน {n} จาก {n} ไฟล์{s}"],
    ["{n} found · searching {n}%", "พบ {n} · กำลังค้นหา {n}%"],
    ["{n} of {n}", "{n} จาก {n}"],
    ["No results", "ไม่พบ"],
    ["No matches", "ไม่พบ"],
    ["Page {n} of {n}", "หน้า {n} จาก {n}"],
  ],
  zh: [
    ["Saved {s}", "已保存 {s}"],
    ["{n} labels sent to the printer. {s}", "已将 {n} 张面单发送到打印机。{s}"],
    ["Searching… {n} of {n} files{s}", "正在搜索… 第 {n}/{n} 个文件{s}"],
    ["{n} matches in {n} of {n} files{s}", "在 {n}/{n} 个文件中找到 {n} 处{s}"],
    ["{n} found · searching {n}%", "已找到 {n} · 搜索中 {n}%"],
    ["{n} of {n}", "{n}/{n}"],
    ["No results", "无结果"],
    ["No matches", "无结果"],
    ["Page {n} of {n}", "第 {n} 页，共 {n} 页"],
  ],
};

const DICTS: Record<Exclude<Lang, "en">, Dict> = { th: TH, zh: ZH };

let lang: Lang = "en";
const original = new WeakMap<Node, string>();
const originalAttr = new WeakMap<Element, Record<string, string>>();
let observer: MutationObserver | null = null;
const ATTRS = ["title", "placeholder", "aria-label"];
/** Never translate inside documents or user content. */
const SKIP = ".pages, .textLayer, .page, .annot-layer, .folder-results, .outline, .marks-list, .recent-list, .tab-name, #status-file, .thumb-label, input[type=search], textarea";

function compiled(): [RegExp, string, string][] {
  if (lang === "en") return [];
  return TEMPLATES[lang].map(([from, to]) => {
    const re = new RegExp(
      "^" + from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{n\\\}/g, "(\\d[\\d,.]*)").replace(/\\\{s\\\}/g, "(.*)") + "$",
      "s",
    );
    return [re, from, to];
  });
}
let templates: [RegExp, string, string][] = [];

/** The current language's text for an English string (unchanged when there is none). */
export function t(s: string): string {
  if (lang === "en" || !s) return s;
  const key = s.trim();
  const d = DICTS[lang];
  const hit = d[key];
  if (hit) return s.replace(key, hit);
  for (const [re, , to] of templates) {
    const m = re.exec(key);
    if (m) {
      let i = 1;
      return to.replace(/\{[ns]\}/g, () => m[i++] ?? "");
    }
  }
  return s;
}

function translateNode(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) return;
    const text = node.textContent ?? "";
    if (!text.trim()) return;
    if (!original.has(node)) original.set(node, text);
    const src = original.get(node)!;
    const next = lang === "en" ? src : t(src);
    if (next !== text) node.textContent = next;
    return;
  }
  if (!(node instanceof Element) || node.closest(SKIP)) return;
  let saved = originalAttr.get(node);
  for (const a of ATTRS) {
    const v = node.getAttribute(a);
    if (v === null) continue;
    if (!saved) originalAttr.set(node, (saved = {}));
    if (!(a in saved)) saved[a] = v;
    const next = lang === "en" ? saved[a] : t(saved[a]);
    if (next !== v) node.setAttribute(a, next);
  }
  if (node instanceof HTMLOptionElement || node.children.length || node.childNodes.length) {
    for (const c of node.childNodes) translateNode(c);
  }
}

/** Switch the interface language (and keep translating what appears later). */
export function setLanguage(next: Lang): void {
  lang = next;
  templates = compiled();
  document.documentElement.lang = next;
  translateNode(document.body);
  observer?.disconnect();
  observer = null;
  if (next === "en") return;
  observer = new MutationObserver((records) => {
    observer!.disconnect();
    for (const r of records) {
      if (r.type === "characterData") {
        original.delete(r.target); // the app changed this text: translate the new value
        translateNode(r.target);
      } else for (const n of r.addedNodes) translateNode(n);
    }
    observer!.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

export function currentLanguage(): Lang {
  return lang;
}

/** Saved choice, or the system language the first time. */
export function initialLanguage(): Lang {
  const saved = localStorage.getItem("pdfstudio:lang");
  if (saved === "en" || saved === "th" || saved === "zh") return saved;
  const sys = (navigator.language || "en").toLowerCase();
  return sys.startsWith("th") ? "th" : sys.startsWith("zh") ? "zh" : "en";
}
