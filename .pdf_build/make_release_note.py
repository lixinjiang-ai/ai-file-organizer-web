# -*- coding: utf-8 -*-
"""生成《AI 文件整理助手 · 最终交付说明》(纯中文) PDF。"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
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
    return ParagraphStyle(name, parent=styles["Normal"], fontName=FONT, **kw)

title = S("title", fontSize=20, leading=26, textColor=BLUE, spaceAfter=2)
sub = S("sub", fontSize=11, leading=15, textColor=GREY, spaceAfter=2)
h1 = S("h1", fontSize=14, leading=20, textColor=BLUE, spaceBefore=12, spaceAfter=6)
body = S("body", fontSize=10.5, leading=17, textColor=DARK, spaceAfter=4)
li = S("li", fontSize=10.5, leading=16, textColor=DARK)
small = S("small", fontSize=9.5, leading=14, textColor=GREY, spaceBefore=2)

doc = SimpleDocTemplate(
    r"D:/AIFileOrganizer/FINAL_RELEASE/最终交付说明.pdf",
    pagesize=A4, leftMargin=20*mm, rightMargin=20*mm, topMargin=18*mm, bottomMargin=18*mm,
    title="AI 文件整理助手 最终交付说明", author="AI 文件整理助手")

E = []
def P(t, st=body): E.append(Paragraph(t, st))
def bullet(items, st=li):
    E.append(ListFlowable([ListItem(Paragraph(x, st), leftIndent=6) for x in items],
                          bulletType="bullet", start="·", leftIndent=12, bulletColor=BLUE))

P("AI 文件整理助手 · 最终交付说明", title)
P("最终交付 v1.0　｜　交付日期：2026-08-25　｜　界面语言：简体中文", sub)
E.append(HRFlowable(width="100%", thickness=1, color=BLUE, spaceBefore=8, spaceAfter=8))

P("一、交付清单", h1)
bullet([
    "Mac 版：AI文件整理助手_Mac_arm64.dmg ＋ AI文件整理助手_Mac版_使用说明书.pdf —— 下载 DMG，拖拽安装到「应用程序」，在 Mac 上离线使用。",
    "Web 版：Web版访问地址.txt ＋ AI文件整理助手_Web版_使用说明书.pdf —— 在手机 / Windows / Mac 浏览器中打开公网地址，无需安装。",
])

P("二、Mac 版", h1)
bullet([
    "文件：AI文件整理助手_Mac_arm64.dmg",
    "安装：双击挂载 DMG，将 App 拖入「应用程序」文件夹。",
    "适用：Apple Silicon Mac（M1 / M2 / M3 / M4 系列）。",
    "网络：本地离线运行，首次运行请在「系统设置 → 隐私与安全性」中允许。",
    "详细步骤请参阅同目录下 AI文件整理助手_Mac版_使用说明书.pdf。",
])

P("三、Web 版", h1)
bullet([
    "公网地址：https://lixinjiang-ai.github.io/ai-file-organizer-web/",
    "使用方式：在手机浏览器、Windows 浏览器或 Mac 浏览器中直接访问，无需下载安装。",
    "界面语言：简体中文，打开即用，无语言切换按钮。",
    "核心入口：首页、文件整理、OCR 文字识别、使用说明。",
    "Web 文件夹中不包含任何源码、package.json、node_modules、.next 或 Git 仓库，仅向最终用户提供访问地址与说明书。",
])

P("四、响应式验证", h1)
bullet([
    "已使用 390px（手机）与 1280px（桌面）两种视口进行真实浏览器渲染验证。",
    "页面包含 viewport 元标签，采用响应式布局，手机端为单列布局，非桌面硬缩放。",
    "核心页面 /、/file-organizer/、/ocr/、/help/ 均可正常访问。",
])

P("五、真实功能验证", h1)
bullet([
    "文件上传、文件整理（按中文分类生成 ZIP）、OCR 文字识别（默认「中文（简体）」，可选「英文」）均已通过真实浏览器功能测试，而非仅页面可打开。",
])

P("六、重要说明", h1)
bullet([
    "本地处理：所有文件处理均在浏览器本地完成，无需上传到服务器。",
    "无需账号：不需要注册或登录。",
    "隐私优先：文件不会上传、不存储、不分析。",
])

doc.build(E)
print("Release note PDF generated OK")
