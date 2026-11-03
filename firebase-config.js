// 到 Firebase Console → 專案設定 → 你的應用程式 → 網頁應用程式，複製設定值填入。
// Firebase Web Config 是公開的專案識別資訊，並不是私密管理員金鑰。
// 不要將 service account 金鑰、Gemini API key 或管理憑證放在這個檔案！
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  appId: '',
  messagingSenderId: ''
};

// 啟用 Firebase AI Logic 後可改為 true；需要先依 README 設定 Firebase App Check。
export const aiSettings = {
  enabled: false,
  model: 'gemini-2.5-flash',
  recaptchaEnterpriseSiteKey: ''
};
