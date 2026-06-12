import { showToast } from "./app.js";
import { exportCSV, exportPDF } from "./export.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

let membersList = [];
let ledgerMap = {};
let lotsMap = {};
let currentReportType = "due"; // 'due', 'monthly', 'lot', 'summary'

export function initReports(db, members, ledgers, lots) {
  membersList = members.sort((a, b) => a.serialNo - b.serialNo);
  
  ledgerMap = {};
  ledgers.forEach(l => {
    ledgerMap[l.memberId] = l;
  });

  lotsMap = {};
  lots.forEach(lot => {
    lotsMap[lot.month] = lot;
  });

  setupReportEvents(db);
  generateReport(db);
}

function setupReportEvents(db) {
  const reportBtns = document.querySelectorAll(".report-btn");
  reportBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      reportBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentReportType = btn.dataset.report;
      generateReport(db);
    });
  });

  const btnExportPdf = document.getElementById("btn-report-pdf");
  const btnExportCsv = document.getElementById("btn-report-csv");

  btnExportPdf.onclick = () => exportCurrentReport("pdf");
  btnExportCsv.onclick = () => exportCurrentReport("csv");
}

function generateReport(db) {
  const tableHead = document.getElementById("report-thead");
  const tableBody = document.getElementById("report-tbody");
  
  if (!tableHead || !tableBody) return;

  tableHead.innerHTML = "";
  tableBody.innerHTML = "";

  const today = new Date();
  const is2026OrLater = today.getFullYear() >= 2026;
  const currentMonthIndex = is2026OrLater ? (today.getFullYear() > 2026 ? 11 : today.getMonth()) : 5; // Default June

  if (currentReportType === "due") {
    // 1. Due Report
    tableHead.innerHTML = `
      <tr>
        <th>SL</th>
        <th>Member Name</th>
        <th class="amount-cell">Expected So Far (₹)</th>
        <th class="amount-cell">Total Paid (₹)</th>
        <th class="amount-cell">Outstanding Due (₹)</th>
      </tr>
    `;

    const expected = (currentMonthIndex + 1) * 500;
    let grandDue = 0;
    let grandPaid = 0;

    membersList.forEach(m => {
      const ledger = ledgerMap[m.id] || {};
      let totalPaidForYear = 0;
      MONTHS.forEach(month => {
        totalPaidForYear += (ledger[month] || 0);
      });

      let due = 0;
      for (let i = 0; i <= currentMonthIndex; i++) {
        const month = MONTHS[i];
        due += Math.max(0, 500 - (ledger[month] || 0));
      }

      grandDue += due;
      grandPaid += totalPaidForYear;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${m.serialNo}</td>
        <td style="font-weight: 600;">${m.name}</td>
        <td class="amount-cell">₹${expected}</td>
        <td class="amount-cell" style="font-family: 'JetBrains Mono', monospace;">₹${totalPaidForYear}</td>
        <td class="amount-cell" style="font-family: 'JetBrains Mono', monospace; color: ${due > 0 ? 'var(--color-due)' : 'var(--color-paid)'}; font-weight: 600;">
          ₹${due}
        </td>
      `;
      tableBody.appendChild(tr);
    });

    // Add Totals
    const trTotal = document.createElement("tr");
    trTotal.className = "summary-row";
    trTotal.innerHTML = `
      <td></td>
      <td>TOTAL OUTSTANDING</td>
      <td class="amount-cell">₹${expected * membersList.length}</td>
      <td class="amount-cell">₹${grandPaid}</td>
      <td class="amount-cell" style="color: var(--color-due);">₹${grandDue}</td>
    `;
    tableBody.appendChild(trTotal);

  } else if (currentReportType === "monthly") {
    // 2. Monthly Collection Report
    tableHead.innerHTML = `
      <tr>
        <th>Month</th>
        <th class="amount-cell">Target Collection (₹)</th>
        <th class="amount-cell">Actual Collection (₹)</th>
        <th class="amount-cell">Pending Collection (₹)</th>
        <th class="amount-cell">Status</th>
      </tr>
    `;

    let grandTarget = 0;
    let grandActual = 0;
    let grandPending = 0;

    MONTHS.forEach((month, idx) => {
      const target = 14000;
      let actual = 0;
      membersList.forEach(m => {
        const ledger = ledgerMap[m.id] || {};
        actual += (ledger[month] || 0);
      });

      const isFuture = idx > currentMonthIndex;
      const pending = isFuture ? 0 : Math.max(0, target - actual);
      
      grandTarget += target;
      grandActual += actual;
      grandPending += pending;

      let statusText = "Pending";
      let statusClass = "status-due";
      
      if (isFuture) {
        statusText = "Not Due";
        statusClass = "";
      } else if (actual >= target) {
        statusText = "Completed";
        statusClass = "status-paid";
      } else if (actual > 0) {
        statusText = "Partial";
        statusClass = "status-partial";
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="font-weight: 600;">${month}</td>
        <td class="amount-cell">₹${target}</td>
        <td class="amount-cell" style="font-family: 'JetBrains Mono', monospace;">₹${actual}</td>
        <td class="amount-cell" style="font-family: 'JetBrains Mono', monospace; color: ${pending > 0 ? 'var(--color-due)' : 'var(--text-muted)'}">₹${pending}</td>
        <td><span class="ledger-month-badge ${statusClass}" style="padding: 4px 8px; font-size: 0.75rem; display: inline-block;">${statusText}</span></td>
      `;
      tableBody.appendChild(tr);
    });

    const trTotal = document.createElement("tr");
    trTotal.className = "summary-row";
    trTotal.innerHTML = `
      <td>TOTALS</td>
      <td class="amount-cell">₹${grandTarget}</td>
      <td class="amount-cell">₹${grandActual}</td>
      <td class="amount-cell" style="color: var(--color-due);">₹${grandPending}</td>
      <td></td>
    `;
    tableBody.appendChild(trTotal);

  } else if (currentReportType === "lot") {
    // 3. Lot History Report
    tableHead.innerHTML = `
      <tr>
        <th>Month</th>
        <th>Winner Name</th>
        <th>Winner SL</th>
        <th class="amount-cell">Winner Payout (₹)</th>
        <th class="amount-cell">Bal. Before Lot (₹)</th>
        <th class="amount-cell">Bal. After Lot (₹)</th>
        <th>Draw Date</th>
      </tr>
    `;

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

      const lot = lotsMap[month] || {};
      let after = before;
      
      const isDrawn = lot.winners && lot.winners.length > 0;

      if (isDrawn) {
        const totalPayout = lot.winners.reduce((sum, w) => sum + (Number(w.lotAmount) || 0), 0);
        after = before - totalPayout;
      } else if (lot.balanceAfter !== undefined && lot.balanceAfter !== null && lot.balanceAfter !== before) {
        after = lot.balanceAfter;
      }
      balanceAfter[month] = after;

      if (isDrawn) {
        lot.winners.forEach((w, wIdx) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td style="font-weight: 600;">${wIdx === 0 ? month : ""}</td>
            <td style="font-weight: 600;">${w.name}</td>
            <td>SL ${w.serialNo}</td>
            <td class="amount-cell" style="font-family: 'JetBrains Mono', monospace; font-weight: 600; color: var(--color-advance);">₹${w.lotAmount}</td>
            <td class="amount-cell" style="font-family: 'JetBrains Mono', monospace;">${wIdx === 0 ? '₹' + before : ""}</td>
            <td class="amount-cell" style="font-family: 'JetBrains Mono', monospace; font-weight: 600; color: var(--color-paid);">${wIdx === lot.winners.length - 1 ? '₹' + after : ""}</td>
            <td>${w.lotDate}</td>
          `;
          tableBody.appendChild(tr);
        });
      } else {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td style="font-weight: 600;">${month}</td>
          <td style="color: var(--text-muted);">No Winners Drawn</td>
          <td>—</td>
          <td class="amount-cell">—</td>
          <td class="amount-cell" style="font-family: 'JetBrains Mono', monospace;">₹${before}</td>
          <td class="amount-cell" style="font-family: 'JetBrains Mono', monospace; color: var(--text-muted);">Pending</td>
          <td>—</td>
        `;
        tableBody.appendChild(tr);
      }
    });

  } else if (currentReportType === "summary") {
    // 4. Year Summary Report
    tableHead.innerHTML = `
      <tr>
        <th>Summary Parameter</th>
        <th class="amount-cell">Report Value</th>
      </tr>
    `;

    let totalPaidForYear = 0;
    membersList.forEach(m => {
      const ledger = ledgerMap[m.id] || {};
      MONTHS.forEach(month => {
        totalPaidForYear += (ledger[month] || 0);
      });
    });

    const totalTarget = 28 * 12 * 500; // 1,68,000

    let outstanding = 0;
    membersList.forEach(m => {
      const ledger = ledgerMap[m.id] || {};
      for (let i = 0; i <= currentMonthIndex; i++) {
        const month = MONTHS[i];
        const paid = ledger[month] || 0;
        outstanding += Math.max(0, 500 - paid);
      }
    });

    let lotsDrawnCount = 0;
    Object.keys(lotsMap).forEach(m => {
      if (lotsMap[m] && lotsMap[m].winners) {
        lotsDrawnCount += lotsMap[m].winners.length;
      }
    });

    // Resolve current carrying balance
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
      if (lot && lot.winners && lot.winners.length > 0) {
        const totalPayout = lot.winners.reduce((sum, w) => sum + (Number(w.lotAmount) || 0), 0);
        after = before - totalPayout;
      } else if (lot && lot.balanceAfter !== undefined && lot.balanceAfter !== null && lot.balanceAfter !== before) {
        after = lot.balanceAfter;
      }
      balanceAfter[month] = after;
    });

    const currentMonthName = MONTHS[currentMonthIndex];
    const currentLot = lotsMap[currentMonthName];
    const lotDrawn = currentLot && currentLot.winners && currentLot.winners.length > 0;
    const carryingBalance = lotDrawn ? balanceAfter[currentMonthName] : balanceBefore[currentMonthName];

    const parameters = [
      { param: "Total Registered Members", val: `${membersList.length} Active` },
      { param: "Yearly Target Chit Collection", val: `₹${totalTarget}` },
      { param: "Expected Collection So Far", val: `₹${(currentMonthIndex + 1) * 14000}` },
      { param: "Actual Collection Received", val: `₹${totalPaidForYear}` },
      { param: "Outstanding Member Dues", val: `₹${outstanding}` },
      { param: "Total Lot Draws Completed", val: `${lotsDrawnCount} / 12 Months` },
      { param: "Carrying Fund Balance (Cash)", val: `₹${carryingBalance}` }
    ];

    parameters.forEach(p => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="font-weight: 600;">${p.param}</td>
        <td class="amount-cell" style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--primary-color);">${p.val}</td>
      `;
      tableBody.appendChild(tr);
    });
  } else if (currentReportType === "eligible") {
    // 5. Eligible Members Report
    tableHead.innerHTML = `
      <tr>
        <th>SL</th>
        <th>Member Name</th>
        <th>Draw Status</th>
        <th class="amount-cell">Total Contribution So Far (₹)</th>
      </tr>
    `;

    // Compile winners in all months
    const allWinners = new Set();
    Object.keys(lotsMap).forEach(m => {
      const lot = lotsMap[m];
      if (lot && lot.winners) {
        lot.winners.forEach(w => allWinners.add(Number(w.serialNo)));
      }
    });

    const eligible = membersList.filter(m => !allWinners.has(m.serialNo));

    if (eligible.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">All members have received their lot!</td></tr>`;
    } else {
      eligible.forEach(m => {
        const ledger = ledgerMap[m.id] || {};
        let totalPaid = 0;
        MONTHS.forEach(month => {
          totalPaid += (ledger[month] || 0);
        });

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${m.serialNo}</td>
          <td style="font-weight: 600;">${m.name}</td>
          <td style="color: var(--color-paid); font-weight: 500;">Eligible for Draw</td>
          <td class="amount-cell" style="font-family: 'JetBrains Mono', monospace;">₹${totalPaid}</td>
        `;
        tableBody.appendChild(tr);
      });
    }
  }
}

function exportCurrentReport(format) {
  const headers = [];
  const rows = [];

  const tableHead = document.querySelector("#report-table thead");
  const tableBody = document.querySelector("#report-table tbody");

  if (!tableHead || !tableBody) return;

  // Extract headers
  tableHead.querySelectorAll("th").forEach(th => {
    headers.push(th.textContent.trim());
  });

  // Extract rows
  tableBody.querySelectorAll("tr").forEach(tr => {
    const row = [];
    tr.querySelectorAll("td").forEach(td => {
      row.push(td.textContent.trim().replace("₹", "").replace("Rs.", ""));
    });
    rows.push(row);
  });

  const title = `KL2 Kuri - ${currentReportType.toUpperCase()} REPORT`;
  const filename = `Kuri_${currentReportType}_report`;

  if (format === "csv") {
    exportCSV(filename, headers, rows);
    showToast("Report exported to CSV!", "success");
  } else if (format === "pdf") {
    const subtitle = `Generated on ${new Date().toLocaleDateString("en-IN")}`;
    exportPDF(filename, title, subtitle, headers, rows);
    showToast("Report exported to PDF!", "success");
  }
}
