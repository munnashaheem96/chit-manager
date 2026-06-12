import { doc, updateDoc, collection, addDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { showToast } from "./app.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

let membersList = [];
let ledgerMap = {};

let lotWinners = new Set();

export function initQuickEntry(db, members, ledgers, lots) {
  membersList = members.sort((a, b) => a.serialNo - b.serialNo);
  
  ledgerMap = {};
  ledgers.forEach(l => {
    ledgerMap[l.memberId] = l;
  });

  lotWinners = new Set();
  if (lots) {
    lots.forEach(lot => {
      if (lot && lot.winners && lot.winners.length > 0) {
        lot.winners.forEach(winner => {
          lotWinners.add(Number(winner.serialNo));
        });
      }
    });
  }

  renderQuickEntry(db);
}

function renderQuickEntry(db) {
  const container = document.getElementById("quick-entry-list");
  if (!container) return;

  container.innerHTML = "";

  membersList.forEach((member, index) => {
    const row = document.createElement("div");
    row.className = "quick-entry-row";
    row.dataset.serialNo = member.serialNo;

    const isWinner = lotWinners.has(member.serialNo);

    row.innerHTML = `
      <div class="quick-entry-info">
        <span class="quick-entry-sl">${member.serialNo}</span>
        <span class="quick-entry-name">${member.name} ${isWinner ? '<span class="winner-badge" title="Lot Received" style="cursor: help;">🏆</span>' : ''}</span>
      </div>
      <div class="quick-entry-form">
        <div class="quick-entry-input-wrapper">
          <span>₹</span>
          <input type="number" 
                 class="quick-entry-input" 
                 data-member-id="${member.id}" 
                 data-index="${index}" 
                 placeholder="0"
                 min="0">
        </div>
        <button class="btn-primary btn-save-quick" data-member-id="${member.id}" data-index="${index}">
          Save
        </button>
      </div>
    `;

    container.appendChild(row);
  });

  setupQuickEntryEvents(db);
}

function setupQuickEntryEvents(db) {
  const inputs = document.querySelectorAll(".quick-entry-input");
  const saveButtons = document.querySelectorAll(".btn-save-quick");

  // Save on button click
  saveButtons.forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const idx = btn.dataset.index;
      const input = document.querySelector(`.quick-entry-input[data-index="${idx}"]`);
      await handleQuickSave(db, input, idx);
    });
  });

  // Save on Enter, and automatically focus the next row
  inputs.forEach(input => {
    input.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const idx = parseInt(input.dataset.index);
        await handleQuickSave(db, input, idx);
      }
    });
  });
}

async function handleQuickSave(db, input, index) {
  const amount = parseInt(input.value) || 0;
  const memberId = input.dataset.memberId;

  if (amount <= 0) {
    showToast("Please enter an amount greater than 0", "error");
    return;
  }

  // Disable input during save
  input.disabled = true;

  try {
    const allocations = await allocatePayment(db, memberId, amount);
    
    // Clear input
    input.value = "";
    showToast(`Successfully allocated ₹${amount} for member!`, "success");

    // Automatically focus next input
    const nextIndex = index + 1;
    const nextInput = document.querySelector(`.quick-entry-input[data-index="${nextIndex}"]`);
    if (nextInput) {
      nextInput.focus();
    } else {
      // If end of list, focus first input
      const firstInput = document.querySelector(`.quick-entry-input[data-index="0"]`);
      if (firstInput) firstInput.focus();
    }
  } catch (error) {
    console.error("Error saving quick collection:", error);
    showToast(`Error: ${error.message}`, "error");
  } finally {
    input.disabled = false;
  }
}

/**
 * Smart Payment Allocation Engine
 * Allocates incoming payments to the oldest unpaid month first.
 */
export async function allocatePayment(db, memberId, amount) {
  // 1. Fetch current ledger
  const ledgerRef = doc(db, "monthlyLedger", memberId);
  const ledgerSnap = await getDoc(ledgerRef);
  
  if (!ledgerSnap.exists()) {
    throw new Error("Member ledger does not exist in Firestore.");
  }

  const ledgerData = ledgerSnap.data();
  const originalLedger = { ...ledgerData };
  let remainingAmount = amount;
  const allocations = [];

  // 2. Greedy allocation to months January (0) to December (11)
  for (const month of MONTHS) {
    const currentPaid = ledgerData[month] || 0;
    if (currentPaid < 500) {
      const needed = 500 - currentPaid;
      const allocated = Math.min(remainingAmount, needed);
      
      ledgerData[month] = currentPaid + allocated;
      remainingAmount -= allocated;

      allocations.push({ month, allocated });

      if (remainingAmount <= 0) {
        break;
      }
    }
  }

  // 3. Excess handling (Advance payments)
  // If there's still money left, add it as excess to December (future advance) or store it
  if (remainingAmount > 0) {
    ledgerData["December"] = (ledgerData["December"] || 0) + remainingAmount;
    allocations.push({ month: "December (Excess)", allocated: remainingAmount });
  }

  // 4. Update ledger in Firestore
  await updateDoc(ledgerRef, ledgerData);

  // 5. Write payment transaction
  const noteStr = allocations.map(a => `${a.month}: ₹${a.allocated}`).join(", ");
  await addDoc(collection(db, "payments"), {
    memberId: memberId,
    amount: amount,
    paymentDate: new Date().toISOString(),
    note: `Smart Allocation: ${noteStr}`
  });

  // Keep local memory ledger updated
  ledgerMap[memberId] = ledgerData;

  return allocations;
}
