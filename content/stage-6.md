# 階段六：後端測試

> 目標：建立高品質的防線，確保邏輯重構的安全性。後端測試比前端測試更重要，因為一個 bug 影響的是真實資料、真實的錢。

---

## 1. 測試金字塔

```
        ▲
       ╱ ╲      E2E Test (慢、貴、少)
      ╱   ╲     - 真的打 API
     ╱─────╲
    ╱       ╲   Integration Test (中)
   ╱         ╲  - 起 server + in-memory DB
  ╱───────────╲
 ╱             ╲ Unit Test (快、便宜、多)
╱_______________╲ - 純邏輯,mock 依賴
```

**比例建議**：

- 單元測試：70%（核心業務邏輯）
- 整合測試：20%（重要的端到端流程）
- E2E 測試：10%（關鍵使用者旅程）

---

## 2. 單元測試基礎

### 2.1 xUnit 入門

xUnit 是 .NET 主流測試框架（NUnit、MSTest 也常見，語法略有差異）。

**建立測試專案**

```bash
dotnet new xunit -n MyApp.Tests
cd MyApp.Tests
dotnet add reference ../MyApp/MyApp.csproj
```

**第一個測試**

```csharp
public class CalculatorTests
{
    [Fact]   // 簡單測試
    public void Add_TwoPositiveNumbers_ReturnsSum()
    {
        // Arrange
        var calc = new Calculator();

        // Act
        var result = calc.Add(2, 3);

        // Assert
        Assert.Equal(5, result);
    }
}
```

**執行測試**

```bash
dotnet test
```

### 2.2 AAA 模式

每個測試都遵循三段式：

```csharp
[Fact]
public async Task GetUserById_UserExists_ReturnsUser()
{
    // Arrange (準備)
    var userId = 1;
    var expected = new User { Id = userId, Email = "test@example.com" };
    var mockRepo = new Mock<IUserRepository>();
    mockRepo.Setup(r => r.GetByIdAsync(userId)).ReturnsAsync(expected);
    var service = new UserService(mockRepo.Object);

    // Act (執行)
    var result = await service.GetByIdAsync(userId);

    // Assert (驗證)
    Assert.NotNull(result);
    Assert.Equal(userId, result.Id);
    Assert.Equal("test@example.com", result.Email);
}
```

**用空行分隔三段**，讓測試結構一目瞭然。

### 2.3 測試命名

好的命名讓人不用看 code 就知道測什麼。

**推薦格式**：`[Method]_[Scenario]_[ExpectedResult]`

```csharp
// ✅ 好
public void GetUserById_UserExists_ReturnsUser() { }
public void GetUserById_UserNotFound_ReturnsNull() { }
public void CreateUser_DuplicateEmail_ThrowsValidationException() { }
public void Transfer_InsufficientFunds_ThrowsBusinessException() { }

// ❌ 不好
public void Test1() { }
public void GetUser() { }
public void TestGetUser() { }
```

### 2.4 [Fact] vs [Theory]

```csharp
// [Fact] - 一個測試
[Fact]
public void Add_PositiveNumbers_ReturnsSum()
{
    Assert.Equal(5, _calc.Add(2, 3));
}

// [Theory] - 參數化測試,一個方法測多種輸入
[Theory]
[InlineData(2, 3, 5)]
[InlineData(0, 0, 0)]
[InlineData(-1, 1, 0)]
[InlineData(-5, -5, -10)]
public void Add_VariousInputs_ReturnsExpected(int a, int b, int expected)
{
    Assert.Equal(expected, _calc.Add(a, b));
}
```

> **[Theory] 比寫多個 [Fact] 好**，少很多重複 code。

### 2.5 常用 Assertion

```csharp
// 相等
Assert.Equal(expected, actual);
Assert.NotEqual(expected, actual);

// Null 檢查
Assert.Null(result);
Assert.NotNull(result);

// 布林
Assert.True(condition);
Assert.False(condition);

// 集合
Assert.Empty(list);
Assert.NotEmpty(list);
Assert.Single(list);              // 只有一個
Assert.Contains(item, list);
Assert.Equal(3, list.Count);

// 字串
Assert.Contains("hello", str);
Assert.StartsWith("https://", url);
Assert.Matches(@"^\d+$", str);

// Exception
var ex = await Assert.ThrowsAsync<ValidationException>(
    () => service.CreateAsync(invalidDto));
Assert.Equal("Email is required", ex.Message);

// 範圍
Assert.InRange(price, 0, 1000);
```

