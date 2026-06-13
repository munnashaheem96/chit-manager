import { doc, updateDoc, setDoc, getDoc, collection, addDoc, getDocs, query, where, writeBatch } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { showToast } from "./app.js";
import { auth } from "./firebase.js";
import { exportTableAsImage } from "./export.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

let membersList = [];
let ledgerMap = {};
let lotsMap = {};
let activeRowIndex = null;
let activeColIndex = null; // 2 to 13 correspond to January to December
let isEditing = false;

export function initBoard(db, members, ledgers, lots) {
  membersList = members.sort((a, b) => a.serialNo - b.serialNo);
  
  ledgerMap = {};
  ledgers.forEach(l => {
    ledgerMap[l.memberId] = l;
  });

  lotsMap = {};
  lots.forEach(lot => {
    lotsMap[lot.month] = lot;
  });

  renderBoard(db);
  setupBoardEvents(db);
}

export function renderBoard(db) {
  const tbody = document.getElementById("board-tbody");
  if (!tbody) return;

  const searchQuery = document.getElementById("board-search").value.toLowerCase();
  const filterPending = document.getElementById("filter-pending").checked;

  tbody.innerHTML = "";

  // Get current date context to determine what months are in the past/future
  // In June 2026, June is index 5. Past/current = <= 5, future = > 5
  const today = new Date();
  const is2026OrLater = today.getFullYear() >= 2026;
  const currentMonthIndex = is2026OrLater ? (today.getFullYear() > 2026 ? 11 : today.getMonth()) : 5; // Default June if time is weird

  // 1. Filter members
  const filteredMembers = membersList.filter(member => {
    const nameMatch = member.name.toLowerCase().includes(searchQuery);
    
    if (filterPending) {
      // Calculate if member has any outstanding due in past/current months
      const ledger = ledgerMap[member.id] || {};
      let hasDues = false;
      for (let mIdx = 0; mIdx <= currentMonthIndex; mIdx++) {
        const monthName = MONTHS[mIdx];
        const paidVal = ledger[monthName] || 0;
        if (paidVal < 500) {
          hasDues = true;
          break;
        }
      }
      return nameMatch && hasDues;
    }

    return nameMatch;
  });

  // Compile lot winners for displaying badges
  const lotWinners = new Set();
  Object.keys(lotsMap).forEach(month => {
    const lot = lotsMap[month];
    if (lot && lot.winners && lot.winners.length > 0) {
      lot.winners.forEach(winner => {
        lotWinners.add(Number(winner.serialNo));
      });
    }
  });

  // 2. Render member rows
  filteredMembers.forEach((member, rIdx) => {
    const ledger = ledgerMap[member.id] || {};
    const tr = document.createElement("tr");
    tr.dataset.memberId = member.id;
    tr.dataset.rowIndex = rIdx;

    // SL No
    const tdSl = document.createElement("td");
    tdSl.textContent = member.serialNo;
    tr.appendChild(tdSl);

    // Member Name
    const tdName = document.createElement("td");
    if (lotWinners.has(member.serialNo)) {
      tdName.innerHTML = `${member.name} <span class="winner-badge" title="Lot Received" style="cursor: help;">🏆</span>`;
    } else {
      tdName.textContent = member.name;
    }
    tr.appendChild(tdName);

    // Months
    MONTHS.forEach((month, cIdx) => {
      const tdMonth = document.createElement("td");
      tdMonth.className = "kuri-cell";
      tdMonth.dataset.memberId = member.id;
      tdMonth.dataset.month = month;
      tdMonth.dataset.colIndex = cIdx + 2; // offset by 2 (SL, Name)

      const paidVal = ledger[month] || 0;
      tdMonth.innerHTML = `<span class="cell-value">${paidVal > 0 ? "₹" + paidVal : "—"}</span>`;

      // Status Coloring
      if (cIdx <= currentMonthIndex) {
        if (paidVal >= 500) {
          tdMonth.classList.add("status-paid");
        } else if (paidVal > 0) {
          tdMonth.classList.add("status-partial");
        } else {
          tdMonth.classList.add("status-due");
        }
      } else {
        // Future month
        if (paidVal > 0) {
          tdMonth.classList.add("status-advance");
        }
      }

      tr.appendChild(tdMonth);
    });

    tbody.appendChild(tr);
  });

  // 3. Render Summary Rows (using all members, not just filtered ones)
  renderSummaryRows(tbody);
}

