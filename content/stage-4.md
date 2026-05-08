# 階段四：資料庫與 EF Core

> 目標：掌握關聯式資料庫設計與 ORM 操作。SQL 是前端轉後端最容易低估的學習成本，這階段花的時間值得。

---

## 1. SQL Server 基礎

### 1.1 關聯設計

**主鍵（Primary Key）**：唯一識別一筆資料

```sql
CREATE TABLE Users (
    Id INT PRIMARY KEY IDENTITY(1,1),  -- 自動遞增
    Email NVARCHAR(100) NOT NULL,
    CreatedAt DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);
```

**外鍵（Foreign Key）**：建立資料表之間的關聯

```sql
CREATE TABLE Orders (
    Id INT PRIMARY KEY IDENTITY(1,1),
    UserId INT NOT NULL,
    Total DECIMAL(10,2) NOT NULL,
    CreatedAt DATETIME2 NOT NULL,
    FOREIGN KEY (UserId) REFERENCES Users(Id)
);
```

**三種關聯**

```
一對一(1:1):   一個 User 對應一個 UserProfile
一對多(1:N):   一個 User 有多個 Order        ← 最常見
多對多(M:N):   一個 Order 有多個 Product,
              一個 Product 屬於多個 Order   (中間需要關聯表)
```

**多對多範例**

```sql
CREATE TABLE Orders (
    Id INT PRIMARY KEY,
    -- ...
);

CREATE TABLE Products (
    Id INT PRIMARY KEY,
    -- ...
);

-- 中間表
CREATE TABLE OrderProducts (
    OrderId INT NOT NULL,
    ProductId INT NOT NULL,
    Quantity INT NOT NULL,
    PRIMARY KEY (OrderId, ProductId),  -- 複合主鍵
    FOREIGN KEY (OrderId) REFERENCES Orders(Id),
    FOREIGN KEY (ProductId) REFERENCES Products(Id)
);
```

### 1.2 基本 T-SQL

**SELECT 與 JOIN**

```sql
-- INNER JOIN: 兩邊都有的資料
SELECT u.Email, o.Total
FROM Users u
INNER JOIN Orders o ON u.Id = o.UserId
WHERE o.Total > 1000;

-- LEFT JOIN: 左邊全要,右邊沒有的補 NULL
SELECT u.Email, COUNT(o.Id) AS OrderCount
FROM Users u
LEFT JOIN Orders o ON u.Id = o.UserId
GROUP BY u.Email;
```

**JOIN 視覺化**

```
INNER JOIN:    A ∩ B         (交集)
LEFT JOIN:     A    + (A∩B)  (左邊全要)
RIGHT JOIN:        B + (A∩B) (右邊全要)
FULL JOIN:     A + B         (全要)
```

**GROUP BY 與聚合**

```sql
-- 每個使用者的訂單數與總金額
SELECT
    UserId,
    COUNT(*) AS OrderCount,
    SUM(Total) AS TotalAmount,
    AVG(Total) AS AvgAmount,
    MAX(Total) AS MaxAmount
FROM Orders
GROUP BY UserId
HAVING SUM(Total) > 10000;  -- HAVING 用於 GROUP 後的過濾
```

**Subquery 與 CTE**

```sql
-- Subquery
SELECT * FROM Users
WHERE Id IN (SELECT UserId FROM Orders WHERE Total > 1000);

-- CTE (Common Table Expression) - 可讀性更好
WITH HighValueUsers AS (
    SELECT UserId, SUM(Total) AS TotalSpent
    FROM Orders
    GROUP BY UserId
    HAVING SUM(Total) > 10000
)
SELECT u.Email, h.TotalSpent
FROM Users u
INNER JOIN HighValueUsers h ON u.Id = h.UserId;
```

### 1.3 索引（Index）

**索引是什麼？** 想像一本書的目錄。沒目錄要從第一頁翻到最後一頁，有目錄可以直接跳到對的頁。

**何時要加索引？**

- WHERE 常用的欄位
- JOIN 的欄位（FK 通常會自動有索引）
- ORDER BY 的欄位

**何時不要加？**

- 寫入很頻繁的欄位（每次寫入都要更新索引）
- 重複值很多的欄位（例如性別欄位）

**聚簇索引 vs 非聚簇索引**