### 2.6 FluentAssertions（推薦）

業界很多人用 FluentAssertions，可讀性比原生 Assert 好。

```bash
dotnet add package FluentAssertions
```

```csharp
// 原生 xUnit
Assert.Equal(5, result);
Assert.NotNull(user);
Assert.Equal("Alice", user.Name);

// FluentAssertions
result.Should().Be(5);
user.Should().NotBeNull();
user.Name.Should().Be("Alice");

// 鏈式驗證
users.Should()
    .HaveCount(3)
    .And.Contain(u => u.Email == "alice@example.com")
    .And.OnlyContain(u => u.IsActive);

// Exception
await service.Invoking(s => s.CreateAsync(invalidDto))
    .Should().ThrowAsync<ValidationException>()
    .WithMessage("*email*");
```

---

## 3. Mocking（模擬物件）

### 3.1 為什麼要 Mock？

單元測試要**隔離**被測單元。如果 UserService 直接連真的 DB，測試會：

- 慢（要連 DB）
- 不穩定（DB 狀態會影響結果）
- 難以測試特定情境（怎麼讓 DB 剛好故障？）

解法：用 Mock 取代依賴。

### 3.2 Moq 入門

```bash
dotnet add package Moq
```

```csharp
public class UserServiceTests
{
    [Fact]
    public async Task GetByIdAsync_UserExists_ReturnsUser()
    {
        // Arrange
        var mockRepo = new Mock<IUserRepository>();
        var fakeUser = new User { Id = 1, Email = "test@example.com" };

        mockRepo.Setup(r => r.GetByIdAsync(1))
                .ReturnsAsync(fakeUser);

        var service = new UserService(mockRepo.Object);

        // Act
        var result = await service.GetByIdAsync(1);

        // Assert
        result.Should().NotBeNull();
        result!.Email.Should().Be("test@example.com");
    }
}
```

### 3.3 Moq 常用語法

```csharp
var mock = new Mock<IUserRepository>();

// 1. Setup - 設定回傳值
mock.Setup(r => r.GetByIdAsync(1))
    .ReturnsAsync(new User { Id = 1 });

// 2. 任何參數
mock.Setup(r => r.GetByIdAsync(It.IsAny<int>()))
    .ReturnsAsync((User?)null);

// 3. 條件參數
mock.Setup(r => r.GetByIdAsync(It.Is<int>(id => id > 0)))
    .ReturnsAsync(new User());

// 4. 拋出例外
mock.Setup(r => r.GetByIdAsync(It.IsAny<int>()))
    .ThrowsAsync(new Exception("DB error"));

// 5. 動態回傳
mock.Setup(r => r.GetByIdAsync(It.IsAny<int>()))
    .ReturnsAsync((int id) => new User { Id = id });

// 6. Verify - 驗證方法被呼叫
mock.Verify(r => r.GetByIdAsync(1), Times.Once);
mock.Verify(r => r.AddAsync(It.IsAny<User>()), Times.Never);
mock.Verify(r => r.GetByIdAsync(It.IsAny<int>()), Times.AtLeastOnce);
```

### 3.4 完整範例

