# 階段二：HTTP 與後端思維

> 目標：從伺服器端視角重新理解 Web。前端通常熟瀏覽器端的 HTTP，但對 server 收到請求後做了什麼是黑盒子。這階段補上這層認知。

---

## 1. HTTP 伺服器端視角

### 1.1 HTTP 方法的語意

前端常常 GET/POST 隨便用，後端要嚴謹得多。

| 方法 | 語意 | 冪等性 | 有 Body | 典型用途 |
|------|------|--------|---------|---------|
| GET | 取得資源 | ✅ | ❌ | 查詢、列表 |
| POST | 建立資源 / 觸發操作 | ❌ | ✅ | 新增、登入 |
| PUT | 完整更新資源 | ✅ | ✅ | 取代整筆資料 |
| PATCH | 部分更新資源 | 通常 ✅ | ✅ | 改某幾個欄位 |
| DELETE | 刪除資源 | ✅ | 通常 ❌ | 刪除 |

**冪等性（Idempotency）**：同樣請求做 N 次，結果跟做 1 次一樣。

```
GET /users/1        → 連續呼叫 10 次，結果都一樣 ✅ 冪等
DELETE /users/1     → 第一次刪除，後面 9 次都是「已刪除」狀態 ✅ 冪等
POST /users         → 連續呼叫 10 次，建立 10 個使用者 ❌ 不冪等
PUT /users/1        → 把 user 1 改成某狀態，做 N 次都一樣 ✅ 冪等
```

> **為什麼要懂冪等？** 網路會 timeout、client 會重試。冪等的方法可以安全重試，不冪等的方法重試會出大事（例如重複扣款）。

### 1.2 狀態碼選擇

正確使用狀態碼是後端的基本功。

**2xx 成功**

| 碼 | 名稱 | 用途 |
|----|------|------|
| 200 | OK | 一般成功（GET、PUT、PATCH） |
| 201 | Created | POST 建立成功，通常 Header 帶 `Location` 指向新資源 |
| 204 | No Content | 成功但沒有回傳 body（DELETE 常用） |

**4xx 客戶端錯誤**

| 碼 | 名稱 | 用途 |
|----|------|------|
| 400 | Bad Request | 請求格式錯誤、驗證失敗 |
| 401 | Unauthorized | **沒登入**（名字有點誤導） |
| 403 | Forbidden | 已登入但沒權限 |
| 404 | Not Found | 資源不存在 |
| 409 | Conflict | 衝突（例如 email 已註冊） |
| 422 | Unprocessable Entity | 格式對但語意錯（驗證失敗） |
| 429 | Too Many Requests | 觸發 rate limit |

**5xx 伺服器錯誤**

| 碼 | 名稱 | 用途 |
|----|------|------|
| 500 | Internal Server Error | 程式 throw exception 沒接到 |
| 502 | Bad Gateway | 上游服務掛了 |
| 503 | Service Unavailable | 服務維護中 |
| 504 | Gateway Timeout | 上游服務 timeout |

> **重點**：401 vs 403 很多人搞混。401 = 「你是誰我不知道」、403 = 「我知道你是誰，但你不能做這件事」。

### 1.3 Header、Cookie、CORS 的伺服器端處理

**常見 Request Headers**

```
Authorization: Bearer eyJhbGc...     # JWT token
Content-Type: application/json       # body 格式
Accept: application/json             # 期望的回傳格式
Cookie: sessionId=abc123             # cookie
X-Request-Id: uuid-xxx               # 自訂追蹤 ID（常見）
```

**常見 Response Headers**

```
Content-Type: application/json
Cache-Control: no-cache
Set-Cookie: sessionId=abc123; HttpOnly; Secure
Location: /users/123                 # 配合 201 Created
WWW-Authenticate: Bearer             # 配合 401
```

**Cookie 的伺服器端設定**

```csharp
Response.Cookies.Append("sessionId", "abc123", new CookieOptions
{
    HttpOnly = true,        // JS 讀不到，防 XSS
    Secure = true,          // 只能 HTTPS
    SameSite = SameSiteMode.Strict,  // 防 CSRF
    Expires = DateTimeOffset.UtcNow.AddDays(7)
});
```

**CORS（跨來源資源共享）**

前端最常遇到的「我從 localhost:3000 打 API 結果報 CORS 錯誤」就是這個。CORS 是**伺服器端的設定**，前端改不了。

```csharp
// Program.cs
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins("https://myapp.com", "http://localhost:3000")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();  // 允許帶 cookie
    });
});

app.UseCors("AllowFrontend");
```

> **前端對比**：你以前抱怨 CORS 的時候，後端就是在改這段 code。

---

## 2. Request / Response 生命週期

### 2.1 從 Kestrel 到回傳的流程

ASP.NET Core 用 **Kestrel** 作為內建 Web Server，請求處理流程大致是：

```
Client (browser/app)
    ↓ HTTP Request
[Reverse Proxy (Nginx/IIS)]   ← 可選，正式環境通常會有
    ↓
Kestrel (ASP.NET Core Web Server)
    ↓
Middleware Pipeline             ← 一個個 middleware 依序處理
    ↓ (Authentication, Authorization, Routing, ...)
Controller / Endpoint
    ↓
Service Layer
    ↓
Repository / DbContext
    ↓
Database
    ↑ Response 反向走回去
Client
```

**重點**：每個 HTTP request 都會經過完整的 pipeline，所以 middleware 的順序非常重要（後面階段三會詳細說）。

### 2.2 Stateless API：為什麼後端 API 通常是無狀態

**有狀態（Stateful）**：Server 記住每個 client 的對話狀態。

