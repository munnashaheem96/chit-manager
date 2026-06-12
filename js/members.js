import { doc, getDoc, getDocs, collection, query, where, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { showToast } from "./app.js";
import { exportCSV, exportPDF } from "./export.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

let membersList = [];
let ledgerMap = {};
let lotsList = [];
let selectedMemberId = null;

export function initMembers(db, members, ledgers, lots) {
  membersList = members.sort((a, b) => a.serialNo - b.serialNo);
  ledgerMap = {};
  ledgers.forEach(l => {
    ledgerMap[l.memberId] = l;
  });
  lotsList = lots || [];

  const lotWinners = new Set();
  lotsList.forEach(lot => {
    if (lot && lot.winners && lot.winners.length > 0) {
      lot.winners.forEach(winner => {
        lotWinners.add(Number(winner.serialNo));
      });
    }
  });

  const select = document.getElementById("member-select");
  if (!select) return;

  select.innerHTML = `<option value="">-- Select Member --</option>`;
  membersList.forEach(m => {
    const isWinner = lotWinners.has(m.serialNo);
    select.innerHTML += `<option value="${m.id}">SL ${m.serialNo} - ${m.name} ${isWinner ? '🏆' : ''}</option>`;
  });

  select.addEventListener("change", (e) => {
    selectedMemberId = e.target.value;
    if (selectedMemberId) {
      showMemberProfile(db, selectedMemberId);
    } else {
      clearMemberProfile();
    }
  });

  // Export buttons
  const btnPdf = document.getElementById("btn-member-pdf");
  const btnCsv = document.getElementById("btn-member-csv");

  if (btnPdf) {
    btnPdf.addEventListener("click", () => {
      if (selectedMemberId) exportMemberStatement(db, selectedMemberId, "pdf");
    });
  }

  if (btnCsv) {
    btnCsv.addEventListener("click", () => {
      if (selectedMemberId) exportMemberStatement(db, selectedMemberId, "csv");
    });
  }
}

export async function showMemberProfile(db, memberId) {
  try {
    const member = membersList.find(m => m.id === memberId);
    if (!member) return;

    // Fetch payments list (query without orderBy to avoid composite index requirements in Firestore)
    const paymentsRef = collection(db, "payments");
    const q = query(paymentsRef, where("memberId", "==", memberId));
    const querySnap = await getDocs(q);
    const payments = [];
    let totalPaid = 0;
    querySnap.forEach(d => {
      const data = d.data();
      payments.push(data);
      totalPaid += data.amount;
    });

    // Sort in-memory descending by paymentDate
    payments.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

    const ledger = ledgerMap[memberId] || {};

    // Get current date context
    const today = new Date();
    const is2026OrLater = today.getFullYear() >= 2026;
    const currentMonthIndex = is2026OrLater ? (today.getFullYear() > 2026 ? 11 : today.getMonth()) : 5; // June default

    // Computations
    const targetContributionSoFar = (currentMonthIndex + 1) * 500;
    let dueAmount = 0;
    for (let i = 0; i <= currentMonthIndex; i++) {
      const monthName = MONTHS[i];
      const paidVal = ledger[monthName] || 0;
      dueAmount += Math.max(0, 500 - paidVal);
    }

    const advanceAmount = Math.max(0, totalPaid - (targetContributionSoFar - dueAmount));

    // Update Profile UI
    document.getElementById("profile-name").textContent = member.name;
    document.getElementById("profile-serial").textContent = `#${member.serialNo}`;
    document.getElementById("val-total-paid").textContent = `₹${totalPaid}`;
    document.getElementById("val-due-amount").textContent = `₹${dueAmount}`;
    document.getElementById("val-advance-amount").textContent = `₹${advanceAmount}`;
    document.getElementById("val-status").textContent = member.active ? "ACTIVE" : "INACTIVE";

    // Set status card text color
    const statusVal = document.getElementById("val-status");
    if (member.active) {
      statusVal.style.color = "var(--color-paid)";
    } else {
      statusVal.style.color = "var(--color-due)";
    }

    // Check Lot status details
    let lotWonInfo = null;
    lotsList.forEach(lot => {
      if (lot && lot.winners) {
        const winEntry = lot.winners.find(w => Number(w.serialNo) === member.serialNo);
        if (winEntry) {
          lotWonInfo = {
            month: lot.month,
            amount: winEntry.lotAmount,
            date: winEntry.lotDate
          };
        }
      }
    });

    const lotStatusVal = document.getElementById("profile-lot-status");
    if (lotStatusVal) {
      if (lotWonInfo) {
        lotStatusVal.innerHTML = `Received in ${lotWonInfo.month} (₹${lotWonInfo.amount}) <span style="font-size: 1.1rem;">🏆</span>`;
        lotStatusVal.style.color = "var(--color-paid)";
      } else {
        lotStatusVal.textContent = "Pending Draw";
        lotStatusVal.style.color = "var(--color-due)";
      }
    }

    // Render chronological payment list
    const paymentListEl = document.getElementById("member-payment-list");
    paymentListEl.innerHTML = "";
    if (payments.length === 0) {
      paymentListEl.innerHTML = `<div class="payment-list-item" style="color: var(--text-muted);">No payment records found.</div>`;
    } else {
      payments.forEach(p => {
        const dateStr = new Date(p.paymentDate).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });
        paymentListEl.innerHTML += `
          <div class="payment-list-item">
            <div>
              <div style="font-weight: 600;">${p.note || "Kuri Payment"}</div>
              <div class="payment-list-date">${dateStr}</div>
            </div>
            <div class="payment-list-amount">₹${p.amount}</div>
          </div>
        `;
      });
    }

    // Render ledger months grid
    const ledgerGridEl = document.getElementById("member-ledger-grid");
    ledgerGridEl.innerHTML = "";

    MONTHS.forEach((month, idx) => {
      const paidVal = ledger[month] || 0;
      let statusClass = "";
      let statusText = "Due";

      if (idx <= currentMonthIndex) {
        if (paidVal >= 500) {
          statusClass = "status-paid";
          statusText = "Paid";
        } else if (paidVal > 0) {
          statusClass = "status-partial";
          statusText = "Partial";
        } else {
          statusClass = "status-due";
          statusText = "Due";
        }
      } else {
        if (paidVal > 0) {
          statusClass = "status-advance";
          statusText = "Advance";
        } else {
          statusClass = "";
          statusText = "Not Due";
        }
      }

      ledgerGridEl.innerHTML += `
        <div class="ledger-month-badge ${statusClass}">
          <span>${month.substring(0, 3).toUpperCase()}</span>
          <span>₹${paidVal}</span>
          <span style="font-size: 0.7rem; opacity: 0.8; font-weight: 500;">${statusText}</span>
        </div>
      `;
    });

    // Show panel
    document.getElementById("member-profile-details").style.display = "flex";
  } catch (error) {
    console.error("Error loading member profile:", error);
    showToast(`Failed to load profile: ${error.message}`, "error");
  }
}

