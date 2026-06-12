import { db, auth } from "./firebase.js";
import { collection, onSnapshot, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { checkAndSeed } from "./seedData.js";
import { initBoard, renderBoard } from "./board.js";
import { initQuickEntry } from "./payments.js";
import { initMembers, showMemberProfile } from "./members.js";
import { initLots } from "./lots.js";
import { initDashboard } from "./dashboard.js";
import { initReports } from "./reports.js";
import { exportBackupJSON, importBackupJSON } from "./export.js";

// Global Cache States
let globalMembers = [];
let globalLedgers = [];
let globalLots = [];

let membersLoaded = false;
let ledgersLoaded = false;
let lotsLoaded = false;

let activeView = "board"; // Default home view

// Auth & Listener Tracking States
let unsubscribeMembers = null;
let unsubscribeLedgers = null;
let unsubscribeLots = null;
let isInitialized = false;

// Export globally for inline editing input references
window.appDb = db;
window.renderKuriBoard = () => {
  if (globalMembers.length && globalLedgers.length && globalLots.length) {
    renderBoard(db);
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  setupNavigation();
  setupTheme();
  setupConnectionIndicator();
  setupBackupRestore();
  setupKeyboardShortcuts();
  setupAuthListeners();
  setupLoginForm();
  setupLogoutBtn();
});

// Setup standard Firebase Auth observer
function setupAuthListeners() {
  const loader = document.getElementById("loader-overlay");
  const statusEl = document.getElementById("loader-status");
  const loginContainer = document.getElementById("login-container");
  const appContainer = document.querySelector(".app-container");

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      // User is logged in
      if (loginContainer) loginContainer.style.display = "none";
      if (appContainer) appContainer.style.display = "flex";
      
      // If we haven't initialized our listeners and DB seed check, do it now
      if (!isInitialized) {
        isInitialized = true;
        if (loader) {
          loader.style.display = "flex";
          loader.style.opacity = "1";
        }
        if (statusEl) statusEl.textContent = "Checking database status...";

        try {
          // 1. Run Seeding check
          await checkAndSeed(db, (msg) => {
            if (statusEl) statusEl.textContent = msg;
          });

          // 2. Attach Firestore Realtime Listeners
          setupRealtimeListeners();
        } catch (error) {
          console.error("Initialization error:", error);
          if (statusEl) {
            statusEl.innerHTML = `<span style="color: var(--color-due);">Initialization Failed: ${error.message}</span>`;
          }
        }
      }
    } else {
      // User is logged out
      // 1. Unsubscribe from active realtime listeners
      if (unsubscribeMembers) { unsubscribeMembers(); unsubscribeMembers = null; }
      if (unsubscribeLedgers) { unsubscribeLedgers(); unsubscribeLedgers = null; }
      if (unsubscribeLots) { unsubscribeLots(); unsubscribeLots = null; }

      // 2. Clear state variables
      membersLoaded = false;
      ledgersLoaded = false;
      lotsLoaded = false;
      isInitialized = false;
      globalMembers = [];
      globalLedgers = [];
      globalLots = [];

      // 3. Update visibility
      if (appContainer) appContainer.style.display = "none";
      if (loader) loader.style.display = "none";
      if (loginContainer) loginContainer.style.display = "flex";
    }
  });
}

