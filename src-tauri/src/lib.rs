//! Native side of PDF Studio.
//!
//! The UI never asks for a whole file: PDF.js requests byte ranges, which are
//! served here straight from disk. That is what lets multi-gigabyte PDFs open
//! instantly with a flat memory footprint on Windows and iOS.

use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Manager;

/// Upper bound for a single range read (PDF.js asks for 256 KiB chunks).
const MAX_RANGE: u64 = 64 * 1024 * 1024;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Size and last-modified time (ms since 1970). Together with the path they
/// tell whether a file changed since unsaved edits to it were autosaved.
#[tauri::command]
fn file_info(path: String) -> Result<(u64, u64), String> {
    let meta = fs::metadata(&path).map_err(err)?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Ok((meta.len(), modified))
}

#[tauri::command]
fn read_range(path: String, offset: u64, length: u64) -> Result<Response, String> {
    let length = length.min(MAX_RANGE);
    let mut f = File::open(&path).map_err(err)?;
    f.seek(SeekFrom::Start(offset)).map_err(err)?;
    let mut buf = Vec::with_capacity(length as usize);
    f.take(length).read_to_end(&mut buf).map_err(err)?;
    // Raw binary response: no JSON/base64 encoding of the bytes.
    Ok(Response::new(buf))
}

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    fs::read(&path).map(Response::new).map_err(err)
}

/// Write to a temp file in the same folder, flush to disk, then rename over
/// the target. A crash or power loss mid-save can never leave a half-written
/// PDF - the original stays intact until the new file is complete.
fn atomic_write(target: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = target.parent().unwrap_or_else(|| Path::new("."));
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "document.pdf".into());
    let tmp = dir.join(format!(".{name}.pdfstudio-tmp"));
    {
        let mut f = File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    if let Err(e) = fs::rename(&tmp, target) {
        let _ = fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

fn header(request: &Request<'_>, key: &str) -> Result<String, String> {
    let raw = request
        .headers()
        .get(key)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| format!("missing '{key}' header"))?;
    Ok(percent_decode_str(raw).decode_utf8_lossy().into_owned())
}

fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes),
        _ => Err("expected a binary body".into()),
    }
}

#[tauri::command]
fn write_file(request: Request<'_>) -> Result<(), String> {
    let path = PathBuf::from(header(&request, "path")?);
    if path.extension().map(|e| !e.eq_ignore_ascii_case("pdf")).unwrap_or(true) {
        return Err("only .pdf files can be written".into());
    }
    atomic_write(&path, raw_body(&request)?).map_err(err)
}

/// iOS/iPadOS: save into the app's Documents folder, which is visible in the
/// Files app (UIFileSharingEnabled / LSSupportsOpeningDocumentsInPlace).
#[tauri::command]
fn save_to_documents(app: tauri::AppHandle, request: Request<'_>) -> Result<String, String> {
    let dir = app.path().document_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    let target = new_file_in(&dir, &header(&request, "name")?);
    atomic_write(&target, raw_body(&request)?).map_err(err)?;
    Ok(target.to_string_lossy().into_owned())
}

/// Kinds of file the app may create: PDFs and exported page images.
const NEW_FILE_TYPES: [&str; 7] = ["pdf", "png", "jpg", "jpeg", "docx", "xlsx", "json"];

/// A new file named `name` in `dir`, never replacing an existing one
/// ("name (1).pdf", "name (2).pdf"...). Path separators in the name are
/// neutralized; any other extension gets ".pdf" added.
fn new_file_in(dir: &Path, name: &str) -> PathBuf {
    let safe: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '\0' | '<' | '>' | '"' | '|' | '?' | '*') { '_' } else { c })
        .collect();
    let safe = safe.trim().trim_start_matches('.').to_string();
    let (stem, ext) = match safe.rsplit_once('.') {
        Some((s, e)) if NEW_FILE_TYPES.contains(&e.to_lowercase().as_str()) => (s.to_string(), e.to_string()),
        _ => (safe.clone(), "pdf".to_string()),
    };
    let stem = if stem.is_empty() { "document".to_string() } else { stem };
    let mut target = dir.join(format!("{stem}.{ext}"));
    let mut n = 1;
    while target.exists() {
        target = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    target
}

/// Save one of several files (split parts, page images) into a folder the
/// user chose, without overwriting anything there. Returns the path used.
#[tauri::command]
fn write_new_file(request: Request<'_>) -> Result<String, String> {
    let dir = PathBuf::from(header(&request, "dir")?);
    if !dir.is_dir() {
        return Err(format!("not a folder: {}", dir.display()));
    }
    let target = new_file_in(&dir, &header(&request, "name")?);
    atomic_write(&target, raw_body(&request)?).map_err(err)?;
    Ok(target.to_string_lossy().into_owned())
}