```csharp
public class OrderServiceTests
{
    private readonly Mock<IUserRepository> _userRepoMock = new();
    private readonly Mock<IProductRepository> _productRepoMock = new();
    private readonly Mock<IOrderRepository> _orderRepoMock = new();
    private readonly Mock<IUnitOfWork> _uowMock = new();
    private readonly Mock<INotificationService> _notificationMock = new();
    private readonly Mock<ILogger<OrderService>> _loggerMock = new();

    private OrderService CreateService() => new(
        _userRepoMock.Object,
        _productRepoMock.Object,
        _orderRepoMock.Object,
        _notificationMock.Object,
        _uowMock.Object,
        _loggerMock.Object);

    [Fact]
    public async Task CreateAsync_UserNotFound_ThrowsNotFoundException()
    {
        // Arrange
        _userRepoMock.Setup(r => r.GetByIdAsync(It.IsAny<int>()))
                     .ReturnsAsync((User?)null);

        var dto = new CreateOrderDto(UserId: 999, Items: new() { new(1, 1) });
        var service = CreateService();

        // Act & Assert
        await service.Invoking(s => s.CreateAsync(dto))
            .Should().ThrowAsync<NotFoundException>()
            .WithMessage("*User 999*");
    }

    [Fact]
    public async Task CreateAsync_InsufficientStock_ThrowsValidationException()
    {
        // Arrange
        _userRepoMock.Setup(r => r.GetByIdAsync(1))
                     .ReturnsAsync(new User { Id = 1 });
        _productRepoMock.Setup(r => r.GetByIdAsync(1))
                        .ReturnsAsync(new Product { Id = 1, Stock = 5, Name = "Widget" });

        var dto = new CreateOrderDto(UserId: 1, Items: new() { new(1, 10) });  // 要 10 個但只有 5
        var service = CreateService();

        // Act & Assert
        await service.Invoking(s => s.CreateAsync(dto))
            .Should().ThrowAsync<ValidationException>()
            .WithMessage("*Stock not enough*");

        // 驗證沒有真的建立訂單
        _orderRepoMock.Verify(r => r.AddAsync(It.IsAny<Order>()), Times.Never);
        _uowMock.Verify(u => u.SaveChangesAsync(), Times.Never);
    }

    [Fact]
    public async Task CreateAsync_ValidOrder_SavesAndNotifies()
    {
        // Arrange
        _userRepoMock.Setup(r => r.GetByIdAsync(1))
                     .ReturnsAsync(new User { Id = 1 });
        _productRepoMock.Setup(r => r.GetByIdAsync(1))
                        .ReturnsAsync(new Product { Id = 1, Stock = 100, Price = 50 });

        var dto = new CreateOrderDto(UserId: 1, Items: new() { new(1, 2) });
        var service = CreateService();

        // Act
        var result = await service.CreateAsync(dto);

        // Assert
        _orderRepoMock.Verify(r => r.AddAsync(It.IsAny<Order>()), Times.Once);
        _uowMock.Verify(u => u.SaveChangesAsync(), Times.Once);
        _notificationMock.Verify(n => n.SendOrderConfirmationAsync(It.IsAny<Order>()), Times.Once);
    }
}
```

### 3.5 NSubstitute（Moq 的替代品）

語法更簡潔，越來越多人用。

```csharp
var repo = Substitute.For<IUserRepository>();
repo.GetByIdAsync(1).Returns(new User { Id = 1 });

await service.GetByIdAsync(1);

await repo.Received(1).GetByIdAsync(1);
```

兩個都行，看公司風格。

---

## 4. 整合測試

### 4.1 為什麼要整合測試？

單元測試 mock 掉一切，但實際上：

- ASP.NET Core middleware 沒測到
- DI 設定有沒有錯沒測到
- EF Core 的 query 真的能跑嗎沒測到

**整合測試**：起一個真的 server（測試版），用 HttpClient 打它。

### 4.2 WebApplicationFactory

```csharp
public class UsersApiTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly HttpClient _client;

    public UsersApiTests(WebApplicationFactory<Program> factory)
    {
        _client = factory.CreateClient();
    }

    [Fact]
    public async Task GetUser_NotFound_Returns404()
    {
        var response = await _client.GetAsync("/api/users/9999");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task CreateUser_ValidData_Returns201()
    {
        var dto = new CreateUserDto { Email = "test@example.com", Password = "Pass1234" };

        var response = await _client.PostAsJsonAsync("/api/users", dto);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var user = await response.Content.ReadFromJsonAsync<UserDto>();
        user!.Email.Should().Be("test@example.com");
    }
}
```

### 4.3 用 In-Memory Database

整合測試不要打真的 DB，用 in-memory 替代。

