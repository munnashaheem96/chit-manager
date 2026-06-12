import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { showToast, customConfirm } from "./app.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const LOTS_SCHEDULE = {
  "January": 2,
  "February": 2,
  "March": 3,
  "April": 2,
  "May": 2,
  "June": 3,
  "July": 2,
  "August": 2,
  "September": 3,
  "October": 2,
  "November": 2,
  "December": 3
};

let membersList = [];
let ledgerMap = {};
let lotsMap = {};

let selectedMonth = null;
let localWinnersList = []; // Accumulate winners locally before saving

export function initLots(db, members, ledgers, lots) {
  membersList = members.sort((a, b) => a.serialNo - b.serialNo);
  
  ledgerMap = {};
  ledgers.forEach(l => {
    ledgerMap[l.memberId] = l;
  });

  lotsMap = {};
  lots.forEach(lot => {
    lotsMap[lot.month] = lot;
  });

  renderLotsDashboard();
  renderLotsTable(db);
  renderEligibleMembers();
  setupLotsForm(db);
}

function renderLotsDashboard() {
  const statsContainer = document.getElementById("lot-stats-summary");
  if (!statsContainer) return;

  // Calculate totals
  let completed = 0;
  Object.keys(lotsMap).forEach(month => {
    const lot = lotsMap[month];
    if (lot && lot.winners) {
      completed += lot.winners.length;
    }
  });

  const remaining = 28 - completed;
  const percentage = ((completed / 28) * 100).toFixed(2);

  statsContainer.innerHTML = `
    <div style="background-color: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; width: 100%;">
      <div>
        <h4 style="color: var(--text-muted); font-size: 0.85rem; text-transform: uppercase; margin-bottom: 6px;">Total Lot Progress</h4>
        <div style="font-size: 1.8rem; font-weight: 700; font-family: 'JetBrains Mono', monospace; color: var(--primary-color);">
          ${completed} / 28 Lots Completed
        </div>
      </div>
      <div style="text-align: right;">
        <span style="font-weight: 600; color: var(--text-secondary);">${remaining} Remaining</span>
        <div style="font-size: 1.1rem; font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--color-paid); margin-top: 4px;">
          ${percentage}% Completed
        </div>
      </div>
    </div>
  `;
}

