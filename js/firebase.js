import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDt6i-UNggkLVADH8TPCtKTDxPV9wXMPFs",
  authDomain: "projectx-ea638.firebaseapp.com",
  projectId: "projectx-ea638",
  storageBucket: "projectx-ea638.firebasestorage.app",
  messagingSenderId: "349137298425",
  appId: "1:349137298425:web:be4c0624dde92c90dd5328"
};

const app = initializeApp(firebaseConfig);

// Enable offline persistence in v10+
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager()
  })
});

export { db };
