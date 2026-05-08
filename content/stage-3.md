# 階段三：ASP.NET Core Web API

> 目標：理解後端服務的運作生命週期與架構設計，能寫出帶有完整功能（DI、驗證、認證、錯誤處理、設定、Logging）的 API。

這是篇幅最長的一階段，因為實際上接業務 80% 的時間都在這層。

> 💡 **這階段先求懂、不用一次鑽完**。能讀懂 Program.cs、知道 controller / DI / middleware 大致怎麼運作，就可以開始接業務、邊做邊學。**真正常出事的不是 API 層，是階段四的資料庫 migration。**

---

## 1. 專案結構與路由

### 1.1 Program.cs 的啟動配置

`.NET 6+` 採用 Minimal Hosting，所有啟動配置都集中在 `Program.cs`。

```csharp
var builder = WebApplication.CreateBuilder(args);

// === 1. 註冊服務（DI 容器） ===
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseSqlServer(builder.Configuration.GetConnectionString("Default")));
builder.Services.AddScoped<IUserService, UserService>();
builder.Services.AddScoped<IUserRepository, UserRepository>();

var app = builder.Build();

// === 2. 設定 Middleware Pipeline ===
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthentication();   // 認證
app.UseAuthorization();    // 授權
app.MapControllers();

app.Run();
```

**兩個區塊的差別**:

- `builder.Services.Add...` → 註冊「**有什麼**」(DI 容器)
- `app.Use...` / `app.Map...` → 設定「**怎麼處理請求**」(Middleware pipeline)

### 1.2 Minimal API vs Controller-based

.NET 提供兩種寫 API 的風格。

**Controller-based（傳統，業務系統主流）**

```csharp
[ApiController]
[Route("api/[controller]")]
public class UsersController : ControllerBase
{
    private readonly IUserService _service;

    public UsersController(IUserService service)
    {
        _service = service;
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<UserDto>> GetById(int id)
    {
        var user = await _service.GetByIdAsync(id);
        return user is null ? NotFound() : Ok(user);
    }

    [HttpPost]
    public async Task<ActionResult<UserDto>> Create([FromBody] CreateUserDto dto)
    {
        var user = await _service.CreateAsync(dto);
        return CreatedAtAction(nameof(GetById), new { id = user.Id }, user);
    }
}
```

**Minimal API（精簡，小服務或 micro-service 流行）**

```csharp
app.MapGet("/api/users/{id:int}", async (int id, IUserService service) =>
{
    var user = await service.GetByIdAsync(id);
    return user is null ? Results.NotFound() : Results.Ok(user);
});

app.MapPost("/api/users", async (CreateUserDto dto, IUserService service) =>
{
    var user = await service.CreateAsync(dto);
    return Results.Created($"/api/users/{user.Id}", user);
});
```

**選擇建議**：

- 公司業務系統:**Controller-based**(結構清晰、適合大型專案)
- 小型 API、效能極致:Minimal API

### 1.3 屬性路由

```csharp
[Route("api/[controller]")]              // [controller] 自動代入 class 名稱(去掉 Controller)
public class UsersController : ControllerBase
{
    [HttpGet]                            // GET /api/users
    public IActionResult GetAll() { }

    [HttpGet("{id:int}")]                // GET /api/users/123 (限定整數)
    public IActionResult GetById(int id) { }

    [HttpGet("by-email/{email}")]        // GET /api/users/by-email/alice@example.com
    public IActionResult GetByEmail(string email) { }

    [HttpGet("active")]                  // GET /api/users/active
    public IActionResult GetActive() { }

    [HttpPost]                           // POST /api/users
    public IActionResult Create([FromBody] CreateUserDto dto) { }
}
```

**路由限制（Constraint）**

```csharp
[HttpGet("{id:int}")]           // 必須是整數
[HttpGet("{id:guid}")]          // 必須是 GUID
[HttpGet("{slug:alpha}")]       // 必須是字母
[HttpGet("{age:int:min(18)}")]  // 整數且 >= 18
```

