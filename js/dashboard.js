const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

let membersList = [];
let ledgerMap = {};
let lotsMap = {};

let trendChart = null;
let progressChart = null;
let duesChart = null;
let runningChart = null;

export function initDashboard(db, members, ledgers, lots) {
  membersList = members;
  ledgerMap = {};
  ledgers.forEach(l => {
    ledgerMap[l.memberId] = l;
  });

  lotsMap = {};
  lots.forEach(lot => {
    lotsMap[lot.month] = lot;
  });

  renderDashboardKPIs();
  renderDashboardCharts();
}

function renderDashboardKPIs() {
  const today = new Date();
  const is2026OrLater = today.getFullYear() >= 2026;
  const currentMonthIndex = is2026OrLater ? (today.getFullYear() > 2026 ? 11 : today.getMonth()) : 5; // Default June
  const currentMonthName = MONTHS[currentMonthIndex];

  // 1. Total Members
  document.getElementById("kpi-total-members").textContent = membersList.length;

  // 2. Monthly Target
  document.getElementById("kpi-monthly-target").textContent = "₹14,000";

  // 3. Current Collection
  let currentCollection = 0;
  membersList.forEach(m => {
    const ledger = ledgerMap[m.id] || {};
    currentCollection += (ledger[currentMonthName] || 0);
  });
  document.getElementById("kpi-current-collection").textContent = `₹${currentCollection}`;

  // 4. Outstanding Dues
  let outstanding = 0;
  membersList.forEach(m => {
    const ledger = ledgerMap[m.id] || {};
    for (let i = 0; i <= currentMonthIndex; i++) {
      const month = MONTHS[i];
      const paid = ledger[month] || 0;
      outstanding += Math.max(0, 500 - paid);
    }
  });
  document.getElementById("kpi-outstanding").textContent = `₹${outstanding}`;

  // 5. Current Balance
  // Balance before/after lot of the current month
  // Find running balances
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

  // Current balance is the latest active month's carrying balance
  // If current month lot is drawn, it is balanceAfter, else it is balanceBefore
  const currentLot = lotsMap[currentMonthName];
  const lotDrawn = currentLot && currentLot.winners && currentLot.winners.length > 0;
  const currentBal = lotDrawn ? balanceAfter[currentMonthName] : balanceBefore[currentMonthName];
  
  document.getElementById("kpi-current-balance").textContent = `₹${currentBal}`;

  // 6. Lot completion progress card
  let completedLots = 0;
  Object.keys(lotsMap).forEach(month => {
    const lot = lotsMap[month];
    if (lot && lot.winners) {
      completedLots += lot.winners.length;
    }
  });
  const remainingLots = 28 - completedLots;
  const compPercent = ((completedLots / 28) * 100).toFixed(2);
  const progressEl = document.getElementById("kpi-lot-progress");
  if (progressEl) {
    progressEl.innerHTML = `${completedLots}/28 Drawn <span style="font-size: 0.9rem; color: var(--text-secondary);">(${compPercent}%)</span>`;
  }
}