/// PDFs passed on the command line ("Open with", double-click on Windows).
#[tauri::command]
fn initial_files() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|a| a.to_lowercase().ends_with(".pdf") && Path::new(a).is_file())
        .collect()
}

/// One PDF found by `list_pdfs`: path, size, last-modified time (ms).
#[derive(serde::Serialize)]
struct PdfEntry {
    path: String,
    size: u64,
    modified: u64,
}

/// Most PDFs a folder search will list (a guard against picking a whole drive).
const MAX_LISTED: usize = 20_000;

/// Every PDF in `dir` and its subfolders (folder search). Hidden folders and
/// files (".git", "$RECYCLE.BIN"...) are skipped; symlinks are not followed.
fn collect_pdfs(dir: &Path, depth: u32, out: &mut Vec<PdfEntry>) {
    if depth > 12 || out.len() >= MAX_LISTED {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name.starts_with('$') {
            continue;
        }
        let Ok(kind) = entry.file_type() else { continue };
        let path = entry.path();
        if kind.is_dir() {
            collect_pdfs(&path, depth + 1, out);
        } else if kind.is_file() && name.to_lowercase().ends_with(".pdf") {
            let Ok(meta) = entry.metadata() else { continue };
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(PdfEntry { path: path.to_string_lossy().into_owned(), size: meta.len(), modified });
        }
        if out.len() >= MAX_LISTED {
            return;
        }
    }
}

#[tauri::command]
fn list_pdfs(dir: String) -> Result<Vec<PdfEntry>, String> {
    let root = Path::new(&dir);
    if !root.is_dir() {
        return Err(format!("not a folder: {dir}"));
    }
    let mut out = Vec::new();
    collect_pdfs(root, 0, &mut out);
    out.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(out)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(desktop)]
            if app.config().plugins.0.contains_key("updater") {
                // Updates are optional. An unconfigured/offline build must still open.
                if let Err(error) = app.handle().plugin(tauri_plugin_updater::Builder::new().build()) {
                    eprintln!("Automatic updates are unavailable: {error}");
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            file_info,
            read_range,
            read_file,
            write_file,
            save_to_documents,
            initial_files,
            list_pdfs,
            write_new_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running PDF Studio");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_file() {
        let dir = std::env::temp_dir().join(format!("pdfstudio-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("a.pdf");
        fs::write(&target, b"old").unwrap();
        atomic_write(&target, b"%PDF-new").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"%PDF-new");
        assert!(!dir.join(".a.pdf.pdfstudio-tmp").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn new_files_never_overwrite_and_stay_in_the_folder() {
        let dir = std::env::temp_dir().join(format!("pdfstudio-new-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let a = new_file_in(&dir, "page 1.png");
        assert_eq!(a.file_name().unwrap(), "page 1.png");
        fs::write(&a, b"x").unwrap();
        assert_eq!(new_file_in(&dir, "page 1.png").file_name().unwrap(), "page 1 (1).png");
        assert_eq!(new_file_in(&dir, r"..\evil.exe").parent().unwrap(), dir.as_path());
        assert_eq!(new_file_in(&dir, "../../evil.pdf").parent().unwrap(), dir.as_path());
        assert!(new_file_in(&dir, "evil.exe").to_string_lossy().ends_with(".pdf"));
        assert_eq!(new_file_in(&dir, "Part 2.PDF").file_name().unwrap(), "Part 2.PDF");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn list_pdfs_finds_nested_pdfs_and_skips_hidden() {
        let dir = std::env::temp_dir().join(format!("pdfstudio-list-{}", std::process::id()));
        fs::create_dir_all(dir.join("sub/deeper")).unwrap();
        fs::create_dir_all(dir.join(".hidden")).unwrap();
        for p in ["a.pdf", "sub/B.PDF", "sub/deeper/c.pdf", ".hidden/x.pdf", "notes.txt"] {
            fs::write(dir.join(p), b"%PDF-1.4").unwrap();
        }
        let found = list_pdfs(dir.to_string_lossy().into_owned()).unwrap();
        let names: Vec<_> = found.iter().map(|e| Path::new(&e.path).file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(names, vec!["a.pdf", "B.PDF", "c.pdf"]);
        assert!(found.iter().all(|e| e.size == 8));
        assert!(list_pdfs(dir.join("a.pdf").to_string_lossy().into_owned()).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }
}