function renderSummaryRows(tbody) {
  // A. Total Collections Row
  const trTotal = document.createElement("tr");
  trTotal.className = "summary-row total-collection";
  trTotal.innerHTML = `<td></td><td>TOTAL COLLECTION</td>`;

  const totalCollections = {};
  MONTHS.forEach(month => {
    let sum = 0;
    membersList.forEach(m => {
      const ledger = ledgerMap[m.id] || {};
      sum += (ledger[month] || 0);
    });
    totalCollections[month] = sum;
    trTotal.innerHTML += `<td>₹${sum}</td>`;
  });
  tbody.appendChild(trTotal);

  // B. Balance Before Lot Row
  const trBefore = document.createElement("tr");
  trBefore.className = "summary-row bal-before-lot";
  trBefore.innerHTML = `<td></td><td>BALANCE BEFORE LOT</td>`;

  const balanceBefore = {};
  const balanceAfter = {};

  MONTHS.forEach((month, idx) => {
    const collection = totalCollections[month] || 0;
    let before = 0;

    if (idx === 0) {
      before = collection;
    } else {
      const prevMonth = MONTHS[idx - 1];
      const prevAfter = balanceAfter[prevMonth];
      before = prevAfter + collection;
    }

    balanceBefore[month] = before;

    // Resolve balanceAfter from lots collection (subtracting total payouts of all winners drawn in that month)
    const lot = lotsMap[month];
    let after = before;
    if (lot && lot.winners && lot.winners.length > 0) {
      const totalPayout = lot.winners.reduce((sum, w) => sum + (Number(w.lotAmount) || 0), 0);
      after = before - totalPayout;
    } else {
      // Historical data lookup for balance after lot (since lots might not be explicitly set with a winner yet but have balanceAfter)
      if (lot && lot.balanceAfter !== undefined && lot.balanceAfter !== null && lot.balanceAfter !== before) {
        after = lot.balanceAfter;
      }
    }
    balanceAfter[month] = after;

    trBefore.innerHTML += `<td>₹${before}</td>`;
  });
  tbody.appendChild(trBefore);

  // C. Balance After Lot Row
  const trAfter = document.createElement("tr");
  trAfter.className = "summary-row bal-after-lot";
  trAfter.innerHTML = `<td></td><td>BALANCE AFTER LOT</td>`;

  MONTHS.forEach((month, idx) => {
    // If the lot hasn't been drawn and is 0/empty:
    const lot = lotsMap[month];
    const isDrawn = lot && ((lot.winners && lot.winners.length > 0) || (lot.balanceAfter !== undefined && lot.balanceAfter !== null && lot.balanceAfter !== balanceBefore[month]));
    
    if (isDrawn) {
      trAfter.innerHTML += `<td>₹${balanceAfter[month]}</td>`;
    } else {
      trAfter.innerHTML += `<td style="color: var(--text-muted);">Pending</td>`;
    }
  });
  tbody.appendChild(trAfter);
}

function setupBoardEvents(db) {
  const table = document.getElementById("board-table");
  if (!table) return;

  // Single click to focus
  table.addEventListener("click", (e) => {
    const cell = e.target.closest(".kuri-cell");
    if (!cell) return;

    if (isEditing) {
      commitEdit(db);
    }

    focusCell(cell);
  });

  // Double click to edit
  table.addEventListener("dblclick", (e) => {
    const cell = e.target.closest(".kuri-cell");
    if (!cell) return;

    enterEditMode(cell);
  });

  // Input change on search
  document.getElementById("board-search").addEventListener("input", () => {
    renderBoard(db);
  });

  // Filter change
  document.getElementById("filter-pending").addEventListener("change", () => {
    renderBoard(db);
  });

  // Download board table as image
  const btnDownloadImage = document.getElementById("btn-download-image");
  if (btnDownloadImage) {
    btnDownloadImage.addEventListener("click", async () => {
      // Commit any active edit before exporting
      const activeCell = document.querySelector(".kuri-cell.editing");
      if (activeCell) {
        const input = activeCell.querySelector("input");
        if (input) input.blur();
      }
      
      const today = new Date();
      const is2026OrLater = today.getFullYear() >= 2026;
      const currentMonthIndex = is2026OrLater ? (today.getFullYear() > 2026 ? 11 : today.getMonth()) : 5;
      
      await exportTableAsImage("board-table", currentMonthIndex, MONTHS);
    });
  }

  // Keyboard navigation
  document.addEventListener("keydown", (e) => {
    // Only handle if Board is the active view
    const boardView = document.getElementById("board-view");
    if (!boardView || !boardView.classList.contains("active")) return;

    if (isEditing) {
      if (e.key === "Enter") {
        e.preventDefault();
        commitEdit(db);
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
      }
      return;
    }

    const currentFocused = document.querySelector(".kuri-cell.focused");
    if (!currentFocused) return;

    let targetRowIndex = parseInt(currentFocused.parentElement.dataset.rowIndex);
    let targetColIndex = parseInt(currentFocused.dataset.colIndex);

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        navigateGrid(targetRowIndex - 1, targetColIndex);
        break;
      case "ArrowDown":
        e.preventDefault();
        navigateGrid(targetRowIndex + 1, targetColIndex);
        break;
      case "ArrowLeft":
        e.preventDefault();
        navigateGrid(targetRowIndex, targetColIndex - 1);
        break;
      case "ArrowRight":
        e.preventDefault();
        navigateGrid(targetRowIndex, targetColIndex + 1);
        break;
      case "Tab":
        e.preventDefault();
        if (e.shiftKey) {
          navigateGrid(targetRowIndex, targetColIndex - 1);
        } else {
          navigateGrid(targetRowIndex, targetColIndex + 1);
        }
        break;
      case "Enter":
        e.preventDefault();
        enterEditMode(currentFocused);
        break;
    }
  });
}