**無狀態（Stateless）**：每個 request 自己包含完整資訊，Server 不記得上一個 request。

```
有狀態：
Client → Server: 我要登入,帳號 alice
Server: 好,我記住你了 (存在 server 記憶體)
Client → Server: 我的訂單列表
Server: (查記憶體) 你是 alice,這是訂單

無狀態：
Client → Server: 我要登入,帳號 alice
Server: 好,給你 token: xyz
Client → Server: 我的訂單列表 [Authorization: Bearer xyz]
Server: (驗證 token) 你是 alice,這是訂單
```

**為什麼後端要 stateless?**

1. **水平擴展**：可以開 10 台 server 處理請求，client 隨便打哪台都行
2. **容錯**：server 掛掉重啟，client 不受影響（token 還在）
3. **簡單**：不用處理「session 怎麼跨機器同步」這種複雜問題

這也是為什麼現代後端幾乎都用 JWT + REST，而不是傳統的 server session。

### 2.3 Session vs Token

| 比較 | Session（Cookie-based） | Token（JWT） |
|------|------------------------|--------------|
| 狀態 | Server 端記住 | Stateless |
| 儲存 | Server 記憶體 / Redis | Client（localStorage / Cookie） |
| 擴展性 | 需共享 session store | 天然支援 |
| 撤銷 | 容易（刪掉 session） | 困難（要 blacklist） |
| 跨域 | 麻煩（CORS + Cookie） | 容易 |
| 適用場景 | 傳統 Web App | API、SPA、行動 App |

> 現代後端 API 大多用 JWT，但傳統 MVC 網站還是用 Cookie session。兩種都會遇到。

---

## 3. 同步 vs 非同步處理

### 3.1 為什麼後端要 async

**Thread Pool 模型**

ASP.NET Core 用一個 thread pool 處理所有 request，假設 thread pool 有 100 個 thread:

**同步寫法（壞）**

```csharp
public ActionResult GetUser(int id)
{
    var user = _db.Users.Find(id);  // 等 DB,thread 卡在這 100ms
    return Ok(user);
}
```

如果 100 個請求同時進來，100 個 thread 全部卡住等 DB，第 101 個請求只能排隊。

**非同步寫法（好）**

```csharp
public async Task<ActionResult> GetUserAsync(int id)
{
    var user = await _db.Users.FindAsync(id);  // 等 DB 時 thread 釋放
    return Ok(user);
}
```

`await` 等 DB 時，thread 被歸還給 pool，可以去處理別的 request。DB 回來時找一個閒置 thread 繼續執行。

**結果**：同樣 100 個 thread，async 可以處理數倍以上的並發請求。

### 3.2 I/O bound vs CPU bound

- **I/O bound**：等網路、DB、檔案 → **用 async**（thread 在等待，可以釋放）
- **CPU bound**：大量計算 → async 沒幫助，要用 `Task.Run` 或多執行緒

```csharp
// I/O bound：用 async
public async Task<string> FetchDataAsync()
{
    return await _httpClient.GetStringAsync(url);
}

// CPU bound：用 Task.Run
public async Task<int> CalculatePrimesAsync(int max)
{
    return await Task.Run(() =>
    {
        // 大量計算
        return CountPrimes(max);
    });
}
```

> **重點**：後端絕大多數操作（DB 查詢、呼叫外部 API、讀檔）都是 I/O bound，所以 async 幾乎是預設選項。

### 3.3 並行 vs 平行

- **並行（Concurrency）**：多件事「輪流」處理（async 屬於這個）
- **平行（Parallelism）**：多件事「同時」處理（多核心 CPU）

```csharp
// 串行：總時間 = 三個請求加總
var a = await CallApiA();  // 1 秒
var b = await CallApiB();  // 1 秒
var c = await CallApiC();  // 1 秒
// 總共 3 秒

// 並行：總時間 = 最慢的那個
var taskA = CallApiA();
var taskB = CallApiB();
var taskC = CallApiC();
await Task.WhenAll(taskA, taskB, taskC);
// 總共 1 秒
```

`Task.WhenAll` 是後端優化效能很常用的工具，要熟。

---

## 4. 練習建議

### 練習一：狀態碼設計

設計一個簡單的「使用者 API」，列出每個 endpoint 應該回什麼狀態碼：

- `GET /users/{id}`（找到 / 找不到 / 無權查看）
- `POST /users`（成功 / 驗證失敗 / email 已存在）
- `PUT /users/{id}`（成功 / 驗證失敗 / 找不到 / 無權修改）
- `DELETE /users/{id}`（成功 / 找不到 / 無權刪除）

### 練習二：用瀏覽器 DevTools 觀察

打開任何網站的 DevTools → Network，挑幾個 API 請求觀察：

- Request / Response Headers 有哪些
- 用什麼狀態碼
- 用 Cookie 還是 Bearer Token
- 有沒有 CORS 相關 header

### 練習三：思考題

如果一個 API 同時收到 1000 個 request，每個都要查 DB（假設 DB 一次查詢 100ms）：

- 用同步寫法，thread pool 100 個 thread，要多久處理完？
- 用 async 寫法呢？

---

## 5. 學完這階段你應該能...

- [ ] 看 API 設計時能判斷狀態碼用得對不對
- [ ] 知道 401 vs 403、PUT vs PATCH 的差別
- [ ] 理解為什麼後端 API 通常是 stateless
- [ ] 知道為什麼 async 在後端那麼重要
- [ ] 看到 CORS 錯誤知道要去哪裡改

完成後進入**階段三：ASP.NET Core Web API**。