| 比較 | 聚簇索引（Clustered） | 非聚簇索引（Non-clustered） |
|------|---------------------|--------------------------|
| 數量限制 | 一個 table 只能有一個 | 可以有多個 |
| 資料排序 | 實體資料按索引排序 | 另外一份索引指向資料 |
| 預設 | PK 預設是聚簇索引 | 一般 INDEX 是這個 |
| 適合 | 範圍查詢、PK | 一般查詢 |

```sql
-- 建立非聚簇索引
CREATE INDEX IX_Orders_UserId ON Orders(UserId);

-- 複合索引(順序很重要!)
CREATE INDEX IX_Orders_UserId_CreatedAt ON Orders(UserId, CreatedAt DESC);
-- 上面這個索引可以用於:
-- WHERE UserId = 1                            ✅
-- WHERE UserId = 1 AND CreatedAt > '2024-01'  ✅
-- WHERE CreatedAt > '2024-01'                  ❌ (沒有先 UserId)
```

### 1.4 執行計畫（Execution Plan）

**怎麼看？** SSMS（SQL Server Management Studio）按 `Ctrl+M` 開啟「Include Actual Execution Plan」，再執行 query。

**關鍵字看圖**

| 看到 | 意義 |
|------|------|
| Index Seek | ✅ 用到索引,效能好 |
| Index Scan | ⚠️ 掃整個索引 |
| Table Scan | ❌ 掃整張表,通常要加索引 |
| Key Lookup | ⚠️ 索引找到後還要回主表查欄位,可考慮 INCLUDE |

初期不用精通，但要養成「query 慢就看執行計畫」的習慣。

---

## 2. Transaction（交易）

### 2.1 ACID 概念

| 字 | 意義 | 例子 |
|----|------|------|
| **A**tomicity | 原子性 | 轉帳:扣款跟入帳要嘛都成功,要嘛都失敗 |
| **C**onsistency | 一致性 | 轉帳前後總金額不變 |
| **I**solation | 隔離性 | 兩個 transaction 不會互相干擾 |
| **D**urability | 持久性 | commit 後不會因為當機而消失 |

### 2.2 EF Core 的 Transaction

```csharp
// 方式 1: SaveChangesAsync 內含交易
public async Task TransferAsync(int fromUserId, int toUserId, decimal amount)
{
    var from = await _db.Users.FindAsync(fromUserId);
    var to = await _db.Users.FindAsync(toUserId);

    from.Balance -= amount;
    to.Balance += amount;

    await _db.SaveChangesAsync();  // 這兩個 update 是同一個交易
}

// 方式 2: 明確使用 Transaction (跨多個 SaveChanges)
public async Task ComplexOperationAsync()
{
    using var transaction = await _db.Database.BeginTransactionAsync();
    try
    {
        await DoStep1();
        await _db.SaveChangesAsync();

        await DoStep2();
        await _db.SaveChangesAsync();

        await transaction.CommitAsync();
    }
    catch
    {
        await transaction.RollbackAsync();
        throw;
    }
}
```

### 2.3 隔離層級

| 層級 | 髒讀 | 不可重複讀 | 幻讀 | 用途 |
|------|------|-----------|------|------|
| Read Uncommitted | 可能 | 可能 | 可能 | 報表查詢可接受不準 |
| **Read Committed** | 不會 | 可能 | 可能 | **預設、最常用** |
| Repeatable Read | 不會 | 不會 | 可能 | 重要的讀取 |
| Serializable | 不會 | 不會 | 不會 | 最嚴格、最慢 |

**問題情境解釋**

- **髒讀（Dirty Read）**：A 更新但還沒 commit，B 讀到了未 commit 的資料
- **不可重複讀（Non-repeatable Read）**：同一交易中讀兩次，因為 B 在中間 commit 了 update，結果不同
- **幻讀（Phantom Read）**：同一交易中查兩次列表，因為 B 插入新資料，第二次多了幾筆

初期用預設的 Read Committed 就好。

### 2.4 死鎖（Deadlock）

```
交易 A:        交易 B:
LOCK Users     LOCK Orders
LOCK Orders    LOCK Users   ← 互相等待對方,死鎖
```

**避免方式**

- 多個 transaction 鎖定資源的順序要一致
- transaction 越短越好
- 別在 transaction 裡面呼叫外部 API（會變慢）

---

## 3. Entity Framework Core

### 3.1 Code-First：定義 Entity 與 DbContext

