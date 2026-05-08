# 階段七：Docker 基礎

> 目標：能在本地跑起 DB、能讀懂 Dockerfile、能用 docker-compose 起完整開發環境。Kubernetes 留到階段八。

---

## 1. Docker 核心概念

### 1.1 為什麼需要 Docker？

**沒 Docker 之前的痛苦**:

- 本機要裝 SQL Server、Redis、RabbitMQ...各種服務
- 「我這邊跑得起來啊」——版本、設定不一致
- 換電腦 / 新人入職要重新裝半天

**有 Docker 之後**:

- 一個指令把 SQL Server 跑起來
- 跟其他人共享相同環境
- 開發、測試、正式環境一致

### 1.2 Image vs Container

```
Image (映像檔)               Container (容器)
─────────────────            ─────────────────
靜態的「模板」                Image 跑起來的「實例」
類似 class                   類似 object
唯讀                         可寫
從 Dockerfile 建立           從 Image 啟動
```

```bash
# Image 操作
docker pull mcr.microsoft.com/mssql/server  # 下載 image
docker images                                # 列出本機 image
docker rmi <image-id>                        # 刪除 image

# Container 操作
docker run <image>                           # 啟動 container
docker ps                                    # 列出執行中的 container
docker ps -a                                 # 列出所有 container
docker stop <container-id>                   # 停止
docker rm <container-id>                     # 刪除
docker logs <container-id>                   # 看 log
docker exec -it <container-id> bash          # 進到 container 裡
```

### 1.3 Volume、Network、Port Mapping

**Port Mapping**：把 container 內的 port 對外暴露

```bash
docker run -p 1433:1433 mcr.microsoft.com/mssql/server
#         ↑ 主機:容器
# 連 localhost:1433 就會連到 container 的 1433
```

**Volume**：資料持久化（不然 container 砍掉資料就沒了）

```bash
docker run -v mydata:/var/opt/mssql mcr.microsoft.com/mssql/server
#         ↑ volume 名稱:容器內路徑
```

**Network**：多個 container 之間溝通

```bash
docker network create myapp-net
docker run --network myapp-net --name db ...
docker run --network myapp-net --name api ...
# api container 可以用 hostname "db" 連到 db container
```

### 1.4 跑一個 SQL Server

```bash
docker run -e "ACCEPT_EULA=Y" \
           -e "SA_PASSWORD=YourStrong!Pass1" \
           -p 1433:1433 \
           --name sqlserver \
           -v sqldata:/var/opt/mssql \
           -d mcr.microsoft.com/mssql/server:2022-latest

# -e: 環境變數
# -p: port mapping
# --name: 命名(方便管理)
# -v: volume
# -d: 背景執行
```

連線字串：`Server=localhost,1433;User Id=sa;Password=YourStrong!Pass1;...`

---

## 2. 編寫 Dockerfile

### 2.1 .NET 應用的 Dockerfile

```dockerfile
# === Build Stage ===
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# 複製 csproj 並還原（先複製這個可以利用 Docker layer cache）
COPY ["MyApp.csproj", "./"]
RUN dotnet restore

# 複製其他原始碼並編譯
COPY . .
RUN dotnet publish -c Release -o /app/publish

# === Runtime Stage ===
FROM mcr.microsoft.com/dotnet/aspnet:8.0
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 8080
ENTRYPOINT ["dotnet", "MyApp.dll"]
```

**指令解釋**:

| 指令 | 用途 |
|------|------|
| `FROM` | 基底 image |
| `WORKDIR` | 設定工作目錄 |
| `COPY` | 複製檔案進 image |
| `RUN` | 在 build 過程執行（編譯、安裝） |
| `EXPOSE` | 宣告 port（記錄用，不會自動 mapping） |
| `ENTRYPOINT` | container 啟動時執行的指令 |
| `CMD` | 預設參數（可被覆蓋） |

### 2.2 Multi-stage Build 的好處

**為什麼分兩個 stage？**

```
Build Stage:    要 SDK(編譯器、套件管理)
                Image 大(約 800MB)

Runtime Stage:  只要 ASP.NET runtime
                Image 小(約 200MB)
                沒有原始碼,安全性更高
```

最終 image 只包含 `Runtime Stage`，build stage 的東西會被丟掉。

### 2.3 Build 與 Run

```bash
# Build image
docker build -t myapp:latest .
#            ↑ tag         ↑ Dockerfile 所在目錄

# Run container
docker run -p 8080:8080 myapp:latest

# Run 加環境變數
docker run -p 8080:8080 \
           -e "ASPNETCORE_ENVIRONMENT=Production" \
           -e "ConnectionStrings__Default=Server=db;..." \
           myapp:latest
```

### 2.4 .dockerignore

跟 .gitignore 類似，不要把不必要的檔案複製進 image。

```
**/bin
**/obj
**/.vs
**/node_modules
**/.git
**/.env
**/Dockerfile*
**/docker-compose*
**/*.md
```

可以大幅縮小 build context、加快 build 速度。

---

## 3. docker-compose

### 3.1 為什麼要 compose？

實際開發環境通常不只一個 service：

- API
- 資料庫
- 快取（Redis）
- 訊息佇列（RabbitMQ）
- ...

每個都用 `docker run` 太麻煩，用 compose 一次搞定。

### 3.2 docker-compose.yml 範例