### 1.4 IActionResult / ActionResult\<T\>

```csharp
// 方式 1: IActionResult (彈性大)
[HttpGet("{id}")]
public async Task<IActionResult> GetById(int id)
{
    var user = await _service.GetByIdAsync(id);
    if (user is null) return NotFound();
    return Ok(user);
}

// 方式 2: ActionResult<T> (推薦,有型別)
[HttpGet("{id}")]
public async Task<ActionResult<UserDto>> GetById(int id)
{
    var user = await _service.GetByIdAsync(id);
    if (user is null) return NotFound();
    return user;  // 自動包成 Ok(user)
}
```

**常用回傳方法**

| 方法 | 狀態碼 | 用途 |
|------|--------|------|
| `Ok(data)` | 200 | 成功 |
| `Created(uri, data)` | 201 | 建立成功 |
| `NoContent()` | 204 | 成功但無回傳 |
| `BadRequest(error)` | 400 | 請求格式錯 |
| `Unauthorized()` | 401 | 未登入 |
| `Forbid()` | 403 | 無權限 |
| `NotFound()` | 404 | 資源不存在 |
| `Conflict(error)` | 409 | 衝突 |

### 1.5 Model Binding：參數從哪來

ASP.NET Core 會自動從不同來源綁參數，但你最好明確標註。

```csharp
[HttpPost("{id:int}/orders")]
public async Task<IActionResult> CreateOrder(
    [FromRoute] int id,                    // 從 URL 路徑
    [FromQuery] string? source,            // 從 query string
    [FromBody] CreateOrderDto dto,         // 從 request body
    [FromHeader(Name = "X-Request-Id")] string requestId  // 從 header
)
{
    // ...
}
```

**綁定規則**:

- 簡單型別（int, string）→ 預設從 route / query
- 複雜型別（class）→ 預設從 body
- `[ApiController]` 加上後會自動推斷,但建議明確標註

---

## 2. 核心架構機制

### 2.1 依賴注入（DI）

DI 是 ASP.NET Core 的核心，不懂這個就不用寫後端了。

**生命週期**

```csharp
builder.Services.AddTransient<IService, Service>();   // 每次都 new
builder.Services.AddScoped<IService, Service>();      // 一個 request 一個 instance
builder.Services.AddSingleton<IService, Service>();   // 全程式只有一個
```

| 生命週期 | 何時用 | 範例 |
|---------|--------|------|
| Transient | 輕量、無狀態 | Helper、Utility |
| **Scoped** | 大部分業務邏輯 | **Service、Repository、DbContext** |
| Singleton | 應用程式級別共享 | Cache、Configuration、HttpClient |

**Scoped 是業務系統最常用的，因為一個 request 共享同一個 DbContext，可以做 transaction。**

**注入方式（建構子注入是主流）**

```csharp
public class UserService : IUserService
{
    private readonly IUserRepository _repo;
    private readonly ILogger<UserService> _logger;

    // 建構子注入,依賴透過參數傳進來
    public UserService(IUserRepository repo, ILogger<UserService> logger)
    {
        _repo = repo;
        _logger = logger;
    }

    public async Task<UserDto?> GetByIdAsync(int id)
    {
        _logger.LogInformation("Getting user {Id}", id);
        var user = await _repo.GetByIdAsync(id);
        return user?.ToDto();
    }
}
```

> **前端對比**：類似 Vue 的 `provide/inject` 或 Nuxt Plugin 注入服務，但 C# 是強型別、編譯期就檢查。

**生命週期陷阱**

⚠️ **不要在 Singleton 裡注入 Scoped**：因為 Singleton 永遠存在，但 Scoped 應該每個 request 釋放一次。這樣會讓 Scoped 變成 Singleton 行為，造成 DbContext 多 thread 共用、資料錯亂等問題。

### 2.2 Middleware（中介軟體）

Middleware 是處理 request/response 的管道，順序非常重要。