function focusCell(cell) {
  document.querySelectorAll(".kuri-cell").forEach(c => c.classList.remove("focused"));
  cell.classList.add("focused");
  activeRowIndex = parseInt(cell.parentElement.dataset.rowIndex);
  activeColIndex = parseInt(cell.dataset.colIndex);
}

function navigateGrid(rIdx, cIdx) {
  // Boundary checks
  const rows = document.querySelectorAll("#board-tbody tr:not(.summary-row)");
  if (rIdx < 0 || rIdx >= rows.length) return;
  if (cIdx < 2 || cIdx > 13) return; // Column index must match month index offset

  const targetRow = rows[rIdx];
  const targetCell = targetRow.querySelector(`.kuri-cell[data-col-index="${cIdx}"]`);
  if (targetCell) {
    focusCell(targetCell);
    // Scroll cell into view if needed
    targetCell.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function enterEditMode(cell) {
  if (auth.currentUser && auth.currentUser.isAnonymous) {
    showToast("Guest Mode: Editing is disabled.", "info");
    return;
  }
  if (isEditing) return;
  isEditing = true;

  cell.classList.add("editing");
  const span = cell.querySelector(".cell-value");
  const originalVal = span ? span.textContent.replace("₹", "") : "0";
  const numVal = originalVal === "—" ? "0" : originalVal;

  cell.innerHTML = `<input type="number" class="kuri-cell-input" value="${numVal}" min="0">`;
  const input = cell.querySelector("input");
  input.focus();
  input.select();

  // Blur saves
  input.addEventListener("blur", () => {
    // Small delay to allow escape key listener to fire first if pressed
    setTimeout(() => {
      if (isEditing) {
        // Find reference to DB. App.js exports the db, but we can pass it down
        const appDb = window.appDb;
        if (appDb) {
          commitEdit(appDb);
        }
      }
    }, 100);
  });
}

async function commitEdit(db) {
  const cell = document.querySelector(".kuri-cell.editing");
  if (!cell) return;

  const input = cell.querySelector("input");
  if (!input) return;

  const memberId = cell.dataset.memberId;
  const month = cell.dataset.month;
  const val = parseInt(input.value) || 0;

  isEditing = false;
  cell.classList.remove("editing");

  // Re-render cell value temporarily
  cell.innerHTML = `<span class="cell-value">${val > 0 ? "₹" + val : "—"}</span>`;
  cell.focus();

  // Check if value actually changed in ledger
  const currentLedger = ledgerMap[memberId] || {};
  const oldVal = currentLedger[month] || 0;
  if (val === oldVal) {
    renderBoard(db);
    return;
  }

  try {
    showToast(`Saving changes...`, "info");

    // 1. Update Monthly Ledger
    const ledgerRef = doc(db, "monthlyLedger", memberId);
    await updateDoc(ledgerRef, {
      [month]: val
    });

    // 2. Adjust payments record. To keep payments collection clean,
    // we query if a payment exists for this month and update/delete it.
    const paymentsRef = collection(db, "payments");
    const q = query(paymentsRef, where("memberId", "==", memberId), where("note", "==", `Manual override for ${month}`));
    const querySnap = await getDocs(q);

    if (val === 0) {
      // Delete any payment records for this month
      querySnap.forEach(async (d) => {
        await deleteDoc(d.ref);
      });
    } else {
      if (!querySnap.empty) {
        // Update existing payment
        const docRef = doc(db, "payments", querySnap.docs[0].id);
        await updateDoc(docRef, {
          amount: val,
          paymentDate: new Date().toISOString()
        });
      } else {
        // Create new payment record
        await addDoc(paymentsRef, {
          memberId: memberId,
          amount: val,
          paymentDate: new Date().toISOString(),
          note: `Manual override for ${month}`
        });
      }
    }

    showToast("Changes saved successfully!", "success");
  } catch (error) {
    console.error("Error committing edit:", error);
    showToast(`Failed to save: ${error.message}`, "error");
    renderBoard(db); // revert on error
  }
}

function cancelEdit() {
  const cell = document.querySelector(".kuri-cell.editing");
  if (!cell) return;

  isEditing = false;
  cell.classList.remove("editing");

  const memberId = cell.dataset.memberId;
  const month = cell.dataset.month;
  const ledger = ledgerMap[memberId] || {};
  const originalVal = ledger[month] || 0;

  cell.innerHTML = `<span class="cell-value">${originalVal > 0 ? "₹" + originalVal : "—"}</span>`;
  cell.focus();
}