function renderLotsTable(db) {
  const tbody = document.getElementById("lots-tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  // Compute collections and running balances
  const totalCollections = {};
  MONTHS.forEach(month => {
    let sum = 0;
    membersList.forEach(m => {
      const ledger = ledgerMap[m.id] || {};
      sum += (ledger[month] || 0);
    });
    totalCollections[month] = sum;
  });

  const balanceBefore = {};
  const balanceAfter = {};

  MONTHS.forEach((month, idx) => {
    const collectionVal = totalCollections[month] || 0;
    let before = 0;

    if (idx === 0) {
      before = collectionVal;
    } else {
      const prevMonth = MONTHS[idx - 1];
      const prevAfter = balanceAfter[prevMonth];
      before = prevAfter + collectionVal;
    }

    balanceBefore[month] = before;

    const lot = lotsMap[month];
    let after = before;

    // Subtract winner payouts
    if (lot && lot.winners && lot.winners.length > 0) {
      const totalPayout = lot.winners.reduce((sum, w) => sum + (Number(w.lotAmount) || 0), 0);
      after = before - totalPayout;
    } else if (lot && lot.balanceAfter !== undefined && lot.balanceAfter !== null && lot.balanceAfter !== before) {
      after = lot.balanceAfter;
    }
    balanceAfter[month] = after;

    const targetLots = LOTS_SCHEDULE[month];
    const completedLots = lot && lot.winners ? lot.winners.length : 0;
    
    // Compile winners list display
    let winnersText = "";
    if (lot && lot.winners && lot.winners.length > 0) {
      winnersText = lot.winners.map(w => `${w.name} (₹${w.lotAmount})`).join(", ");
    } else {
      winnersText = `<span style="color: var(--text-muted);">No Winners Drawn</span>`;
    }

    const balanceBeforeDisplay = `₹${before}`;
    const balanceAfterDisplay = lot && ((lot.winners && lot.winners.length > 0) || (lot.balanceAfter !== undefined && lot.balanceAfter !== null && lot.balanceAfter !== before)) ? `₹${after}` : "Pending";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-weight: 600;">
        ${month}
        <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500;">
          Schedule: ${targetLots} Draw${targetLots > 1 ? 's' : ''}
        </div>
      </td>
      <td>
        <div style="font-weight: 500;">${winnersText}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">Drawn: ${completedLots} / ${targetLots}</div>
      </td>
      <td class="amount-cell" style="font-family: 'JetBrains Mono', monospace;">
        ₹${lot && lot.winners ? lot.winners.reduce((sum, w) => sum + w.lotAmount, 0) : 0}
      </td>
      <td class="amount-cell" style="font-family: 'JetBrains Mono', monospace;">${balanceBeforeDisplay}</td>
      <td class="amount-cell" style="font-family: 'JetBrains Mono', monospace; font-weight: 600; color: ${completedLots === targetLots ? 'var(--color-paid)' : 'inherit'};">
        ${balanceAfterDisplay}
      </td>
      <td style="text-align: center;">
        <button class="btn-secondary btn-edit-lot" data-month="${month}">
          Draw / Edit
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Attach button events
  document.querySelectorAll(".btn-edit-lot").forEach(btn => {
    btn.addEventListener("click", () => {
      openLotDrawPanel(db, btn.dataset.month, balanceBefore);
    });
  });
}

function renderEligibleMembers() {
  const container = document.getElementById("eligible-members-sidebar");
  if (!container) return;

  // Compile winners
  const allWinners = new Set();
  Object.keys(lotsMap).forEach(m => {
    const lot = lotsMap[m];
    if (lot && lot.winners) {
      lot.winners.forEach(w => allWinners.add(Number(w.serialNo)));
    }
  });

  const eligible = membersList.filter(m => !allWinners.has(m.serialNo));

  container.innerHTML = `
    <div class="history-card" style="height: 100%; max-height: 500px; display: flex; flex-direction: column;">
      <div class="history-card-header" style="padding-bottom: 8px;">
        <h3>Eligible Members (${eligible.length})</h3>
      </div>
      <div style="overflow-y: auto; flex-grow: 1; margin-top: 12px; display: flex; flex-direction: column; gap: 8px;">
        ${eligible.length === 0 ? '<div style="color: var(--text-muted); font-size: 0.9rem;">All members have received their lot!</div>' : ''}
        ${eligible.map(m => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background-color: var(--bg-tertiary); border-radius: 8px; font-size: 0.9rem;">
            <span style="font-weight: 600; color: var(--text-secondary);">${m.name}</span>
            <span style="font-family: 'JetBrains Mono', monospace; color: var(--text-muted); font-size: 0.8rem;">SL ${m.serialNo}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function setupLotsForm(db) {
  const form = document.getElementById("lot-form");
  if (!form) return;

  const btnCancel = document.getElementById("btn-cancel-lot");
  const btnAddWinner = document.getElementById("btn-add-winner-to-list");
  const overrideCheckbox = document.getElementById("lot-admin-override");

  btnCancel.onclick = () => {
    document.getElementById("lot-edit-card").style.display = "none";
    selectedMonth = null;
    localWinnersList = [];
  };

  // Re-load dropdown options if admin override is toggled
  if (overrideCheckbox) {
    overrideCheckbox.onchange = () => {
      populateWinnersDropdown();
    };
  }

  // Add winner to local list on click
  if (btnAddWinner) {
    btnAddWinner.onclick = () => {
      const winnerSelect = document.getElementById("lot-winner-select");
      const winnerId = winnerSelect.value;
      const prizeAmount = parseInt(document.getElementById("lot-prize-input").value) || 0;
      const drawDate = document.getElementById("lot-date-input").value;

      if (!winnerId) {
        showToast("Please choose a winner", "error");
        return;
      }
      if (prizeAmount <= 0) {
        showToast("Enter a valid prize payout", "error");
        return;
      }

      const winnerObj = membersList.find(m => m.id === winnerId);
      if (!winnerObj) return;

      // Check if duplicate in local list
      const isDup = localWinnersList.some(w => w.serialNo === winnerObj.serialNo);
      if (isDup && !overrideCheckbox.checked) {
        showToast("This member is already added to this month's winners list", "error");
        return;
      }

      localWinnersList.push({
        serialNo: winnerObj.serialNo,
        name: winnerObj.name,
        lotAmount: prizeAmount,
        lotDate: drawDate || new Date().toISOString().slice(0, 10)
      });

      showToast(`Added ${winnerObj.name} to drawings!`, "success");
      
      // Reset dropdown select
      winnerSelect.value = "";

      renderLocalWinnersList();
      recalculateBalanceAfter();
    };
  }

  // Form Submission
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!selectedMonth) return;

    const targetLots = LOTS_SCHEDULE[selectedMonth];
    if (localWinnersList.length > targetLots && !overrideCheckbox.checked) {
      const confirmed = await customConfirm(
        "Confirm Excess Drawings",
        `Warning: This month expects ${targetLots} lot drawings, but you have added ${localWinnersList.length}. Proceed anyway?`
      );
      if (!confirmed) {
        return;
      }
    }

    const lotAmount = parseInt(document.getElementById("lot-amount-input").value) || 14000;
    const balanceBefore = parseInt(document.getElementById("lot-bal-before").value) || 0;
    const balanceAfter = parseInt(document.getElementById("lot-bal-after").value) || 0;

    try {
      showToast("Saving month draws...", "info");

      const lotRef = doc(db, "lots", selectedMonth);
      await setDoc(lotRef, {
        month: selectedMonth,
        numberOfLots: targetLots,
        balanceBefore: balanceBefore,
        balanceAfter: balanceAfter,
        winners: localWinnersList
      });

      // Cache update
      lotsMap[selectedMonth] = {
        month: selectedMonth,
        numberOfLots: targetLots,
        balanceBefore: balanceBefore,
        balanceAfter: balanceAfter,
        winners: localWinnersList
      };

      showToast(`Saved draws successfully for ${selectedMonth}!`, "success");
      document.getElementById("lot-edit-card").style.display = "none";
      selectedMonth = null;
      localWinnersList = [];

      renderLotsTable(db);
      renderEligibleMembers();
      renderLotsDashboard();

      // Trigger main UI updates
      if (window.renderKuriBoard) {
        window.renderKuriBoard();
      }
    } catch (err) {
      console.error("Error saving lots:", err);
      showToast(`Save failed: ${err.message}`, "error");
    }
  };
}

function openLotDrawPanel(db, month, balanceBeforeMap) {
  selectedMonth = month;
  
  const lot = lotsMap[month] || {};
  const before = balanceBeforeMap[month] || 0;

  const targetLots = LOTS_SCHEDULE[month];
  document.getElementById("lot-month-title").textContent = `Draw Lot: ${month} (Target: ${targetLots})`;
  document.getElementById("lot-bal-before").value = before;
  document.getElementById("lot-amount-input").value = lot.lotAmount || 14000;
  
  // Set default draw date
  const monthNum = MONTHS.indexOf(month) + 1;
  const monthStr = monthNum < 10 ? `0${monthNum}` : `${monthNum}`;
  document.getElementById("lot-date-input").value = `2026-${monthStr}-15`;

  // Copy winners to local accumulator
  localWinnersList = lot.winners ? [...lot.winners] : [];

  document.getElementById("lot-admin-override").checked = false;

  populateWinnersDropdown();
  renderLocalWinnersList();
  recalculateBalanceAfter();

  // Show
  document.getElementById("lot-edit-card").style.display = "block";
  document.getElementById("lot-edit-card").scrollIntoView({ behavior: "smooth" });
}

function populateWinnersDropdown() {
  const winnerSelect = document.getElementById("lot-winner-select");
  if (!winnerSelect) return;

  winnerSelect.innerHTML = `<option value="">-- Choose Member --</option>`;

  const override = document.getElementById("lot-admin-override").checked;

  // Compile winners in other months
  const otherWinners = new Set();
  Object.keys(lotsMap).forEach(m => {
    if (m !== selectedMonth) {
      const lot = lotsMap[m];
      if (lot && lot.winners) {
        lot.winners.forEach(w => otherWinners.add(Number(w.serialNo)));
      }
    }
  });

  // Current winners in local list
  const currentLocals = new Set(localWinnersList.map(w => w.serialNo));

  membersList.forEach(m => {
    const wonElsewhere = otherWinners.has(m.serialNo);
    const wonHere = currentLocals.has(m.serialNo);

    if (override || (!wonElsewhere && !wonHere)) {
      winnerSelect.innerHTML += `<option value="${m.id}">SL ${m.serialNo} - ${m.name}</option>`;
    }
  });
}

function renderLocalWinnersList() {
  const list = document.getElementById("lot-current-winners-list");
  if (!list) return;

  list.innerHTML = "";

  if (localWinnersList.length === 0) {
    list.innerHTML = `<div style="color: var(--text-muted); font-size: 0.85rem; padding: 6px 0;">No winners added for this month yet.</div>`;
    return;
  }

  localWinnersList.forEach((w, index) => {
    const item = document.createElement("div");
    item.style.display = "flex";
    item.style.justify = "space-between";
    item.style.alignItems = "center";
    item.style.padding = "8px 12px";
    item.style.backgroundColor = "var(--bg-tertiary)";
    item.style.borderRadius = "6px";
    item.style.fontSize = "0.85rem";
    item.style.marginTop = "4px";

    item.innerHTML = `
      <div>
        <span style="font-weight: 600;">${w.name} (SL ${w.serialNo})</span>
        <div style="font-size: 0.75rem; color: var(--text-muted);">Payout: ₹${w.lotAmount} | Date: ${w.lotDate}</div>
      </div>
      <button type="button" class="btn-icon btn-remove-winner" data-index="${index}" style="width: 28px; height: 28px; color: var(--color-due); border-color: rgba(239, 68, 68, 0.2);" title="Remove Drawing">
        <i class="fas fa-trash-alt"></i>
      </button>
    `;

    list.appendChild(item);
  });

  // Remove winner event
  document.querySelectorAll(".btn-remove-winner").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.index);
      localWinnersList.splice(idx, 1);
      renderLocalWinnersList();
      populateWinnersDropdown();
      recalculateBalanceAfter();
    });
  });
}

function recalculateBalanceAfter() {
  const before = parseInt(document.getElementById("lot-bal-before").value) || 0;
  const totalPayout = localWinnersList.reduce((sum, w) => sum + w.lotAmount, 0);
  const after = Math.max(0, before - totalPayout);
  document.getElementById("lot-bal-after").value = after;
}