```csharp
// 標準順序（記不住沒關係,先建立印象）
app.UseExceptionHandler();      // 1. 全域錯誤處理(最外層)
app.UseHttpsRedirection();      // 2. HTTPS 重導
app.UseStaticFiles();           // 3. 靜態檔案
app.UseRouting();               // 4. 路由
app.UseCors();                  // 5. CORS
app.UseAuthentication();        // 6. 認證(你是誰)
app.UseAuthorization();         // 7. 授權(你能做什麼)
app.MapControllers();           // 8. 進入 Controller
```

**自己寫一個 Middleware**

```csharp
public class RequestLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<RequestLoggingMiddleware> _logger;

    public RequestLoggingMiddleware(RequestDelegate next, ILogger<RequestLoggingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var sw = Stopwatch.StartNew();
        _logger.LogInformation("→ {Method} {Path}", context.Request.Method, context.Request.Path);

        await _next(context);  // 呼叫下一個 middleware

        sw.Stop();
        _logger.LogInformation("← {StatusCode} ({Ms}ms)", context.Response.StatusCode, sw.ElapsedMilliseconds);
    }
}

// 註冊
app.UseMiddleware<RequestLoggingMiddleware>();
```

> **前端對比**：跟 Express middleware、Nuxt server middleware 概念完全一樣，連 `next()` 的設計都像。

### 2.3 Filter

Filter 跟 Middleware 容易搞混，但用途不同。

| 比較 | Middleware | Filter |
|------|-----------|--------|
| 範圍 | 整個應用 | Controller / Action 層級 |
| 拿得到 ModelState | ❌ | ✅ |
| 拿得到 Action 資訊 | ❌ | ✅ |
| 適合 | Logging、CORS、認證 | 模型驗證、Action 級別的橫切邏輯 |

```csharp
// ActionFilter 範例：自動驗證 ModelState
public class ValidateModelAttribute : ActionFilterAttribute
{
    public override void OnActionExecuting(ActionExecutingContext context)
    {
        if (!context.ModelState.IsValid)
        {
            context.Result = new BadRequestObjectResult(context.ModelState);
        }
    }
}

// 用法
[ValidateModel]
[HttpPost]
public async Task<IActionResult> Create(CreateUserDto dto) { }
```

**簡單原則**：

- 跟「請求進來/出去」相關 → **Middleware**
- 跟「Controller / Action 邏輯」相關 → **Filter**

---

## 3. 資料傳遞與驗證

### 3.1 DTO 模式

**為什麼要 DTO？**

直接把 Entity 回傳給前端是常見的反模式：

```csharp
// ❌ 不要這樣
[HttpGet("{id}")]
public ActionResult<User> GetById(int id) => _db.Users.Find(id);
// 問題:
// 1. 暴露密碼欄位
// 2. 暴露內部資料庫結構
// 3. 修改 DB schema 會影響 API
// 4. 容易序列化循環引用(導航屬性)
```

**正確做法**:

```csharp
// Entity (DB)
public class User
{
    public int Id { get; set; }
    public string Email { get; set; }
    public string PasswordHash { get; set; }  // 不能暴露
    public DateTime CreatedAt { get; set; }
    public List<Order> Orders { get; set; }   // 導航屬性
}

// DTO (API)
public record UserDto(int Id, string Email, DateTime CreatedAt);

public record CreateUserDto(string Email, string Password);

public record UpdateUserDto(string Email);

// Controller
[HttpGet("{id}")]
public async Task<ActionResult<UserDto>> GetById(int id)
{
    var user = await _db.Users.FindAsync(id);
    if (user is null) return NotFound();
    return new UserDto(user.Id, user.Email, user.CreatedAt);  // 只暴露需要的欄位
}
```

> **DTO 命名慣例**:
> - `UserDto` - 通用回傳
> - `CreateUserDto` / `UserCreateDto` - 建立時的 input
> - `UpdateUserDto` - 更新時的 input
> - `UserListItemDto` - 列表時的精簡版

### 3.2 Model Validation

