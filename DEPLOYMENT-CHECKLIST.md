# UA Arena Web v1.1 – 上線檢核清單

## 已完成（原始碼／本地）
- [x] Quick Match 設定：雙方玩家、各自牌組、30 分鐘計時開關
- [x] 進行中的回合只能有一位玩家，支援開始、結束、取消及儲存戰績
- [x] 兩位玩家計時、30:00 總倒數、未歸屬回合空檔與回合紀錄
- [x] 計時場次儲存在 Firestore 的 `groups/{gid}/quickMatches`；跨瀏覽器監聽與交易已編寫
- [x] 非計時場次沿用原本 Matches，直接選勝者存檔
- [x] Firebase Firestore rules 更新，包含計時 session 及最終對戰寫入權限
- [x] GitHub Pages GitHub Actions 工作流程
- [x] 瀏覽器展示模式之桌面及手機實測，以及純函式測試

## 尚需帳號層級設定（不可由這份程式碼代替）
- [ ] 於 GitHub 帳號 `samuel8796` 建立新的公開 Repository：`ua-arena-web`
- [ ] 將專案根目錄所有正式檔案推到預設 `main` 分支
- [ ] GitHub Repo → Settings → Pages → Source: GitHub Actions
- [ ] Firebase Console 建立專案並啟用 Web App、Authentication（Email/Password）、Firestore
- [ ] 將 Firebase Web App 的公開設定填入 `firebase-config.js`（不放管理員金鑰）
- [ ] 將 `firestore.rules` 在 Firestore Rules 頁面發布並透過 Rules Playground / Emulator 驗證
- [ ] Authentication → Authorized domains 添加 `samuel8796.github.io`
- [ ] GitHub Actions 完成部署並取得實際 Pages URL
- [ ] 兩個真實帳號完成跨裝置回合同步與戰績寫入測試

> 若只有 GitHub Pages 但 Firebase Web 設定空白，網站會顯示可操作展示模式，資料只存於各自瀏覽器，不代表多人同步已上線。
> 計時採用瀏覽器 UTC 時間戳且規則有時間範圍檢查，供朋友間比較用時。不是防篡改／正式賽事裁判級計時。

## v1.3 訪客玩家驗收
- [ ] Firestore Rules 已 Publish 最新 `firestore.rules`（包含 `validBattleSide`）。
- [ ] 登入後自動出現「暱稱的戰團」。
- [ ] 個人戰團可選「訪客玩家」、輸入本場牌組名稱與顏色。
- [ ] 訪客牌組只存戰績／計時，不出現在正式牌組清單。
- [ ] 30 分鐘 Quick Match 與不計時流程均可儲存訪客對戰。
- [ ] 既有多人對戰團及錦標賽的舊資料不變。
