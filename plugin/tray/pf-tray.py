# pf-tray.py — promptFigure 本地插件托盘壳（第二阶段）
# 职责：常驻托盘保护 daemon；GUI 窗口随便关，服务不随窗口死
# 依赖：pystray + pillow（pip install pystray pillow）
# 里面每 10s 探测 daemon.json 对应进程是否存活，死了自动拉起（复用 pf-local-media-server 托盘的自愈思路）
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw
import pystray

PF_DIR = Path.home() / ".promptfigure"
DAEMON_JSON = PF_DIR / "daemon.json"
TRAY_JSON = PF_DIR / "tray.json"          # 托盘心跳（pf open 用来判断托盘是否已在跑）
STOP_FLAG = PF_DIR / "stopped.flag"        # pf stop 写入：自愈线程看到就不再拉活服务
PLUGIN_ROOT = Path(__file__).resolve().parent.parent
SERVER_MJS = PLUGIN_ROOT / "src" / "server.mjs"
PF_CLI = PLUGIN_ROOT / "bin" / "pf.mjs"
NODE = "node"

DEFAULT_PORT = 17420


def read_daemon():
    try:
        return json.loads(DAEMON_JSON.read_text(encoding="utf-8"))
    except Exception:
        return None


def daemon_alive():
    """daemon.json 里的 pid 活着 & 端口能连上才算活（两个条件防僵尸记录）"""
    d = read_daemon()
    if not d:
        return None
    pid = d.get("pid")
    if pid:
        try:
            # Windows: 打开进程探测
            import ctypes
            k32 = ctypes.windll.kernel32
            h = k32.OpenProcess(0x1000, False, int(pid))  # PROCESS_QUERY_LIMITED_INFORMATION
            if h:
                k32.CloseHandle(h)
            else:
                return None  # 进程没了
        except Exception:
            return None
    # 端口探测
    import socket
    try:
        with socket.create_connection(("127.0.0.1", int(d["port"])), timeout=1):
            return d
    except Exception:
        return None


def port_free(port):
    """端口能否绑定（被孤儿进程占着 = 不自由）"""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", int(port)))
        return True
    except Exception:
        return False
    finally:
        s.close()


def start_daemon():
    # 🔴 端口回退（2026-09-21 实测）：孤儿进程占着默认端口时，原逻辑会每 10s 在同端口
    # 重试到天荒地老。逐个 +1 试到 5，新端口由 server 写进 daemon.json，CLI 自动跟上
    base = int(read_daemon().get("port") if read_daemon() else DEFAULT_PORT)
    # 🔴 stdio 必须重定向到真实文件（2026-09-21）：托盘从 Startup vbs（pythonw，无控制台）
    # 启动时子进程继承无效句柄 —— 与 pf.mjs 里 stdio:'ignore'(NUL) 弄死 pythonw 是同类坑；
    # 且日志留下 daemon 秒死时的临终输出（此前 daemon 死因零证据）
    log_path = PF_DIR / "logs" / "daemon.log"
    try:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        logf = open(log_path, "a", encoding="utf-8", errors="replace")
        logf.write(f"\n---- tray start_daemon {time.strftime('%Y-%m-%dT%H:%M:%S')} ----\n")
        logf.flush()
    except Exception:
        logf = None
    for offset in range(0, 6):
        port = base + offset
        if not port_free(port):
            continue
        kwargs = {}
        if logf is not None:
            kwargs = {"stdout": logf, "stderr": logf}
        subprocess.Popen(
            [NODE, str(SERVER_MJS), str(port)],
            creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP,
            cwd=str(PLUGIN_ROOT),
            **kwargs,
        )
        for _ in range(20):
            time.sleep(0.5)
            if daemon_alive():
                return True
    return False


def gui_url():
    d = read_daemon()
    if not d:
        return None
    docs = sorted((PF_DIR / "projects").glob("*"), key=lambda p: p.stat().st_mtime, reverse=True)
    doc = f"?doc={docs[0].name}&" if docs else "?"
    return f"http://127.0.0.1:{d['port']}/{doc}token={d['guiToken']}"


def on_open(icon, item):
    url = gui_url()
    if url:
        os.startfile(url)  # 默认浏览器；独立窗口用 pf open
    else:
        start_daemon()
        url = gui_url()
        if url:
            os.startfile(url)


def on_restart(icon, item):
    notify(icon, "正在重启本地服务…")
    try:
        d = read_daemon()
        if d and d.get("pid"):
            subprocess.run(["taskkill", "/PID", str(d["pid"]), "/F"], capture_output=True)
    except Exception:
        pass
    ok = start_daemon()
    notify(icon, "服务已重启" if ok else "重启失败（看日志）")