**Data Annotations 寫法**

```csharp
public class CreateUserDto
{
    [Required]
    [EmailAddress]
    [MaxLength(100)]
    public string Email { get; set; } = "";

    [Required]
    [MinLength(8)]
    [MaxLength(100)]
    public string Password { get; set; } = "";

    [Range(18, 120)]
    public int Age { get; set; }

    [RegularExpression(@"^09\d{8}$")]
    public string? Phone { get; set; }
}
```

加上 `[ApiController]` 後，驗證失敗會自動回 400 + ProblemDetails，不用自己寫。

**FluentValidation（業界常用替代方案）**

```csharp
public class CreateUserDtoValidator : AbstractValidator<CreateUserDto>
{
    public CreateUserDtoValidator(IUserRepository repo)
    {
        RuleFor(x => x.Email)
            .NotEmpty()
            .EmailAddress()
            .MustAsync(async (email, _) => !await repo.EmailExistsAsync(email))
                .WithMessage("Email 已被註冊");

        RuleFor(x => x.Password)
            .NotEmpty()
            .MinimumLength(8)
            .Matches(@"[A-Z]").WithMessage("需要大寫字母")
            .Matches(@"[0-9]").WithMessage("需要數字");
    }
}
```

**何時用 FluentValidation？**

- 驗證邏輯複雜（跨欄位、查 DB）
- 想把驗證邏輯集中、可測試
- Data Annotations 不夠用

---

## 4. 設定管理

### 4.1 appsettings.json

```json
// appsettings.json
{
  "ConnectionStrings": {
    "Default": "Server=localhost;Database=MyApp;..."
  },
  "Jwt": {
    "Issuer": "myapp",
    "Audience": "myapp-users",
    "Key": "secret-key-here",
    "ExpireMinutes": 60
  },
  "Logging": {
    "LogLevel": { "Default": "Information" }
  }
}

// appsettings.Development.json (覆蓋本機開發)
{
  "ConnectionStrings": {
    "Default": "Server=localhost;Database=MyApp_Dev;..."
  }
}
```

### 4.2 環境變數與優先順序

ASP.NET Core 設定載入順序（後面的覆蓋前面的）：

1. `appsettings.json`
2. `appsettings.{Environment}.json`（Development / Staging / Production）
3. **User Secrets**（本機開發用，不會進 Git）
4. **環境變數**（部署環境設定）
5. 命令列參數

> **正式環境的密碼絕對不要寫在 appsettings.json**，要用環境變數或 Azure Key Vault。

### 4.3 IOptions\<T\> Pattern

把設定包成強型別物件注入。

```csharp
// 1. 定義設定類別
public class JwtOptions
{
    public string Issuer { get; set; } = "";
    public string Audience { get; set; } = "";
    public string Key { get; set; } = "";
    public int ExpireMinutes { get; set; }
}

// 2. 註冊
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));

// 3. 注入使用
public class AuthService
{
    private readonly JwtOptions _jwt;

    public AuthService(IOptions<JwtOptions> options)
    {
        _jwt = options.Value;
    }
}
```

**三種變體**：

- `IOptions<T>`：應用啟動時讀一次（最常用）
- `IOptionsSnapshot<T>`：每次 request 重讀（Scoped）
- `IOptionsMonitor<T>`：可訂閱變更（Singleton 用）

---

## 5. Logging

### 5.1 ILogger 基本用法

```csharp
public class UserService
{
    private readonly ILogger<UserService> _logger;

    public UserService(ILogger<UserService> logger)
    {
        _logger = logger;
    }

    public async Task<UserDto?> GetByIdAsync(int id)
    {
        _logger.LogInformation("Getting user {UserId}", id);
        //                                  ↑ 結構化參數,不要用字串拼接

        try
        {
            var user = await _repo.GetByIdAsync(id);
            if (user is null)
            {
                _logger.LogWarning("User {UserId} not found", id);
                return null;
            }
            return user.ToDto();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get user {UserId}", id);
            throw;
        }
    }
}
```