// Setup login form controls
function setupLoginForm() {
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("login-error");
  const loginErrorText = document.getElementById("login-error-text");

  if (!loginForm) return;

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    if (loginError) loginError.style.display = "none";

    const submitBtn = loginForm.querySelector(".login-submit-btn");
    if (submitBtn) {
      submitBtn.disabled = true;
      const span = submitBtn.querySelector("span");
      if (span) span.textContent = "Signing In...";
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);
      showToast("Signed in successfully!", "success");
    } catch (err) {
      console.error("Authentication failed:", err);
      let errMsg = "Incorrect credentials. Please try again.";
      if (err.code === "auth/invalid-email") {
        errMsg = "Invalid email format.";
      } else if (err.code === "auth/user-disabled") {
        errMsg = "This user account has been disabled.";
      } else if (err.code === "auth/user-not-found" || err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") {
        errMsg = "Incorrect email or password.";
      } else if (err.code === "auth/too-many-requests") {
        errMsg = "Too many failed attempts. Try again later.";
      }

      if (loginError && loginErrorText) {
        loginErrorText.textContent = errMsg;
        loginError.style.display = "flex";
      } else {
        showToast(errMsg, "error");
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        const span = submitBtn.querySelector("span");
        if (span) span.textContent = "Sign In";
      }
    }
  });
}

// Setup logout button actions
function setupLogoutBtn() {
  const btnLogout = document.getElementById("btn-logout");
  if (!btnLogout) return;

  btnLogout.addEventListener("click", async (e) => {
    e.preventDefault();

    const confirmed = await customConfirm(
      "Confirm Sign Out",
      "Are you sure you want to log out of Kuri Manager?",
      false
    );

    if (confirmed) {
      try {
        await signOut(auth);
        showToast("Signed out successfully.", "info");
        // Force fully fresh window refresh to ensure memory state resets clean
        window.location.reload();
      } catch (err) {
        console.error("Signout error:", err);
        showToast(`Sign out failed: ${err.message}`, "error");
      }
    }
  });
}

function setupRealtimeListeners() {
  const loader = document.getElementById("loader-overlay");

  // Members Listener
  unsubscribeMembers = onSnapshot(collection(db, "members"), (snap) => {
    globalMembers = [];
    snap.forEach(doc => {
      globalMembers.push(doc.data());
    });
    membersLoaded = true;
    checkInitialLoadComplete(loader);
  }, (err) => {
    console.error("Members listener error:", err);
    showToast(`Real-time Sync Error (Members): ${err.message}`, "error");
  });

  // Ledger Listener
  unsubscribeLedgers = onSnapshot(collection(db, "monthlyLedger"), (snap) => {
    globalLedgers = [];
    snap.forEach(doc => {
      globalLedgers.push(doc.data());
    });
    ledgersLoaded = true;
    checkInitialLoadComplete(loader);
  }, (err) => {
    console.error("Ledger listener error:", err);
    showToast(`Real-time Sync Error (Ledger): ${err.message}`, "error");
  });

  // Lots Listener
  unsubscribeLots = onSnapshot(collection(db, "lots"), (snap) => {
    globalLots = [];
    snap.forEach(doc => {
      globalLots.push(doc.data());
    });
    lotsLoaded = true;
    checkInitialLoadComplete(loader);
  }, (err) => {
    console.error("Lots listener error:", err);
    showToast(`Real-time Sync Error (Lots): ${err.message}`, "error");
  });
}

function checkInitialLoadComplete(loader) {
  if (membersLoaded && ledgersLoaded && lotsLoaded) {
    // Hide loader
    if (loader) {
      loader.style.opacity = "0";
      setTimeout(() => {
        loader.style.display = "none";
      }, 300);
    }

    // Refresh active view
    renderActiveView();
  }
}

// Render the UI based on active tab view
function renderActiveView() {
  if (activeView === "board") {
    initBoard(db, globalMembers, globalLedgers, globalLots);
  } else if (activeView === "quick-entry") {
    initQuickEntry(db, globalMembers, globalLedgers, globalLots);
  } else if (activeView === "members") {
    initMembers(db, globalMembers, globalLedgers, globalLots);
  } else if (activeView === "lots") {
    initLots(db, globalMembers, globalLedgers, globalLots);
  } else if (activeView === "dashboard") {
    initDashboard(db, globalMembers, globalLedgers, globalLots);
  } else if (activeView === "reports") {
    initReports(db, globalMembers, globalLedgers, globalLots);
  }
}

