# UA ARENA WEB v1.1

**LINE Bot 已取消。** 本專案是一套可部署至 GitHub Pages 的手機優先靜態網站，使用 Firebase Authentication + Cloud Firestore，並可選擇啟用 Firebase AI Logic (Gemini)。

## v1.1 新功能：Quick Match

使用者點擊側邊欄／手機底部的 **Quick Match（速配）**，先選擇兩位玩家、雙方牌組。**任何群組成員都能代填。**

- **開啟計時（預設）**：先建立計時場次，再由第一位玩家按 **回合開始** 才啟動 30:00 總倒數。一次僅能有一位玩家進行回合，結束時按 **回合結束**；下一位再按自己的 **回合開始**。總倒數不因回合間空檔或關閉網頁而停止。
- 即時顯示各玩家累計用時、剩餘時間、回合數以及未分配至個人的間隔時間，保留每回合起訖與耗時。時間到後不能開始新回合，但可結束現有回合並登錄勝負。
- **不開啟計時**：取消勾選，系統不建立計時 session，直接進入勝者與備註欄位，提交即新增對戰紀錄。
- **結束對戰**：由一位成員選出勝者，系統將計時 session 標記 finished，並在同一筆 Firestore transaction 中寫入 `matches`，避免多裝置重複提交。
- **取消本場**：放棄計時場次，不列入戰績。可在 Quick Match 場次列表查看已完成／已取消的計時歷史。
- **恢復計時**：瀏覽器重新整理後，回到 Quick Match 並選擇尚未完成的計時場次；在 Firebase 模式下，多位成員會透過 `onSnapshot` 即時同步狀態，操作使用 transaction 來避免並行覆寫。 
- **結果紀錄**：Match History 中可看到兩人的用時 A/B，點擊可回到該場的詳細回合紀錄。

> **重要**：用時是由客戶端記錄的時間戳，Firebase Rules 會檢查操作時間範圍及狀態，但無法防止有意操作或修改客戶端時鐘。僅作朋友間參考，不能視為正式競賽裁定。當時間歸零也**不會自動判勝者**。

## 已提供的功能

- Email / 密碼登入與註冊；亦提供 Google 登入（必須先在 Firebase Console 啟用供應商）
- 建立對戰群組，使用邀請連結加入；一位玩家可加入多個群組
- 團體共用玩家名單，登入後自動識別當前玩家
- 牌組管理：**圖片、名稱、顏色**；持有者從群組玩家選擇
- 任何已登入群組成員可單獨替 **任意兩位成員** 登錄一場對戰，並保存真正提交者
- 對戰歷史、勝率、玩家排行、各玩家常用／勝場最多／敗場最多牌組
- 牌組封存，舊戰績仍保留；比賽撤銷（不改寫舊結果）
- 可選的 UA 專用 Gemini 規則問答（Firebase AI Logic + App Check）
- 無 Firebase 設定時可操作展示版，僅存於本機瀏覽器（**不是多人同步的正式資料**）

## 系統限制與注意

1. GitHub Pages 只託管 HTML/CSS/JS；跨裝置登入與同步依賴 **你自己的 Firebase 專案**，因此未填 Firebase 設定前不能宣稱已正式上線。
2. Firebase Web App 的 `apiKey`、`authDomain` 等設定可公開，**必須**發佈本專案的 `firestore.rules` 才能限制資料存取。**絕對不要**將 Firebase service account JSON、Gemini Developer API Key、管理員憑證寫入 GitHub。
3. 圖片上傳會在瀏覽器壓縮至約 150 KB 以下的 JPEG Data URL，再放入 Firestore 文件。這適合小型私人社群；成長後應改用物件儲存服務。2026 年 Cloud Storage for Firebase 的預設儲存區需要 Blaze 計費方案。
4. Gemini 問答目前只有固定 UA 專用系統提示詞，**未建置官方 FAQ / PDF RAG 資料庫**；因此並不能保證回答等同於官方裁定。AI 需另行啟用。
5. Firebase 新建的 Firestore 資料不會自動同步之前的 Google Sheets，除非之後另外建置遷移作業。先前的 Google Sheet 不會受影響。
6. `groupId` 為隨機生成的邀請能力代碼；知道邀請連結且成功登入的人可加入。請勿公開散布連結。需要「邀請需管理員核准」時再新增後端審核機制。
7. 網站不是 BANDAI 或 UNION ARENA 官方網站；請使用自己拍攝或擁有授權的牌組圖片。

## 1. 取得原始碼與預覽

不需安裝 Node.js 或建置工具。將整個資料夾下載解壓後，在專案目錄啟動簡單 HTTP 伺服器：

```powershell
cd C:\UA_Arena_Web_v1
py -m http.server 8080
```

瀏覽器開啟 `http://localhost:8080` → **進入可操作展示**。瀏覽器直接以 `file://` 開啟 ES Modules 會遇到 CORS，請使用 HTTP 伺服器。

