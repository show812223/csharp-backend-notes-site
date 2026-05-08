# 階段五：程式碼架構

> 目標：實際接業務時，看公司現有 code 不會卡住。學會把前面學的東西組合起來，寫出可維護、可測試的程式碼。

這階段不像前面有很多語法要記，更多是「思考方式」的轉變。可以邊看公司 code 邊學。

---

## 1. 為什麼要分層？

### 1.1 反例：什麼都塞 Controller

```csharp
// ❌ 所有邏輯都在 Controller
[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    private readonly AppDbContext _db;

    public OrdersController(AppDbContext db) => _db = db;

    [HttpPost]
    public async Task<IActionResult> Create(CreateOrderDto dto)
    {
        // 驗證
        if (dto.Items.Count == 0)
            return BadRequest("Items cannot be empty");

        // 查使用者
        var user = await _db.Users.FindAsync(dto.UserId);
        if (user is null) return NotFound();

        // 查商品、檢查庫存
        decimal total = 0;
        foreach (var item in dto.Items)
        {
            var product = await _db.Products.FindAsync(item.ProductId);
            if (product is null) return NotFound();
            if (product.Stock < item.Quantity)
                return BadRequest($"Stock not enough for {product.Name}");
            total += product.Price * item.Quantity;
            product.Stock -= item.Quantity;
        }

        // 建立 order
        var order = new Order
        {
            UserId = user.Id,
            Total = total,
            CreatedAt = DateTime.UtcNow
        };
        _db.Orders.Add(order);
        await _db.SaveChangesAsync();

        // 寄信通知
        var smtp = new SmtpClient("smtp.gmail.com");
        smtp.Send("...");

        return Ok(new { order.Id });
    }
}
```

**問題**：

- 業務邏輯混進 HTTP 細節，難以重用（CLI、背景工作怎麼用？）
- 直接操作 DbContext，難以單元測試（要 mock 整個 DB）
- 一個方法做太多事，難以理解、難以維護
- 修改驗證邏輯要動 Controller、修改通知方式也要動 Controller

### 1.2 解法：分層

```
┌─────────────────────────┐
│   Controller            │  ← 只負責 HTTP（接收請求、回傳結果）
│   - 接收 DTO            │
│   - 呼叫 Service        │
│   - 回傳 ActionResult   │
└──────────┬──────────────┘
           ↓
┌─────────────────────────┐
│   Service               │  ← 業務邏輯（這是核心）
│   - 驗證業務規則        │
│   - 協調多個 Repository │
│   - Transaction 管理    │
└──────────┬──────────────┘
           ↓
┌─────────────────────────┐
│   Repository            │  ← 資料存取（封裝 DB 操作）
│   - DbContext 操作      │
│   - 查詢、新增、修改    │
└──────────┬──────────────┘
           ↓
┌─────────────────────────┐
│   Database              │
└─────────────────────────┘
```

---

## 2. 分層架構實作

### 2.1 Controller 層

```csharp
[ApiController]
[Route("api/[controller]")]
public class OrdersController : ControllerBase
{
    private readonly IOrderService _service;

    public OrdersController(IOrderService service) => _service = service;

    [HttpPost]
    public async Task<ActionResult<OrderDto>> Create(CreateOrderDto dto)
    {
        var order = await _service.CreateAsync(dto);
        return CreatedAtAction(nameof(GetById), new { id = order.Id }, order);
    }

    [HttpGet("{id:int}")]
    public async Task<ActionResult<OrderDto>> GetById(int id)
    {
        var order = await _service.GetByIdAsync(id);
        return order is null ? NotFound() : Ok(order);
    }
}
```

**Controller 該做什麼？**

- 接收 HTTP 請求、解析參數
- 呼叫 Service
- 把結果包成 HTTP 回應
- **不做業務邏輯、不直接碰 DB**

### 2.2 Service 層

