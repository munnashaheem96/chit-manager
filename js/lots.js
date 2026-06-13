import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { showToast, customConfirm } from "./app.js";
import { auth } from "./firebase.js";

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
  setupSpinWheel();
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
  if (auth.currentUser && auth.currentUser.isAnonymous) {
    return;
  }
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

let candidates = [];
let wheelAngle = 0;
let isSpinning = false;

function setupSpinWheel() {
  const btnOpenWheel = document.getElementById("btn-open-wheel");
  const modal = document.getElementById("wheel-modal");
  const btnClose = document.getElementById("btn-close-wheel");
  const btnSpinTrigger = document.getElementById("btn-spin-trigger");
  const btnApply = document.getElementById("btn-apply-wheel-winner");
  const canvas = document.getElementById("wheel-canvas");

  if (!btnOpenWheel || !modal || !btnClose || !btnSpinTrigger || !btnApply || !canvas) return;

  btnOpenWheel.onclick = () => {
    const winnerSelect = document.getElementById("lot-winner-select");
    const eligibleOptions = Array.from(winnerSelect.options).slice(1);
    
    if (eligibleOptions.length === 0) {
      showToast("No eligible members available to spin!", "error");
      return;
    }

    candidates = eligibleOptions.map(opt => {
      const val = opt.value;
      const text = opt.textContent;
      const match = text.match(/^SL (\d+) - (.*)$/);
      return {
        id: val,
        serialNo: match ? parseInt(match[1]) : 0,
        name: match ? match[2] : text
      };
    });

    // Reset wheel state
    wheelAngle = Math.random() * Math.PI * 2;
    isSpinning = false;
    document.getElementById("wheel-winner-announcement").style.display = "none";
    document.getElementById("wheel-winner-name").classList.remove("winner-highlight");
    btnSpinTrigger.disabled = false;
    btnSpinTrigger.style.opacity = "1";
    
    // Draw initial wheel
    const isLight = document.body.classList.contains("light-mode");
    drawWheel(canvas, wheelAngle, isLight);

    modal.style.display = "flex";
  };

  btnClose.onclick = () => {
    if (isSpinning) return; // prevent closing while spinning
    modal.style.display = "none";
  };

  btnSpinTrigger.onclick = () => {
    if (isSpinning) return;
    isSpinning = true;
    btnSpinTrigger.disabled = true;
    btnSpinTrigger.style.opacity = "0.6";
    document.getElementById("wheel-winner-announcement").style.display = "none";

    let velocity = 0.5 + Math.random() * 0.4;
    const friction = 0.982 + Math.random() * 0.006; // smooth friction deceleration

    function animate() {
      wheelAngle += velocity;
      velocity *= friction;

      const isLight = document.body.classList.contains("light-mode");
      drawWheel(canvas, wheelAngle, isLight);

      if (velocity > 0.001) {
        requestAnimationFrame(animate);
      } else {
        isSpinning = false;
        btnSpinTrigger.disabled = false;
        btnSpinTrigger.style.opacity = "1";
        
        // Calculate winner
        const arcSize = (2 * Math.PI) / candidates.length;
        const relativeAngle = (1.5 * Math.PI - wheelAngle) % (2 * Math.PI);
        const normalizedAngle = relativeAngle < 0 ? relativeAngle + 2 * Math.PI : relativeAngle;
        const winnerIndex = Math.floor(normalizedAngle / arcSize);
        const winner = candidates[winnerIndex];

        // Announce winner
        const announcement = document.getElementById("wheel-winner-announcement");
        const nameEl = document.getElementById("wheel-winner-name");
        nameEl.textContent = `${winner.name} (SL ${winner.serialNo})`;
        nameEl.classList.add("winner-highlight");
        announcement.style.display = "flex";

        // Pop confetti at the center of the wheel
        triggerConfetti(160, 160, canvas.parentElement);

        btnApply.onclick = () => {
          const winnerSelect = document.getElementById("lot-winner-select");
          winnerSelect.value = winner.id;
          modal.style.display = "none";
          showToast(`Selected ${winner.name} as the winner!`, "success");
        };
      }
    }

    animate();
  };
}

function drawWheel(canvas, currentAngle, isLight) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  const total = candidates.length;
  const arcSize = (2 * Math.PI) / total;
  
  const colors = isLight 
    ? ["#4f46e5", "#10b981", "#f59e0b", "#3b82f6", "#ec4899", "#8b5cf6", "#f43f5e"] 
    : ["#6366f1", "#059669", "#d97706", "#2563eb", "#db2777", "#7c3aed", "#e11d48"];

  ctx.save();
  ctx.translate(160, 160);
  ctx.rotate(currentAngle);
  
  for (let i = 0; i < total; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 150, i * arcSize, (i + 1) * arcSize);
    ctx.closePath();
    
    // Distribute colors evenly
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    
    ctx.strokeStyle = isLight ? "rgba(255, 255, 255, 0.4)" : "rgba(255, 255, 255, 0.15)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    
    // Draw text in the slice
    ctx.save();
    ctx.rotate(i * arcSize + arcSize / 2);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px 'Outfit', sans-serif";
    
    const displayName = candidates[i].name.length > 12 
      ? candidates[i].name.slice(0, 10) + ".." 
      : candidates[i].name;
      
    ctx.fillText(displayName, 135, 0);
    ctx.restore();
  }
  
  ctx.restore();
  
  // Outer ring
  ctx.beginPath();
  ctx.arc(160, 160, 150, 0, 2 * Math.PI);
  ctx.strokeStyle = isLight ? "#4f46e5" : "#6366f1";
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(160, 160, 153, 0, 2 * Math.PI);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function triggerConfetti(startX, startY, parentElement) {
  const colors = ["#ff5964", "#35a7ff", "#38b000", "#ffc857", "#e07a5f", "#6366f1"];
  
  for (let i = 0; i < 60; i++) {
    const p = document.createElement("div");
    p.className = "confetti-particle";
    
    // Random shape (square, circle, triangle)
    const shape = Math.random();
    if (shape < 0.33) {
      p.style.borderRadius = "50%";
    } else if (shape < 0.66) {
      p.style.borderRadius = "0px";
    } else {
      // clip-path for triangle
      p.style.clipPath = "polygon(50% 0%, 0% 100%, 100% 100%)";
    }
    
    p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    p.style.width = `${6 + Math.random() * 8}px`;
    p.style.height = `${6 + Math.random() * 8}px`;
    
    // Random directions
    const angle = Math.random() * Math.PI * 2;
    const distance = 80 + Math.random() * 140;
    const destX = Math.cos(angle) * distance;
    const destY = Math.sin(angle) * distance + 50; // gravity drop
    const destR = (Math.random() * 720 - 360) + "deg";
    
    p.style.setProperty("--x", `${destX}px`);
    p.style.setProperty("--y", `${destY}px`);
    p.style.setProperty("--r", destR);
    
    p.style.left = `${startX}px`;
    p.style.top = `${startY}px`;
    
    parentElement.appendChild(p);
    
    setTimeout(() => {
      p.remove();
    }, 1200);
  }
}