展示模式可新增／封存牌組、登錄／撤銷對戰、查看統計；展示模式資料只儲存在目前瀏覽器（localStorage）。

## 2. 建立 Firebase 專案（首次需手動授權）

前往 <https://console.firebase.google.com/> → **Add project** → 例如名稱 `ua-arena-web`。

### 2a. 建立 Web App

Project Overview → 點 **`</>` Web** 圖示 → Register app → 應用程式名稱 `UA Arena Web` → 取得：

```js
const firebaseConfig = {
  apiKey: '...',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  appId: '...',
  messagingSenderId: '...'
};
```

將值填到根目錄 `firebase-config.js` 中，**不要更改 property 名稱**。

注意：Firebase Web Config 不屬於祕密，但它也不會自動保護 Firestore，安全必須靠 Firestore Rules、App Check 及 Firebase 服務設定。

### 2b. 啟用 Authentication

Build → **Authentication** → **Get started** → Sign-in method：

- **Email/Password → Enable**（必須）。
- **Google → Enable**（可選，使用者才可以點 Google 登入）。
- Settings → **Authorized domains**：新增 `YOUR_GITHUB_USERNAME.github.io`（只輸入網域，不加 `https://`、repo 路徑）。用本機測試時確認 `localhost` 也在清單中；新建專案可能不會預設加 localhost。

### 2c. 啟用 Cloud Firestore

Build → **Firestore Database** → Create database → 選擇就近區域（例如 Asia 相關區域）→ 建立。首次可以選 Production mode，**接著務必發佈下面的規則**。

Firestore Database → **Rules** → 複製專案根目錄 `firestore.rules` **全部內容** → **Publish**。

**不要使用 `allow read, write: if true;`。** 規則會將對戰資料限制給群組成員、驗證牌組是否屬於參賽玩家、驗證勝者、禁止任意改寫或刪除勝負結果。

建議先於 Firebase Console Rules Playground 測試：未登入者無法讀取私人子集合、成員可新增牌組、非群組成員不能新增對戰。

## 3. 發佈 GitHub Pages

本版本包含 `.github/workflows/pages.yml`。它會在 `main` 分支更新時自動打包網站並部署至 GitHub Pages。**GitHub Repo → Settings → Pages → Build and deployment → Source 必須選 GitHub Actions**，不要依照舊版設定為 Deploy from a branch。

**這次連接的 GitHub 帳號是 `samuel8796`。截至 2026-11-03 尚未發現獨立的 `ua-arena-web` Repository；GitHub 連線不提供建立新 repo 的操作。** 為避免把 UA Arena 混入你既有的私人或無關專案，請先在 <https://github.com/new> 建立 `samuel8796/ua-arena-web` 公開 Repository（預設 main）。建立後即可把本壓縮包解壓，上傳整個檔案樹。


### 3a. 建立獨立 Repository

進入 <https://github.com/new>，建立新 Repo：

- Repository name: `ua-arena-web`
- Visibility: **Public**（GitHub Free 的 Pages 通常需要公開 repo；**資料本身不會放在 repo，而是 Firestore**）
- 可先不勾選 Initialize README，或直接建立後再上傳。

上傳本專案所有檔案，尤其是：`index.html`、`app.js`、`core.mjs`、`quick-core.mjs`、`firebase-adapter.js`、`firebase-config.js`、`demo-adapter.js`、`styles.css`、`firestore.rules`、`.nojekyll` 與 `assets/`。

這些檔案必須在 **repo 根目錄**，不要只把 ZIP 當成一個檔案上傳。`firestore.rules` 雖然保存在 repo，但需要你手動複製到 Firebase Console Publish；GitHub Pages 並不會自行部署資料庫規則。

### 3b. 啟用 GitHub Pages

Repo → **Settings → Pages** → Build and deployment：

- Source: **GitHub Actions**
- GitHub Actions → 確認 `Deploy UA Arena Web to GitHub Pages` workflow 已成功執行

GitHub Actions 顯示成功後取得：

```
https://YOUR_GITHUB_USERNAME.github.io/ua-arena-web/
```

**請以 GitHub Pages 介面實際顯示的 URL 為準。** Repo 名稱如果不同，URL 路徑也不同。

### 3c. 開啟正式網頁

先在 Firebase Authentication → Authorized domains 加入 `YOUR_GITHUB_USERNAME.github.io`，再打開 GitHub Pages 網站。

首次註冊一位使用者 → 建立群組 → 複製邀請連結 → 讓朋友以各自 Email 註冊並加入。

## 4. 端對端驗收

