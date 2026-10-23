/// 启动桌面应用。
///
/// 插件：
/// - dialog：系统“打开文件”对话框；
/// - fs：读取文件。能读哪些路径由 capabilities/default.json 决定（目前只允许读，
///   没有静态路径范围，只有经 dialog 选中的文件才可读）。
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("启动 GSP-plus 失败");
}