```csharp
// Entity
public class User
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public DateTime CreatedAt { get; set; }

    // 導航屬性(Navigation Property)
    public List<Order> Orders { get; set; } = new();
}

public class Order
{
    public int Id { get; set; }
    public int UserId { get; set; }   // FK
    public decimal Total { get; set; }
    public DateTime CreatedAt { get; set; }

    // 反向導航
    public User User { get; set; } = null!;
}

// DbContext
public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<Order> Orders => Set<Order>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasIndex(u => u.Email).IsUnique();
            entity.Property(u => u.Email).HasMaxLength(100).IsRequired();
        });

        modelBuilder.Entity<Order>(entity =>
        {
            entity.Property(o => o.Total).HasColumnType("decimal(10,2)");
            entity.HasOne(o => o.User)
                  .WithMany(u => u.Orders)
                  .HasForeignKey(o => o.UserId)
                  .OnDelete(DeleteBehavior.Restrict);
        });
    }
}

// Program.cs 註冊
builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseSqlServer(builder.Configuration.GetConnectionString("Default")));
```

### 3.2 Migrations

EF Core 用 migrations 管理 DB schema 變更。

```bash
# 安裝工具(第一次)
dotnet tool install --global dotnet-ef

# 建立第一個 migration
dotnet ef migrations add InitialCreate

# 套用到資料庫
dotnet ef database update

# 修改 Entity 後,新增 migration
dotnet ef migrations add AddPhoneToUser

# 套用
dotnet ef database update

# 退回某個 migration
dotnet ef database update PreviousMigrationName

# 移除最後一個還沒套用的 migration
dotnet ef migrations remove
```

**Migration 檔案會被 commit 進 Git**，team 成員 pull 下來執行 `database update` 就能同步 schema。

### 3.3 Fluent API vs Data Annotations

兩種設定方式都行，業務系統慣用 Fluent API（集中、不污染 Entity）。

```csharp
// Data Annotations - 寫在 Entity
public class User
{
    [Key]
    public int Id { get; set; }

    [Required]
    [MaxLength(100)]
    public string Email { get; set; } = "";
}

// Fluent API - 寫在 DbContext
protected override void OnModelCreating(ModelBuilder b)
{
    b.Entity<User>(e =>
    {
        e.HasKey(u => u.Id);
        e.Property(u => u.Email).IsRequired().HasMaxLength(100);
    });
}
```

### 3.4 LINQ to Entities

EF Core 把 LINQ 翻譯成 SQL。

```csharp
// 簡單查詢
var users = await _db.Users
    .Where(u => u.CreatedAt > DateTime.UtcNow.AddDays(-30))
    .OrderByDescending(u => u.CreatedAt)
    .Take(10)
    .ToListAsync();

// JOIN(用導航屬性,不用寫 join)
var ordersWithUsers = await _db.Orders
    .Where(o => o.Total > 1000)
    .Select(o => new
    {
        o.Id,
        o.Total,
        UserEmail = o.User.Email  // EF 自動 JOIN
    })
    .ToListAsync();

// 聚合
var stats = await _db.Orders
    .GroupBy(o => o.UserId)
    .Select(g => new
    {
        UserId = g.Key,
        Count = g.Count(),
        Total = g.Sum(o => o.Total)
    })
    .ToListAsync();
```

**常用結尾方法**

| 方法 | 行為 |
|------|------|
| `ToListAsync()` | 執行 query,回 List |
| `FirstOrDefaultAsync()` | 取第一筆,沒有回 null |
| `SingleOrDefaultAsync()` | 預期最多一筆,多筆會 throw |
| `AnyAsync()` | 是否存在(只回 true/false,SQL 用 EXISTS) |
| `CountAsync()` | 計數 |

> **重點**：在 `ToListAsync()` 之前都還沒執行 SQL，這就是 IQueryable 的延遲執行特性（在階段一提過）。

---

## 4. EF Core 效能優化

### 4.1 N+1 問題

**最常見的效能殺手**。

```csharp
// ❌ N+1 問題
var users = await _db.Users.ToListAsync();   // 1 次 query
foreach (var user in users)
{
    var count = user.Orders.Count;            // 每個 user 多 1 次 query
    // 總共 1 + N 次 query
}
```

**解法 1：Eager Loading（Include）**