**重點:結構化日誌**

```csharp
// ❌ 不要
_logger.LogInformation($"User {id} logged in");

// ✅ 要
_logger.LogInformation("User {UserId} logged in", id);
```

差別在於後者把 `UserId=123` 當作結構化欄位，可以在 log 系統（Seq、ELK、Application Insights）做查詢：「找出所有 UserId=123 的 log」。

### 5.2 Log Level

| Level | 用途 |
|-------|------|
| Trace | 最詳細，通常開發才開 |
| Debug | 除錯資訊 |
| **Information** | 一般流程訊息（預設 production 等級） |
| **Warning** | 不正常但還能處理（找不到資料、重試） |
| **Error** | 錯誤,功能失敗 |
| Critical | 嚴重，整個應用受影響 |

### 5.3 Serilog（業界主流）

ASP.NET Core 內建 Logging 夠用，但業界常用 Serilog 做結構化日誌 + 多輸出。

```csharp
// Program.cs
builder.Host.UseSerilog((ctx, cfg) => cfg
    .ReadFrom.Configuration(ctx.Configuration)
    .WriteTo.Console()
    .WriteTo.File("logs/app-.log", rollingInterval: RollingInterval.Day)
    .WriteTo.Seq("http://localhost:5341"));  // 結構化日誌平台
```

初期看到知道在幹嘛就好，等熟了再深入。

---

## 6. 錯誤處理

### 6.1 全域 Exception Handler

不要在每個 Controller 都寫 try/catch，用全域 handler。

```csharp
public class GlobalExceptionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<GlobalExceptionMiddleware> _logger;

    public GlobalExceptionMiddleware(RequestDelegate next, ILogger<GlobalExceptionMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (NotFoundException ex)
        {
            await WriteProblem(context, 404, "Not Found", ex.Message);
        }
        catch (ValidationException ex)
        {
            await WriteProblem(context, 400, "Validation Error", ex.Message);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled exception");
            await WriteProblem(context, 500, "Internal Server Error", "An error occurred");
        }
    }

    private async Task WriteProblem(HttpContext context, int status, string title, string detail)
    {
        context.Response.StatusCode = status;
        context.Response.ContentType = "application/problem+json";
        var problem = new ProblemDetails
        {
            Status = status,
            Title = title,
            Detail = detail
        };
        await context.Response.WriteAsJsonAsync(problem);
    }
}

// 註冊（要在 pipeline 最前面）
app.UseMiddleware<GlobalExceptionMiddleware>();
```

### 6.2 ProblemDetails（RFC 7807）

業界標準的錯誤回傳格式：

```json
{
  "type": "https://example.com/probs/out-of-credit",
  "title": "You do not have enough credit.",
  "status": 403,
  "detail": "Your current balance is 30, but that costs 50.",
  "instance": "/account/12345/msgs/abc"
}
```

ASP.NET Core 內建支援，加上 `[ApiController]` 驗證錯誤就會自動回這個格式。

### 6.3 自訂 Exception 類別

```csharp
public class NotFoundException : Exception
{
    public NotFoundException(string message) : base(message) { }
}

public class ValidationException : Exception
{
    public Dictionary<string, string[]> Errors { get; }

    public ValidationException(Dictionary<string, string[]> errors)
        : base("Validation failed")
    {
        Errors = errors;
    }
}

// 業務邏輯丟特定 exception
public async Task<UserDto> GetByIdAsync(int id)
{
    var user = await _repo.GetByIdAsync(id)
        ?? throw new NotFoundException($"User {id} not found");
    return user.ToDto();
}
```

---

## 7. 認證與授權

### 7.1 AuthN vs AuthZ

- **Authentication（認證）**：你是誰？→ 401
- **Authorization（授權）**：你能做什麼？→ 403

### 7.2 JWT Bearer Token 流程

```
1. 登入
   Client → POST /login { email, password }
   Server: 驗證 → 產生 JWT → 回傳給 Client

2. 後續請求
   Client → GET /api/users [Authorization: Bearer xxx.yyy.zzz]
   Server: 驗證 JWT → 取出 UserId → 處理請求
```