def on_quit(icon, item):
    """退出 = 真退出：托盘和本地服务一起停，不留看不见的后台进程"""
    try:
        d = read_daemon()
        if d and d.get("pid"):
            subprocess.run(["taskkill", "/PID", str(d["pid"]), "/F"], capture_output=True)
        if DAEMON_JSON.exists():
            DAEMON_JSON.unlink()
    except Exception:
        pass
    icon.stop()


def notify(icon, msg):
    try:
        icon.notify(msg, "promptFigure")
    except Exception:
        pass


def make_image():
    # 画一个简洁的"图表"图标：深蓝底 + 白色柱状 + 黄色高亮点
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    dr.rounded_rectangle([4, 4, 60, 60], radius=14, fill=(28, 60, 120, 255))
    for i, (x, h) in enumerate([(16, 20), (27, 32), (38, 14), (45, 26)]):
        dr.rounded_rectangle([x, 48 - h, x + 8, 48], radius=3, fill=(255, 255, 255, 235))
    dr.ellipse([41, 8, 53, 20], fill=(255, 196, 0, 255))
    return img


def heartbeat():
    try:
        TRAY_JSON.write_text(json.dumps({"pid": os.getpid(), "t": time.time()}), encoding="utf-8")
    except Exception:
        pass


def watch_loop():
    """自愈线程：每 10s 探测，挂了自动拉起；pf stop 写了 stopped.flag 就不再拉（尊重手动停止）"""
    while True:
        try:
            heartbeat()
            if STOP_FLAG.exists():
                pass  # 用户/CLI 明确停过服务，别自作主张复活
            elif not daemon_alive():
                start_daemon()
        except Exception:
            pass
        time.sleep(10)


def existing_instance_alive():
    """单实例守卫：tray.json 心跳新鲜且 pid 活着 = 已有托盘在跑（pf open 多次调用 /
    schtasks 重试都会重复拉起，两个图标两个自愈循环打架 —— 2026-09-21 实测）"""
    try:
        d = json.loads(TRAY_JSON.read_text(encoding="utf-8"))
    except Exception:
        return False
    if time.time() - float(d.get("t", 0)) > 40:
        return False
    pid = d.get("pid")
    if not pid or int(pid) == os.getpid():
        return False
    try:
        import ctypes
        k32 = ctypes.windll.kernel32
        h = k32.OpenProcess(0x1000, False, int(pid))
        if h:
            k32.CloseHandle(h)
            return True
        return False
    except Exception:
        return False


def kill_stale_tray():
    """🔴 心跳停更但进程还在 = 冻结的旧实例（宿主会话挂起/睡眠恢复残留，2026-09-21 实测）。
    不清理的话旧实例一旦恢复，两个自愈循环抢着拉 daemon 打架。单实例守卫只挡"活"实例，
    这里负责补刀僵尸。"""
    try:
        d = json.loads(TRAY_JSON.read_text(encoding="utf-8"))
        pid = int(d.get("pid") or 0)
        if not pid or pid == os.getpid():
            return
        t = float(d.get("t", 0))
        if time.time() - t <= 40:  # 心跳还新鲜 = 真活实例，别动（与 existing_instance_alive 同阈值）
            return
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True)
    except Exception:
        pass


def main():
    # 单实例守卫放在心跳之前：已有实例在跑就静默退出，不覆盖它的心跳
    if existing_instance_alive():
        return
    # 守卫放过的 = 心跳已停更，若旧进程还挂着（冻结态）先补刀
    kill_stale_tray()
    # 🔴 心跳必须是第一件事 —— pf open/ensureTray 靠它在几秒内判断托盘起没起来，
    # 放到 start_daemon 之后会错过 CLI 的等待窗口（实测被判"托盘启动失败"）
    heartbeat()
    # 显式启动托盘 = 用户想要服务，清掉手动停止标记
    try:
        if STOP_FLAG.exists():
            STOP_FLAG.unlink()
    except Exception:
        pass
    if not daemon_alive():
        start_daemon()
    import threading
    threading.Thread(target=watch_loop, daemon=True).start()

    menu = pystray.Menu(
        pystray.MenuItem("打开工作台", on_open, default=True),
        pystray.MenuItem("重启本地服务", on_restart),
        pystray.MenuItem("退出（停止托盘并关闭服务）", on_quit),
    )
    icon = pystray.Icon("promptFigure", make_image(), "promptFigure 本地插件", menu)
    notify(icon, "托盘已启动，服务受保护")
    icon.run()


if __name__ == "__main__":
    main()
