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
  "Other %…": "อื่น ๆ %…", "Type a percentage.": "พิมพ์เปอร์เซ็นต์", "e.g. 135": "เช่น 135",
  "Zoom (type a percentage)": "ซูม (พิมพ์เปอร์เซ็นต์)", "Zoom: type a percentage, e.g. 135, or pick one": "ซูม: พิมพ์เปอร์เซ็นต์ เช่น 135 หรือเลือกจากรายการ",
  "Auto-save": "บันทึกอัตโนมัติ", "Auto-saving…": "กำลังบันทึกอัตโนมัติ…", "Auto-save is off.": "ปิดการบันทึกอัตโนมัติแล้ว", "Auto-save is on: changes are saved to the file 30 seconds after your last edit. Each save clears Undo.": "เปิดบันทึกอัตโนมัติแล้ว: บันทึกลงไฟล์ 30 วินาทีหลังแก้ไขล่าสุด แต่ละครั้งจะล้างประวัติเลิกทำ", "Auto-save is on, but only works in the PC app with files opened from this PC.": "เปิดบันทึกอัตโนมัติแล้ว แต่ใช้ได้เฉพาะในแอปบน PC กับไฟล์ที่เปิดจากเครื่องนี้",
  "Form data (CSV / JSON)…": "ข้อมูลฟอร์ม (CSV / JSON)…", "Form data (CSV)…": "ข้อมูลฟอร์ม (CSV)…", "This document has no form fields.": "เอกสารนี้ไม่มีช่องกรอกฟอร์ม", "None of the names in the file match this form's fields.": "ไม่มีชื่อในไฟล์ที่ตรงกับช่องของฟอร์มนี้", "The file needs field names in the first row and values in the second.": "ไฟล์ต้องมีชื่อช่องในแถวแรก และค่าในแถวที่สอง",
  "Zoom to area": "ซูมเฉพาะส่วน", "Layers…": "เลเยอร์…", "Layers": "เลเยอร์", "Attachments…": "ไฟล์แนบ…", "Attachments": "ไฟล์แนบ", "Snapshot (copy an area as a picture)": "จับภาพ (คัดลอกบางส่วนเป็นรูป)", "Drag a frame around the part to zoom in on.": "ลากกรอบรอบส่วนที่ต้องการซูม", "Drag a frame around the part to copy as a picture.": "ลากกรอบรอบส่วนที่ต้องการคัดลอกเป็นรูป", "Picture copied. Paste it into LINE, Word or an email (Ctrl+V).": "คัดลอกรูปแล้ว วางใน LINE, Word หรืออีเมลได้ (Ctrl+V)", "Saved the picture as snapshot.png": "บันทึกรูปเป็น snapshot.png แล้ว", "Show or hide parts of the document. Only the view changes, not the file.": "แสดงหรือซ่อนบางส่วนของเอกสาร เปลี่ยนแค่การแสดงผล ไม่เปลี่ยนไฟล์", "This document has no layers.": "เอกสารนี้ไม่มีเลเยอร์", "This document has no attached files.": "เอกสารนี้ไม่มีไฟล์แนบ", "(unnamed layer)": "(เลเยอร์ไม่มีชื่อ)", "Save…": "บันทึก…",
  "Page labels…": "เลขหน้าแบบกำหนดเอง…", "Page labels": "เลขหน้าแบบกำหนดเอง", "Number pages your way, e.g. i, ii, iii for the front pages, then 1, 2, 3.": "กำหนดเลขหน้าเอง เช่น i, ii, iii สำหรับหน้าแรก ๆ แล้วต่อด้วย 1, 2, 3", "From page": "ตั้งแต่หน้า", "Style": "รูปแบบ", "Prefix": "คำนำหน้า", "Start at": "เริ่มที่", "No number (prefix only)": "ไม่มีตัวเลข (คำนำหน้าอย่างเดียว)", "Remove this numbering": "ลบการกำหนดเลขนี้", "Plain numbers": "เลขหน้าปกติ", "Plain page numbers (1, 2, 3…).": "เลขหน้าปกติ (1, 2, 3…)", "Apply": "ใช้",
  "Crop pages": "ครอบตัดหน้า", "Remove crop": "เอาการครอบตัดออก", "Copy pages": "คัดลอกหน้า", "Cut pages to paste": "ตัดหน้าไปวาง", "Paste pages": "วางหน้า", "This page": "หน้านี้", "Keep only the part inside the frame. Undo or Edit › Pages › Remove crop brings the rest back.": "เก็บเฉพาะส่วนในกรอบ เลิกทำ หรือ แก้ไข › หน้า › เอาการครอบตัดออก เพื่อนำส่วนที่เหลือกลับมา", "Drag a frame around the part of the page to keep.": "ลากกรอบรอบส่วนของหน้าที่ต้องการเก็บไว้", "Copy or cut pages first (select them in the sidebar, Ctrl+C).": "คัดลอกหรือตัดหน้าก่อน (เลือกในแถบข้าง แล้วกด Ctrl+C)",
  "Print": "พิมพ์", "All of them": "ทุกหน้าที่เลือก", "Odd pages only": "เฉพาะหน้าคี่", "Even pages only": "เฉพาะหน้าคู่", "1 page per sheet": "1 หน้าต่อแผ่น", "2 pages per sheet": "2 หน้าต่อแผ่น", "4 pages per sheet": "4 หน้าต่อแผ่น", "6 pages per sheet": "6 หน้าต่อแผ่น", "Booklet (fold in half)": "หนังสือเล่มเล็ก (พับครึ่ง)", "Paper": "กระดาษ", "Same as the pages": "เท่ากับขนาดหน้า", "Orientation": "แนวกระดาษ", "Automatic": "อัตโนมัติ", "Portrait": "แนวตั้ง", "Landscape": "แนวนอน", "Reverse order": "เรียงย้อนกลับ", "Black and white (grayscale)": "ขาวดำ (โทนเทา)", "Print on both sides, flipping on the short edge, then fold the stack in half.": "พิมพ์สองหน้าแบบพลิกด้านสั้น แล้วพับครึ่งทั้งปึก", "Several pages per sheet are printed on A4 unless you choose a paper size.": "หลายหน้าต่อแผ่นจะพิมพ์บน A4 ถ้าไม่ได้เลือกขนาดกระดาษ", "Previous sheet": "แผ่นก่อน", "Next sheet": "แผ่นถัดไป", "Nothing to print": "ไม่มีอะไรให้พิมพ์", "Rendering pages for printing…": "กำลังเตรียมหน้าสำหรับพิมพ์…", "Preparing to print…": "กำลังเตรียมพิมพ์…",
  "Comments": "ความเห็น", "Your name": "ชื่อของคุณ", "Shown on your comments": "แสดงบนความเห็นของคุณ", "All": "ทั้งหมด", "Done": "เสร็จแล้ว", "Reopen": "เปิดอีกครั้ง", "Reply": "ตอบกลับ", "Reply…": "ตอบกลับ…", "Show": "แสดง", "No comments. Use the Comment tool (N) and click on the page.": "ยังไม่มีความเห็น ใช้เครื่องมือความเห็น (N) แล้วคลิกบนหน้า", "Cloud": "เมฆ", "Cloud (C)": "รูปเมฆ (C)", "Eraser": "ยางลบ", "Eraser: drag over pen strokes (E)": "ยางลบ: ลากผ่านเส้นที่วาด (E)",
  "Find a command…": "ค้นหาคำสั่ง…", "Find a command": "ค้นหาคำสั่ง", "Type a command…": "พิมพ์ชื่อคำสั่ง…", "Type a command": "พิมพ์ชื่อคำสั่ง", "No matching command": "ไม่พบคำสั่ง", "Commands": "คำสั่ง",
  "Revert to saved": "กลับไปฉบับที่บันทึก", "Revert to saved?": "กลับไปฉบับที่บันทึกไว้?", "This removes the changes made since the file was last saved. You can still bring them back with Undo.": "การแก้ไขหลังการบันทึกครั้งล่าสุดจะถูกเอาออก ยังกู้คืนได้ด้วยเลิกทำ", "Revert": "ย้อนกลับ", "No unsaved changes.": "ไม่มีการแก้ไขที่ยังไม่บันทึก", "Back to the saved version.": "กลับไปฉบับที่บันทึกแล้ว",
  // menu bar
  "File": "ไฟล์", "Edit": "แก้ไข", "View": "มุมมอง", "Tools": "เครื่องมือ", "Help": "ช่วยเหลือ", "New PDF from photos…": "สร้าง PDF จากรูปถ่าย…", "Open…": "เปิด…", "Open recent": "เปิดล่าสุด", "No recent files": "ไม่มีไฟล์ล่าสุด", "Save with password…": "บันทึกพร้อมรหัสผ่าน…", "Save smaller copy…": "บันทึกสำเนาขนาดเล็ก…", "Import": "นำเข้า", "Pages from other PDF…": "หน้าจาก PDF อื่น…", "Image…": "รูปภาพ…", "Blank page": "หน้าว่าง", "Pages as images (PNG/JPG)…": "หน้าเป็นรูปภาพ (PNG/JPG)…", "Split into PDF files…": "แยกเป็นไฟล์ PDF…", "Selected pages as PDF…": "หน้าที่เลือกเป็น PDF…", "Word document…": "เอกสาร Word…", "Excel workbook…": "ไฟล์ Excel…", "PDF/A archive copy…": "สำเนาเก็บถาวร PDF/A…", "Print…": "พิมพ์…", "Print labels…": "พิมพ์ใบปะหน้า…", "Close tab": "ปิดแท็บ", "Undo": "เลิกทำ", "Redo": "ทำซ้ำ", "Find…": "ค้นหา…", "Delete selected": "ลบที่เลือก", "Stamp…": "ตรายาง…", "Page numbers…": "เลขหน้า…", "Watermark…": "ลายน้ำ…", "Headers / footers / Bates…": "หัวกระดาษ / ท้ายกระดาษ / Bates…", "Edit existing text…": "แก้ไขข้อความเดิม…", "Create form fields…": "สร้างช่องฟอร์ม…", "Comments…": "ความเห็น…", "Bookmarks…": "บุ๊กมาร์ก…", "Redact by search…": "ปิดข้อมูลตามคำค้น…", "Remove hidden information…": "ลบข้อมูลที่ซ่อนอยู่…", "Cut pages…": "ตัดหน้า…", "Delete pages": "ลบหน้า", "Zoom in": "ขยาย", "Zoom out": "ย่อ", "Split view": "แบ่งจอ", "Compare with another PDF…": "เปรียบเทียบกับ PDF อื่น…", "Night reading": "อ่านกลางคืน", "Light / dark theme": "ธีมสว่าง / มืด", "Read aloud": "อ่านออกเสียง", "Mark this position": "คั่นตำแหน่งนี้", "Recognize text (OCR)…": "อ่านข้อความจากภาพ (OCR)…", "Measure distance / area…": "วัดระยะ / พื้นที่…", "Find QR codes": "ค้นหา QR โค้ด", "Add QR code…": "เพิ่ม QR โค้ด…", "Certificate signature…": "ลายเซ็นใบรับรอง…", "Batch actions…": "ทำหลายไฟล์พร้อมกัน…", "All professional tools…": "เครื่องมือมืออาชีพทั้งหมด…", "Work together live…": "ทำงานร่วมกันสด…", "Connect Claude…": "เชื่อมต่อ Claude…", "PDF engine settings…": "ตั้งค่าเครื่องมือ PDF…", "Keyboard shortcuts": "แป้นลัด", "Check for updates…": "ตรวจหาอัปเดต…", "About PDF Studio & credits": "เกี่ยวกับ PDF Studio และผู้ร่วมสร้าง",
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
  // tool settings
  "Light theme": "ธีมสว่าง", "Dark theme": "ธีมมืด", "Highlight options": "ตัวเลือกไฮไลต์", "Text options": "ตัวเลือกข้อความ",
  Font: "ฟอนต์", Opacity: "ความทึบ", "Line thickness": "ความหนาเส้น", "Highlight opacity": "ความทึบไฮไลต์", "Highlight color": "สีไฮไลต์",
  Sans: "ไม่มีเชิง", Serif: "มีเชิง", Mono: "ความกว้างเท่ากัน", Width: "กว้าง", Height: "สูง", Custom: "กำหนดเอง", "Other color": "สีอื่น",
  "Font size: pick one or type any size": "ขนาดฟอนต์: เลือกหรือพิมพ์ขนาดเอง",
  "Free — drag any box": "อิสระ — ลากกรอบขนาดใดก็ได้", "Fixed size — same height every time": "ขนาดคงที่ — สูงเท่ากันทุกครั้ง",
  "Fixed size: click to place a Width × Height highlight, or drag sideways to set the width — the height stays the same.":
    "ขนาดคงที่: คลิกเพื่อวางไฮไลต์ขนาด กว้าง × สูง หรือลากไปด้านข้างเพื่อกำหนดความกว้าง — ความสูงคงเดิม",
  "Tip: drag the corner handle of a text box to scale its size.": "เคล็ดลับ: ลากจุดที่มุมกล่องข้อความเพื่อย่อ/ขยายขนาด",
  "Sans (Helvetica)": "ไม่มีเชิง (Helvetica)", "Serif (Times)": "มีเชิง (Times)", "Mono (Courier)": "ความกว้างเท่ากัน (Courier)",
  "Standard (smallest file)": "มาตรฐาน (ไฟล์เล็กที่สุด)", "On this computer": "ในเครื่องนี้", "Search fonts…": "ค้นหาฟอนต์…",
  "Show all fonts on this PC…": "แสดงฟอนต์ทั้งหมดในเครื่องนี้…", "More fonts on this PC…": "ฟอนต์อื่นๆ ในเครื่องนี้…",
  // page tools
  "Merge PDFs…": "รวม PDF…", "Merge PDFs": "รวม PDF", Merge: "รวม", "Extract / split pages…": "แยก / แบ่งหน้า…", "Extract / split pages": "แยก / แบ่งหน้า",
  "Move to page…": "ย้ายไปหน้า…", "Page range…": "ช่วงหน้า…", "Page range": "ช่วงหน้า", Move: "ย้าย", Remove: "เอาออก", Make: "สร้าง",
  "Chosen pages → one new PDF": "หน้าที่เลือก → PDF ใหม่ 1 ไฟล์", "Each range → its own PDF": "แต่ละช่วง → PDF แยกไฟล์", "Every N pages → its own PDF": "ทุก N หน้า → PDF แยกไฟล์",
  "Move to page… (type the page number)": "ย้ายไปหน้า… (พิมพ์เลขหน้า)", "Extract / split pages: chosen pages into one PDF, or split into several PDF files": "แยก / แบ่งหน้า: หน้าที่เลือกเป็น PDF เดียว หรือแบ่งเป็นหลายไฟล์ PDF",
  "Split into several PDF files (by ranges or every N pages)": "แบ่งเป็นหลายไฟล์ PDF (ตามช่วงหน้าหรือทุก N หน้า)",
  "The files are joined in this order into one new PDF. The originals aren't changed.": "ไฟล์จะถูกรวมตามลำดับนี้เป็น PDF ใหม่ 1 ไฟล์ ไฟล์ต้นฉบับไม่เปลี่ยน",
  "Choose at least two files to merge.": "เลือกอย่างน้อย 2 ไฟล์เพื่อรวม",
  // live over the internet
  "Host over the internet": "เป็นโฮสต์ผ่านอินเทอร์เน็ต", "Host on the same network": "เป็นโฮสต์ในเครือข่ายเดียวกัน", "Invite people": "เชิญผู้อื่น",
  "Invite an editor": "เชิญผู้แก้ไข", "Invite view-only": "เชิญแบบดูอย่างเดียว", "End session": "จบเซสชัน", "Copy invitation": "คัดลอกคำเชิญ",
  "2. Paste their reply code": "2. วางรหัสตอบกลับของเขา", "Send this reply code to the host": "ส่งรหัสตอบกลับนี้ให้โฮสต์", "Copy reply code": "คัดลอกรหัสตอบกลับ",
  "Waiting for the host…": "กำลังรอโฮสต์…", "Nobody has joined yet.": "ยังไม่มีใครเข้าร่วม", "Joining…": "กำลังเข้าร่วม…",
};

