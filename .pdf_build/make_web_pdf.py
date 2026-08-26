# -*- coding: utf-8 -*-
"""生成《AI 文件整理助手 Web 版 使用说明书》(纯中文) PDF。"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, ListFlowable,
                                ListItem, HRFlowable)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont

pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
FONT = "STSong-Light"
BLUE = colors.HexColor("#1E5EBA")
DARK = colors.HexColor("#16263D")
GREY = colors.HexColor("#555555")

styles = getSampleStyleSheet()
def S(name, **kw):
    base = kw.pop("parent", styles["Normal"])
    return ParagraphStyle(name, parent=base, fontName=FONT, **kw)

title = S("title", fontSize=22, leading=28, textColor=BLUE, spaceAfter=4)
subtitle = S("subtitle", fontSize=12, leading=16, textColor=GREY, spaceAfter=2)
url = S("url", fontSize=11, leading=15, textColor=DARK, spaceAfter=2)
h1 = S("h1", fontSize=14, leading=20, textColor=BLUE, spaceBefore=12, spaceAfter=6)
body = S("body", fontSize=10.5, leading=17, textColor=DARK, spaceAfter=4, alignment=TA_LEFT)
li = S("li", fontSize=10.5, leading=16, textColor=DARK)
small = S("small", fontSize=9.5, leading=14, textColor=GREY, spaceBefore=2)

doc = SimpleDocTemplate(
    r"D:/AIFileOrganizer/FINAL_RELEASE/Web/AI文件整理助手_Web版_使用说明书.pdf",
    pagesize=A4, leftMargin=20*mm, rightMargin=20*mm, topMargin=18*mm, bottomMargin=18*mm,
    title="AI 文件整理助手 Web 版 使用说明书", author="AI 文件整理助手")

E = []
def P(t, st=body): E.append(Paragraph(t, st))
def bullet(items, st=li):
    E.append(ListFlowable(
        [ListItem(Paragraph(x, st), leftIndent=6) for x in items],
        bulletType="bullet", start="·", leftIndent=12, bulletColor=BLUE))

# ---- 封面区 ----
P("AI 文件整理助手", title)
P("Web 版 · 使用说明书", subtitle)
P("浏览器直接使用 · 免安装 · 文件本地处理，不上传", subtitle)
E.append(Spacer(1, 4))
P("访问地址：<font color='#1E5EBA'>https://lixinjiang-ai.github.io/ai-file-organizer-web/</font>", url)
P("文档版本：V1.0　｜　更新：2026-08-25　｜　界面语言：简体中文", small)
E.append(HRFlowable(width="100%", thickness=1, color=BLUE, spaceBefore=8, spaceAfter=8))

# ---- 目录 ----
P("目录", h1)
bullet([
    "1. 产品简介", "2. 如何访问", "3. 开始使用", "4. 使用文件整理",
    "5. 使用 OCR 文字识别", "6. 支持的文件类型", "7. 常见问题（FAQ）",
    "8. 注意事项", "9. 隐私与文件处理说明", "10. 联系与反馈",
])

# ---- 一、产品简介 ----
P("一、产品简介", h1)
P("AI 文件整理助手 Web 版是 AI 文件整理助手的浏览器版本。它帮你把杂乱文件快速归类，并能从图片中提取文字（OCR）——全部在浏览器内运行。")
bullet([
    "免安装：打开网页即可使用。",
    "免费：无需账号、无需付费。",
    "隐私优先：文件在本机处理，不会上传。",
    "两个工具：文件整理（按类归类）+ OCR（图片转文字）。",
])
P("提示：Web 版适合在任何电脑或手机上快速整理文件。如需在 Mac 上离线、常驻使用，请看配套的 macOS 安装包 AI文件整理助手_Mac_arm64.dmg。", small)

# ---- 二、如何访问 ----
P("二、如何访问", h1)
bullet([
    "打开现代浏览器（Chrome / Edge / Safari / Firefox 的新版本）。",
    "访问：https://lixinjiang-ai.github.io/ai-file-organizer-web/",
    "无需下载、无需注册，桌面与手机均可使用。界面为简体中文，打开即用。",
])

# ---- 三、开始使用 ----
P("三、开始使用", h1)
P("在顶部菜单选择「文件整理」或「OCR」。文件仅在本设备处理，可随时关闭页面。")

# ---- 四、使用文件整理 ----
P("四、使用文件整理", h1)
bullet([
    "在顶部菜单打开「文件整理」。",
    "添加文件：把文件拖入方框，或点击选择，支持多文件。",
    "自动分组：文件按类型归为：文档、表格、演示、图片、压缩包、音频、视频、代码、其他。",
    "查看分类预览。",
    "点击「整理并下载 ZIP」，获得按类别分文件夹的压缩包。",
    "原始文件不会被修改；ZIP 是全新下载。",
])
P("说明：分类文件夹使用中文名称，例如「文档/」「表格/」「图片/」。", small)

# ---- 五、使用 OCR 文字识别 ----
P("五、使用 OCR 文字识别", h1)
bullet([
    "在顶部菜单打开「OCR」。",
    "上传图片（JPG / PNG 等）。",
    "选择语言（默认「中文（简体）」，可选「英文」），点击「提取文字」。",
    "复制识别结果，或点击「下载 .txt」保存为文本文件。",
])
P("首次使用提示：OCR 首次会下载一个小语言模型（中文为 chi_sim、英文为 eng），因此首次需要联网；之后更快。识别过程在浏览器本地完成。", small)

# ---- 六、支持的文件类型 ----
P("六、支持的文件类型", h1)
bullet([
    "文档：pdf、doc、docx、txt、md、rtf、odt、pages",
    "表格：xls、xlsx、csv",
    "演示：ppt、pptx、key",
    "图片：jpg、jpeg、png、gif、webp、bmp、svg、heic",
    "压缩包：zip、rar、7z、tar、gz、zst",
    "音频：mp3、wav、m4a、flac",
    "视频：mp4、mov、webm、mkv",
    "代码：js、ts、py、json、html、css、java、c、cpp、go、rs、sh",
])
P("其余未列出的类型归入「其他」。", small)

# ---- 七、常见问题 ----
P("七、常见问题（FAQ）", h1)
P("<b>Q：需要安装软件吗？</b><br/>A：不需要。用浏览器直接打开访问地址即可。", body)
P("<b>Q：我的文件会被上传吗？</b><br/>A：不会。文件在浏览器本地处理，不上传任何服务器。", body)
P("<b>Q：支持手机吗？</b><br/>A：支持。手机浏览器打开同一地址即可使用，页面已做响应式适配，非桌面硬缩放。", body)
P("<b>Q：OCR 识别不准怎么办？</b><br/>A：尽量使用清晰、正向、对比度高的图片；当前中文（简体）与英文效果最佳。图片型 PDF 支持正在规划中。", body)

# ---- 八、注意事项 ----
P("八、注意事项", h1)
bullet([
    "文件整理与 OCR 均在浏览器本地运行，请使用较新的浏览器版本。",
    "大文件处理受本机性能与浏览器内存限制。",
    "整理结果以 ZIP 形式下载，原始文件不会被改动。",
])

# ---- 九、隐私与文件处理说明 ----
P("九、隐私与文件处理说明", h1)
P("本工具是纯前端应用：所有文件读取、分类与 OCR 识别均在你的浏览器本地完成，不上传、不存储、不分析。无需登录、无账号体系。你可以随时关闭页面，数据不会离开你的设备。")

# ---- 十、联系与反馈 ----
P("十、联系与反馈", h1)
P("如需 macOS 离线版，请使用配套安装包 AI文件整理助手_Mac_arm64.dmg。使用问题与建议，可通过产品发布渠道反馈。网页版与 macOS 版是同一产品的两个交付入口。")

doc.build(E)
print("PDF generated OK")
