import http.server, socketserver, os, io, sys, threading, tempfile, zipfile, traceback
from PIL import Image, ImageDraw, ImageFont

ROOT = "D:/ai-file-organizer-web/out"
PREFIX = "/ai-file-organizer-web"
CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe"
BASE = "http://127.0.0.1:8088" + PREFIX

# ---- local static server (strips basePath prefix) ----
class H(http.server.SimpleHTTPRequestHandler):
    directory = ROOT
    def translate_path(self, path):
        if path.startswith(PREFIX):
            path = path[len(PREFIX):] or "/"
        return super().translate_path(path)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

def start_server():
    os.chdir(ROOT)  # serve from out/ so self.directory resolves correctly
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", 8088), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd

# ---- create sample files ----
tmp = tempfile.mkdtemp(prefix="afo_test_")
def make_txt(name, content):
    p = os.path.join(tmp, name)
    with open(p, "w", encoding="utf-8") as f:
        f.write(content)
    return p
def make_png_text(path, text, font_path=None, size=(640, 160), cjk=False):
    img = Image.new("RGB", size, "white")
    d = ImageDraw.Draw(img)
    try:
        if cjk:
            font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 40)
        else:
            font = ImageFont.truetype(font_path, 48) if font_path else ImageFont.load_default()
    except Exception:
        font = ImageFont.load_default()
    d.text((20, 50), text, fill="black", font=font)
    img.save(path)

txt1 = make_txt("报告.txt", "这是一份测试文档内容。")
csv1 = make_txt("数据.csv", "name,value\nAlice,10\nBob,20")
png1 = os.path.join(tmp, "截图.png")
make_png_text(png1, "Hello World 123", size=(640, 160))
ocr_en = os.path.join(tmp, "ocr_en.png")
make_png_text(ocr_en, "Hello World 123", size=(700, 200))
ocr_zh = os.path.join(tmp, "ocr_zh.png")
make_png_text(ocr_zh, "你好世界 文件整理", cjk=True, size=(700, 200))

# ---- run ----
from playwright.sync_api import sync_playwright

results = {}
def log(*a):
    print(*a, flush=True)

try:
    start_server()
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, headless=True,
                                    args=["--no-sandbox", "--disable-gpu"])
        ctx = browser.new_context(accept_downloads=True)
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ===== FILE ORGANIZER =====
        log(">>> open file-organizer")
        page.goto(BASE + "/file-organizer/", wait_until="load", timeout=60000)
        page.wait_for_selector("h1:has-text('文件整理')", timeout=30000)
        page.set_input_files("input[type=file]", [txt1, csv1, png1])
        page.wait_for_selector("text=个文件", timeout=15000)
        count_txt = page.text_content("text=个文件")
        log("file count text:", count_txt)
        # click organize & download
        with page.expect_download(timeout=60000) as dl:
            page.click("button:has-text('整理并下载 ZIP')")
        download = dl.value
        zip_path = os.path.join(tmp, download.suggested_filename or "out.zip")
        download.save_as(zip_path)
        with zipfile.ZipFile(zip_path) as zf:
            names = zf.namelist()
        ok = any(n.startswith("文档/") for n in names) and any(n.startswith("图片/") for n in names) and any(n.startswith("表格/") for n in names)
        results["organize"] = {"downloaded": os.path.getsize(zip_path), "entries": names[:6], "categorized": ok}
        log("organize ZIP entries sample:", names[:8], "categorized:", ok)

        # ===== OCR (English) =====
        log(">>> open ocr (English)")
        page.goto(BASE + "/ocr/", wait_until="load", timeout=60000)
        page.wait_for_selector("h1:has-text('OCR')", timeout=30000)
        page.set_input_files("input[type=file]", ocr_en)
        page.wait_for_selector("img[alt=preview]", timeout=15000)
        # select 英文
        page.select_option("select", "eng")
        page.click("button:has-text('提取文字')")
        # wait for result textarea to be non-empty
        page.wait_for_function(
            "document.querySelector('textarea[readonly]') && document.querySelector('textarea[readonly]').value.trim().length>0",
            timeout=120000)
        ocr_en_text = page.input_value("textarea[readonly]")
        results["ocr_en"] = {"text": ocr_en_text.strip()[:80], "nonempty": bool(ocr_en_text.strip())}
        log("OCR(EN) result:", repr(ocr_en_text.strip()[:80]))

        # ===== OCR (Chinese) =====
        log(">>> ocr (Chinese)")
        page.goto(BASE + "/ocr/", wait_until="load", timeout=60000)
        page.wait_for_selector("h1:has-text('OCR')", timeout=30000)
        page.set_input_files("input[type=file]", ocr_zh)
        page.wait_for_selector("img[alt=preview]", timeout=15000)
        page.select_option("select", "chi_sim")
        page.click("button:has-text('提取文字')")
        try:
            page.wait_for_function(
                "document.querySelector('textarea[readonly]') && document.querySelector('textarea[readonly]').value.trim().length>0",
                timeout=180000)
            ocr_zh_text = page.input_value("textarea[readonly]")
            results["ocr_zh"] = {"text": ocr_zh_text.strip()[:80], "nonempty": bool(ocr_zh_text.strip())}
            log("OCR(ZH) result:", repr(ocr_zh_text.strip()[:80]))
        except Exception as e:
            results["ocr_zh"] = {"error": str(e)[:120]}
            log("OCR(ZH) timed out (model download may be slow):", str(e)[:120])

        results["console_errors"] = errors[:10]
        browser.close()
except Exception as e:
    results["FATAL"] = traceback.format_exc()
    log("FATAL", traceback.format_exc())

print("\n===== FUNCTIONAL TEST RESULTS =====")
import json
print(json.dumps(results, ensure_ascii=False, indent=2))