function clearMemberProfile() {
  document.getElementById("member-profile-details").style.display = "none";
}

async function exportMemberStatement(db, memberId, format) {
  try {
    const member = membersList.find(m => m.id === memberId);
    if (!member) return;

    showToast("Generating statement...", "info");

    const paymentsRef = collection(db, "payments");
    const q = query(paymentsRef, where("memberId", "==", memberId));
    const querySnap = await getDocs(q);
    const rawPayments = [];
    
    querySnap.forEach(d => {
      rawPayments.push(d.data());
    });

    // Sort in-memory ascending by paymentDate
    rawPayments.sort((a, b) => new Date(a.paymentDate) - new Date(b.paymentDate));

    const payments = [];
    let runningTotal = 0;
    rawPayments.forEach(data => {
      runningTotal += data.amount;
      payments.push({
        date: new Date(data.paymentDate).toLocaleDateString("en-IN"),
        amount: data.amount,
        runningTotal: runningTotal,
        note: data.note || "Regular Contribution"
      });
    });

    const ledger = ledgerMap[memberId] || {};

    if (format === "csv") {
      const headers = ["Date", "Description", "Amount (₹)", "Running Total (₹)"];
      const rows = payments.map(p => [p.date, p.note, p.amount, p.runningTotal]);
      exportCSV(`Statement_${member.name.replace(/\s+/g, "_")}`, headers, rows);
    } else if (format === "pdf") {
      const title = `${member.name} - Kuri Statement`;
      const subtitle = `Serial Number: ${member.serialNo} | Date Generated: ${new Date().toLocaleDateString("en-IN")}`;
      const headers = ["Date", "Description", "Amount (₹)", "Running Balance (₹)"];
      const rows = payments.map(p => [p.date, p.note, `Rs. ${p.amount}`, `Rs. ${p.runningTotal}`]);
      exportPDF(`Statement_${member.name.replace(/\s+/g, "_")}`, title, subtitle, headers, rows);
    }

    showToast("Statement exported successfully!", "success");
  } catch (error) {
    console.error("Error exporting statement:", error);
    showToast(`Export failed: ${error.message}`, "error");
  }
}
