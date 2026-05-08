# C# 後端開發學習筆記網站

前端工程師轉後端的 C# 學習資料站，可離線部署、行動裝置友善。

https://show812223.github.io/csharp-backend-notes-site/

## 功能

- 八階段學習內容（C# → ASP.NET Core → EF Core → 架構 → 測試 → Docker → CI/CD）
- 全文搜尋（按 Cmd/Ctrl + K）
- 進度追蹤（各階段任務 checkbox 自動存到 localStorage）
- 深色 / 淺色模式（會記住偏好）
- 行動裝置 RWD
- 閱讀進度條
- 上一階段 / 下一階段導覽

## 本機預覽

任何靜態檔案 server 都可以，例如：

```bash
# Python
python3 -m http.server 8000

# Node.js
npx serve .

# 然後打開 http://localhost:8000
```

> ⚠️ 不能直接用 `file://` 開 `index.html`，因為要 fetch markdown 檔案，會被 CORS 擋。

## 部署到 GitHub Pages

1. 把整個資料夾 push 到 GitHub repo
2. Settings → Pages → Source 選 `main` branch（或 `gh-pages`）
3. 等幾分鐘，網站會出現在 `https://<你的帳號>.github.io/<repo-name>/`

如果 repo name 不是 `username.github.io`，網址會帶子目錄，但網站本身用的是相對路徑，沒問題。

## 修改內容

學習內容都在 `content/stage-*.md`，可以直接用任何 markdown 編輯器修改，重新整理網頁就會看到新內容。

如果要新增階段：

1. 在 `content/` 新增 `stage-9.md`
2. 編輯 `app.js` 的 `STAGES` 陣列加上新階段
3. 編輯 `index.html` 的 `<nav>` 加上對應的 nav-item

## 檔案結構

```
.
├── index.html         主頁
├── style.css          樣式
├── app.js             邏輯（路由、搜尋、進度、主題）
├── content/           markdown 內容
│   ├── stage-1.md
│   ├── stage-2.md
│   └── ...
└── README.md
```

## 第三方依賴（CDN）

- [marked](https://github.com/markedjs/marked) — Markdown 解析
- [highlight.js](https://highlightjs.org/) — 程式碼高亮
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) — 等寬字
- [Noto Serif TC / Noto Sans TC](https://fonts.google.com/noto) — 中文字型

不用安裝任何套件，純前端。

## 進度資料

進度存在瀏覽器的 localStorage（key: `cs-notes-progress`），跨裝置不會同步。如果要重設可以點側邊欄底部的「↺ 重設進度」。