1. 帳號 A 註冊登入，建立 `UA 週末對戰團`。
2. 複製邀請連結，帳號 B（不同瀏覽器或無痕視窗）開啟，註冊登入並加入。
3. A 建立一副牌組（圖片、名稱、顏色）；B 建立一副牌組。
4. A 在 **對戰紀錄** 點「新增戰績」，可選 A/B 及兩副牌組，再選勝者，儲存。
5. B 刷新頁面，確認出現同一筆戰績，勝率、排行榜都更新。
6. A 可以繼續邀請 C，並**自行填寫 B 與 C 的比賽**，不需要 B/C 登入確認。
7. 嘗試非本群組帳號讀取資料，Firestore Rules 應拒絕。
8. 任一群組成員切換 Quick Match，先測試計時未勾選：選兩副牌組後直接選勝者，記錄立即出現在 Matches。
9. 另開一場勾選計時的 Quick Match：第一人按「回合開始」後倒數；按「回合結束」，第二人再開始。刷新與跨裝置時維持累計與目前回合。
10. 時間用完後應停止開啟新回合，但不會自動判定勝者。結束時由一人選勝者，Matches 應只有一列並可開啟詳細回合記錄。
11. 原提交者或群組建立者可撤銷錯誤紀錄；Firestore 保留該筆資料但統計會排除。

## 5. （可選）啟用 Gemini 規則助手

> **建議優先將登入、對戰與牌組驗收完成，再做 AI。** 這些步驟不會影響核心對戰功能。

1. Firebase Console → **AI Logic** → Get started → 選 Gemini Developer API 並完成服務啟用。免費額度依所選模型與官方當期規定而異。
2. Firebase Console → **App Check**，為你的 Web App 設定 **reCAPTCHA Enterprise** 站點金鑰，將 GitHub Pages hostname 加入允許網域。啟用 App Check 的 enforce，避免外部網站濫用你的模型額度。
3. 將公開的 **reCAPTCHA Enterprise site key** 填入 `firebase-config.js` 的 `aiSettings.recaptchaEnterpriseSiteKey`，並將 `aiSettings.enabled` 改為 `true`。
4. 推送 GitHub Pages 更新，進入「規則 AI」頁面測試。

**不要**將一般 Gemini Developer API Key 貼在 GitHub 網頁程式碼中；Firebase AI Logic 透過 Firebase 的代理服務處理後端模型金鑰，並可結合 App Check。固定 UA 系統提示詞寫在 `core.mjs`，需要官方精確裁定時仍應比對官方原始資料。適用版本：日文、英文、繁體中文、簡體中文、混合。

推薦官方規則連結：
- https://www.unionarena-tcg.com/tc/rules/
- https://www.unionarena-tcg.com/na/faq/
- https://www.unionarena-tcg.com/jp/

## 常見錯誤

| 問題 | 原因與修正 |
| --- | --- |
| 打開網站只看到「先體驗網站」 | `firebase-config.js` 仍是空白；請填 Firebase 設定後重新上傳 |
| Firebase `auth/unauthorized-domain` | GitHub Pages hostname 未加入 Authentication → Authorized domains |
| Firebase `auth/operation-not-allowed` | 尚未啟用 Email/Password 或 Google provider |
| Firestore `permission-denied` | 未 Publish 正確 `firestore.rules`、尚未加入群組，或 rules 與欄位不一致 |
| 邀請連結無法加入 | 請先註冊登入，並確認 `?join=GROUP_ID` 的連結完整 |
| 新增戰績無法選牌組 | 先替參賽玩家新增自己的牌組；牌組會依玩家自動篩選 |
| 圖片過大或無法上傳 | 會自動轉 JPEG 與壓縮；若仍過大請用較小尺寸照片 |
| 規則 AI 按鈕不能按 | 尚未啟用 AI Logic 與 App Check，這是正常的核心功能保護 |
| GitHub Pages 404 | 檔案未放 repo 根目錄、Pages source 未選 GitHub Actions 或網站尚未發佈 |

## 專案檔案

```
UA_Arena_Web_v1_1/
├── index.html                  # 網站入口
├── styles.css                  # 響應式 UI
├── app.js                      # 頁面、表單、事件、統計 UI
├── core.mjs                    # 統計與輸入驗證
├── quick-core.mjs              # Quick Match 計時狀態及統計（可純邏輯測試）
├── firebase-adapter.js         # Firebase Auth / Firestore / AI Logic
├── firebase-config.js          # 填自己的 Firebase Web 設定
├── demo-adapter.js             # 離線示範資料 (localStorage)
├── firestore.rules             # Firestore 存取安全政策
├── assets/favicon.svg         # 圖示
├── tests.mjs                   # 純邏輯測試
├── .nojekyll                   # GitHub Pages 原樣託管
├── .github/workflows/pages.yml # GitHub Pages 自動部署工作流程
├── firebase.json              # Firebase CLI Firestore Rules 設定
├── DEPLOYMENT-CHECKLIST.md    # 上線檢核
└── README.md                   # 這份文件
```

## 升級建議

可在下一版增加：個人檔案管理、牌組對戰相性、賽季篩選、CSV 匯入舊 Google Sheets、管理員核准邀請、圖片獨立儲存、正式官方 FAQ RAG、帳號忘記密碼與通知。