```csharp
public interface IOrderService
{
    Task<OrderDto> CreateAsync(CreateOrderDto dto);
    Task<OrderDto?> GetByIdAsync(int id);
}

public class OrderService : IOrderService
{
    private readonly IUserRepository _userRepo;
    private readonly IProductRepository _productRepo;
    private readonly IOrderRepository _orderRepo;
    private readonly INotificationService _notification;
    private readonly IUnitOfWork _uow;
    private readonly ILogger<OrderService> _logger;

    public OrderService(
        IUserRepository userRepo,
        IProductRepository productRepo,
        IOrderRepository orderRepo,
        INotificationService notification,
        IUnitOfWork uow,
        ILogger<OrderService> logger)
    {
        _userRepo = userRepo;
        _productRepo = productRepo;
        _orderRepo = orderRepo;
        _notification = notification;
        _uow = uow;
        _logger = logger;
    }

    public async Task<OrderDto> CreateAsync(CreateOrderDto dto)
    {
        // 業務規則驗證
        if (dto.Items.Count == 0)
            throw new ValidationException("Items cannot be empty");

        // 查使用者
        var user = await _userRepo.GetByIdAsync(dto.UserId)
            ?? throw new NotFoundException($"User {dto.UserId} not found");

        // 計算總金額、扣庫存
        decimal total = 0;
        foreach (var item in dto.Items)
        {
            var product = await _productRepo.GetByIdAsync(item.ProductId)
                ?? throw new NotFoundException($"Product {item.ProductId} not found");

            if (product.Stock < item.Quantity)
                throw new ValidationException($"Stock not enough for {product.Name}");

            product.Stock -= item.Quantity;
            total += product.Price * item.Quantity;
        }

        // 建立訂單
        var order = new Order
        {
            UserId = user.Id,
            Total = total,
            Items = dto.Items.Select(i => new OrderItem { /* ... */ }).ToList(),
            CreatedAt = DateTime.UtcNow
        };
        await _orderRepo.AddAsync(order);

        await _uow.SaveChangesAsync();  // 一次儲存所有變更

        // 副作用（通知）放最後
        await _notification.SendOrderConfirmationAsync(order);

        _logger.LogInformation("Order {OrderId} created for user {UserId}", order.Id, user.Id);

        return order.ToDto();
    }

    public async Task<OrderDto?> GetByIdAsync(int id)
    {
        var order = await _orderRepo.GetByIdAsync(id);
        return order?.ToDto();
    }
}
```

**Service 該做什麼？**

- 業務規則驗證（不只是欄位格式，還包含「庫存不夠」這種商業邏輯）
- 協調多個 Repository
- 管理 Transaction
- 處理跨領域邏輯（通知、log）
- **不直接接 HTTP、不直接寫 SQL**

### 2.3 Repository 層

```csharp
public interface IOrderRepository
{
    Task<Order?> GetByIdAsync(int id);
    Task<List<Order>> GetByUserIdAsync(int userId);
    Task AddAsync(Order order);
    Task<bool> ExistsAsync(int id);
}

public class OrderRepository : IOrderRepository
{
    private readonly AppDbContext _db;

    public OrderRepository(AppDbContext db) => _db = db;

    public async Task<Order?> GetByIdAsync(int id)
    {
        return await _db.Orders
            .Include(o => o.Items)
            .FirstOrDefaultAsync(o => o.Id == id);
    }

    public async Task<List<Order>> GetByUserIdAsync(int userId)
    {
        return await _db.Orders
            .AsNoTracking()
            .Where(o => o.UserId == userId)
            .OrderByDescending(o => o.CreatedAt)
            .ToListAsync();
    }

    public async Task AddAsync(Order order)
    {
        await _db.Orders.AddAsync(order);
    }

    public async Task<bool> ExistsAsync(int id)
    {
        return await _db.Orders.AnyAsync(o => o.Id == id);
    }
}
```

**Repository 該做什麼？**

- 封裝資料存取細節
- 提供針對該 Entity 的查詢/操作方法
- **不做業務邏輯**

> **常見爭議**：EF Core 本身已經是個 Repository pattern 了，要不要再包一層？
>
> - 不包：簡單、直接、Service 直接用 DbContext。適合小專案。
> - 包：方便 mock 測試、隔離 ORM 細節（之後換 ORM 容易）。適合大專案。
>
> 看公司現有風格走，不用糾結。

---

## 3. Unit of Work

### 3.1 為什麼要 UoW？

Repository 各自呼叫 `SaveChanges` 會有問題：

```csharp
// ❌ 每個 repo 各自 SaveChanges
await _orderRepo.AddAsync(order);
await _orderRepo.SaveChangesAsync();   // commit 1
await _productRepo.UpdateStock(...);
await _productRepo.SaveChangesAsync();  // commit 2
// 如果 commit 2 失敗,commit 1 已經寫進去了,沒 transaction 保護
```

