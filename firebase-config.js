// Firebase Web App 公開設定。身分與資料權限由 Firebase Authentication 和 Firestore Security Rules 控制。
// 切勿將 Firebase service account、管理員金鑰、或 Gemini Developer API Key 寫入此檔案。
export const firebaseConfig = {
  apiKey: "AIzaSyDq_x2ZXD7P_Ep1uG4o2OpGKmuUjTxujXM",
  authDomain: "ua-arena-web.firebaseapp.com",
  projectId: "ua-arena-web",
  storageBucket: "ua-arena-web.firebasestorage.app",
  messagingSenderId: "22146218387",
  appId: "1:22146218387:web:c28397c8f50971b03f1066",
  measurementId: "G-5XW9LYB2SN"
};

// 規則問答須另行啟用 Firebase AI Logic / App Check 並驗證來源。
export const aiSettings = {
  enabled: false,
  model: 'gemini-2.5-flash',
  recaptchaEnterpriseSiteKey: ''
};
