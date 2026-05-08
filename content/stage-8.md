# 階段八：CI/CD 與 Kubernetes

> 目標：初期能讀懂 pipeline、能用 kubectl 看 log 跟狀態。深入學習等實際碰到再補。

⚠️ **這階段不用一次學完**。把它當成「上線後遇到問題能查資料、能溝通」的程度即可。等你有實際參與 deploy、處理 production issue 時再深入。

---

## 1. 什麼是 CI/CD？

### 1.1 概念

**CI（Continuous Integration，持續整合）**

每次 push code 自動：

1. 編譯程式碼
2. 跑單元測試
3. 跑整合測試
4. 打包 Docker image

**CD（Continuous Delivery / Deployment，持續交付 / 部署）**

通過 CI 後自動：

1. 推送 image 到 registry
2. 部署到測試環境
3. 部署到正式環境（自動或手動觸發）

### 1.2 為什麼重要？

- **防呆**：自動跑測試，避免 broken code 進主分支
- **快**：自動化部署，幾分鐘上線
- **可追溯**：每次部署有完整紀錄

### 1.3 常見工具

| 工具 | 特色 |
|------|------|
| **Azure DevOps Pipelines** | 微軟生態主流，YAML 配置 |
| **GitHub Actions** | GitHub 原生整合 |
| Jenkins | 老牌、彈性大 |
| GitLab CI | GitLab 原生整合 |

公司用什麼跟著學就對了。.NET 業務系統最常見是 Azure DevOps。

---

## 2. Azure DevOps Pipelines

### 2.1 azure-pipelines.yml 結構

```yaml
trigger:
  branches:
    include:
      - main
      - develop

pool:
  vmImage: 'ubuntu-latest'

variables:
  buildConfiguration: 'Release'
  imageName: 'myapp'

stages:
- stage: Build
  jobs:
  - job: BuildAndTest
    steps:
    - task: UseDotNet@2
      inputs:
        version: '8.0.x'

    - script: dotnet restore
      displayName: 'Restore packages'

    - script: dotnet build --configuration $(buildConfiguration) --no-restore
      displayName: 'Build'

    - script: dotnet test --no-build --configuration $(buildConfiguration)
      displayName: 'Run tests'

- stage: Docker
  dependsOn: Build
  condition: succeeded()
  jobs:
  - job: BuildAndPush
    steps:
    - task: Docker@2
      inputs:
        containerRegistry: 'myacr-connection'
        repository: $(imageName)
        command: 'buildAndPush'
        Dockerfile: '**/Dockerfile'
        tags: |
          $(Build.BuildId)
          latest

- stage: Deploy
  dependsOn: Docker
  jobs:
  - deployment: DeployToAKS
    environment: 'production'
    strategy:
      runOnce:
        deploy:
          steps:
          - task: KubernetesManifest@0
            inputs:
              action: 'deploy'
              kubernetesServiceConnection: 'aks-connection'
              manifests: 'k8s/*.yaml'
```

### 2.2 重要概念

**Trigger（觸發）**：什麼時候執行 pipeline

```yaml
trigger:
  branches:
    include: [main, develop]
  paths:
    include: ['src/**']      # 只有 src/ 下的變更才觸發

pr:
  branches:
    include: [main]          # PR 到 main 時也跑
```

**Stage / Job / Step（階段 / 工作 / 步驟）**

```
Pipeline
└── Stage (Build)
    └── Job (BuildAndTest)
        └── Step (dotnet restore)
        └── Step (dotnet build)
        └── Step (dotnet test)
└── Stage (Deploy)
    └── Job (...)
```

- Stage 之間可以有依賴（`dependsOn`）
- Job 預設並行，可以指定依賴
- Step 內按順序執行

**Variables（變數）**

```yaml
variables:
  buildConfig: 'Release'

steps:
- script: dotnet build --configuration $(buildConfig)
#                                      ↑ 用 $() 取值
```

**Secrets（密碼）**

```
# 在 Azure DevOps UI 設定:
# Pipeline → Variables → Add (勾選 "Keep this value secret")

# YAML 中使用
- script: echo $(MyPassword)
  env:
    MyPassword: $(MyPassword)
```

### 2.3 讀懂公司 pipeline 的步驟

1. **找 trigger**：什麼分支會觸發？
2. **看 stage 結構**：分了幾個階段？
3. **看每個 job 做什麼**：build、test、deploy？
4. **找環境變數**：哪些值是寫死、哪些從 secret 來？
5. **看部署目標**：哪個 cluster、哪個 namespace？

### 2.4 實務技巧

**只在主分支才推 image**

```yaml
- task: Docker@2
  condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
```

**手動觸發 production 部署**

```yaml
- stage: ProdDeploy
  trigger: manual   # 需要手動按按鈕才執行
```

**並行測試多個專案**

