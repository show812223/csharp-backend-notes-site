# 階段一:C# 語言核心

> 目標：熟悉強型別語言特性與非同步處理邏輯,具備閱讀 C# 程式碼的能力。

---

## 1. 基礎語法與型別系統

### 1.1 基本資料型別

C# 是強型別語言,變數宣告時必須有明確型別(或讓編譯器推斷)。

```csharp
int age = 30;
string name = "Alice";
bool isActive = true;
DateTime now = DateTime.Now;
decimal price = 99.99m;  // 注意 m 後綴
double weight = 65.5;

// 編譯器推斷型別(等同於上面)
var age2 = 30;          // 推斷為 int
var name2 = "Alice";    // 推斷為 string
```

**重點：`decimal` vs `double`**

- `decimal`:精確計算,**金額一律用這個**(避免浮點誤差)
- `double`:科學計算、不要求精確的數值

```csharp
// 浮點誤差的經典問題
double a = 0.1 + 0.2;        // 0.30000000000000004
decimal b = 0.1m + 0.2m;     // 0.3 (正確)
```

### 1.2 參考型別 vs 實值型別

這是 C# 跟 JavaScript 差最多的地方之一。

| 類別 | 範例 | 賦值行為 |
|------|------|---------|
| 實值型別(Value Type) | `int`, `bool`, `DateTime`, `struct` | 複製值 |
| 參考型別(Reference Type) | `class`, `string`, `array`, `List<T>` | 複製參考(指標) |

```csharp
// 實值型別:複製值
int x = 10;
int y = x;
y = 20;
Console.WriteLine(x);  // 10 (沒被改)

// 參考型別:共享同一個物件
var list1 = new List<int> { 1, 2, 3 };
var list2 = list1;
list2.Add(4);
Console.WriteLine(list1.Count);  // 4 (被改了)
```

> **前端對比**:JS 的 primitive(string, number, boolean)行為類似 Value Type,object/array 類似 Reference Type,概念是通的。

### 1.3 Nullable 型別

C# 8 之後預設啟用 Nullable Reference Types,所有參考型別預設「不可為 null」,要 null 必須明確標示 `?`。

```csharp
// 不可為 null
string name = "Alice";
name = null;  // ❌ 編譯警告

// 可為 null
string? nickname = null;  // ✅
int? age = null;          // ✅ 實值型別也可以加 ?

// Null 檢查運算子
int length = nickname?.Length ?? 0;
//          ↑ 如果 nickname 是 null 就回 null
//                       ↑ ?? 意思是「如果左邊是 null,用右邊」
```

> **前端對比**:類似 TypeScript 的 `string | null` 跟 optional chaining (`?.`),但 C# 是強制檢查、TypeScript 是宣告式檢查。

### 1.4 var、const、readonly

```csharp
var name = "Alice";          // 編譯時推斷型別,執行期可變
const int MaxSize = 100;     // 編譯時常數,只能用基本型別
readonly DateTime CreatedAt; // 執行時常數,可在建構式中賦值
```

> **前端對比**:`const` 像 JS 的 `const` 但更嚴格(只能編譯時常數);`readonly` 比較像「初始化後不能改的 const」。

---

## 2. 物件導向程式設計(OOP)

### 2.1 類別與物件

```csharp
public class User
{
    // 屬性(Property) - 比 field 更常用
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public DateTime CreatedAt { get; private set; }  // 外部唯讀

    // 建構式
    public User(string name)
    {
        Name = name;
        CreatedAt = DateTime.UtcNow;
    }

    // 方法
    public string Greet() => $"Hello, {Name}!";
}

// 使用
var user = new User("Alice");
Console.WriteLine(user.Greet());  // Hello, Alice!
```

**重點:Property vs Field**

```csharp
public class BadExample
{
    public string Name;  // ❌ 這叫 field,後端 code 很少這樣寫
}

public class GoodExample
{
    public string Name { get; set; }  // ✅ 這叫 property
}
```

Property 看起來像 field,但其實是包裝過的 getter/setter,可以加邏輯、序列化、ORM 都靠它。

### 2.2 介面(Interface)

介面定義「行為規範」,是 DI 的核心。

```csharp
// 定義介面
public interface IUserRepository
{
    Task<User?> GetByIdAsync(int id);
    Task AddAsync(User user);
}

// 實作介面
public class UserRepository : IUserRepository
{
    public async Task<User?> GetByIdAsync(int id)
    {
        // 實作細節...
        return null;
    }

    public async Task AddAsync(User user)
    {
        // 實作細節...
    }
}

// 使用時依賴介面,不依賴實作 - 這就是 DI 的基礎
public class UserService
{
    private readonly IUserRepository _repo;

    public UserService(IUserRepository repo)  // 依賴介面
    {
        _repo = repo;
    }
}
```

> **前端對比**:跟 TypeScript Interface 概念完全一樣,但 C# 的 interface 是執行期真實存在的型別(TS 編譯後就消失了)。