// Setup Single Page App tab navigation
function setupNavigation() {
  const menuItems = document.querySelectorAll(".menu-item");
  const views = document.querySelectorAll(".app-view");
  const viewTitle = document.getElementById("active-view-title");

  menuItems.forEach(item => {
    item.addEventListener("click", (e) => {
      e.preventDefault();
      
      const viewName = item.dataset.view;
      if (!viewName) return;

      activeView = viewName;

      // Toggle active link
      menuItems.forEach(mi => mi.classList.remove("active"));
      item.classList.add("active");

      // Toggle visible view
      views.forEach(v => {
        v.classList.remove("active");
        if (v.id === `${viewName}-view`) {
          v.classList.add("active");
        }
      });

      // Update Header Title
      if (viewTitle) {
        viewTitle.textContent = item.textContent.trim();
      }

      // Render view
      renderActiveView();
    });
  });
}

// Light & Dark theme toggle
function setupTheme() {
  const btnTheme = document.getElementById("btn-toggle-theme");
  if (!btnTheme) return;

  // Read saved theme
  const savedTheme = localStorage.getItem("kuriTheme") || "dark";
  if (savedTheme === "light") {
    document.body.classList.add("light-mode");
    btnTheme.innerHTML = `<i class="fas fa-moon"></i>`;
  }

  btnTheme.addEventListener("click", () => {
    document.body.classList.toggle("light-mode");
    const isLight = document.body.classList.contains("light-mode");
    
    localStorage.setItem("kuriTheme", isLight ? "light" : "dark");
    btnTheme.innerHTML = isLight ? `<i class="fas fa-moon"></i>` : `<i class="fas fa-sun"></i>`;
    
    showToast(`Switched to ${isLight ? 'Light' : 'Dark'} Mode`, "success");
    
    // Rerender dashboard charts to adjust grid text colors
    if (activeView === "dashboard") {
      renderActiveView();
    }
  });
}

// Monitors connection status and toggles indicator
function setupConnectionIndicator() {
  const dot = document.getElementById("connection-status-dot");
  const text = document.getElementById("connection-status-text");

  const updateStatus = () => {
    const isOnline = navigator.onLine;
    if (isOnline) {
      dot.className = "connection-dot";
      text.textContent = "Online Sync Enabled";
      showToast("Connection restored. Syncing updates...", "success");
    } else {
      dot.className = "connection-dot offline";
      text.textContent = "Offline Mode Active";
      showToast("Connection lost. Working offline...", "error");
    }
  };

  window.addEventListener("online", updateStatus);
  window.addEventListener("offline", updateStatus);

  // Set initial
  if (!navigator.onLine) {
    dot.className = "connection-dot offline";
    text.textContent = "Offline Mode Active";
  }
}

// Setup Import/Export Backup
function setupBackupRestore() {
  const btnExport = document.getElementById("btn-export-backup");
  const fileImport = document.getElementById("import-backup-file");
  const btnReseed = document.getElementById("btn-reseed-db");

  if (btnExport) {
    btnExport.addEventListener("click", () => {
      exportBackupJSON(db);
    });
  }

  if (fileImport) {
    fileImport.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const confirmed = await customConfirm(
        "Import Backup",
        "WARNING: Importing backup will overwrite all current database data. Are you sure you want to proceed?",
        true
      );
      if (confirmed) {
        try {
          await importBackupJSON(db, file);
        } catch (err) {
          showToast(`Import failed: ${err.message}`, "error");
        }
      }
      // reset file input
      fileImport.value = "";
    });
  }

  if (btnReseed) {
    btnReseed.addEventListener("click", async () => {
      const confirmed = await customConfirm(
        "Reset & Re-seed Database",
        "CRITICAL WARNING: This will completely erase all current data in Firestore (payments, ledgers, lots, members) and re-seed it with the initial 28 members, contributions, and 11 completed lot winners. Are you absolutely sure?",
        true
      );
      if (confirmed) {
        try {
          showToast("Resetting and re-seeding database...", "info");
          
          // Reset seed Completed flag
          const settingsRef = doc(db, "settings", "kuriSettings");
          await setDoc(settingsRef, { seedCompleted: false });
          
          // Reload to trigger seeding on restart!
          window.location.reload();
        } catch (err) {
          showToast(`Reset failed: ${err.message}`, "error");
        }
      }
    });
  }
}