function renderDashboardCharts() {
  const ctxTrend = document.getElementById("collectionTrendChart");
  const ctxProgress = document.getElementById("monthlyProgressChart");
  const ctxDues = document.getElementById("dueAnalysisChart");
  const ctxRunning = document.getElementById("runningBalanceChart");

  if (!ctxTrend || !ctxProgress || !ctxDues || !ctxRunning) return;

  const today = new Date();
  const is2026OrLater = today.getFullYear() >= 2026;
  const currentMonthIndex = is2026OrLater ? (today.getFullYear() > 2026 ? 11 : today.getMonth()) : 5; // Default June

  // Compute monthly data
  const monthlyCollections = MONTHS.map(month => {
    let sum = 0;
    membersList.forEach(m => {
      const ledger = ledgerMap[m.id] || {};
      sum += (ledger[month] || 0);
    });
    return sum;
  });

  const monthlyTargets = MONTHS.map((month, idx) => {
    // If month is elapsed or current, target is 14000. If future, target is 14000 as well
    return 14000;
  });

  // Calculate carrying balances
  const balanceBefore = [];
  const balanceAfter = [];
  MONTHS.forEach((month, idx) => {
    const colVal = monthlyCollections[idx];
    let before = 0;
    if (idx === 0) {
      before = colVal;
    } else {
      before = balanceAfter[idx - 1] + colVal;
    }
    balanceBefore.push(before);

    const lot = lotsMap[month];
    let after = before;
    if (lot && lot.winners && lot.winners.length > 0) {
      const totalPayout = lot.winners.reduce((sum, w) => sum + (Number(w.lotAmount) || 0), 0);
      after = before - totalPayout;
    } else if (lot && lot.balanceAfter !== undefined && lot.balanceAfter !== null && lot.balanceAfter !== before) {
      after = lot.balanceAfter;
    }
    balanceAfter.push(after);
  });

  // 1. Collection Trend Chart (Bar Chart)
  if (trendChart) trendChart.destroy();
  trendChart = new Chart(ctxTrend, {
    type: 'bar',
    data: {
      labels: MONTHS.map(m => m.substring(0, 3)),
      datasets: [
        {
          label: 'Collections (₹)',
          data: monthlyCollections,
          backgroundColor: '#6366f1',
          borderRadius: 6,
        },
        {
          label: 'Target (₹)',
          data: monthlyTargets,
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          borderColor: 'rgba(255, 255, 255, 0.15)',
          borderWidth: 1,
          borderRadius: 6,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#9ca3af', font: { family: 'Outfit' } } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#9ca3af', font: { family: 'Outfit' } } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#9ca3af', font: { family: 'Outfit' } } }
      }
    }
  });

  // 2. Monthly Progress Chart (Doughnut Chart)
  const currentMonthName = MONTHS[currentMonthIndex];
  const currentMonthCollection = monthlyCollections[currentMonthIndex];
  const currentMonthRemaining = Math.max(0, 14000 - currentMonthCollection);

  if (progressChart) progressChart.destroy();
  progressChart = new Chart(ctxProgress, {
    type: 'doughnut',
    data: {
      labels: ['Collected (₹)', 'Pending (₹)'],
      datasets: [{
        data: [currentMonthCollection, currentMonthRemaining],
        backgroundColor: ['#10b981', 'rgba(239, 68, 68, 0.15)'],
        borderColor: ['#10b981', '#ef4444'],
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#9ca3af', font: { family: 'Outfit' } } },
        title: {
          display: true,
          text: `${currentMonthName} Collections`,
          color: '#f3f4f6',
          font: { family: 'Outfit', size: 14, weight: 'bold' }
        }
      }
    }
  });

  // 3. Due Analysis Chart (Horizontal Bar Chart of Top Debtors)
  const memberDues = membersList.map(m => {
    const ledger = ledgerMap[m.id] || {};
    let due = 0;
    for (let i = 0; i <= currentMonthIndex; i++) {
      const month = MONTHS[i];
      const paid = ledger[month] || 0;
      due += Math.max(0, 500 - paid);
    }
    return { name: m.name, due };
  })
  .filter(m => m.due > 0)
  .sort((a, b) => b.due - a.due)
  .slice(0, 8); // Top 8 debtors

  if (duesChart) duesChart.destroy();
  duesChart = new Chart(ctxDues, {
    type: 'bar',
    data: {
      labels: memberDues.map(m => m.name),
      datasets: [{
        label: 'Outstanding Due (₹)',
        data: memberDues.map(m => m.due),
        backgroundColor: 'rgba(239, 68, 68, 0.7)',
        borderColor: '#ef4444',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#9ca3af', font: { family: 'Outfit' } } },
        y: { grid: { display: false }, ticks: { color: '#9ca3af', font: { family: 'Outfit' } } }
      }
    }
  });

  // 4. Running Balance Chart (Line Chart of carrying funds)
  if (runningChart) runningChart.destroy();
  runningChart = new Chart(ctxRunning, {
    type: 'line',
    data: {
      labels: MONTHS.map(m => m.substring(0, 3)),
      datasets: [
        {
          label: 'Bal. Before Lot (₹)',
          data: balanceBefore,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.05)',
          fill: true,
          tension: 0.3
        },
        {
          label: 'Bal. After Lot (₹)',
          data: balanceAfter,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.05)',
          fill: true,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#9ca3af', font: { family: 'Outfit' } } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#9ca3af', font: { family: 'Outfit' } } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#9ca3af', font: { family: 'Outfit' } } }
      }
    }
  });
}