**JWT 結構**

```
Header.Payload.Signature
```

- **Header**：演算法（HS256、RS256）
- **Payload**：claims（使用者資訊、過期時間）
- **Signature**：用密鑰簽名，防止偽造

### 7.3 ASP.NET Core 設定 JWT

```csharp
// Program.cs
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        var jwt = builder.Configuration.GetSection("Jwt").Get<JwtOptions>()!;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwt.Issuer,
            ValidAudience = jwt.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Key))
        };
    });

builder.Services.AddAuthorization();

// pipeline
app.UseAuthentication();
app.UseAuthorization();
```

### 7.4 產生 JWT

```csharp
public string GenerateToken(User user)
{
    var claims = new[]
    {
        new Claim(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
        new Claim(JwtRegisteredClaimNames.Email, user.Email),
        new Claim(ClaimTypes.Role, user.Role),
        new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString())
    };

    var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(_jwt.Key));
    var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

    var token = new JwtSecurityToken(
        issuer: _jwt.Issuer,
        audience: _jwt.Audience,
        claims: claims,
        expires: DateTime.UtcNow.AddMinutes(_jwt.ExpireMinutes),
        signingCredentials: creds);

    return new JwtSecurityTokenHandler().WriteToken(token);
}
```

### 7.5 使用 [Authorize]

```csharp
// 需要登入
[Authorize]
[HttpGet]
public IActionResult GetMyProfile() { }

// 需要特定角色
[Authorize(Roles = "Admin")]
[HttpDelete("{id}")]
public IActionResult Delete(int id) { }

// 不需要登入(整個 controller 有 [Authorize] 時用)
[AllowAnonymous]
[HttpPost("login")]
public IActionResult Login(LoginDto dto) { }

// 取得目前使用者
[Authorize]
[HttpGet("me")]
public IActionResult Me()
{
    var userId = User.FindFirst(JwtRegisteredClaimNames.Sub)?.Value;
    return Ok(new { userId });
}
```

### 7.6 Policy-based Authorization

進階用法，定義複雜權限規則。

```csharp
// 註冊
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("MinimumAge", policy =>
        policy.RequireClaim("age", "18", "19", "20"));

    options.AddPolicy("AdminOrSelf", policy =>
        policy.Requirements.Add(new AdminOrSelfRequirement()));
});

// 使用
[Authorize(Policy = "MinimumAge")]
public IActionResult AdultContent() { }
```

---

## 8. 練習建議

### 練習一：完整的 Todo API

寫一個 Todo API，要包含：

- CRUD endpoints
- DTO + Validation
- DI（Service / Repository）
- 全域 Exception Handler
- ILogger 適當記錄
- JWT 認證（只能看 / 改自己的 todo）
- appsettings + IOptions 管理 JWT 設定

### 練習二：Middleware 實作

寫一個自己的 Middleware：

- 紀錄每個 request 的耗時
- 加上 X-Request-Id header（如果 client 沒傳就產生一個）
- 用結構化 logging 輸出

### 練習三：閱讀公司 code

找一個公司現有的 Controller，畫出它的呼叫鏈，並回答：

- 這個 endpoint 用什麼 HTTP 方法、回什麼狀態碼？
- 它依賴哪些 Service？這些 Service 是什麼生命週期？
- 有沒有用 [Authorize]？怎麼做權限控制？
- DTO 怎麼定義？跟 Entity 差在哪？

---

## 9. 學完這階段你應該能...

- [ ] 寫出有完整 DI 結構的 Controller
- [ ] 自己設計 DTO 並做驗證
- [ ] 設定全域錯誤處理
- [ ] 用 IOptions 管理設定
- [ ] 實作 JWT 認證流程
- [ ] 看公司 code 不會再被 Middleware 跟 DI 搞糊塗

完成後進入**階段四：資料庫與 EF Core**。
