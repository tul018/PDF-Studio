# PDF Studio

A fast, crash-resistant **PDF viewer and editor for Windows and iOS/iPadOS**, built with [Tauri 2](https://tauri.app) (a native shell using the system WebView), [PDF.js](https://mozilla.github.io/pdf.js/) for rendering and [pdf-lib](https://pdf-lib.js.org/) for saving.

It is designed around the most common complaint about PDF apps: **crashing or freezing on big, image-heavy files.** Memory is bounded by design. The test suite opens a 261 MB, 400-page photo PDF and flings through it, and render memory stays around **15 MB**.

See **[docs/RESEARCH.md](docs/RESEARCH.md)** for the full analysis of why other viewers crash and how each problem is handled here.

## Features

| | |
|---|---|
| **View** | Continuous scroll, fit width/page, zoom 10–800%, pinch and Ctrl+wheel zoom, thumbnails, outline, links, search with highlighted hits, text selection and copy, dark mode, print |
| **Split view** | Two independent panes of the same PDF, e.g. page 3 next to page 70. Each pane has its own scroll position, zoom and page box. **Ctrl+\\** or the *Split* button |
| **Marks** | Mark your current position (**M** or **Ctrl+D**), name it, and click it in the *Marks* tab to jump back. Marks are saved per file |
| **Annotate** | Highlight (select text, then click Highlight), text, freehand ink (Apple Pencil / Windows Ink), box, circle, line, arrow, comments (real PDF sticky notes), images, signature, white-out |
| **Redact** | True redaction: the page is re-rendered with the content under the boxes removed, not just covered |
| **Pages** | Rotate, delete, drag to reorder, insert blank page, merge PDFs, extract pages |
| **Forms** | Fill text, checkbox, radio, dropdown and list fields |
| **Safety** | Edits are non-destructive until you save. Saves are atomic. Unsaved edits are autosaved and can be restored after a crash. Undo/redo |

## Project layout

```
src/
  core/        device memory profile, virtual layout, render queue, LRU, byte-range sources
  viewer/      virtualized viewer, thumbnails, search, forms/links, gestures
  edit/        edit model, undo history, annotation overlay & tools, marks, crash recovery
  save/        pdf-lib save pipeline (runs in a Web Worker)
  platform/    Windows / iOS / browser bridge (open, save, links)
  ui/          dialogs, signature pad, icons, print
src-tauri/     Rust shell: byte-range file reads, atomic writes, iOS Documents saving
tests/unit     Vitest: layout, render queue, budgets, viewport maths, model, save pipeline
tests/e2e      Playwright: open/search, 400-page stress test, annotate+save, redaction, forms, marks, split view, iPad profile
```

## Develop

Requirements: Node 20+ and, for native builds, Rust (stable) plus the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run dev          # browser at http://localhost:1420 (fastest UI iteration)
npm run app:dev      # native desktop window (Tauri)
npm test             # unit tests
npm run e2e          # end-to-end tests (generates test PDFs, builds, runs Playwright)
npm run typecheck
```

## Build for Windows

On a Windows machine (or use the **Build apps** GitHub Actions workflow):

```bash
npm run app:build
# -> src-tauri/target/release/bundle/nsis/PDF Studio_0.1.0_x64-setup.exe
# -> src-tauri/target/release/bundle/msi/PDF Studio_0.1.0_x64_en-US.msi
```

The installer registers PDF Studio as a `.pdf` handler ("Open with"), and installs the WebView2 runtime if it is missing.

## Build for iPhone / iPad

Requires a Mac with Xcode, and an Apple Developer account to install on a device.

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
npm run ios:init                 # generates src-tauri/gen/apple (Xcode project)
npm run ios:dev                  # run in the simulator or on a connected device
npm run ios:build                # release build (.ipa); set APPLE_DEVELOPMENT_TEAM
```

`src-tauri/Info.ios.plist` turns on *File Sharing* and *Open in Place*. Saved PDFs then appear in **Files › On My iPhone/iPad › PDF Studio**, and PDFs can be opened from the Files app. If your Tauri CLI version doesn't merge this file automatically, copy its keys into `src-tauri/gen/apple/pdf-studio_iOS/Info.plist` after `ios:init`.

## Keyboard shortcuts

| Action | Keys |
|---|---|
| Open / Save / Save as / Print | Ctrl+O / Ctrl+S / Ctrl+Shift+S / Ctrl+P |
| Undo / Redo | Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) |
| Find, next / previous | Ctrl+F, Enter / Shift+Enter (F3) |
| Zoom in / out / fit width | Ctrl+= / Ctrl+- / Ctrl+0 (or Ctrl+wheel) |
| Split view | Ctrl+\\ |
| Mark position | M or Ctrl+D |
| First / last page | Home / End |
| Tools | V select · H pan · U highlight · T text · P draw · R box · O circle · L line · A arrow · N comment |
| Delete selected annotation | Del |

On macOS, use Cmd instead of Ctrl.

## Known limitations

See the roadmap at the end of [docs/RESEARCH.md](docs/RESEARCH.md): OCR, certificate (PKI) signatures, editing existing text, native annotations for every type, compression/PDF-A, incremental save, XFA forms, and optional AI features. Saving still loads the full file into memory (viewing never does). The app warns before saving very large files on iOS.
