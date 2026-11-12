"""真实鼠标驱动新版窗口（SendInput）。只给 desktop-drag-perf.ts 用。
prep <pid>：最大化并切到前台，打印 hwnd。
drag <hwnd> <cssX> <cssY> <dpr> <rx> <ry> <ms>：从 (cssX,cssY) 按下，按椭圆轨迹拖动 ms 毫秒后松开。
前台窗口变化就立即松开并退出（用户回来碰电脑时不抢鼠标）。"""
import ctypes, ctypes.wintypes as W, math, sys, time
u = ctypes.windll.user32
ctypes.windll.winmm.timeBeginPeriod(1)
ctypes.windll.shcore.SetProcessDpiAwareness(2)
u.GetForegroundWindow.restype = W.HWND


class MI(ctypes.Structure):
    _fields_ = [('dx', W.LONG), ('dy', W.LONG), ('mouseData', W.DWORD), ('dwFlags', W.DWORD), ('time', W.DWORD), ('dwExtraInfo', ctypes.c_size_t)]


class INP(ctypes.Structure):
    class U(ctypes.Union):
        _fields_ = [('mi', MI), ('pad', ctypes.c_byte * 32)]
    _fields_ = [('type', W.DWORD), ('u', U)]


MOVE, DOWN, UP, ABS, VD = 1, 2, 4, 0x8000, 0x4000
vx, vy, vw, vh = [u.GetSystemMetrics(i) for i in (76, 77, 78, 79)]


def send(flags, x=0, y=0):
    i = INP()
    i.type = 0
    if flags & MOVE:
        i.u.mi = MI(int((x - vx) * 65535 / (vw - 1)), int((y - vy) * 65535 / (vh - 1)), 0, flags | ABS | VD, 0, 0)
    else:
        i.u.mi = MI(0, 0, 0, flags, 0, 0)
    u.SendInput(1, ctypes.byref(i), ctypes.sizeof(INP))


def prep(pid):
    found = []

    @ctypes.WINFUNCTYPE(W.BOOL, W.HWND, W.LPARAM)
    def cb(h, _):
        p = W.DWORD()
        u.GetWindowThreadProcessId(h, ctypes.byref(p))
        if p.value == pid and u.IsWindowVisible(h) and u.GetWindowTextLengthW(h) > 0:
            found.append(h)
        return True
    u.EnumWindows(cb, 0)
    if not found:
        sys.exit('找不到窗口')
    h = found[0]
    u.ShowWindow(h, 3)
    # 前台限制：挂到当前前台线程的输入队列上才允许切前台（模拟 Alt 会让窗口进入菜单循环）
    fg = u.GetForegroundWindow()
    a = u.GetWindowThreadProcessId(fg, None) if fg else 0
    b = ctypes.windll.kernel32.GetCurrentThreadId()
    if a:
        u.AttachThreadInput(b, a, True)
    u.BringWindowToTop(h)
    u.SetForegroundWindow(h)
    if a:
        u.AttachThreadInput(b, a, False)
    time.sleep(.5)
    if u.GetForegroundWindow() != h:
        sys.exit('切不到前台')
    print(h)


def drag(h, cx, cy, dpr, rx, ry, ms):
    o = W.POINT(0, 0)
    u.ClientToScreen(h, ctypes.byref(o))
    sx, sy = o.x + cx * dpr, o.y + cy * dpr
    send(MOVE, sx, sy)
    time.sleep(.15)
    send(DOWN)
    time.sleep(.05)
    t0 = time.perf_counter()
    n = 0
    try:
        while True:
            t = (time.perf_counter() - t0) * 1000
            if t >= ms:
                break
            if u.GetForegroundWindow() != h:
                print('前台改变，停止', file=sys.stderr)
                break
            a = t / 900 * math.tau
            # 从起点出发：x 用 sin，y 用 1-cos
            send(MOVE, sx + rx * dpr * math.sin(a), sy + ry * dpr * (1 - math.cos(a * .7)) / 2)
            n += 1
            time.sleep(.001)
    finally:
        send(UP)
    print(n)


if sys.argv[1] == 'prep':
    prep(int(sys.argv[2]))
else:
    drag(int(sys.argv[2]), *[float(x) for x in sys.argv[3:9]])