**Unit of Work** 的概念：把多個 Repository 操作包在「一個交易單元」裡。

### 3.2 EF Core 內建的 UoW

好消息是：**`DbContext` 本身就是 Unit of Work**。

```csharp
public interface IUnitOfWork
{
    Task<int> SaveChangesAsync();
}

public class UnitOfWork : IUnitOfWork
{
    private readonly AppDbContext _db;

    public UnitOfWork(AppDbContext db) => _db = db;

    public Task<int> SaveChangesAsync() => _db.SaveChangesAsync();
}

// Repository 不再各自 SaveChanges
public class OrderRepository : IOrderRepository
{
    public async Task AddAsync(Order order)
    {
        await _db.Orders.AddAsync(order);
        // 不呼叫 SaveChanges
    }
}

// Service 統一控制
public async Task CreateAsync(...)
{
    await _orderRepo.AddAsync(order);
    _productRepo.UpdateStock(...);

    await _uow.SaveChangesAsync();  // 一次 commit 所有變更
}
```

> **關鍵**：因為 DbContext 是 Scoped 生命週期，**同一個 request 裡所有 Repository 拿到的是同一個 DbContext**，`SaveChangesAsync` 會在同一個 transaction 內 commit。

---

## 4. DTO ↔ Entity Mapping

### 4.1 為什麼需要 mapping？

Entity 跟 DTO 結構通常不一樣：

```csharp
// Entity (DB 結構)
public class User
{
    public int Id { get; set; }
    public string Email { get; set; }
    public string PasswordHash { get; set; }   // 不暴露
    public DateTime CreatedAt { get; set; }
    public List<Order> Orders { get; set; }    // 導航屬性,不暴露
}

// DTO (API 格式)
public record UserDto(int Id, string Email, DateTime CreatedAt);
```

需要在這兩者間轉換。

### 4.2 三種寫法

**方式 1：手動 mapping（推薦初期用）**

```csharp
public static class UserExtensions
{
    public static UserDto ToDto(this User user)
        => new(user.Id, user.Email, user.CreatedAt);

    public static User ToEntity(this CreateUserDto dto)
        => new()
        {
            Email = dto.Email,
            PasswordHash = HashPassword(dto.Password),
            CreatedAt = DateTime.UtcNow
        };
}

// 使用
return user.ToDto();
```

**優點**：明確、好除錯、效能好
**缺點**:欄位多時要寫一堆

**方式 2:AutoMapper**

```csharp
// 設定
public class MappingProfile : Profile
{
    public MappingProfile()
    {
        CreateMap<User, UserDto>();
        CreateMap<CreateUserDto, User>()
            .ForMember(dest => dest.PasswordHash,
                       opt => opt.MapFrom(src => HashPassword(src.Password)));
    }
}

// 使用
public class UserService
{
    private readonly IMapper _mapper;

    public UserDto Get(...)
    {
        var user = ...;
        return _mapper.Map<UserDto>(user);
    }
}
```

**優點**：欄位多時省 code
**缺點**：runtime 才發現錯誤、效能略差、debug 困難（很多人現在不推薦了）

**方式 3：Mapster**（AutoMapper 的現代替代品）

```csharp
// 簡單情況直接用
return user.Adapt<UserDto>();

// 複雜情況設定
TypeAdapterConfig<CreateUserDto, User>.NewConfig()
    .Map(dest => dest.PasswordHash, src => HashPassword(src.Password));
```

效能比 AutoMapper 好，API 簡潔。

> **建議**:初期手動 mapping。需要 mapping 的地方多了再考慮工具，避免增加心智負擔。

### 4.3 Projection 直接 mapping（效能最佳）

EF Core 查詢時直接投影到 DTO，避免額外 mapping。

```csharp
// 直接查出 DTO,不撈 Entity
var users = await _db.Users
    .Select(u => new UserDto(u.Id, u.Email, u.CreatedAt))
    .ToListAsync();
```

SQL 只會 SELECT 需要的欄位，效能最好。**列表查詢首選做法**。

---

## 5. 架構概念（知道即可，不用深入）

### 5.1 Clean Architecture

把專案分成幾層：

