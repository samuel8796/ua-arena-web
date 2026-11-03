// 公開 Firebase Web config；帳號與資料權限受 Authentication / Firestore Rules 控制。
// 禁止將 Service Account、管理員私鑰、Gemini API key 寫入此檔案。
export const firebaseConfig = {
  apiKey: "AIzaSyDq_x2ZXD7P_Ep1uG4o2OpGKmuUjTxujXM",
  authDomain: "ua-arena-web.firebaseapp.com",
  projectId: "ua-arena-web",
  storageBucket: "ua-arena-web.firebasestorage.app",
  messagingSenderId: "22146218387",
  appId: "1:22146218387:web:c28397c8f50971b03f1066",
  measurementId: "G-5XW9LYB2SN"
};

// AI Logic 已預留；必須在 Firebase Console 啟用 AI Logic 並設定 App Check。
// 將公用的 reCAPTCHA Enterprise 網站金鑰填入後，方會啟用問答功能。
export const aiSettings = {
  enabled: true,
  model: 'gemini-2.5-flash',
  recaptchaEnterpriseSiteKey: ''
};
