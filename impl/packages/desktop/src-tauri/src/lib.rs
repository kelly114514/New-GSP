/// 启动桌面应用。
///
/// 插件：
/// - dialog：系统“打开文件”和“另存为”对话框；
/// - fs：读写文件。能访问哪些路径由 capabilities/default.json 决定；
///   没有静态路径范围，只有经 dialog 选中的文件才可读写。
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("启动 GSP-plus 失败");
}
