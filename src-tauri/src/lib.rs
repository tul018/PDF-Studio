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
    let name = header(&request, "name")?;
    let safe: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '\0') { '_' } else { c })
        .collect();
    let safe = if safe.to_lowercase().ends_with(".pdf") { safe } else { format!("{safe}.pdf") };
    let dir = app.path().document_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    let stem = safe.trim_end_matches(".pdf").trim_end_matches(".PDF").to_string();
    let mut target = dir.join(&safe);
    let mut n = 1;
    while target.exists() {
        target = dir.join(format!("{stem} ({n}).pdf"));
        n += 1;
    }
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            file_info,
            read_range,
            read_file,
            write_file,
            save_to_documents,
            initial_files
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
}