### 2.3 繼承與多型

```csharp
public class Animal
{
    public string Name { get; set; } = "";
    public virtual string Speak() => "Some sound";  // virtual 才能被覆寫
}

public class Dog : Animal  // : 表示繼承
{
    public override string Speak() => "Woof!";  // override 覆寫
}

public class Cat : Animal
{
    public override string Speak() => "Meow!";
}

// 多型
Animal animal = new Dog();
Console.WriteLine(animal.Speak());  // Woof! (執行期決定)
```

### 2.4 抽象類別 vs 介面

| 比較項 | abstract class | interface |
|-------|----------------|-----------|
| 可以有實作 | ✅ | ✅(C# 8+ 有 default implementation) |
| 可以有欄位 | ✅ | ❌ |
| 多重繼承 | ❌(一次一個) | ✅(一次多個) |
| 用途 | 共用基礎邏輯 | 定義行為契約 |

**何時用哪個?**

- 純粹規範行為、不共用實作 → **interface**(後端 99% 用這個)
- 多個類別有共用實作,但需要客製化某些方法 → **abstract class**

### 2.5 泛型(Generics)

```csharp
// 泛型方法
public T GetFirstOrDefault<T>(List<T> items)
{
    return items.Count > 0 ? items[0] : default;
}

// 泛型類別
public class Repository<T> where T : class  // 泛型約束
{
    public T? GetById(int id) { /* ... */ return null; }
}

// 使用
var userRepo = new Repository<User>();
```

> **前端對比**:跟 TypeScript Generics 一樣,語法 `<T>` 也一樣。

---

## 3. 現代 C# 重要特性

### 3.1 Record 型別(C# 9+)

寫 DTO 的好夥伴,自動產生 equality、ToString、解構。

```csharp
// 一行定義一個 immutable DTO
public record UserDto(int Id, string Name, string Email);

var user1 = new UserDto(1, "Alice", "alice@example.com");
var user2 = new UserDto(1, "Alice", "alice@example.com");

Console.WriteLine(user1 == user2);  // True (值相等,不是參考相等)
Console.WriteLine(user1);            // UserDto { Id = 1, Name = Alice, ... }

// 不可變,要修改用 with
var user3 = user1 with { Name = "Bob" };
```

> **前端對比**:類似 immutable object,有點像用 `Object.freeze` 加上 `{...obj, name: 'Bob'}` spread 修改。

### 3.2 Pattern Matching

```csharp
// switch expression
string GetDayType(DayOfWeek day) => day switch
{
    DayOfWeek.Saturday or DayOfWeek.Sunday => "Weekend",
    _ => "Weekday"  // _ 是 default
};

// is 表達式
object obj = "Hello";
if (obj is string s && s.Length > 3)
{
    Console.WriteLine(s.ToUpper());
}

// 屬性比對
if (user is { Name: "Alice", Id: > 0 })
{
    // user.Name 是 "Alice" 且 Id 大於 0
}
```

### 3.3 Extension Methods

幫既有型別「外掛」方法,LINQ 整套就是這樣實作的。

```csharp
public static class StringExtensions
{
    public static bool IsNullOrEmpty(this string? value)
        //                        ↑ this 關鍵字是重點
    {
        return string.IsNullOrEmpty(value);
    }
}

// 使用時看起來像 string 自帶的方法
string? name = null;
bool empty = name.IsNullOrEmpty();  // 即使 name 是 null 也能呼叫
```

### 3.4 using 與 IDisposable

C# 雖然有 GC,但**非託管資源**(檔案、DB 連線、HTTP 連線)需要手動釋放。

```csharp
// 傳統寫法
using (var connection = new SqlConnection(connStr))
{
    connection.Open();
    // ...
}  // 離開區塊自動 Dispose

// C# 8+ 簡化寫法
using var connection = new SqlConnection(connStr);
connection.Open();
// 離開當前函式才 Dispose

// 自訂 IDisposable
public class MyResource : IDisposable
{
    public void Dispose()
    {
        // 釋放資源
    }
}
```

> **重點**:看到 `DbContext`、`HttpClient`、`FileStream` 都要想到 using。

---

## 4. 非同步與集合操作

### 4.1 Task、async/await

C# 的非同步比 JS 嚴格,但思路一樣。

```csharp
// 非同步方法
public async Task<User?> GetUserAsync(int id)
{
    var user = await _repo.GetByIdAsync(id);  // await 等待結果
    return user;
}

// 沒有回傳值的非同步
public async Task SaveAsync(User user)
{
    await _repo.AddAsync(user);
}

// 同步呼叫非同步(❌ 不要這樣寫,會死鎖)
var user = GetUserAsync(1).Result;  // 危險!

// 正確做法:async 一路傳到頂
public async Task Main()
{
    var user = await GetUserAsync(1);
}
```

**重點規則**:

- 方法名以 `Async` 結尾(慣例)
- 回傳 `Task` 或 `Task<T>`
- 內部用 `await` 等待
- **async 會傳染**:呼叫 async 的方法自己也要 async(類似 JS)

> **前端對比**:跟 JS 的 `async/await` 幾乎一樣,但 C# 的 `Task` 比 `Promise` 更嚴格、有 cancellation token、有 ConfigureAwait 等進階控制。

### 4.2 ConfigureAwait(false)

寫 library 程式碼時會看到,簡單原則:

- **應用程式 code(Controller、Service)**:不用加
- **共用 library code**:加 `.ConfigureAwait(false)` 避免死鎖

```csharp
// library 寫法
var data = await _httpClient.GetAsync(url).ConfigureAwait(false);
```

初期看到知道在幹嘛就好。

### 4.3 常用集合

```csharp
// List<T> - 動態陣列(類似 JS Array)
var users = new List<User>();
users.Add(new User("Alice"));
users.Remove(users[0]);

// Dictionary<TKey, TValue> - 鍵值對(類似 JS Object 或 Map)
var userMap = new Dictionary<int, User>();
userMap[1] = new User("Alice");
if (userMap.TryGetValue(1, out var user)) { /* 安全取值 */ }

// HashSet<T> - 不重複集合(類似 JS Set)
var ids = new HashSet<int> { 1, 2, 3 };
ids.Add(1);  // 不會重複
```

### 4.4 LINQ

LINQ 是 C# 最強大的功能之一,前端工程師會超有共鳴。

```csharp
var users = new List<User> { /* ... */ };

// 過濾(類似 .filter)
var actives = users.Where(u => u.IsActive).ToList();

// 投影(類似 .map)
var names = users.Select(u => u.Name).ToList();

// 排序
var sorted = users.OrderBy(u => u.Name).ToList();
var descSorted = users.OrderByDescending(u => u.CreatedAt).ToList();

// 分組
var byAge = users.GroupBy(u => u.Age);

// 鏈式操作
var result = users
    .Where(u => u.IsActive)
    .OrderBy(u => u.Name)
    .Select(u => new { u.Id, u.Name })  // 匿名物件
    .Take(10)
    .ToList();

// 聚合
var count = users.Count(u => u.IsActive);
var totalAge = users.Sum(u => u.Age);
var oldest = users.Max(u => u.Age);
var first = users.FirstOrDefault(u => u.Name == "Alice");  // 找不到回 null
var single = users.Single(u => u.Id == 1);  // 預期只有一個,沒找到或多筆會 throw
```

> **前端對比表**

| LINQ | JavaScript |
|------|-----------|
| `Where` | `filter` |
| `Select` | `map` |
| `OrderBy` | `sort` |
| `Aggregate` | `reduce` |
| `Any` | `some` |
| `All` | `every` |
| `FirstOrDefault` | `find` |
| `Count` | `length` 或 `filter().length` |

### 4.5 IEnumerable vs IQueryable

這個跟 EF Core 效能直接相關,**很重要**。

```csharp
// IEnumerable - 在記憶體中查詢
IEnumerable<User> users = _context.Users.ToList();  // 先撈全部到記憶體
var actives = users.Where(u => u.IsActive);          // 再過濾(記憶體)

// IQueryable - 翻譯成 SQL 查詢
IQueryable<User> query = _context.Users;             // 還沒執行
var actives = query.Where(u => u.IsActive).ToList();  // SQL: WHERE IsActive = 1
```

**關鍵差異**:

- `IEnumerable.Where(...)` → 在 **記憶體** 過濾
- `IQueryable.Where(...)` → 翻譯成 **SQL** 在資料庫過濾

寫 EF Core 時用錯會把整張表撈進來,效能災難。

---

## 5. 練習建議

### 練習一:基礎語法

寫一個 console 程式,定義 `User` class 跟 `IUserRepository` interface,用 `List<User>` 當記憶體儲存,做基本的新增/查詢/刪除。

### 練習二:LINQ

給定一個訂單列表,用 LINQ 完成:

- 找出金額大於 1000 的訂單
- 按客戶 ID 分組,計算每個客戶的總消費
- 找出消費最多的前 5 名客戶

### 練習三:async/await

寫兩個 async 方法,模擬呼叫外部 API(用 `Task.Delay(1000)` 模擬網路延遲),練習:

- 串行呼叫(一個等一個)
- 並行呼叫(`Task.WhenAll`)
- 比較兩者執行時間

---

## 6. 學完這階段你應該能...

- [ ] 看懂 C# 程式碼,知道 class、interface、property 的差別
- [ ] 寫出簡單的 OOP 設計(class + interface + DI 雛形)
- [ ] 熟練使用 LINQ 處理集合
- [ ] 寫 async/await 不會卡住或死鎖
- [ ] 知道 record、pattern matching 是什麼,看到不會慌

完成後就可以進入**階段二:HTTP 與後端思維**。
