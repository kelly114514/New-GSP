// 发布版不弹出控制台窗口；不要删除这一行。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    gsp_plus_lib::run()
}
