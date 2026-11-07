#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs::{self, OpenOptions}, io::Write, path::{Path, PathBuf}, sync::atomic::{AtomicU64, Ordering}};
use tauri::Manager;

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

fn atomic_save(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let ext = target.extension().and_then(|s| s.to_str()).map(|s| s.to_ascii_lowercase());
    let magic_ok = match ext.as_deref() {
        Some("gsp") => bytes.starts_with(b"GSP4"),
        Some("ngsp") => bytes.starts_with(b"NGSP1
"),
        _ => return Err("请选择 .gsp 或 .ngsp 文件".into()),
    };
    if bytes.len() > 100 * 1024 * 1024 || !magic_ok {
        return Err("文件数据无效或超过大小限制".into());
    }
    let parent = target.parent().ok_or("保存路径没有父目录")?;
    let (path, mut file) = (0..100).find_map(|_| {
        let n = NEXT_TEMP.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!(".new-gsp-{}-{n}.tmp", std::process::id()));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => Some((path, file)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => None,
            Err(_) => None,
        }
    }).ok_or("无法在目标目录创建临时文件")?;
    let outcome = (|| -> Result<(), String> {
        file.write_all(bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        if fs::read(&path).map_err(|e| e.to_string())? != bytes { return Err("写入校验失败".into()); }
        fs::rename(&path, target).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if outcome.is_err() { let _ = fs::remove_file(&path); }
    outcome
}

#[tauri::command]
fn save_gsp(path: String, bytes: Vec<u8>) -> Result<(), String> {
    atomic_save(Path::new(&path), &bytes)
}


#[tauri::command]
fn read_gsp(path: String) -> Result<Vec<u8>, String> {
    let p = Path::new(&path);
    let ext = p.extension().and_then(|s| s.to_str()).map(|s| s.to_ascii_lowercase());
    if ext.as_deref() != Some("gsp") && ext.as_deref() != Some("ngsp") {
        return Err("请选择 .gsp 或 .ngsp 文件".into());
    }
    let meta = fs::metadata(p).map_err(|e| e.to_string())?;
    if meta.len() > 200 * 1024 * 1024 { return Err("文件超过大小限制".into()); }
    fs::read(p).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let ok = (url.starts_with("http://") || url.starts_with("https://")) && url.len() < 2000 && !url.chars().any(|c| c.is_whitespace() || c == '"' || c == '<' || c == '>' || c == '^' || c == '&' || c == '|');
    if !ok { return Err("只能打开 http/https 网址".into()); }
    std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", &url]).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// 读系统剪贴板里的图片：用 PowerShell 取出并存成临时 PNG（WebView2 的 navigator.clipboard.read 会弹权限提示，不可用）。没有图片返回 None。
#[tauri::command]
fn read_clipboard_image() -> Result<Option<Vec<u8>>, String> {
    use std::os::windows::process::CommandExt;
    let tmp = std::env::temp_dir().join(format!("new-gsp-clip-{}.png", std::process::id()));
    let script = format!("Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; if ([System.Windows.Forms.Clipboard]::ContainsImage()) {{ $i = [System.Windows.Forms.Clipboard]::GetImage(); $i.Save('{}', [System.Drawing.Imaging.ImageFormat]::Png); $i.Dispose(); 'ok' }}", tmp.display());
    let out = std::process::Command::new("powershell").args(["-NoProfile", "-STA", "-Command", &script]).creation_flags(0x0800_0000).output().map_err(|e| e.to_string())?;
    if !String::from_utf8_lossy(&out.stdout).contains("ok") { let _ = fs::remove_file(&tmp); return Ok(None); }
    let bytes = fs::read(&tmp).map_err(|e| e.to_string())?; let _ = fs::remove_file(&tmp);
    Ok(Some(bytes))
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) { app.exit(0); }

fn recovery_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 桌面集成测试使用自己的恢复目录，避免读取、提示或改动用户的恢复快照。
    let dir = if let Some(path) = std::env::var_os("NEW_GSP_TEST_RECOVERY_DIR") {
        let path = PathBuf::from(path);
        if !path.is_absolute() { return Err("测试恢复目录需要绝对路径".into()); }
        path
    } else {
        app.path().app_data_dir().map_err(|e| e.to_string())?.join("recovery")
    };
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}
fn recovery_name(name: &str) -> Result<String, String> {
    if name.is_empty() || name.len() > 80 || !name.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') { return Err("快照名无效".into()); }
    Ok(format!("{name}.recovery.json"))
}

#[tauri::command]
fn recovery_write(app: tauri::AppHandle, name: String, text: String) -> Result<(), String> {
    let path = recovery_dir(&app)?.join(recovery_name(&name)?);
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, text.as_bytes()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn recovery_list(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let mut out = vec![];
    for e in fs::read_dir(recovery_dir(&app)?).map_err(|e| e.to_string())? {
        let n = e.map_err(|e| e.to_string())?.file_name().to_string_lossy().to_string();
        if let Some(stem) = n.strip_suffix(".recovery.json") { out.push(stem.to_string()); }
    }
    Ok(out)
}

#[tauri::command]
fn recovery_read(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let path = recovery_dir(&app)?.join(recovery_name(&name)?);
    if !path.exists() { return Ok(None); }
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn recovery_delete(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let path = recovery_dir(&app)?.join(recovery_name(&name)?);
    if path.exists() { fs::remove_file(path).map_err(|e| e.to_string())?; }
    Ok(())
}

/// 列出文件夹里的 .gsp 文件名（只看这一层，按名称排序，最多 1000 个）。工具文件夹用。
#[tauri::command]
fn list_gsp_files(dir: String) -> Result<Vec<String>, String> {
    let mut out: Vec<String> = vec![];
    for e in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        if !e.file_type().map_err(|e| e.to_string())?.is_file() { continue; }
        let name = e.file_name().to_string_lossy().to_string();
        if name.to_ascii_lowercase().ends_with(".gsp") { out.push(name); }
    }
    out.sort();
    out.truncate(1000);
    Ok(out)
}

/// 把 src 里的 .gsp 复制到应用数据目录的 tools 文件夹（同名覆盖），返回目标路径和复制个数。
#[tauri::command]
fn import_tool_folder(app: tauri::AppHandle, src: String) -> Result<(String, usize), String> {
    let dest = app.path().app_data_dir().map_err(|e| e.to_string())?.join("tools");
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    let mut n = 0;
    for name in list_gsp_files(src.clone())? {
        let from = Path::new(&src).join(&name);
        if fs::metadata(&from).map_err(|e| e.to_string())?.len() > 200 * 1024 * 1024 { continue; }
        fs::copy(&from, dest.join(&name)).map_err(|e| e.to_string())?;
        n += 1;
    }
    Ok((dest.to_string_lossy().to_string(), n))
}

/// 应用数据目录里的 tools 文件夹路径（可能还不存在）。
#[tauri::command]
fn local_tool_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("tools").to_string_lossy().to_string())
}

#[tauri::command]
fn launch_args() -> Vec<String> {
    std::env::args().skip(1).filter(|a| is_document_arg(a)).collect()
}

fn is_document_arg(arg: &str) -> bool {
    matches!(Path::new(arg).extension().and_then(|s| s.to_str()).map(|s| s.to_ascii_lowercase()).as_deref(), Some("gsp" | "ngsp"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_gsp, read_gsp, open_url, read_clipboard_image, exit_app, recovery_write, recovery_list, recovery_read, recovery_delete, launch_args, list_gsp_files, import_tool_folder, local_tool_dir])
        .run(tauri::generate_context!())
        .expect("无法启动新版");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn launch_accepts_both_document_formats() {
        for path in [r"C:\课件\测试.gsp", r"C:\课件\测试.NGSP", "文件.GSP"] { assert!(is_document_arg(path)); }
        for path in ["课件.gsp.bak", "notes.txt", "--flag", "folder.ngsp/file"] { assert!(!is_document_arg(path)); }
    }
    #[test]
    fn replace_only_after_successful_validation() {
        let dir = std::env::temp_dir().join(format!("new-gsp-atomic-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("中文.gsp"); fs::write(&target, b"original").unwrap();
        assert!(atomic_save(&target, b"bad").is_err());
        assert_eq!(fs::read(&target).unwrap(), b"original");
        atomic_save(&target, b"GSP4test").unwrap();
        assert!(atomic_save(&dir.join("x.txt"), b"GSP4test").is_err());
        assert_eq!(fs::read(&target).unwrap(), b"GSP4test");
        fs::remove_file(target).unwrap(); fs::remove_dir(dir).unwrap();
    }
}