const ZH: Dict = {
  "Other %…": "其他 %…", "Type a percentage.": "输入百分比。", "e.g. 135": "例如 135",
  "Zoom (type a percentage)": "缩放（输入百分比）", "Zoom: type a percentage, e.g. 135, or pick one": "缩放：输入百分比（如 135）或从列表选择",
  "Auto-save": "自动保存", "Auto-saving…": "正在自动保存…", "Auto-save is off.": "已关闭自动保存。", "Auto-save is on: changes are saved to the file 30 seconds after your last edit. Each save clears Undo.": "已开启自动保存：最后一次编辑 30 秒后保存到文件。每次保存会清除撤销记录。", "Auto-save is on, but only works in the PC app with files opened from this PC.": "已开启自动保存，但仅在电脑版中对本机打开的文件有效。",
  "Form data (CSV / JSON)…": "表单数据（CSV / JSON）…", "Form data (CSV)…": "表单数据（CSV）…", "This document has no form fields.": "此文档没有表单字段。", "None of the names in the file match this form's fields.": "文件中的名称与此表单的字段都不匹配。", "The file needs field names in the first row and values in the second.": "文件第一行应为字段名，第二行为值。",
  "Zoom to area": "缩放到区域", "Layers…": "图层…", "Layers": "图层", "Attachments…": "附件…", "Attachments": "附件", "Snapshot (copy an area as a picture)": "快照（将区域复制为图片）", "Drag a frame around the part to zoom in on.": "拖出一个框，框住要放大的部分。", "Drag a frame around the part to copy as a picture.": "拖出一个框，框住要复制为图片的部分。", "Picture copied. Paste it into LINE, Word or an email (Ctrl+V).": "图片已复制。可粘贴到 LINE、Word 或邮件中 (Ctrl+V)。", "Saved the picture as snapshot.png": "图片已保存为 snapshot.png", "Show or hide parts of the document. Only the view changes, not the file.": "显示或隐藏文档的部分内容。只改变显示，不改变文件。", "This document has no layers.": "此文档没有图层。", "This document has no attached files.": "此文档没有附件。", "(unnamed layer)": "（未命名图层）", "Save…": "保存…",
  "Page labels…": "页码标签…", "Page labels": "页码标签", "Number pages your way, e.g. i, ii, iii for the front pages, then 1, 2, 3.": "自定义页码，例如前几页用 i、ii、iii，之后用 1、2、3。", "From page": "从第几页", "Style": "样式", "Prefix": "前缀", "Start at": "起始于", "No number (prefix only)": "无数字（仅前缀）", "Remove this numbering": "删除此编号", "Plain numbers": "普通页码", "Plain page numbers (1, 2, 3…).": "普通页码（1、2、3…）。", "Apply": "应用",
  "Crop pages": "裁剪页面", "Remove crop": "取消裁剪", "Copy pages": "复制页面", "Cut pages to paste": "剪切页面", "Paste pages": "粘贴页面", "This page": "此页", "Keep only the part inside the frame. Undo or Edit › Pages › Remove crop brings the rest back.": "只保留框内部分。撤销或“编辑 › 页面 › 取消裁剪”可恢复其余部分。", "Drag a frame around the part of the page to keep.": "拖出一个框，框住要保留的部分。", "Copy or cut pages first (select them in the sidebar, Ctrl+C).": "请先复制或剪切页面（在侧边栏选择后按 Ctrl+C）。",
  "Print": "打印", "All of them": "全部", "Odd pages only": "仅奇数页", "Even pages only": "仅偶数页", "1 page per sheet": "每张 1 页", "2 pages per sheet": "每张 2 页", "4 pages per sheet": "每张 4 页", "6 pages per sheet": "每张 6 页", "Booklet (fold in half)": "小册子（对折）", "Paper": "纸张", "Same as the pages": "与页面相同", "Orientation": "方向", "Automatic": "自动", "Portrait": "纵向", "Landscape": "横向", "Reverse order": "倒序", "Black and white (grayscale)": "黑白（灰度）", "Print on both sides, flipping on the short edge, then fold the stack in half.": "双面打印（短边翻转），然后整叠对折。", "Several pages per sheet are printed on A4 unless you choose a paper size.": "每张多页时默认使用 A4，除非选择纸张大小。", "Previous sheet": "上一张", "Next sheet": "下一张", "Nothing to print": "没有可打印的内容", "Rendering pages for printing…": "正在准备打印页面…", "Preparing to print…": "正在准备打印…",
  "Comments": "批注", "Your name": "你的名字", "Shown on your comments": "显示在你的批注上", "All": "全部", "Done": "已完成", "Reopen": "重新打开", "Reply": "回复", "Reply…": "回复…", "Show": "显示", "No comments. Use the Comment tool (N) and click on the page.": "暂无批注。使用批注工具 (N) 并点击页面。", "Cloud": "云形", "Cloud (C)": "云形 (C)", "Eraser": "橡皮擦", "Eraser: drag over pen strokes (E)": "橡皮擦：拖过笔画 (E)",
  "Find a command…": "查找命令…", "Find a command": "查找命令", "Type a command…": "输入命令…", "Type a command": "输入命令", "No matching command": "没有匹配的命令", "Commands": "命令",
  "Revert to saved": "恢复到已保存版本", "Revert to saved?": "恢复到已保存版本？", "This removes the changes made since the file was last saved. You can still bring them back with Undo.": "这会移除上次保存后的更改。仍可用撤销恢复。", "Revert": "恢复", "No unsaved changes.": "没有未保存的更改。", "Back to the saved version.": "已恢复到保存的版本。",
  // menu bar
  "File": "文件", "Edit": "编辑", "View": "视图", "Tools": "工具", "Help": "帮助", "New PDF from photos…": "从照片新建 PDF…", "Open…": "打开…", "Open recent": "最近打开", "No recent files": "没有最近的文件", "Save with password…": "用密码保存…", "Save smaller copy…": "保存较小的副本…", "Import": "导入", "Pages from other PDF…": "其他 PDF 的页面…", "Image…": "图片…", "Blank page": "空白页", "Pages as images (PNG/JPG)…": "页面导出为图片 (PNG/JPG)…", "Split into PDF files…": "拆分为多个 PDF…", "Selected pages as PDF…": "所选页面导出为 PDF…", "Word document…": "Word 文档…", "Excel workbook…": "Excel 工作簿…", "PDF/A archive copy…": "PDF/A 存档副本…", "Print…": "打印…", "Print labels…": "打印标签…", "Close tab": "关闭标签页", "Undo": "撤销", "Redo": "重做", "Find…": "查找…", "Delete selected": "删除所选", "Stamp…": "印章…", "Page numbers…": "页码…", "Watermark…": "水印…", "Headers / footers / Bates…": "页眉 / 页脚 / Bates…", "Edit existing text…": "编辑现有文字…", "Create form fields…": "创建表单字段…", "Comments…": "批注…", "Bookmarks…": "书签…", "Redact by search…": "按搜索涂黑…", "Remove hidden information…": "删除隐藏信息…", "Cut pages…": "裁切页面…", "Delete pages": "删除页面", "Zoom in": "放大", "Zoom out": "缩小", "Split view": "分屏", "Compare with another PDF…": "与另一个 PDF 比较…", "Night reading": "夜间阅读", "Light / dark theme": "浅色 / 深色主题", "Read aloud": "朗读", "Mark this position": "标记此位置", "Recognize text (OCR)…": "识别文字 (OCR)…", "Measure distance / area…": "测量距离 / 面积…", "Find QR codes": "查找二维码", "Add QR code…": "添加二维码…", "Certificate signature…": "证书签名…", "Batch actions…": "批量操作…", "All professional tools…": "全部专业工具…", "Work together live…": "实时协作…", "Connect Claude…": "连接 Claude…", "PDF engine settings…": "PDF 引擎设置…", "Keyboard shortcuts": "键盘快捷键", "Check for updates…": "检查更新…", "About PDF Studio & credits": "关于 PDF Studio 与致谢",
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
  // tool settings
  "Light theme": "浅色主题", "Dark theme": "深色主题", "Highlight options": "高亮选项", "Text options": "文字选项",
  Font: "字体", Opacity: "不透明度", "Line thickness": "线条粗细", "Highlight opacity": "高亮不透明度", "Highlight color": "高亮颜色",
  Sans: "无衬线", Serif: "衬线", Mono: "等宽", Width: "宽", Height: "高", Custom: "自定义", "Other color": "其他颜色",
  "Font size: pick one or type any size": "字号：选择或输入任意大小",
  "Free — drag any box": "自由 — 拖出任意大小", "Fixed size — same height every time": "固定大小 — 每次高度相同",
  "Fixed size: click to place a Width × Height highlight, or drag sideways to set the width — the height stays the same.":
    "固定大小：单击放置 宽 × 高 的高亮，或横向拖动设置宽度 — 高度保持不变。",
  "Tip: drag the corner handle of a text box to scale its size.": "提示：拖动文本框角上的控制点可缩放大小。",
  "Sans (Helvetica)": "无衬线 (Helvetica)", "Serif (Times)": "衬线 (Times)", "Mono (Courier)": "等宽 (Courier)",
  "Standard (smallest file)": "标准（文件最小）", "On this computer": "本机字体", "Search fonts…": "搜索字体…",
  "Show all fonts on this PC…": "显示本机所有字体…", "More fonts on this PC…": "本机更多字体…",
  // page tools
  "Merge PDFs…": "合并 PDF…", "Merge PDFs": "合并 PDF", Merge: "合并", "Extract / split pages…": "提取 / 拆分页面…", "Extract / split pages": "提取 / 拆分页面",
  "Move to page…": "移到第几页…", "Page range…": "页面范围…", "Page range": "页面范围", Move: "移动", Remove: "移除", Make: "生成",
  "Chosen pages → one new PDF": "所选页面 → 一个新 PDF", "Each range → its own PDF": "每个范围 → 单独的 PDF", "Every N pages → its own PDF": "每 N 页 → 单独的 PDF",
  "Move to page… (type the page number)": "移到第几页…（输入页码）", "Extract / split pages: chosen pages into one PDF, or split into several PDF files": "提取 / 拆分页面：所选页面合成一个 PDF，或拆分为多个 PDF 文件",
  "Split into several PDF files (by ranges or every N pages)": "拆分为多个 PDF 文件（按范围或每 N 页）",
  "The files are joined in this order into one new PDF. The originals aren't changed.": "文件按此顺序合并为一个新 PDF，原文件不变。",
  "Choose at least two files to merge.": "请至少选择两个文件进行合并。",
  // live over the internet
  "Host over the internet": "通过互联网主持", "Host on the same network": "在同一网络中主持", "Invite people": "邀请他人",
  "Invite an editor": "邀请编辑者", "Invite view-only": "邀请仅查看者", "End session": "结束会话", "Copy invitation": "复制邀请",
  "2. Paste their reply code": "2. 粘贴对方的回复码", "Send this reply code to the host": "将此回复码发送给主持人", "Copy reply code": "复制回复码",
  "Waiting for the host…": "正在等待主持人…", "Nobody has joined yet.": "还没有人加入。", "Joining…": "正在加入…",
};

