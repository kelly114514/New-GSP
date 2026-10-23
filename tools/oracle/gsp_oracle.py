#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""gsp_oracle.py - 驱动原版几何画板 5 (GSP5chs.exe) 导出对照输出 (EMF / HTML)。

子命令:
  setup                          准备 oracle/runtime 并校验 exe 哈希
  probe                          启动原版, 列出菜单、文件类型、窗口 (排障用)
  export --in F --out-dir D [--emf] [--html]
  batch  --list L --out-dir D [--resume] [--timeout S] [--emf] [--html]

实现方式: 纯 Win32 消息自动化 (pywin32), 不依赖 UI Automation, 不发送鼠标/键盘输入。
  * 文件(&F) 里的命令直接 PostMessage(WM_COMMAND, 命令ID) 给主窗口: 打开 0x9001, 另存为 0x9005, 关闭 0x9006。
  * 打开/另存为是标准 Win32 通用对话框(#32770), 直接对其控件发消息:
    文件名 Edit、保存类型 ComboBox(1136)、IDOK。
  * 其余弹窗(消息框等)按规则处理并全部记录进 manifest。
详见 tools/oracle/README.md。
"""
import argparse
import ctypes
import datetime
import glob
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

try:
    import win32api
    import win32con
    import win32gui
    import win32process
except ImportError:  # pragma: no cover
    sys.exit("需要 pywin32: tools/oracle/.venv/Scripts/python.exe -m pip install -r tools/oracle/requirements.txt")

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "tools"))
import emf_dump  # noqa: E402

ORIGINAL_DIR = REPO / "original" / "sketchpad5"
RUNTIME = REPO / "oracle" / "runtime"
STATE = REPO / "oracle" / "state"
WORK = REPO / "oracle" / "work"
EXE_NAME = "GSP5chs.exe"
EXE_SHA256 = "bf22c09822ad2da66f8e3655e5a9cbd6c8e494feaf78690cf118f9261887c7b3"

# 命令 ID (见 reference/features/menu-commands.md 与运行时菜单转储; 有文档窗口时的菜单)
CMD_OPEN = 0x9001
CMD_SAVE_AS = 0x9005
CMD_CLOSE = 0x9006
CMD_NEW = 0x9000
CMD_STOP_ANIM = 0x9038  # 显示(&D) → 停止动画(&S)
CMD_OPEN_NODOC = 0xE101  # 无文档时的菜单 ID (资源 128)

# 另存为对话框的"保存类型"下标 (运行时核对过)
FT_GSP, FT_GSP4, FT_HTML, FT_EMF = 0, 1, 2, 3

DLG_CLASS = "#32770"
MAIN_CLASS = "GSP5MainWin"
IGNORED_CLASSES = {MAIN_CLASS, "DXBuffer", "MSCTFIME UI", "IME", "GDI+ Hook Window Class",
                   "OleDdeWndClass", "#32768", "tooltips_class32", "ComboLBox"}

DETACHED = 0x00000008
NEW_GROUP = 0x00000200
BREAKAWAY = 0x01000000


class OracleError(Exception):
    pass


class JobTimeout(OracleError):
    pass


class AppDied(OracleError):
    pass


class DialogProblem(OracleError):
    pass


class OpenRejected(OracleError):
    """原版弹窗拒绝打开该文件 (损坏/非画板文件); 会话仍干净, 不需要重启。"""


def now_iso():
    return datetime.datetime.now().isoformat(timespec="seconds")


def sha256_file(p, bufsize=1 << 20):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        while True:
            b = f.read(bufsize)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def log(*a):
    print(*a, flush=True)


# --------------------------------------------------------------------------- runtime 准备

def ensure_runtime():
    """复制 exe 与 Support Files 到 oracle/runtime, 并校验 exe 哈希。"""
    src_exe = ORIGINAL_DIR / EXE_NAME
    dst_exe = RUNTIME / EXE_NAME
    RUNTIME.mkdir(parents=True, exist_ok=True)
    if not dst_exe.exists():
        if not src_exe.exists():
            raise OracleError("找不到原版: %s" % src_exe)
        if sha256_file(src_exe) != EXE_SHA256:
            raise OracleError("original/sketchpad5/GSP5chs.exe 哈希不符, 拒绝使用")
        shutil.copy2(src_exe, dst_exe)
    sup_src, sup_dst = ORIGINAL_DIR / "Support Files", RUNTIME / "Support Files"
    if not sup_dst.exists() and sup_src.exists():
        shutil.copytree(sup_src, sup_dst)
    got = sha256_file(dst_exe)
    if got != EXE_SHA256:
        raise OracleError("runtime exe 哈希 %s != %s" % (got, EXE_SHA256))
    return dst_exe


# --------------------------------------------------------------------------- Win32 小工具

def pid_alive(pid):
    try:
        h = win32api.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    except Exception:
        return False
    try:
        return win32process.GetExitCodeProcess(h) == 259  # STILL_ACTIVE
    finally:
        win32api.CloseHandle(h)


def proc_image(pid):
    try:
        h = win32api.OpenProcess(0x1000, False, pid)
    except Exception:
        return None
    try:
        buf = ctypes.create_unicode_buffer(1024)
        n = ctypes.c_ulong(1024)
        if ctypes.windll.kernel32.QueryFullProcessImageNameW(int(h), 0, buf, ctypes.byref(n)):
            return buf.value
    finally:
        win32api.CloseHandle(h)
    return None


def proc_creation(pid):
    try:
        h = win32api.OpenProcess(0x1000, False, pid)
    except Exception:
        return None
    try:
        return int(win32process.GetProcessTimes(h)["CreationTime"])
    except Exception:
        return None
    finally:
        win32api.CloseHandle(h)


def cpu_seconds(pid):
    try:
        h = win32api.OpenProcess(0x1000, False, pid)
    except Exception:
        return None
    try:
        t = win32process.GetProcessTimes(h)
        return (int(t["KernelTime"]) + int(t["UserTime"])) / 1e7
    except Exception:
        return None
    finally:
        win32api.CloseHandle(h)


def terminate_pid(pid):
    try:
        h = win32api.OpenProcess(0x0001, False, pid)  # PROCESS_TERMINATE
    except Exception:
        return
    try:
        win32api.TerminateProcess(h, 1)
    except Exception:
        pass
    finally:
        win32api.CloseHandle(h)


def top_windows(pid):
    out = []

    def cb(h, _):
        try:
            if win32process.GetWindowThreadProcessId(h)[1] == pid:
                out.append(h)
        except Exception:
            pass
        return True

    win32gui.EnumWindows(cb, None)
    return out


def child_windows(h):
    out = []
    try:
        win32gui.EnumChildWindows(h, lambda c, _: out.append(c) or True, None)
    except Exception:
        pass
    return out


def gtext(h):
    try:
        return win32gui.GetWindowText(h)
    except Exception:
        return ""


def gclass(h):
    try:
        return win32gui.GetClassName(h)
    except Exception:
        return ""


_u32a = ctypes.WinDLL("user32", use_last_error=True)
_u32a.SendMessageTimeoutW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t,
                                      ctypes.c_uint, ctypes.c_uint, ctypes.POINTER(ctypes.c_size_t)]
_u32a.SendMessageTimeoutW.restype = ctypes.c_ssize_t
_u32b = ctypes.WinDLL("user32", use_last_error=True)
_u32b.SendMessageTimeoutW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_wchar_p,
                                      ctypes.c_uint, ctypes.c_uint, ctypes.POINTER(ctypes.c_size_t)]
_u32b.SendMessageTimeoutW.restype = ctypes.c_ssize_t


def responsive(h, ms=500):
    """SendMessageTimeout(WM_NULL): 窗口线程是否在泵消息。"""
    res = ctypes.c_size_t(0)
    r = _u32a.SendMessageTimeoutW(h, win32con.WM_NULL, 0, 0, 0x2 | 0x1, ms, ctypes.byref(res))  # ABORTIFHUNG|BLOCK
    return bool(r)


def send_text(h, text, timeout_ms=3000):
    res = ctypes.c_size_t(0)
    ok = _u32b.SendMessageTimeoutW(h, win32con.WM_SETTEXT, 0, text, 0x2, timeout_ms, ctypes.byref(res))
    return bool(ok)


_u32c = ctypes.WinDLL("user32", use_last_error=True)
_u32c.SendMessageTimeoutW.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_size_t, ctypes.c_void_p,
                                      ctypes.c_uint, ctypes.c_uint, ctypes.POINTER(ctypes.c_size_t)]
_u32c.SendMessageTimeoutW.restype = ctypes.c_ssize_t


def get_text_msg(h, timeout_ms=3000):
    """用 WM_GETTEXT 读控件文字 (GetWindowText 读不到别的进程里 Edit 的内容)。"""
    res = ctypes.c_size_t(0)
    if not _u32c.SendMessageTimeoutW(h, win32con.WM_GETTEXTLENGTH, 0, None, 0x2, timeout_ms, ctypes.byref(res)):
        return ""
    n = res.value
    buf = ctypes.create_unicode_buffer(n + 2)
    if not _u32c.SendMessageTimeoutW(h, win32con.WM_GETTEXT, n + 1, ctypes.cast(buf, ctypes.c_void_p), 0x2, timeout_ms, ctypes.byref(res)):
        return ""
    return buf.value


def send_msg(h, msg, wparam=0, lparam=0, timeout_ms=5000):
    """SendMessageTimeout 封装: 目标无响应时抛 OracleError, 而不是永远阻塞。"""
    res = ctypes.c_size_t(0)
    ok = _u32a.SendMessageTimeoutW(h, msg, wparam, lparam, 0x2 | 0x1, timeout_ms, ctypes.byref(res))  # ABORTIFHUNG|BLOCK
    if not ok:
        raise OracleError("窗口无响应 (消息 0x%x)" % msg)
    return res.value


def combo_items(combo):
    out = []
    n = win32gui.SendMessage(combo, win32con.CB_GETCOUNT, 0, 0)
    for i in range(max(0, n)):
        L = win32gui.SendMessage(combo, win32con.CB_GETLBTEXTLEN, i, 0)
        buf = ctypes.create_unicode_buffer(max(L, 0) + 2)
        ctypes.windll.user32.SendMessageW(combo, win32con.CB_GETLBTEXT, i, buf)
        out.append(buf.value)
    return out


def menu_dump(m, depth=0, max_items=400):
    out = []
    n = win32gui.GetMenuItemCount(m)
    for i in range(min(n, max_items)):
        buf = ctypes.create_unicode_buffer(256)
        ctypes.windll.user32.GetMenuStringW(m, i, buf, 256, win32con.MF_BYPOSITION)
        sub = win32gui.GetSubMenu(m, i)
        e = {"pos": i, "text": buf.value, "id": win32gui.GetMenuItemID(m, i) & 0xFFFFFFFF}
        if sub:
            e["sub"] = menu_dump(sub, depth + 1, 40 if buf.value.startswith("文本") else max_items)
        out.append(e)
    return out


class IdleTracker:
    """跟踪原版进程“最后一次忙”的时刻 (CPU>5% 或界面线程无响应)。idle_for() = 已连续空闲的秒数。"""

    def __init__(self, sess):
        self.sess = sess
        self.busy = time.time()
        self.cpu = cpu_seconds(sess.pid)
        self.t = time.time()

    def update(self):
        now = time.time()
        c = cpu_seconds(self.sess.pid)
        if c is not None and self.cpu is not None and (c - self.cpu) / max(now - self.t, 1e-3) > 0.05:
            self.busy = now
        self.cpu, self.t = c, now
        if not responsive(self.sess.main, 200):
            self.busy = now
        return now - self.busy

    def mark_busy(self):
        self.busy = time.time()


# --------------------------------------------------------------------------- 应用会话

class Session:
    """持有一个原版进程; 负责启动/重启/关闭、弹窗处理、命令发送。"""

    def __init__(self, show="min", screenshots=None, verbose=False):
        self.proc = None
        self.pid = None
        self.main = None
        self.show = show
        self.verbose = verbose
        self.screenshots = screenshots
        self.dialogs = []          # 当前 job 内记录的弹窗
        self.t0 = time.time()      # job 起点 (记录弹窗相对时间)
        self.deadline = None
        self.restarts = 0
        self._handled = {}
        self._seen = {}
        self._ignore = set()
        self._disabled_since = None
        self.settled = True
        self.animation_stopped = False
        self.baseline_docs = None

    # ---- 生命周期
    def kill_stale(self):
        f = STATE / "pid.json"
        if not f.exists():
            return None
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            pid = d["pid"]
        except Exception:
            f.unlink(missing_ok=True)
            return None
        if pid_alive(pid) and proc_creation(pid) == d.get("creation") and (proc_image(pid) or "").lower() == str(RUNTIME / EXE_NAME).lower():
            terminate_pid(pid)
            time.sleep(0.5)
            f.unlink(missing_ok=True)
            return pid
        f.unlink(missing_ok=True)
        return None

    def start(self, timeout=40):
        exe = ensure_runtime()
        STATE.mkdir(parents=True, exist_ok=True)
        stale = self.kill_stale()
        if stale:
            log("  [session] 已结束上次遗留的进程 PID %d" % stale)
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = 7 if self.show == "min" else 1   # SW_SHOWMINNOACTIVE / SW_SHOWNORMAL
        flags = DETACHED | NEW_GROUP | BREAKAWAY
        try:
            self.proc = subprocess.Popen([str(exe)], cwd=str(RUNTIME), creationflags=flags, startupinfo=si, close_fds=True)
        except OSError:
            self.proc = subprocess.Popen([str(exe)], cwd=str(RUNTIME), creationflags=DETACHED | NEW_GROUP, startupinfo=si, close_fds=True)
        self.pid = self.proc.pid
        (STATE / "pid.json").write_text(json.dumps({"pid": self.pid, "creation": proc_creation(self.pid), "started": now_iso()}), encoding="utf-8")
        t_end = time.time() + timeout
        self.main = None
        while time.time() < t_end:
            if self.proc.poll() is not None:
                raise AppDied("启动后进程立即退出, 退出码 %s" % self.proc.returncode)
            for h in top_windows(self.pid):
                if gclass(h) == MAIN_CLASS and win32gui.IsWindowVisible(h):
                    self.main = h
            if self.main and responsive(self.main, 1000) and self.mdi_titles():
                break
            time.sleep(0.2)
        if not self.main:
            self.stop()
            raise OracleError("启动超时: 未出现主窗口")
        if self.show == "min" and not win32gui.IsIconic(self.main):
            win32gui.ShowWindow(self.main, win32con.SW_SHOWMINNOACTIVE)  # 程序可能恢复了上次的窗口位置, 强制最小化
            time.sleep(0.3)
        self.settle(8)
        self.baseline_docs = len(self.mdi_titles())
        self._handled = {}
        self._seen = {}
        return self.pid

    def alive(self):
        return self.proc is not None and self.proc.poll() is None and pid_alive(self.pid)

    def stop(self, graceful=True):
        if not self.proc:
            return
        try:
            if graceful and self.alive() and self.main:
                try:
                    win32gui.PostMessage(self.main, win32con.WM_CLOSE, 0, 0)
                except Exception:
                    pass
                t_end = time.time() + 6
                while time.time() < t_end and self.alive():
                    for d in self.visible_dialogs():
                        self._auto_dialog(d, "shutdown", silent=True)
                    time.sleep(0.2)
            if self.alive():
                terminate_pid(self.pid)
                for _ in range(25):
                    if not self.alive():
                        break
                    time.sleep(0.2)
        finally:
            try:
                (STATE / "pid.json").unlink(missing_ok=True)
            except Exception:
                pass
            self.proc = None
            self.main = None

    def restart(self, why=""):
        self.restarts += 1
        log("  [session] 重启原版 (%s)" % why)
        self.stop(graceful=False)
        time.sleep(0.5)
        return self.start()

    # ---- 窗口信息
    def title(self):
        return gtext(self.main) if self.main else ""

    def mdi_client(self):
        for c in child_windows(self.main):
            if gclass(c) == "MDIClient":
                return c
        return None

    def mdi_titles(self):
        cl = self.mdi_client()
        if not cl:
            return []
        out = []
        k = win32gui.GetWindow(cl, win32con.GW_CHILD)
        while k:
            out.append(gtext(k))
            k = win32gui.GetWindow(k, win32con.GW_HWNDNEXT)
        return out

    def visible_dialogs(self):
        res = []
        for h in top_windows(self.pid):
            if h == self.main or not win32gui.IsWindowVisible(h):
                continue
            c = gclass(h)
            if c in IGNORED_CLASSES:
                continue
            if c == DLG_CLASS:
                res.append(h)
        return res

    def other_windows(self):
        res = []
        for h in top_windows(self.pid):
            if h == self.main or not win32gui.IsWindowVisible(h):
                continue
            c = gclass(h)
            if c in IGNORED_CLASSES or c == DLG_CLASS:
                continue
            res.append({"class": c, "title": gtext(h)})
        return res

    # ---- 弹窗
    @staticmethod
    def is_file_dialog(h):
        ids = {win32gui.GetDlgCtrlID(c) for c in child_windows(h)}
        return 1136 in ids and 1148 in ids

    @staticmethod
    def dialog_info(h):
        statics, buttons, others = [], [], {}
        for c in child_windows(h):
            cc, tx = gclass(c), gtext(c)
            if cc == "Static":
                if tx.strip():
                    statics.append(tx.strip())
            elif cc == "Button":
                if win32gui.IsWindowVisible(c):
                    buttons.append({"id": win32gui.GetDlgCtrlID(c), "text": tx})
            elif win32gui.IsWindowVisible(c):
                others[cc] = others.get(cc, 0) + 1
        return {"class": gclass(h), "title": gtext(h), "text": " | ".join(statics), "buttons": buttons, "controls": others}

    @staticmethod
    def decide(info):
        """返回 (按钮ID, 理由, 是否已知类型)。原则: 不保存、不替换、其余信息框点确定。"""
        btns = {b["id"]: b["text"] for b in info["buttons"]}
        text = info["title"] + " " + info["text"]
        if not btns:
            return None, "无按钮", False
        if len(btns) == 1:
            only = next(iter(btns))
            return only, "单按钮信息框", True
        if 7 in btns and re.search(r"保存|更改|修改", text):
            return 7, "拒绝保存更改(否)", True
        if 2 in btns and 6 in btns and 7 in btns:
            return 7, "三选项对话框选“否”", False
        if 1 in btns and len(btns) == 1:
            return 1, "信息框确定", True
        if 1 in btns and 2 in btns:
            return 2, "确定/取消对话框选取消", False
        if 1 in btns:
            return 1, "确定", False
        if 7 in btns:
            return 7, "否", False
        if 2 in btns:
            return 2, "取消", False
        return info["buttons"][0]["id"], "首个按钮", False

    def _auto_dialog(self, h, stage, silent=False):
        info = self.dialog_info(h)
        now = time.time()
        st = self._handled.get(h)
        if st is None:
            st = self._handled[h] = {"first": now, "last": 0.0, "n": 0}
        # 进度条对话框 (如“正在打开…”, 没有按钮): 不碰, 等它自己消失。只在第一次看到时记一笔。
        if not info["buttons"] and "msctls_progress32" in info["controls"]:
            if st["n"] == 0:
                st["n"] = 1
                if not silent:
                    rec = dict(info)
                    rec.update(stage=stage, t=round(now - self.t0, 2), action=(None, "进度条: 不操作, 等待消失"), known=True)
                    self.dialogs.append(rec)
            return
        if now - st["last"] < 1.5 and st["n"] > 0:
            return  # 点击已发出, 给目标线程时间处理 (载入大文件时界面线程可能很忙)
        bid, why, known = self.decide(info)
        st["n"] += 1
        st["last"] = now
        if st["n"] == 1:
            rec = dict(info)
            rec.update(stage=stage, t=round(now - self.t0, 2), action=(bid, why), known=known)
            if not silent:
                self.dialogs.append(rec)
                if not known:
                    log("  [dialog?] 未登记弹窗 stage=%s title=%r text=%r buttons=%s -> %s" % (stage, info["title"], info["text"][:80], info["buttons"], why))
                elif self.verbose:
                    log("  [dialog] %r %r -> %s" % (info["title"], info["text"][:60], why))
        if st["n"] >= 9:
            raise DialogProblem("弹窗无法关闭: %r %r" % (info["title"], info["text"][:100]))
        if st["n"] >= 4 or bid is None:
            try:
                win32gui.PostMessage(h, win32con.WM_CLOSE, 0, 0)
            except Exception:
                pass
            return
        btn = win32gui.GetDlgItem(h, bid)
        win32gui.PostMessage(h, win32con.WM_COMMAND, (0 << 16) | (bid & 0xFFFF), btn)

    def _prune(self):
        """窗口句柄会被系统复用: 已不可见/已销毁的对话框要从状态表里清掉, 免得新对话框继承旧状态。"""
        for tbl in (self._handled, self._seen):
            for h in list(tbl):
                try:
                    alive = win32gui.IsWindow(h) and win32gui.IsWindowVisible(h)
                except Exception:
                    alive = False
                if not alive:
                    del tbl[h]

    # ---- 等待与泵
    def check_alive(self):
        if not self.alive():
            rc = self.proc.poll() if self.proc else None
            raise AppDied("原版进程已退出 (退出码 %s)" % (rc if rc is not None else "未知, 可能被外部结束"))

    def check_deadline(self, what):
        if self.deadline and time.time() > self.deadline:
            raise JobTimeout("超时: %s" % what)

    def pump(self, stage, cond=None, expect_file_dialog=None, poll=0.05, what=""):
        """循环: 处理意外弹窗; 条件成立返回 ('cond', None); 期望的文件对话框出现返回 ('dialog', hwnd)。"""
        while True:
            self.check_alive()
            self.check_deadline(what or stage)
            self._prune()
            for d in self.visible_dialogs():
                if d in self._ignore:
                    continue
                if expect_file_dialog and gtext(d) in expect_file_dialog:
                    if self.is_file_dialog(d):
                        return "dialog", d
                    first = self._seen.setdefault(d, time.time())
                    if time.time() - first < 2.0:
                        continue  # 通用对话框先显示、后创建子控件, 给它一点时间; 超过 2 秒仍无文件名框则当消息框处理
                self._auto_dialog(d, stage)
            if cond is not None:
                try:
                    if cond():
                        return "cond", None
                except OracleError:
                    raise
                except Exception:
                    pass  # 窗口句柄瞬间失效之类的竞态, 下一轮再判
            # 主窗口被禁用却看不到标准对话框: 说明有非标准模态窗口, 记录并关闭
            if self.main and not win32gui.IsWindowEnabled(self.main) and not self.visible_dialogs():
                self._disabled_since = self._disabled_since or time.time()
                if time.time() - self._disabled_since > 2.0:
                    for w in self.other_windows():
                        self.dialogs.append({"stage": stage, "title": w["title"], "class": w["class"], "text": "(非标准模态窗口)",
                                             "buttons": [], "action": (None, "WM_CLOSE"), "known": False, "t": round(time.time() - self.t0, 2)})
                    for h in top_windows(self.pid):
                        if h != self.main and win32gui.IsWindowVisible(h) and gclass(h) not in IGNORED_CLASSES and gclass(h) != DLG_CLASS:
                            win32gui.PostMessage(h, win32con.WM_CLOSE, 0, 0)
                    self._disabled_since = time.time()
            else:
                self._disabled_since = None
            time.sleep(poll)

    def settle(self, max_s, stage="settle"):
        """等主线程空闲: 响应消息, 且进程 CPU 占用 < 5% 连续 0.4 秒。返回是否真正空闲。"""
        t_end = time.time() + max_s
        idle_since = None
        last_c, last_t = cpu_seconds(self.pid), time.time()
        while time.time() < t_end:
            self.check_alive()
            for d in self.visible_dialogs():
                self._auto_dialog(d, stage)
                idle_since = None
            if not responsive(self.main, 300):
                idle_since = None
                time.sleep(0.1)
                last_c, last_t = cpu_seconds(self.pid), time.time()
                continue
            time.sleep(0.15)
            c, t = cpu_seconds(self.pid), time.time()
            if c is not None and last_c is not None and (c - last_c) / max(t - last_t, 1e-3) < 0.05 and self.main and win32gui.IsWindowEnabled(self.main):
                idle_since = idle_since or t
                if t - idle_since >= 0.4:
                    return True
            else:
                idle_since = None
            last_c, last_t = c, t
        return False

    # ---- 命令
    def post_cmd(self, cmd):
        win32gui.PostMessage(self.main, win32con.WM_COMMAND, cmd, 0)

    def has_doc(self):
        return len(self.mdi_titles()) > 0

    def set_file_dialog(self, d, path, ftype=None):
        if ftype is not None:
            combo = win32gui.GetDlgItem(d, 1136)
            send_msg(combo, win32con.CB_SETCURSEL, ftype, 0)
            send_msg(d, win32con.WM_COMMAND, (win32con.CBN_SELCHANGE << 16) | 1136, combo)
            if send_msg(combo, win32con.CB_GETCURSEL, 0, 0) != ftype:
                raise OracleError("无法选择保存类型 %d" % ftype)
        edit = None
        for c in child_windows(d):
            if gclass(c) == "Edit" and win32gui.GetDlgCtrlID(c) == 1148:
                edit = c
                break
        if not edit:
            raise OracleError("对话框里找不到文件名编辑框")
        if not send_text(edit, str(path)):
            raise OracleError("设置文件名超时")
        got = get_text_msg(edit)
        if got != str(path):
            raise OracleError("文件名写入失败: %r != %r" % (got, str(path)))

    def click_ok(self, d, stage):
        """点确定, 并等这个文件对话框真正关闭 (期间它不当作意外弹窗处理)。
        若点确定后出现错误框、文件对话框却一直不关 (如路径非法), 取消它并报错, 不拖到总超时。"""
        self._ignore.add(d)
        t_click = time.time()
        idle = IdleTracker(self)
        n_dlg = len(self.dialogs)
        win32gui.PostMessage(d, win32con.WM_COMMAND, 1, win32gui.GetDlgItem(d, 1))

        def gone():
            if not (win32gui.IsWindow(d) and win32gui.IsWindowVisible(d)):
                return True
            if time.time() - t_click > 4 and idle.update() > 2.0:
                msgs = [x["text"] for x in self.dialogs[n_dlg:]]
                win32gui.PostMessage(d, win32con.WM_COMMAND, 2, win32gui.GetDlgItem(d, 2))
                time.sleep(0.3)
                raise OracleError("文件对话框点确定后没有关闭: %s" % ("; ".join(msgs) or "无错误弹窗"))
            return False

        try:
            self.pump(stage, cond=gone, what="等待对话框关闭")
        finally:
            self._ignore.discard(d)

    # ---- 阶段: 打开
    def open_file(self, path):
        before = len(self.mdi_titles())
        self.post_cmd(CMD_OPEN if self.has_doc() else CMD_OPEN_NODOC)
        kind, d = self.pump("open", expect_file_dialog={"打开"}, what="等待打开对话框")
        self.set_file_dialog(d, path)
        n_dlg = sum(1 for x in self.dialogs if x["stage"] == "open")
        self.click_ok(d, "open")
        idle = IdleTracker(self)

        def opened():
            if self.visible_dialogs():
                idle.mark_busy()      # 弹窗还在 (含刚点过、尚未消失的): 不下结论
                return False
            titles = self.mdi_titles()
            # 打开失败时原版会先建一个空标题的 MDI 子窗口, 弹错误框, 关掉后再销毁它; 所以要求标题非空
            if len(titles) > before and "" not in titles:
                return True
            # 点“确定”后出现过弹窗, 之后进程已空闲 2 秒仍没有新文档 => 打开失败, 不等到总超时
            if sum(1 for x in self.dialogs if x["stage"] == "open") > n_dlg and idle.update() > 2.0:
                msgs = [(x["title"] + ": " + x["text"]) for x in self.dialogs if x["stage"] == "open"][n_dlg:]
                raise OpenRejected("原版拒绝打开: %s" % "; ".join(msgs))
            idle.update()
            return False

        self.pump("open", cond=opened, what="等待文档载入")
        self.settled = self.settle(min(6, max(2, (self.deadline - time.time()) if self.deadline else 6)), "open")
        self.animation_stopped = False
        if not self.settled:
            # 文档在自动播放动画 (CPU 一直忙): 发“停止动画”命令再等一下. 导出的是停止那一刻的帧, 不可复现, 会在 manifest 里标记
            self.post_cmd(CMD_STOP_ANIM)
            self.animation_stopped = True
            self.settled = self.settle(4, "open")
        return self.mdi_titles()[0] if self.mdi_titles() else ""

    # ---- 阶段: 另存为
    def save_as(self, out_path, ftype):
        if os.path.exists(out_path):
            os.remove(out_path)
        self.post_cmd(CMD_SAVE_AS)
        kind, d = self.pump("save_as", expect_file_dialog={"另存为"}, what="等待另存为对话框")
        self.set_file_dialog(d, out_path, ftype)
        self.click_ok(d, "save_as")
        # 等文件出现并大小稳定. 若对话框已关、进程已空闲却始终没有文件 (如空白页的 EMF), 返回 None
        st = {"size": -1, "since": 0.0}
        idle = IdleTracker(self)
        result = {"produced": None}

        def done():
            if any(self.is_file_dialog(x) for x in self.visible_dialogs()):
                idle.mark_busy()
                return False
            now = time.time()
            quiet = idle.update()
            if not os.path.exists(out_path):
                if quiet > 1.5:
                    result["produced"] = False
                    return True
                return False
            sz = os.path.getsize(out_path)
            if sz != st["size"]:
                st["size"], st["since"] = sz, now
                return False
            if sz > 0 and now - st["since"] >= 0.35:
                result["produced"] = True
                return True
            return False

        self.pump("save_as", cond=done, what="等待导出文件")
        return out_path if result["produced"] else None

    # ---- 阶段: 关闭文档
    def close_doc(self, expect_count):
        self.post_cmd(CMD_CLOSE)
        self.pump("close", cond=lambda: len(self.mdi_titles()) <= expect_count, what="等待关闭文档")
        self.settle(4, "close")

    def clean_extra_docs(self, max_tries=6):
        """job 间的保险: 关闭所有多余文档, 回到基线文档数。"""
        for _ in range(max_tries):
            n = len(self.mdi_titles())
            if self.baseline_docs is None or n <= self.baseline_docs:
                return True
            self.post_cmd(CMD_CLOSE)
            t_end = time.time() + 5
            while time.time() < t_end and len(self.mdi_titles()) >= n:
                for d in self.visible_dialogs():
                    self._auto_dialog(d, "cleanup")
                time.sleep(0.1)
        return len(self.mdi_titles()) <= (self.baseline_docs or 0)

    # ---- 排障
    def screenshot(self, path):
        try:
            import win32ui
            from PIL import Image
        except Exception:
            return False
        try:
            h = self.main
            l, t, r, b = win32gui.GetWindowRect(h)
            w, hh = max(r - l, 1), max(b - t, 1)
            hdc = win32gui.GetWindowDC(h)
            mfc = win32ui.CreateDCFromHandle(hdc)
            save = mfc.CreateCompatibleDC()
            bmp = win32ui.CreateBitmap()
            bmp.CreateCompatibleBitmap(mfc, w, hh)
            save.SelectObject(bmp)
            ctypes.windll.user32.PrintWindow(h, save.GetSafeHdc(), 2)
            info = bmp.GetInfo()
            im = Image.frombuffer("RGB", (info["bmWidth"], info["bmHeight"]), bmp.GetBitmapBits(True), "raw", "BGRX", 0, 1)
            im.save(path)
            win32gui.DeleteObject(bmp.GetHandle())
            save.DeleteDC()
            mfc.DeleteDC()
            win32gui.ReleaseDC(h, hdc)
            return True
        except Exception:
            return False


# --------------------------------------------------------------------------- 单文件作业

def safe_input_name(name):
    """输入副本文件名: 保持原名(让 HTML 标题一致), 仅当不能无损经过 ANSI 对话框时才替换。"""
    try:
        name.encode("gbk")
        ok = not any(c in name for c in '*?"<>|')
    except UnicodeEncodeError:
        ok = False
    if ok:
        return name
    return "input_" + hashlib.sha1(name.encode("utf-8")).hexdigest()[:10] + ".gsp"


def check_html(path):
    try:
        t = Path(path).read_bytes().decode("utf-8", errors="replace")
    except Exception as e:
        return {"valid": False, "issues": [str(e)]}
    issues = []
    if "<APPLET" not in t:
        issues.append("no <APPLET>")
    if "NAME=Construction" not in t:
        issues.append("no Construction param")
    if "</HTML>" not in t.upper():
        issues.append("no </HTML>")
    objs = len(re.findall(r"^\{\d+\}", t, flags=re.M))
    m = re.search(r"<APPLET[^>]*WIDTH=(\d+) HEIGHT=(\d+)", t)
    out = {"valid": not issues, "issues": issues, "construction_steps": objs}
    if m:
        out["canvas"] = [int(m.group(1)), int(m.group(2))]
    return out


def out_paths(out_dir, rel):
    rp = Path(rel)
    base = Path(out_dir) / rp.parent / rp.stem
    return {"emf": Path(str(base) + ".emf"), "html": Path(str(base) + ".htm")}


def describe_output(p, kind):
    d = {"path": str(p), "size": p.stat().st_size, "sha256": sha256_file(p)}
    if kind == "emf":
        raw = p.read_bytes()
        q = emf_dump.quick_check(raw)
        d.update(valid=q["ok"], n_records=q["n_records"], has_emfplus=q.get("has_emfplus"),
                 draw_records=q.get("draw_records"), frame_mm=q.get("frame_mm"))
        if q["issues"]:
            d["issues"] = q["issues"]
        if q["ok"] and len(raw) <= 64 * 1024 * 1024:
            try:   # 图元级摘要: 字节哈希每次都会因 EMF+ 对象槽位号/LOGFONT 填充字节变化, 它不会
                d["canon_sha256"] = emf_dump.canonical_digest(emf_dump.parse_emf(raw, with_records=False))
            except Exception as e:  # noqa
                d["canon_error"] = "%s: %s" % (type(e).__name__, e)
    else:
        d.update(check_html(p))
    return d


def run_job(sess, src, rel, want, out_dir, timeout, job_no=0, shots=None):
    """打开 src -> 导出 want 中的格式 -> 关闭。返回 manifest 条目。"""
    t_start = time.time()
    entry = {"input": rel, "input_size": os.path.getsize(src), "input_sha256": sha256_file(src), "started": now_iso()}
    sess.dialogs = []
    sess.t0 = t_start
    sess.deadline = t_start + timeout
    stage_t = {}
    outputs = {}
    status, err, soft_fail = "ok", None, False
    # 原版在“打开”后会把进程当前目录切到输入文件所在目录, 目录因此删不掉; 所以用固定的 in/out 目录, 每个 job 只清文件
    jobdir = WORK
    for sub in ("in", "out"):
        (jobdir / sub).mkdir(parents=True, exist_ok=True)
        for f in (jobdir / sub).iterdir():
            try:
                f.unlink() if f.is_file() else shutil.rmtree(f, ignore_errors=True)
            except OSError:
                pass
    work_in = jobdir / "in" / safe_input_name(Path(src).name)
    shutil.copy2(src, work_in)
    opened = False
    try:
        sess.check_alive()
        if not sess.clean_extra_docs():
            raise OracleError("无法清理残留文档")
        n_before = len(sess.mdi_titles())
        t = time.time()
        title = sess.open_file(str(work_in))
        stage_t["open"] = round(time.time() - t, 2)
        opened = True
        entry["doc_title"] = title
        entry["window_title"] = sess.title()
        entry["main_iconic"] = bool(win32gui.IsIconic(sess.main))
        if not sess.settled:
            entry["busy_after_open"] = True
            entry.setdefault("notes", []).append("打开后 CPU 一直不空闲 (多半是自动播放的动画); 已发送“停止动画”命令, 导出的是停止后的画面 (Sample.gsp 实测两次一致, 不保证所有文件都可复现)")
        if sess.animation_stopped:
            entry["animation_stop_sent"] = True
        od = [d for d in sess.dialogs if d["stage"] == "open"]
        if od:
            entry.setdefault("notes", []).append("打开时出现 %d 个弹窗 (见 dialogs); 文档标题 %r" % (len(od), title))
        ow = sess.other_windows()
        if ow:
            entry["other_windows"] = ow
        for kind, ftype, ext in (("emf", FT_EMF, ".emf"), ("html", FT_HTML, ".htm")):
            if kind not in want:
                continue
            t = time.time()
            tmp = jobdir / "out" / (Path(work_in.name).stem + ext)  # HTML 的 <TITLE>/页脚取自保存文件名, 所以保持与输入同名
            made = sess.save_as(str(tmp), ftype)
            stage_t[kind] = round(time.time() - t, 2)
            if made is None:
                outputs[kind] = {"produced": False}
                entry.setdefault("notes", []).append("%s: 原版没有写出文件 (对话框正常关闭, 无错误弹窗)" % kind)
                continue
            dest = out_paths(out_dir, rel)[kind]
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(tmp), str(dest))
            outputs[kind] = describe_output(dest, kind)
            extra = [f.name for f in (jobdir / "out").iterdir()]
            if extra:  # 例如 jsp5.jar 之类的副产物
                entry.setdefault("side_files", []).extend(extra)
        t = time.time()
        sess.close_doc(n_before)
        stage_t["close"] = round(time.time() - t, 2)
        opened = False
        # 输出有效性
        bad = [k for k, v in outputs.items() if v.get("produced", True) and not v.get("valid", True)]
        if bad:
            status, err = "failed", "输出校验失败: %s" % ", ".join("%s: %s" % (k, outputs[k].get("issues")) for k in bad)
        if not any(v.get("produced", True) for v in outputs.values()):
            if status == "ok":
                status, err = "ok", None  # 原版对该文件确实不产生任何导出 (见 notes), 不算失败
    except JobTimeout as e:
        status, err = "timeout", str(e)
    except AppDied as e:
        status, err = "failed", "进程崩溃/退出: %s" % e
    except OpenRejected as e:
        status, err, soft_fail = "failed", str(e), True
    except DialogProblem as e:
        status, err = "failed", "弹窗: %s" % e
    except Exception as e:  # noqa
        status, err = "failed", "%s: %s" % (type(e).__name__, e)
        entry["traceback"] = traceback.format_exc(limit=6)
    entry["outputs"] = outputs
    entry["dialogs"] = sess.dialogs
    entry["stage_seconds"] = stage_t
    entry["status"] = status
    entry["error"] = err
    entry["seconds"] = round(time.time() - t_start, 2)
    # 失败: 现场取证 + 重启
    if status != "ok":
        if shots and sess.alive():
            try:
                shots.mkdir(parents=True, exist_ok=True)
                sp = shots / (re.sub(r"[^0-9A-Za-z_.-]", "_", Path(rel).stem)[:40] + "_%d.png" % job_no)
                if sess.screenshot(str(sp)):
                    entry["screenshot"] = str(sp)
            except Exception:
                pass
        clean = False
        if soft_fail:   # 原版干净地拒绝了文件: 只要文档数回到基线、界面有响应, 就不用重启
            try:
                clean = sess.alive() and responsive(sess.main, 1000) and sess.clean_extra_docs() and not sess.visible_dialogs()
            except Exception:
                clean = False
        entry["restarted"] = not clean
        if not clean:
            try:
                sess.restart("%s: %s" % (status, (err or "")[:60]))
            except Exception as e:  # noqa
                entry["restart_error"] = str(e)
    for sub in ("in", "out"):
        for f in (jobdir / sub).glob("*"):
            try:
                f.unlink()
            except OSError:
                pass
    sess.deadline = None
    return entry


# --------------------------------------------------------------------------- 清单与断点续跑

def read_manifest(mf):
    done = {}
    if Path(mf).exists():
        with open(mf, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except Exception:
                    continue
                done[e["input"]] = e
    return done


def append_manifest(mf, entry):
    with open(mf, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())


def expand_list(spec, root):
    """spec: .txt 清单文件(每行一个路径或 glob, # 注释) 或 glob 表达式。返回排好序的 Path 列表。"""
    pats = []
    p = Path(spec)
    if p.is_file() and p.suffix.lower() in (".txt", ".lst", ".list"):
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                pats.append(line)
    else:
        pats.append(spec)
    found = []
    for pat in pats:
        cands = [pat] if os.path.isabs(pat) else [str(Path.cwd() / pat), str(root / pat)]
        hit = []
        for c in cands:
            hit = glob.glob(c, recursive=True)
            if hit:
                break
        found.extend(Path(h) for h in hit if Path(h).is_file())
    seen, out = set(), []
    for f in sorted(found, key=lambda x: str(x).lower()):
        r = f.resolve()
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


def rel_of(p, root):
    try:
        return p.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return p.resolve().as_posix()


class RunLock:
    def __init__(self):
        STATE.mkdir(parents=True, exist_ok=True)
        self.f = STATE / "oracle.lock"

    def __enter__(self):
        if self.f.exists():
            try:
                pid = int(self.f.read_text().strip())
            except Exception:
                pid = 0
            if pid and pid != os.getpid() and pid_alive(pid) and "python" in (proc_image(pid) or "").lower():
                raise OracleError("已有另一个 gsp_oracle 在运行 (PID %d); 它们共用同一个原版实例, 不能并行" % pid)
        self.f.write_text(str(os.getpid()))
        return self

    def __exit__(self, *a):
        self.f.unlink(missing_ok=True)


def run_batch(files, out_dir, want, timeout, resume, root, show, retries, skip_failed, shots, verbose, recycle=150):
    out_dir = Path(out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    mf = out_dir / "manifest.jsonl"
    done = read_manifest(mf) if resume else {}
    if not resume and mf.exists():
        bak = out_dir / ("manifest.%s.jsonl.bak" % datetime.datetime.now().strftime("%Y%m%d-%H%M%S"))
        mf.rename(bak)
        log("已有 manifest 改名为 %s (使用 --resume 可续跑)" % bak.name)
    todo = []
    for f in files:
        rel = rel_of(f, root)
        e = done.get(rel)
        if e and resume:
            ok_outputs = all(Path(v["path"]).exists() for v in e.get("outputs", {}).values())
            wanted_present = all(k in e.get("outputs", {}) for k in want)
            if e.get("status") == "ok" and ok_outputs and wanted_present and e.get("input_sha256") == sha256_file(f):
                continue
            if e.get("status") in ("failed", "timeout") and skip_failed:
                continue
        todo.append((f, rel))
    log("共 %d 个输入, 待处理 %d (已完成 %d)" % (len(files), len(todo), len(files) - len(todo)))
    if not todo:
        return summarize(read_manifest(mf), files, root)
    sess = Session(show=show, verbose=verbose)
    t_all = time.time()
    try:
        with RunLock():
            sess.start()
            log("原版已启动 PID %d, 窗口 %r, 基线文档 %d" % (sess.pid, sess.title(), sess.baseline_docs))
            since_start = 0
            for i, (f, rel) in enumerate(todo, 1):
                if recycle and since_start >= recycle:
                    sess.restart("每 %d 个文件定期重启, 防止原版资源累积" % recycle)
                    sess.restarts -= 1  # 定期重启不算故障重启
                    since_start = 0
                since_start += 1
                entry = None
                for attempt in range(1, retries + 2):
                    entry = run_job(sess, f, rel, want, out_dir, timeout, job_no=i, shots=shots)
                    entry["attempts"] = attempt
                    if entry["status"] == "ok":
                        break
                    since_start = 0
                    log("  [%s] 第 %d 次尝试: %s" % (entry["status"], attempt, entry["error"]))
                entry["restarts_total"] = sess.restarts
                append_manifest(mf, entry)
                sizes = " ".join(("%s=%dB" % (k, v["size"])) if "size" in v else ("%s=none" % k) for k, v in entry["outputs"].items())
                log("[%d/%d] %-7s %6.1fs %s dialogs=%d  %s%s" % (
                    i, len(todo), entry["status"], entry["seconds"], sizes, len(entry["dialogs"]), rel,
                    ("  !! " + entry["error"]) if entry.get("error") else ""))
    finally:
        sess.stop()
    log("批处理用时 %.1fs (%.2fs/文件)" % (time.time() - t_all, (time.time() - t_all) / max(len(todo), 1)))
    return summarize(read_manifest(mf), files, root)


def summarize(done, files, root):
    cnt = {"ok": 0, "failed": 0, "timeout": 0, "missing": 0}
    secs = []
    dlg = {}
    for f in files:
        e = done.get(rel_of(f, root))
        if not e:
            cnt["missing"] += 1
            continue
        cnt[e["status"]] = cnt.get(e["status"], 0) + 1
        if e["status"] == "ok":
            secs.append(e["seconds"])
        for d in e.get("dialogs", []):
            k = "%s | %s | %s" % (d["title"], d["text"][:80], d["action"])
            dlg[k] = dlg.get(k, 0) + 1
    log("汇总: %s" % json.dumps(cnt, ensure_ascii=False))
    if secs:
        secs.sort()
        log("ok 文件耗时: 平均 %.2fs 中位 %.2fs 最大 %.2fs" % (sum(secs) / len(secs), secs[len(secs) // 2], secs[-1]))
    for k, v in dlg.items():
        log("  弹窗 x%d: %s" % (v, k))
    return cnt


# --------------------------------------------------------------------------- 子命令

def cmd_setup(a):
    exe = ensure_runtime()
    log("runtime 就绪: %s  sha256 OK" % exe)
    for p in (RUNTIME / "Support Files").glob("*"):
        log("  Support Files/%s %d" % (p.name, p.stat().st_size))
    return 0


def cmd_probe(a):
    sess = Session(show=a.show, verbose=True)
    with RunLock():
        sess.start()
        try:
            info = {"pid": sess.pid, "title": sess.title(), "mdi": sess.mdi_titles(),
                    "other_windows": sess.other_windows()}
            info["menu"] = menu_dump(win32gui.GetMenu(sess.main))
            # 文件类型列表
            sess.post_cmd(CMD_SAVE_AS)
            sess.deadline = time.time() + 20
            kind, d = sess.pump("probe", expect_file_dialog={"另存为"})
            info["save_as_filetypes"] = combo_items(win32gui.GetDlgItem(d, 1136))
            win32gui.PostMessage(d, win32con.WM_COMMAND, 2, win32gui.GetDlgItem(d, 2))
            time.sleep(0.5)
            sess.post_cmd(CMD_OPEN)
            kind, d = sess.pump("probe", expect_file_dialog={"打开"})
            info["open_filetypes"] = combo_items(win32gui.GetDlgItem(d, 1136))
            win32gui.PostMessage(d, win32con.WM_COMMAND, 2, win32gui.GetDlgItem(d, 2))
            print(json.dumps(info, ensure_ascii=False, indent=1))
        finally:
            sess.stop()
    return 0


def parse_want(a):
    want = []
    if a.emf:
        want.append("emf")
    if a.html:
        want.append("html")
    return want or ["emf", "html"]


def cmd_export(a):
    src = Path(a.infile).resolve()
    if not src.is_file():
        raise OracleError("输入文件不存在: %s" % src)
    root = Path(a.root).resolve() if a.root else REPO
    out_dir = Path(a.out_dir).resolve()
    cnt = run_batch([src], out_dir, parse_want(a), a.timeout, False, root, a.show, a.retries, False,
                    out_dir / "_fail" if a.screenshots else None, a.verbose)
    return 0 if cnt.get("ok") == 1 else 1


def cmd_batch(a):
    root = Path(a.root).resolve() if a.root else REPO
    files = expand_list(a.list, root)
    if not files:
        raise OracleError("清单没有匹配到任何文件: %s" % a.list)
    out_dir = Path(a.out_dir).resolve()
    cnt = run_batch(files, out_dir, parse_want(a), a.timeout, a.resume, root, a.show, a.retries, a.skip_failed,
                    out_dir / "_fail" if a.screenshots else None, a.verbose, a.recycle)
    return 0 if cnt.get("failed", 0) + cnt.get("timeout", 0) + cnt.get("missing", 0) == 0 else 1


def build_parser():
    ap = argparse.ArgumentParser(description="原版几何画板 oracle 驱动")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--emf", action="store_true", help="导出 EMF (两者都不指定则都导出)")
        p.add_argument("--html", action="store_true", help="导出 HTML (JavaSketchpad 构造描述)")
        p.add_argument("--timeout", type=float, default=90, help="单文件总超时秒数 (默认 90)")
        p.add_argument("--retries", type=int, default=1, help="失败后重试次数 (默认 1, 每次失败都会重启原版)")
        p.add_argument("--show", choices=["min", "normal"], default="min", help="原版窗口启动状态 (默认最小化, 不抢焦点)")
        p.add_argument("--root", help="输入相对路径的基准目录 (默认仓库根)")
        p.add_argument("--screenshots", action="store_true", help="失败时保存窗口截图到 <out-dir>/_fail (需要 Pillow)")
        p.add_argument("-v", "--verbose", action="store_true")

    p = sub.add_parser("setup")
    p.set_defaults(fn=cmd_setup)
    p = sub.add_parser("probe")
    p.add_argument("--show", choices=["min", "normal"], default="normal")
    p.set_defaults(fn=cmd_probe)
    p = sub.add_parser("export")
    p.add_argument("--in", dest="infile", required=True)
    p.add_argument("--out-dir", required=True)
    common(p)
    p.set_defaults(fn=cmd_export)
    p = sub.add_parser("batch")
    p.add_argument("--list", required=True, help=".txt 清单 (每行一个路径或 glob) 或 glob 表达式")
    p.add_argument("--out-dir", required=True)
    p.add_argument("--resume", action="store_true", help="跳过 manifest 里已成功的文件; 失败/超时的会重试")
    p.add_argument("--skip-failed", action="store_true", help="与 --resume 合用: 连失败/超时的也跳过")
    p.add_argument("--recycle", type=int, default=150, help="每处理 N 个文件主动重启一次原版 (0=不重启, 默认 150)")
    common(p)
    p.set_defaults(fn=cmd_batch)
    return ap


def main(argv=None):
    a = build_parser().parse_args(argv)
    if str(WORK).encode("ascii", "ignore").decode() != str(WORK):
        log("警告: work 目录含非 ASCII 字符 (%s), ANSI 对话框可能写不进路径" % WORK)
    try:
        return a.fn(a)
    except OracleError as e:
        log("错误: %s" % e)
        return 2


if __name__ == "__main__":
    sys.exit(main())