```csharp
public class CustomWebApplicationFactory : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.ConfigureServices(services =>
        {
            // 移除原本的 DbContext 設定
            var descriptor = services.SingleOrDefault(
                d => d.ServiceType == typeof(DbContextOptions<AppDbContext>));
            if (descriptor != null) services.Remove(descriptor);

            // 改用 in-memory
            services.AddDbContext<AppDbContext>(opt =>
                opt.UseInMemoryDatabase("TestDb"));

            // 初始化測試資料
            using var scope = services.BuildServiceProvider().CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Database.EnsureCreated();
            SeedTestData(db);
        });
    }

    private void SeedTestData(AppDbContext db)
    {
        db.Users.Add(new User { Id = 1, Email = "alice@example.com" });
        db.SaveChanges();
    }
}
```

### 4.4 In-Memory vs SQLite vs Testcontainers

| 方式 | 速度 | 行為一致性 |
|------|------|-----------|
| InMemoryDatabase | 最快 | ❌ 不支援 transaction、不支援 SQL 特性 |
| SQLite (in-memory) | 快 | ⚠️ 不完全相容 SQL Server |
| **Testcontainers** | 中 | ✅ 跑真實 SQL Server in Docker |

**業界推薦**：

- 簡單測試 → InMemoryDatabase
- 認真測試 → Testcontainers（最貼近正式環境）

### 4.5 Testcontainers 範例

```csharp
public class IntegrationTestFixture : IAsyncLifetime
{
    public MsSqlContainer Container { get; }

    public IntegrationTestFixture()
    {
        Container = new MsSqlBuilder()
            .WithPassword("Test123!")
            .Build();
    }

    public Task InitializeAsync() => Container.StartAsync();
    public Task DisposeAsync() => Container.DisposeAsync().AsTask();
}
```

每次測試起一個真的 SQL Server container，最貼近正式環境，但需要本機有 Docker。

---

## 5. 該測什麼、不該測什麼

### 5.1 該測

- ✅ **業務邏輯**：Service 裡的規則判斷、計算
- ✅ **邊界條件**：空值、極限值、錯誤輸入
- ✅ **錯誤處理**：對的 exception 被丟、對的 log 被記
- ✅ **重要的整合流程**：登入、下訂單、付款

### 5.2 不該測（或低優先）

- ❌ **getter / setter**：沒邏輯不用測
- ❌ **第三方框架**：EF Core 的 SaveChanges、ASP.NET 的 routing 不用測
- ❌ **私有方法**：透過公開介面測就好
- ❌ **Mock 自己**：測試只在驗證 mock 設定，沒驗證真實邏輯

### 5.3 反模式：過度 mock

```csharp
// ❌ 測試只是在驗證 mock 設定,沒測到真邏輯
[Fact]
public async Task GetUser_CallsRepo()
{
    var mock = new Mock<IUserRepository>();
    mock.Setup(r => r.GetByIdAsync(1)).ReturnsAsync(new User());

    var service = new UserService(mock.Object);
    await service.GetByIdAsync(1);

    mock.Verify(r => r.GetByIdAsync(1), Times.Once);  // 這驗證了什麼?
}
```

如果 service 只是傳穿過去，**不用測**或寫整合測試比較有意義。

---

## 6. 練習建議

### 練習一：替你的 OrderService 寫單元測試

涵蓋情境：

- 使用者不存在 → throw NotFoundException
- 商品不存在 → throw NotFoundException
- 庫存不夠 → throw ValidationException
- 成功建立 → 驗證有呼叫 SaveChanges、有寄通知

### 練習二:[Theory] 練習

寫一個密碼強度驗證方法，用 [Theory] 測：

- 太短 → fail
- 沒大寫 → fail
- 沒數字 → fail
- 符合所有規則 → pass

至少 8 個測試案例。

### 練習三：整合測試

替你的 Todo API 寫整合測試：

- 起 WebApplicationFactory
- 用 in-memory DB
- 測完整 CRUD 流程
- 測 401（未登入）、404（找不到）

### 練習四：找一個沒測試的 Service

公司現有 code 隨便挑一個 Service，補上單元測試。會發現：

- 哪些地方難測（通常代表設計有問題）
- 哪些業務規則之前沒注意到

---

## 7. 學完這階段你應該能...

- [ ] 用 xUnit 寫出有 AAA 結構的單元測試
- [ ] 用 Moq 隔離依賴
- [ ] 知道什麼該測、什麼不該測
- [ ] 用 WebApplicationFactory 寫整合測試
- [ ] 看公司測試 code 知道在做什麼

完成後進入**階段七：Docker 基礎**。