```yaml
jobs:
- job: TestProject1
- job: TestProject2
# 兩個 job 並行,加快速度
```

---

## 3. Kubernetes 基礎

### 3.1 K8s 是什麼？

簡單說，K8s 是「**管理一堆 container 的平台**」。

**為什麼需要 K8s？**

當你有 10 個服務、每個要跑 3 個副本、要做負載平衡、要自動重啟、要滾動更新...用 docker-compose 不夠，需要 K8s。

### 3.2 核心元件（先建立印象）

```
Cluster (整個 K8s 集群)
├── Node (一台機器,可以是 VM 或實體機)
│   ├── Pod (最小執行單位,內含 1+ container)
│   │   └── Container
│   └── Pod
└── Node
    └── ...
```

**主要資源**：

| 資源 | 用途 |
|------|------|
| **Pod** | 最小執行單位（一個或多個 container 的群組） |
| **Deployment** | 管理 Pod 的部署、副本數、滾動更新 |
| **Service** | 給 Pod 一個固定 IP（內部 / 外部） |
| **Ingress** | HTTP 路由（domain → service 的對應） |
| **ConfigMap** | 設定檔 |
| **Secret** | 敏感資料（密碼、token） |
| **Namespace** | 邏輯分區（dev / staging / prod） |

### 3.3 簡單範例：部署一個 API

**deployment.yaml**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-api
  namespace: production
spec:
  replicas: 3                    # 跑 3 個副本
  selector:
    matchLabels:
      app: myapp-api
  template:
    metadata:
      labels:
        app: myapp-api
    spec:
      containers:
      - name: api
        image: myacr.azurecr.io/myapp:v1.2.3
        ports:
        - containerPort: 8080
        env:
        - name: ASPNETCORE_ENVIRONMENT
          value: Production
        - name: ConnectionStrings__Default
          valueFrom:
            secretKeyRef:
              name: db-secret
              key: connectionString
        resources:
          requests:
            cpu: 100m
            memory: 256Mi
          limits:
            cpu: 500m
            memory: 512Mi
        livenessProbe:           # 健康檢查
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
```

**service.yaml**

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-api
  namespace: production
spec:
  selector:
    app: myapp-api
  ports:
  - port: 80
    targetPort: 8080
  type: ClusterIP
```

**ingress.yaml**

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress
spec:
  rules:
  - host: api.myapp.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: myapp-api
            port:
              number: 80
```

---

## 4. kubectl：日常維運指令

### 4.1 環境設定

```bash
# 看目前連到哪個 cluster
kubectl config current-context

# 切換 context（多個 cluster）
kubectl config use-context my-aks-cluster

# 切換 namespace（避免每次都 -n production）
kubectl config set-context --current --namespace=production
```

### 4.2 看狀態（最常用）

```bash
# 看所有 pod
kubectl get pods
kubectl get pods -n production            # 指定 namespace
kubectl get pods -l app=myapp             # 用 label 過濾
kubectl get pods -o wide                  # 看更多資訊（IP、Node）

# 看詳細資訊
kubectl describe pod <pod-name>           # 完整資訊（含事件）

# 看 deployment
kubectl get deployments
kubectl describe deployment myapp-api

# 看 service
kubectl get services

# 看所有資源
kubectl get all
```

### 4.3 看 Log（除錯必備）

```bash
# 看 pod 的 log
kubectl logs <pod-name>

# 持續 follow
kubectl logs -f <pod-name>

# 看最後 100 行
kubectl logs --tail=100 <pod-name>

# 多副本時,看所有 pod 的 log
kubectl logs -l app=myapp-api --tail=50

# 看上一次 crash 的 log（pod 重啟過）
kubectl logs <pod-name> --previous
```

### 4.4 進到 container 內

```bash
# 進去 shell 除錯
kubectl exec -it <pod-name> -- bash
kubectl exec -it <pod-name> -- /bin/sh   # 沒 bash 時

# 直接執行單一指令
kubectl exec <pod-name> -- ls /app
kubectl exec <pod-name> -- env           # 看環境變數
```

### 4.5 部署相關

```bash
# 套用 manifest
kubectl apply -f deployment.yaml

# 重啟 deployment（不改 image,只是讓 pod 重啟）
kubectl rollout restart deployment myapp-api

# 看部署歷史
kubectl rollout history deployment myapp-api

# 回滾
kubectl rollout undo deployment myapp-api

# 強制刪除 pod（會自動重建）
kubectl delete pod <pod-name>
```

### 4.6 Port Forward（本機連 cluster 內服務）

```bash
# 把本機 8080 接到 pod 的 8080
kubectl port-forward pod/<pod-name> 8080:8080