```csharp
// ✅ 一次撈完
var users = await _db.Users
    .Include(u => u.Orders)        // 一起撈 Orders
    .ToListAsync();

// 多層
var orders = await _db.Orders
    .Include(o => o.User)
    .Include(o => o.OrderItems)
        .ThenInclude(oi => oi.Product)
    .ToListAsync();
```

**解法 2：Projection（推薦，最有效率）**

```csharp
// ✅ 只撈需要的欄位
var result = await _db.Users
    .Select(u => new
    {
        u.Id,
        u.Email,
        OrderCount = u.Orders.Count,
        TotalSpent = u.Orders.Sum(o => o.Total)
    })
    .ToListAsync();
```

### 4.2 Eager / Lazy / Explicit Loading

| 方式 | 何時載入 | 用法 |
|------|---------|------|
| Eager | 主查詢同時 | `.Include()` |
| Lazy | 存取時自動 | 需設定，預設關閉 |
| Explicit | 手動觸發 | `.Entry().Collection().LoadAsync()` |

EF Core 預設不用 Lazy Loading，主流是 Eager + Projection。

### 4.3 AsNoTracking

預設 EF 會追蹤每個查出來的 Entity 狀態（為了之後 SaveChanges）。**唯讀查詢用 AsNoTracking 可以省一半記憶體**。

```csharp
// 只是要讀,不會修改
var users = await _db.Users
    .AsNoTracking()
    .Where(u => u.IsActive)
    .ToListAsync();
```

> **規則**：API 回傳給前端的 read 操作幾乎都該加 `AsNoTracking()`。

### 4.4 看 EF 產生的 SQL

**方式 1：ToQueryString()**

```csharp
var query = _db.Users.Where(u => u.IsActive);
Console.WriteLine(query.ToQueryString());  // 印出 SQL
```

**方式 2：Logging**

```csharp
// Program.cs
builder.Services.AddDbContext<AppDbContext>(opt =>
{
    opt.UseSqlServer(connStr);
    opt.EnableSensitiveDataLogging();   // 印出參數值(只在開發用)
    opt.LogTo(Console.WriteLine, LogLevel.Information);
});
```

> **養成習慣**:寫完 EF query 順手看 SQL,可以避免很多效能災難。

### 4.5 Split Query

多個 Include 時，EF 預設會用 LEFT JOIN 一次撈，遇到 1:N + 1:N 會產生「笛卡兒爆炸」。

```csharp
// ❌ 一個 user 有 10 個 order, 每個 order 有 10 個 item
//    結果一個 user 會出現 100 次,資料量爆炸
var users = await _db.Users
    .Include(u => u.Orders)
        .ThenInclude(o => o.Items)
    .ToListAsync();

// ✅ 拆成多個 query 執行
var users = await _db.Users
    .Include(u => u.Orders)
        .ThenInclude(o => o.Items)
    .AsSplitQuery()
    .ToListAsync();
```

---

## 5. 練習建議

### 練習一：設計 Schema

設計一個簡單電商的資料庫，包含：

- Users（使用者）
- Products（商品）
- Orders（訂單）
- OrderItems（訂單明細）

要求：

- 畫出 ER Diagram（可用 [dbdiagram.io](https://dbdiagram.io)）
- 寫出建表 SQL
- 想想哪些欄位該加索引

### 練習二：用 EF Core 實作

照上面的 schema 用 Code-First 寫出來：

- 定義所有 Entity
- 設定 Fluent API（關聯、欄位限制、索引）
- 跑 migration 建立 DB
- 寫一個 service 實作「查詢使用者的所有訂單，含明細」

### 練習三：效能對比

寫三個版本的「列出所有使用者及其訂單數」：

1. N+1 版（不要用 Include）
2. Include 版
3. Projection 版

用 `ToQueryString()` 看 SQL，比較差別。

### 練習四：Transaction

寫一個「下訂單」的方法，要做：

1. 檢查商品庫存
2. 扣庫存
3. 建立 Order
4. 建立 OrderItems

用 transaction 包起來，確保任一步失敗都會 rollback。

---

## 6. 學完這階段你應該能...

- [ ] 設計合理的關聯式資料庫 schema
- [ ] 寫常見的 SQL（JOIN、GROUP BY、Subquery）
- [ ] 知道何時該加索引、加什麼索引
- [ ] 用 EF Core 寫複雜查詢，並避開 N+1
- [ ] 看得懂 EF 產生的 SQL
- [ ] 用 transaction 處理多步驟業務邏輯

完成後進入**階段五：程式碼架構**。