```
┌────────────────────────────────────────┐
│  Presentation (Controllers, Web)       │  ← 外層
├────────────────────────────────────────┤
│  Application (Services, UseCases)      │
├────────────────────────────────────────┤
│  Domain (Entities, Business Rules)     │  ← 內層,最穩定
├────────────────────────────────────────┤
│  Infrastructure (DB, External APIs)    │
└────────────────────────────────────────┘
```

**核心思想**：依賴方向只能由外往內。Domain 不能依賴 Infrastructure，這樣換 DB、換框架都不影響核心邏輯。

實際專案不一定要嚴格遵守，知道思想即可。

### 5.2 DDD（Domain-Driven Design）基礎

| 概念 | 意義 | 範例 |
|------|------|------|
| Entity | 有唯一識別的物件 | User、Order（同名不同個） |
| Value Object | 沒有唯一識別、用值判斷相等 | Address、Money |
| Aggregate | 一組相關物件的集合，有一個 root | Order（root） + OrderItems |
| Repository | 操作 Aggregate 的介面 | IOrderRepository |

**Aggregate 重點**：外部只能透過 Aggregate Root 操作（不能直接操作 OrderItem），保證資料一致性。

### 5.3 CQRS（看到 MediatR 不會慌）

把「寫」跟「讀」分開:

- **Command**:寫操作（CreateOrder、UpdateUser）
- **Query**:讀操作（GetOrderById、ListUsers）

通常用 MediatR 套件實作:

```csharp
// Command
public record CreateOrderCommand(int UserId, List<OrderItemDto> Items) : IRequest<int>;

public class CreateOrderHandler : IRequestHandler<CreateOrderCommand, int>
{
    public async Task<int> Handle(CreateOrderCommand cmd, CancellationToken ct)
    {
        // ...
        return order.Id;
    }
}

// Controller
[HttpPost]
public async Task<IActionResult> Create(CreateOrderCommand cmd)
{
    var id = await _mediator.Send(cmd);
    return CreatedAtAction(nameof(GetById), new { id }, null);
}
```

公司可能有用、可能沒用，看到知道是什麼即可。

---

## 6. 實務建議

### 6.1 看公司 code 的順序

1. **先看資料夾結構**:大概有幾層、怎麼命名
2. **找一個簡單的 Controller**:看它依賴哪些 Service
3. **追進 Service**:看業務邏輯怎麼寫
4. **追進 Repository**:看 DB 操作
5. **看 DI 註冊**(`Program.cs`):確認生命週期跟綁定

### 6.2 不要過度設計

剛接業務時遇到的雷區：

- **不要為了 pattern 而 pattern**：簡單的 CRUD 不用搞 CQRS
- **不要每個 Entity 都有 Service**：CRUD 直接從 Controller 呼叫 Repository 也行
- **不要為了未來可能換 DB 過度抽象**：YAGNI（You Aren't Gonna Need It）

### 6.3 命名慣例

| 類型 | 慣例 | 範例 |
|------|------|------|
| Interface | I 開頭 | `IUserService` |
| Async 方法 | Async 結尾 | `GetByIdAsync` |
| DTO | Dto 結尾 | `UserDto`、`CreateUserDto` |
| Entity | 名詞 | `User`、`Order` |
| Service | Service 結尾 | `OrderService` |
| Repository | Repository 結尾 | `UserRepository` |

---

## 7. 練習建議

### 練習一：重構

把階段三練習寫的 Todo API 重構成三層架構：

- Controller 只處理 HTTP
- Service 處理業務邏輯
- Repository 處理資料存取
- 用 IUnitOfWork 統一 SaveChanges

### 練習二：閱讀公司 code

找一個業務流程稍微複雜的 endpoint（不是純 CRUD），畫出：

- 它依賴幾個 Service？
- Service 之間怎麼互動？
- Transaction 怎麼控制？
- 有沒有 mapping？怎麼做？

### 練習三：mapping 對比

用同一個 Entity，分別用三種方式（手動、AutoMapper、Projection）寫 mapping，比較：

- code 量
- SQL 差別
- 改欄位時的維護成本

---

## 8. 學完這階段你應該能...

- [ ] 看公司 code 知道每一層在做什麼
- [ ] 把業務邏輯從 Controller 拆出來放到 Service
- [ ] 用 Repository 模式封裝 DB 操作
- [ ] 用 DTO 跟 Entity 分離
- [ ] 知道 DDD、CQRS 是什麼，看到不慌
- [ ] 決定何時該抽象、何時保持簡單

完成後進入**階段六：後端測試**。