# 也可以接到 service
kubectl port-forward service/myapp-api 8080:80
```

很適合除錯：直接連 production DB 看資料（要小心）。

---

## 5. 常見除錯情境

### 5.1 Pod 一直重啟

```bash
kubectl get pods
# NAME            STATUS              RESTARTS
# myapp-xxx-yyy   CrashLoopBackOff   5

# 步驟 1: 看詳情
kubectl describe pod myapp-xxx-yyy
# 看「Events」區塊有無線索

# 步驟 2: 看 log
kubectl logs myapp-xxx-yyy
kubectl logs myapp-xxx-yyy --previous   # 看 crash 前的 log

# 常見原因:
# - 環境變數沒設好(連不到 DB)
# - Image 拉不下來
# - liveness probe 失敗
```

### 5.2 Pod Pending（一直起不來）

```bash
kubectl describe pod <pod>
# 看 Events,通常是:
# - 資源不夠(cluster 沒位置)
# - PVC 沒 bind 上
# - Image pull 失敗
```

### 5.3 服務連不到

```bash
# 1. 檢查 service 是否選到正確的 pod
kubectl get endpoints myapp-api
# 應該要有 IP,空的就是 selector 對不上

# 2. 從別的 pod 測試
kubectl run test --rm -it --image=curlimages/curl -- sh
$ curl http://myapp-api.production.svc.cluster.local
```

---

## 6. 實務建議

### 6.1 不用追求精通

K8s 是個無底洞，剛接後端的目標：

- ✅ 能看 log、能看狀態、能進 container 除錯
- ✅ 看懂 deployment.yaml 大概在做什麼
- ✅ 跟 DevOps / SRE 溝通時知道在說什麼

不用會：

- ❌ 自己設計 cluster 架構
- ❌ 寫複雜的 Helm Chart
- ❌ 配置 networking、storage

### 6.2 優先學什麼？

依重要性排序：

1. **kubectl logs** - 80% 的時間在看 log
2. **kubectl describe** - 看 events 找問題
3. **kubectl exec** - 進去除錯
4. **kubectl port-forward** - 連內部服務
5. 看懂 deployment.yaml
6. 知道 service / ingress 的角色

### 6.3 進階主題（之後有需要再學）

- **Helm**：K8s 的套件管理工具
- **Kustomize**：管理多環境 manifest
- **Operator Pattern**：自訂 K8s 控制器
- **Service Mesh**（Istio、Linkerd）：服務間通訊
- **HPA / VPA**：自動擴展

公司有用就學，沒用就不用花時間。

---

## 7. 練習建議

### 練習一：閱讀公司 pipeline

把公司的 `azure-pipelines.yml` 從頭到尾讀一遍，回答：

- 哪些分支會觸發？
- 有幾個 stage？每個做什麼？
- 怎麼存 secret？
- Image 推到哪？
- 怎麼部署？

### 練習二：閱讀公司 K8s 設定

找公司的 K8s manifest，理解：

- Deployment 的 replica 數？資源限制？
- 用了哪些環境變數？來自 ConfigMap 還是 Secret？
- 有沒有 health check？
- Service 怎麼暴露？用 Ingress 嗎？

### 練習三：kubectl 操作

連到公司測試環境（如果可以），練習：

- `kubectl get pods` 看有哪些 pod
- `kubectl logs` 看你負責服務的 log
- `kubectl describe` 找一個有問題的 pod
- `kubectl exec` 進去看環境變數

### 練習四：本機 K8s（可選）

想深入學的話，本機裝 [minikube](https://minikube.sigs.k8s.io/) 或 [kind](https://kind.sigs.k8s.io/) 跑單機 K8s，把你的 Todo API 部署上去。

---

## 8. 學完這階段你應該能...

- [ ] 看懂公司的 azure-pipelines.yml
- [ ] 知道 CI/CD 各階段在做什麼
- [ ] 用 kubectl 看 pod 狀態跟 log
- [ ] 進到 container 內除錯
- [ ] 看懂基本的 deployment.yaml
- [ ] 知道 K8s 的 Pod、Deployment、Service、Ingress 是什麼

---

## 🎯 整套清單完成後

恭喜！走完這八個階段，你已經具備：

- **語言能力**:看懂、寫得出 C# / async / LINQ
- **Web 後端**:能設計 RESTful API、處理認證授權、錯誤處理
- **資料庫**:能設計 schema、寫 EF Core、避開效能陷阱
- **架構能力**：能用分層架構寫出可維護的 code
- **品質保障**：會寫單元測試、整合測試
- **維運基礎**：能用 Docker、能看懂 CI/CD 跟 K8s

接下來建議：

1. **多參與 code review**：看資深同事怎麼寫
2. **挑一個業務 feature 從頭做到尾**：實戰才會把所有東西串起來
3. **遇到問題深挖**：例如效能慢就學 SQL 調校、需求複雜就學 DDD
4. **保持輸出**：寫部落格、技術筆記，鞏固知識

加油！🚀