// Global Keyboard Shortcuts
function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Only check Alt combinations
    if (!e.altKey) return;
    // Don't trigger shortcuts if user is not logged in
    if (!auth.currentUser) return;

    switch (e.key.toLowerCase()) {
      case "b": // Alt+B: Board
        e.preventDefault();
        triggerNavClick("board");
        break;
      case "q": // Alt+Q: Quick Entry
        e.preventDefault();
        triggerNavClick("quick-entry");
        break;
      case "m": // Alt+M: Members
        e.preventDefault();
        triggerNavClick("members");
        break;
      case "l": // Alt+L: Lots
        e.preventDefault();
        triggerNavClick("lots");
        break;
      case "d": // Alt+D: Dashboard
        e.preventDefault();
        triggerNavClick("dashboard");
        break;
      case "r": // Alt+R: Reports
        e.preventDefault();
        triggerNavClick("reports");
        break;
      case "s": // Alt+S: Settings
        e.preventDefault();
        triggerNavClick("settings");
        break;
      case "t": // Alt+T: Toggle Theme
        e.preventDefault();
        const btnTheme = document.getElementById("btn-toggle-theme");
        if (btnTheme) btnTheme.click();
        break;
    }
  });
}

function triggerNavClick(viewName) {
  const item = document.querySelector(`.menu-item[data-view="${viewName}"]`);
  if (item) item.click();
}

// Global Toast Display Helper
export function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  let icon = '<i class="fas fa-check-circle"></i>';
  if (type === "error") {
    icon = '<i class="fas fa-exclamation-circle"></i>';
  } else if (type === "info") {
    icon = '<i class="fas fa-info-circle"></i>';
  }

  toast.innerHTML = `
    ${icon}
    <span>${message}</span>
  `;

  container.appendChild(toast);

  // Remove toast after duration
  setTimeout(() => {
    toast.style.animation = "slideIn 0.3s backwards reverse ease";
    setTimeout(() => {
      container.removeChild(toast);
    }, 300);
  }, 3000);
}

// Custom Promise-based Confirmation Dialog Overlay
export function customConfirm(title, message, isDanger = false) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirm-modal");
    const titleEl = document.getElementById("confirm-modal-title");
    const msgEl = document.getElementById("confirm-modal-message");
    const btnCancel = document.getElementById("btn-confirm-cancel");
    const btnOk = document.getElementById("btn-confirm-ok");

    if (!modal || !titleEl || !msgEl || !btnCancel || !btnOk) {
      resolve(confirm(`${title}\n\n${message}`));
      return;
    }

    titleEl.textContent = title;
    msgEl.textContent = message;

    if (isDanger) {
      btnOk.style.backgroundColor = "var(--color-due)";
      btnOk.style.borderColor = "var(--color-due)";
    } else {
      btnOk.style.backgroundColor = "";
      btnOk.style.borderColor = "";
    }

    modal.style.display = "flex";

    const cleanUp = () => {
      modal.style.display = "none";
      btnOk.removeEventListener("click", onOk);
      btnCancel.removeEventListener("click", onCancel);
    };

    const onOk = (e) => {
      e.preventDefault();
      cleanUp();
      resolve(true);
    };

    const onCancel = (e) => {
      e.preventDefault();
      cleanUp();
      resolve(false);
    };

    // Use once: true to ensure event handlers don't leak
    btnOk.addEventListener("click", onOk, { once: true });
    btnCancel.addEventListener("click", onCancel, { once: true });
  });
}