```yaml
version: '3.8'

services:
  # API 服務
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      - ASPNETCORE_ENVIRONMENT=Development
      - ConnectionStrings__Default=Server=db;Database=MyApp;User Id=sa;Password=YourStrong!Pass1;TrustServerCertificate=True
    depends_on:
      - db
    networks:
      - myapp-net

  # 資料庫
  db:
    image: mcr.microsoft.com/mssql/server:2022-latest
    environment:
      - ACCEPT_EULA=Y
      - SA_PASSWORD=YourStrong!Pass1
    ports:
      - "1433:1433"
    volumes:
      - sqldata:/var/opt/mssql
    networks:
      - myapp-net

  # Redis
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    networks:
      - myapp-net

volumes:
  sqldata:

networks:
  myapp-net:
```

### 3.3 常用指令

```bash
# 啟動所有服務(背景)
docker-compose up -d

# 啟動並看 log
docker-compose up

# 停止所有服務
docker-compose down

# 停止並刪除 volume(連資料一起清掉)
docker-compose down -v

# 重新 build image
docker-compose build

# 看特定服務的 log
docker-compose logs -f api

# 進到某個 container
docker-compose exec api bash
docker-compose exec db /opt/mssql-tools/bin/sqlcmd -S localhost -U sa
```

### 3.4 環境變數管理

別把密碼寫死在 yml 裡。

**用 .env 檔（要 gitignore）**

```
# .env
DB_PASSWORD=YourStrong!Pass1
DB_NAME=MyApp
```

```yaml
# docker-compose.yml
services:
  db:
    environment:
      - SA_PASSWORD=${DB_PASSWORD}
  api:
    environment:
      - ConnectionStrings__Default=Server=db;Database=${DB_NAME};User Id=sa;Password=${DB_PASSWORD};...
```

### 3.5 開發用 vs 正式用

通常會有兩份 compose：

```
docker-compose.yml          # 基底配置
docker-compose.override.yml # 開發用(自動套用)
docker-compose.prod.yml     # 正式用
```

```bash
# 開發
docker-compose up

# 正式
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up
```

---

## 4. 實務小技巧

### 4.1 加快 Build 速度

**1. 利用 layer cache**

```dockerfile
# ❌ 錯誤:程式碼變動會讓 restore 重跑
COPY . .
RUN dotnet restore
RUN dotnet publish

# ✅ 正確:csproj 沒變就不用重 restore
COPY ["MyApp.csproj", "./"]
RUN dotnet restore
COPY . .
RUN dotnet publish
```

**2. 善用 .dockerignore**

把 node_modules、bin、obj 排除掉。

### 4.2 縮小 Image

**1. 用 alpine 基底**（如果相容）

```dockerfile
FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine
# 比一般版小很多
```

**2. 多階段 build**（前面講過）

**3. 不裝多餘套件**

### 4.3 健康檢查

```yaml
services:
  db:
    healthcheck:
      test: ["CMD", "/opt/mssql-tools/bin/sqlcmd", "-S", "localhost", "-U", "sa", "-P", "YourStrong!Pass1", "-Q", "SELECT 1"]
      interval: 10s
      timeout: 3s
      retries: 5

  api:
    depends_on:
      db:
        condition: service_healthy  # 等 DB 真的 ready 才啟動 API
```

### 4.4 Migration 怎麼處理？

兩種做法:

**方式 1：API 啟動時自動跑 migration（簡單）**

```csharp
// Program.cs
var app = builder.Build();

using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    db.Database.Migrate();  // 自動套用 migration
}
```

**方式 2：獨立 migration container（較佳）**

```yaml
services:
  migrate:
    build: .
    command: dotnet ef database update
    depends_on:
      db:
        condition: service_healthy
    environment:
      - ConnectionStrings__Default=...

  api:
    depends_on:
      - migrate
    # ...
```

正式環境通常用方式 2，避免多個 instance 同時跑 migration。

---

## 5. 練習建議

### 練習一：跑起 SQL Server

```bash
docker run -e "ACCEPT_EULA=Y" -e "SA_PASSWORD=Test123!" \
  -p 1433:1433 -d --name sqltest mcr.microsoft.com/mssql/server:2022-latest
```

用 SSMS 或 Azure Data Studio 連線，建一個 DB、寫幾筆資料。

### 練習二：寫 Dockerfile

把你階段三~六的 Todo API 包成 Docker image：

- 用 multi-stage build
- 加 .dockerignore
- 跑起來能正常運作

### 練習三：完整 docker-compose

寫一份 docker-compose.yml，包含：

- 你的 API
- SQL Server
- 用 volume 持久化 DB 資料
- 用 .env 管理密碼
- API 等 DB ready 才啟動

跑 `docker-compose up`，整套環境一個指令起來。

### 練習四：閱讀公司 Dockerfile

找公司現有的 Dockerfile 來看，理解：

- 用什麼基底 image？
- 有沒有 multi-stage？
- build 過程做了什麼最佳化？

---

## 6. 學完這階段你應該能...

- [ ] 用 Docker 跑起 SQL Server / Redis 等服務
- [ ] 寫 Dockerfile 把 .NET 應用包成 image
- [ ] 用 docker-compose 起完整開發環境
- [ ] 看懂公司現有的 Dockerfile 跟 compose 設定
- [ ] 知道 Volume、Network、Port mapping 在做什麼

完成後進入**階段八：CI/CD 與 Kubernetes**。