const TEMPLATES: Record<Exclude<Lang, "en">, Templates> = {
  th: [
    ["Saved {s}", "บันทึก {s} แล้ว"],
    ["{n} labels sent to the printer. {s}", "ส่งใบปะหน้า {n} ใบไปที่เครื่องพิมพ์แล้ว {s}"],
    ["Searching… {n} of {n} files{s}", "กำลังค้นหา… {n} จาก {n} ไฟล์{s}"],
    ["{n} matches in {n} of {n} files{s}", "พบ {n} รายการ ใน {n} จาก {n} ไฟล์{s}"],
    ["{n} found · searching {n}%", "พบ {n} · กำลังค้นหา {n}%"],
    ["Sheet {n} of {n}", "แผ่นที่ {n} จาก {n}"],
    ["Copied {n} page{s}. Paste with Ctrl+V after the page you choose.", "คัดลอก {n} หน้าแล้ว วางด้วย Ctrl+V หลังหน้าที่เลือก"],
    ["Cut {n} page{s}. Paste with Ctrl+V after the page you choose.", "ตัด {n} หน้าแล้ว วางด้วย Ctrl+V หลังหน้าที่เลือก"],
    ["Pasted {n} page{s}.", "วาง {n} หน้าแล้ว"],
    ["Auto-saved {s}", "บันทึกอัตโนมัติ {s} แล้ว"],
    ["Filled {n} field{s} from {s}.", "กรอก {n} ช่องจาก {s} แล้ว"],
    ["Saved {n} fields to {s}", "บันทึก {n} ช่องลงใน {s} แล้ว"],
    ["+ Numbering from page {n}", "+ กำหนดเลขตั้งแต่หน้า {n}"],
    ["Page {s} ({n} of {n})", "หน้า {s} ({n} จาก {n})"],
    ["Selected pages ({n})", "หน้าที่เลือก ({n})"],
    ["All pages ({n})", "ทุกหน้า ({n})"],
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
    ["Sheet {n} of {n}", "第 {n} 张，共 {n} 张"],
    ["Copied {n} page{s}. Paste with Ctrl+V after the page you choose.", "已复制 {n} 页。在选定页面后按 Ctrl+V 粘贴。"],
    ["Cut {n} page{s}. Paste with Ctrl+V after the page you choose.", "已剪切 {n} 页。在选定页面后按 Ctrl+V 粘贴。"],
    ["Pasted {n} page{s}.", "已粘贴 {n} 页。"],
    ["Auto-saved {s}", "已自动保存 {s}"],
    ["Filled {n} field{s} from {s}.", "已从 {s} 填写 {n} 个字段。"],
    ["Saved {n} fields to {s}", "已将 {n} 个字段保存到 {s}"],
    ["+ Numbering from page {n}", "+ 从第 {n} 页开始编号"],
    ["Page {s} ({n} of {n})", "第 {s} 页（{n}/{n}）"],
    ["Selected pages ({n})", "所选页面 ({n})"],
    ["All pages ({n})", "全部页面 ({n})"],
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
