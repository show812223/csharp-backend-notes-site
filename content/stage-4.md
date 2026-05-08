# 階段四：資料庫（MySQL 與 MongoDB）

> 目標：掌握關聯式資料庫（MySQL + EF Core）與 NoSQL（MongoDB）的設計差異與操作。**重點是 EF Core migration 流程**——這是後端最容易出事的環節，處理不好可能讓 production 資料遺失。

> ⚠️ **本階段最關鍵的章節是 [3.2 Migration 流程](#32-migration-流程重點章)**。其他語法細節事後可以查，但 migration 觀念不對會在 production 把資料搞壞，事後很難救。

> NoSQL 沒有 migration 的議題（schema-less），這是 RDB 才有的問題。在我們的環境就是 MySQL 要特別留意。

---

## 1. MySQL 基礎

### 1.1 關聯設計

**主鍵（Primary Key）**：唯一識別一筆資料

```sql
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(100) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**外鍵（Foreign Key）**：建立資料表之間的關聯

```sql
CREATE TABLE orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> MySQL 注意事項：用 `InnoDB` engine 才支援交易與外鍵；charset 用 `utf8mb4` 才能存 emoji 與完整 Unicode（`utf8` 是個歷史包袱、只支援 3-byte 字元）。

**三種關聯**

```
一對一(1:1):   一個 user 對應一個 user_profile
一對多(1:N):   一個 user 有多個 order        ← 最常見
多對多(M:N):   一個 order 有多個 product,
              一個 product 屬於多個 order   (中間需要關聯表)
```

**多對多範例**

```sql
CREATE TABLE orders (
    id INT PRIMARY KEY AUTO_INCREMENT
    -- ...
);

CREATE TABLE products (
    id INT PRIMARY KEY AUTO_INCREMENT
    -- ...
);

-- 中間表
CREATE TABLE order_products (
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    quantity INT NOT NULL,
    PRIMARY KEY (order_id, product_id),  -- 複合主鍵
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
);
```

### 1.2 基本 SQL

**SELECT 與 JOIN**

```sql
-- INNER JOIN: 兩邊都有的資料
SELECT u.email, o.total
FROM users u
INNER JOIN orders o ON u.id = o.user_id
WHERE o.total > 1000;

-- LEFT JOIN: 左邊全要,右邊沒有的補 NULL
SELECT u.email, COUNT(o.id) AS order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.email;
```

**JOIN 視覺化**

```
INNER JOIN:    A ∩ B         (交集)
LEFT JOIN:     A    + (A∩B)  (左邊全要)
RIGHT JOIN:        B + (A∩B) (右邊全要)
```

> MySQL 不支援 `FULL OUTER JOIN`，要用 `LEFT JOIN UNION RIGHT JOIN` 模擬。

**GROUP BY 與聚合**

```sql
-- 每個使用者的訂單數與總金額
SELECT
    user_id,
    COUNT(*)   AS order_count,
    SUM(total) AS total_amount,
    AVG(total) AS avg_amount,
    MAX(total) AS max_amount
FROM orders
GROUP BY user_id
HAVING SUM(total) > 10000;  -- HAVING 用於 GROUP 後的過濾
```

**Subquery 與 CTE**（CTE 需要 MySQL 8.0+）

```sql
-- Subquery
SELECT * FROM users
WHERE id IN (SELECT user_id FROM orders WHERE total > 1000);

-- CTE (Common Table Expression) - 可讀性更好
WITH high_value_users AS (
    SELECT user_id, SUM(total) AS total_spent
    FROM orders
    GROUP BY user_id
    HAVING SUM(total) > 10000
)
SELECT u.email, h.total_spent
FROM users u
INNER JOIN high_value_users h ON u.id = h.user_id;
```

**LIMIT 與 OFFSET**（MySQL 沒有 `TOP`）

```sql
SELECT * FROM orders ORDER BY created_at DESC LIMIT 10;            -- 前 10 筆
SELECT * FROM orders ORDER BY created_at DESC LIMIT 10 OFFSET 20;  -- 第 21~30 筆
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

**InnoDB 的 PK 與 secondary index**

| 比較 | 主鍵索引（叢集索引） | 一般索引（secondary） |
|------|---------------------|--------------------------|
| 數量限制 | 一張 table 只有一個 | 可以有多個 |
| 資料排序 | 實體資料按主鍵排序 | 索引葉節點記錄主鍵值 |
| 查詢 | PK 查最快 | 查到主鍵後再回主索引找資料（回表） |

```sql
-- 建立索引
CREATE INDEX ix_orders_user_id ON orders(user_id);

-- 複合索引(順序很重要!)
CREATE INDEX ix_orders_user_created ON orders(user_id, created_at DESC);
-- 上面這個索引可以用於:
-- WHERE user_id = 1                              ✅
-- WHERE user_id = 1 AND created_at > '2024-01'   ✅
-- WHERE created_at > '2024-01'                   ❌ (沒有先 user_id)
```

### 1.4 EXPLAIN（執行計畫）

**怎麼看？** 在 query 前面加 `EXPLAIN`：

```sql
EXPLAIN SELECT * FROM orders WHERE user_id = 1;
```

**type 欄位看效率**（由好到差）

| type | 意義 |
|------|------|
| `const` / `eq_ref` | ✅ PK 或唯一索引精準查到一筆 |
| `ref` | ✅ 用到一般索引 |
| `range` | ⚠️ 範圍掃描 |
| `index` | ⚠️ 掃整個索引 |
| `ALL` | ❌ 全表掃描，通常要加索引 |

也可以用 `EXPLAIN ANALYZE`（MySQL 8.0+）看實際執行時間。

初期不用精通，但要養成「query 慢就 EXPLAIN」的習慣。

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
| Read Committed | 不會 | 可能 | 可能 | Oracle/PostgreSQL 預設 |
| **Repeatable Read** | 不會 | 不會 | (InnoDB 用 gap lock 避免) | **MySQL InnoDB 預設** |
| Serializable | 不會 | 不會 | 不會 | 最嚴格、最慢 |

> MySQL 預設是 Repeatable Read，跟 SQL Server / PostgreSQL 不同，這點要注意。

### 2.4 死鎖（Deadlock）

```
交易 A:        交易 B:
LOCK users     LOCK orders
LOCK orders    LOCK users   ← 互相等待對方,死鎖
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
```

**MySQL 連線設定（Pomelo provider）**

```bash
dotnet add package Pomelo.EntityFrameworkCore.MySql
```

```csharp
// Program.cs
var connStr = builder.Configuration.GetConnectionString("Default");
builder.Services.AddDbContext<AppDbContext>(opt =>
    opt.UseMySql(connStr, ServerVersion.AutoDetect(connStr)));
```

```json
// appsettings.json
{
  "ConnectionStrings": {
    "Default": "Server=localhost;Port=3306;Database=app;User=root;Password=...;"
  }
}
```

> EF Core 官方沒有提供 MySQL provider，業界主流是用社群的 **Pomelo.EntityFrameworkCore.MySql**。

### 3.2 Migration 流程（重點章）

EF Core 用 migration 管理 DB schema 變更。**這是這階段最重要的一節**——沒處理好會讓 production 資料消失。

#### 3.2.1 為什麼 migration 容易出事

Migration 本質是「把 C# Entity 的變化翻成 SQL DDL（`ALTER TABLE`、`DROP COLUMN` 等）」。但 EF 不一定能正確猜到你的意圖：

- 你把欄位 `Phone` 改名成 `PhoneNumber` → EF 通常會產生「DROP COLUMN Phone + ADD COLUMN PhoneNumber」**而不是 RENAME**，原本欄位的資料就沒了
- 你把 `string` 改成 `int` → EF 產生 `ALTER TABLE ... MODIFY COLUMN`，**舊資料無法轉型會直接失敗或變空**
- 你刪掉 Entity 的某個 property → EF 產生 `DROP COLUMN`，**那一欄資料永遠消失**

關聯式資料庫的 schema 改變是破壞性操作。一旦在 production 跑下去，資料就回不來了。所以 migration 不能無腦相信 EF 產生的內容，**一定要先打開來看**。

#### 3.2.2 標準工作流程

```
寫/改 Entity
    ↓
dotnet ef migrations add <Name>     ← 產生 migration 檔
    ↓
打開 Migrations/*.cs 檢查           ← ⚠️ 最重要的一步
    ↓
（必要時手改 Up/Down 邏輯）
    ↓
本機 dotnet ef database update      ← 在 dev DB 試
    ↓
git commit migration 檔             ← 跟 code 一起 commit
    ↓
Code review + PR
    ↓
部署到 staging → production
```

#### 3.2.3 安裝與基本指令

```bash
# 第一次安裝工具
dotnet tool install --global dotnet-ef

# 建立 migration（不會動到 DB）
dotnet ef migrations add InitialCreate

# 套用到資料庫
dotnet ef database update

# 退回某個 migration（會跑 Down）
dotnet ef database update PreviousMigrationName

# 退回所有 migration（清空 schema）
dotnet ef database update 0

# 移除最後一個還沒套用的 migration
dotnet ef migrations remove

# 列出所有 migration
dotnet ef migrations list

# 產生 SQL 腳本（不執行，給 DBA 審）
dotnet ef migrations script
dotnet ef migrations script FromMigration ToMigration
dotnet ef migrations script --idempotent           # ⭐ production 推薦
```

#### 3.2.4 看懂 migration 檔案

`dotnet ef migrations add AddPhoneToUser` 會產生：

```csharp
// Migrations/20260508120000_AddPhoneToUser.cs
public partial class AddPhoneToUser : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "Phone",
            table: "Users",
            type: "varchar(20)",
            maxLength: 20,
            nullable: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "Phone", table: "Users");
    }
}
```

- `Up()`：套用時跑（schema 往前推）
- `Down()`：退版時跑（schema 往回退）
- 開 PR 前先把 `Up` 跟 `Down` **逐行讀過**，確認真的是你要的動作

#### 3.2.5 危險操作清單（會掉資料）

| 操作 | EF 預設行為 | 風險 |
|------|------------|------|
| 刪 property | `DropColumn` | ⚠️ 該欄資料永久消失 |
| 改 property 名 | `DropColumn` + `AddColumn` | ⚠️ 舊資料不會搬到新欄位 |
| 改型別（string→int 等） | `AlterColumn` | ⚠️ 無法轉型的資料會 fail 或變空 |
| 加 NOT NULL 欄位（沒給 default） | `AddColumn ... NOT NULL` | ⚠️ 既有資料會 fail |
| 加 unique index | `CreateIndex ... unique` | ⚠️ 既有重複資料會 fail |
| 改變 PK | `DropPrimaryKey` + `AddPrimaryKey` | ⚠️ 通常牽涉重建表 |

**改名要怎麼做才安全？** 手改 migration 用 `RenameColumn`：

```csharp
protected override void Up(MigrationBuilder mb)
{
    // ❌ EF 自動生的（會丟資料）
    // mb.DropColumn(name: "Phone", table: "Users");
    // mb.AddColumn<string>(name: "PhoneNumber", table: "Users", ...);

    // ✅ 手改成 rename
    mb.RenameColumn(name: "Phone", table: "Users", newName: "PhoneNumber");
}
```

**改型別要怎麼做才安全？** 拆成多步：

1. 加新欄位（nullable）
2. 寫資料搬移腳本（`migrationBuilder.Sql("UPDATE ... SET new_col = CAST(...)")`）
3. 等 deploy 穩定
4. 下一次 migration 才把舊欄位刪掉

**加 NOT NULL 欄位要怎麼做？** 兩種選擇：

```csharp
// 選 1：給 default value，舊資料會被填上 default
mb.AddColumn<int>(
    name: "Status", table: "Users",
    nullable: false, defaultValue: 0);

// 選 2：先加 nullable → 補資料 → 再改 NOT NULL（安全但要兩次 migration）
```

#### 3.2.6 Production 套用：別直接跑 `database update`

本機開發可以 `dotnet ef database update`，但 production **不建議直接跑**。原因：

- 需要把 EF 工具與 connection string 帶到 production 機器
- 失敗時沒有預先審查的機會
- 多 instance 部署可能同時想跑 migration

**推薦方式：產出 idempotent SQL，由 CI/CD 套用**

```bash
dotnet ef migrations script --idempotent --output migration.sql
```

`--idempotent` 會在每段 SQL 前加判斷「這個 migration 已經套過就跳過」，重複跑也不會壞。把 SQL 給 DBA 審、放進 deploy pipeline 用 `mysql < migration.sql` 或工具套用。

#### 3.2.7 Pending Model Changes

執行 `dotnet ef database update` 或啟動 app 時，可能看到：

```
The model for context 'AppDbContext' has pending changes.
Add a new migration before updating the database.
```

意思是 **Entity 跟最後一個 migration 對不上**——你改了 Entity 但忘記 `migrations add`。**這是訊號，不是噪音**：忽略它就會跑出跟 Entity 不一致的 schema。

#### 3.2.8 多人協作的衝突

兩個人各自開 branch、都產了 migration：

```
A 的 branch: 20260501_AddPhone
B 的 branch: 20260502_AddAddress
```

合併時 EF 發現 **`ModelSnapshot.cs` 衝突**（這檔記錄當前的「綜合 schema」）。處理方式：

1. 後 merge 的人把自己的 migration 移除（`dotnet ef migrations remove`）
2. pull 對方的 migration
3. 重新跑 `dotnet ef migrations add` 在最新的基礎上產一份

不要硬解 `ModelSnapshot.cs` 的衝突，會出事。

#### 3.2.9 退版（Rollback）

```bash
# 退到指定 migration（會跑後續 migration 的 Down）
dotnet ef database update AddPhoneToUser
```

但 **實務上 production 不太會退 migration**，因為：

- `Down` 通常會 drop 新加的欄位 → 期間寫進去的資料會掉
- 跟 application code 的版本對不上

通常 production 出事是用「**前進修補**」（再加一個 migration 把錯誤改回來），而不是退版。所以 deploy 前的 review 才是最重要的關卡。

#### 3.2.10 Migration 流程 checklist

每次改 schema 前對著這個 checklist 跑一遍：

- [ ] 我有沒有打開 `Migrations/*.cs` 看 `Up()` 跟 `Down()`？
- [ ] 有沒有出現 `DropColumn`？是真的要丟，還是其實是 rename？
- [ ] 有沒有出現 `AlterColumn` 改型別？舊資料能正確轉型嗎？
- [ ] 加 NOT NULL 欄位有沒有給 default？
- [ ] 加 unique index 前確認過沒有重複資料嗎？
- [ ] `dotnet ef migrations script --idempotent` 跑過嗎？SQL 看起來合理嗎？
- [ ] PR 有讓人 review migration 檔嗎？

> **一句話**：都知道自己在幹嘛才能 update database。

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
    opt.UseMySql(connStr, ServerVersion.AutoDetect(connStr));
    opt.EnableSensitiveDataLogging();   // 印出參數值(只在開發用)
    opt.LogTo(Console.WriteLine, LogLevel.Information);
});
```

> **養成習慣**：寫完 EF query 順手看 SQL，可以避免很多效能災難。

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

## 5. NoSQL：MongoDB

我們的環境同時用 MySQL（關聯式）跟 MongoDB（NoSQL）。兩種資料庫的世界觀不一樣，要分清楚什麼資料適合放哪裡。

### 5.1 文件型資料庫的世界觀

MongoDB 把一筆資料叫做 **document**（BSON / 類 JSON），存在 **collection**（類似 table，但沒有固定 schema）。

```js
// MySQL 的 user + orders 要兩張表
// MongoDB 可以塞在一個 document 裡
{
  "_id": ObjectId("..."),
  "email": "alice@example.com",
  "orders": [
    { "total": 1200, "createdAt": ISODate("2026-05-01") },
    { "total":  300, "createdAt": ISODate("2026-05-03") }
  ]
}
```

| 概念 | MySQL | MongoDB |
|------|-------|---------|
| 資料容器 | table | collection |
| 一筆資料 | row | document |
| 欄位 | column（固定） | field（每筆可以不同） |
| 主鍵 | `id` | `_id`（ObjectId） |
| 關聯 | JOIN | 嵌入（embed）或參照（reference） |
| Schema | 嚴格、要 migration | 彈性、無 migration 概念 |
| 交易 | ACID | 預設沒交易（4.0+ 支援，但有限制） |

### 5.2 何時用 RDB、何時用 NoSQL

| 情境 | 比較適合 |
|------|---------|
| 業務資料、訂單、會員、財務 | **MySQL**（要交易、要一致性） |
| 多對多關聯複雜、要 JOIN | **MySQL** |
| 純讀寫多、結構彈性、不太 JOIN | **MongoDB**（log、event、cache、用戶行為） |
| 文件結構巢狀很深、整包讀整包寫 | **MongoDB** |
| 需要彈性 schema（每筆欄位不一樣） | **MongoDB** |

實務上很多公司是兩種都用：核心業務在 MySQL，輔助資料（log、設定、彈性內容）在 MongoDB。

### 5.3 沒有 migration 的代價

「NoSQL 沒有 migration」聽起來爽，但代價要清楚：

- **schema 漂移（schema drift）**：同個 collection 裡，舊 document 有 `phone`、新的有 `phone_number`，要在 application code 容忍兩種
- **沒有 ALTER COLUMN**：要改欄位名稱，得寫程式 / script 把所有 document 一筆筆更新
- **約束在 application 層**：MySQL 的 `NOT NULL`、unique、FK 都沒了，靠程式守
- **沒有 EF migration 流程**：新增/移除欄位不會被 review，DBA 也很難審

**結論**：MongoDB 的「自由」是 application code 要扛責任。改 document 結構時還是要想清楚相容性。

### 5.4 C# 用 MongoDB.Driver

```bash
dotnet add package MongoDB.Driver
```

```csharp
public class UserDoc
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string? Id { get; set; }

    [BsonElement("email")]
    public string Email { get; set; } = "";

    [BsonElement("createdAt")]
    public DateTime CreatedAt { get; set; }
}

public class UserRepository
{
    private readonly IMongoCollection<UserDoc> _users;

    public UserRepository(IConfiguration cfg)
    {
        var client = new MongoClient(cfg.GetConnectionString("Mongo"));
        var db = client.GetDatabase("app");
        _users = db.GetCollection<UserDoc>("users");
    }

    public Task<List<UserDoc>> GetActiveAsync()
        => _users.Find(u => u.CreatedAt > DateTime.UtcNow.AddDays(-30))
                 .ToListAsync();

    public Task InsertAsync(UserDoc user)
        => _users.InsertOneAsync(user);

    public Task UpdateEmailAsync(string id, string email)
    {
        var filter = Builders<UserDoc>.Filter.Eq(u => u.Id, id);
        var update = Builders<UserDoc>.Update.Set(u => u.Email, email);
        return _users.UpdateOneAsync(filter, update);
    }
}
```

**Program.cs 註冊**

```csharp
builder.Services.AddSingleton<IMongoClient>(sp =>
    new MongoClient(builder.Configuration.GetConnectionString("Mongo")));
builder.Services.AddScoped<UserRepository>();
```

> Mongo client 是 thread-safe，**用 Singleton 註冊**（跟 EF DbContext 不同）。

---

## 6. 練習建議

### 練習一：設計 Schema

設計一個簡單電商的資料庫，包含：

- users（使用者）
- products（商品）
- orders（訂單）
- order_items（訂單明細）

要求：

- 畫出 ER Diagram（可用 [dbdiagram.io](https://dbdiagram.io)）
- 寫出建表 SQL（MySQL 語法）
- 想想哪些欄位該加索引

### 練習二：用 EF Core + MySQL 實作

照上面的 schema 用 Code-First 寫出來：

- 連線到 MySQL（用 Pomelo provider）
- 定義所有 Entity
- 設定 Fluent API（關聯、欄位限制、索引）
- 跑 migration 建立 DB
- 寫一個 service 實作「查詢使用者的所有訂單，含明細」

### 練習三：Migration 危險情境演練

刻意製造會掉資料的 migration，觀察並修正：

1. 把 `User.Phone` 改名成 `User.PhoneNumber`，看 EF 產生什麼，手改成 `RenameColumn`
2. 把 `User.Age` 從 `string` 改成 `int`，先放假資料、再產 migration、看會發生什麼
3. 加一個 `User.Status` 欄位（NOT NULL），思考既有資料怎麼補
4. 跑 `dotnet ef migrations script --idempotent`，看產生的 SQL

### 練習四：效能對比

寫三個版本的「列出所有使用者及其訂單數」：

1. N+1 版（不要用 Include）
2. Include 版
3. Projection 版

用 `ToQueryString()` 看 SQL，比較差別。

### 練習五：Transaction

寫一個「下訂單」的方法，要做：

1. 檢查商品庫存
2. 扣庫存
3. 建立 Order
4. 建立 OrderItems

用 transaction 包起來，確保任一步失敗都會 rollback。

### 練習六：MongoDB

把「使用者行為紀錄（user_events）」存到 MongoDB：

- 設計 document 結構（events 是一筆一筆的，不需要 JOIN）
- 用 `MongoDB.Driver` 寫 insert / query
- 想一下：如果之後要加新欄位 `device`，舊資料怎麼辦？要不要寫遷移 script？

---

## 7. 學完這階段你應該能...

- [ ] 設計合理的 MySQL schema
- [ ] 寫常見的 SQL（JOIN、GROUP BY、Subquery）
- [ ] 知道何時該加索引、加什麼索引
- [ ] 用 EF Core + Pomelo 連 MySQL，寫複雜查詢，並避開 N+1
- [ ] 看得懂 EF 產生的 SQL
- [ ] 用 transaction 處理多步驟業務邏輯
- [ ] **打開 migration 檔逐行 review，看得出哪些操作會掉資料**
- [ ] **知道 production 套 migration 應該用 `--idempotent` SQL**
- [ ] 知道 MySQL 與 MongoDB 各自適合什麼情境
- [ ] 用 `MongoDB.Driver` 寫基本的 CRUD

完成後進入**階段五：程式碼架構**。
