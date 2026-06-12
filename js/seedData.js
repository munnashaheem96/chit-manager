import { doc, getDoc, setDoc, addDoc, collection } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const MONTH_MAP = {
  "JAN": "January",
  "FEB": "February",
  "MAR": "March",
  "APR": "April",
  "MAY": "May",
  "JUN": "June",
  "JUL": "July",
  "AUG": "August",
  "SEP": "September",
  "OCT": "October",
  "NOV": "November",
  "DEC": "December"
};

const MONTH_NUMBERS = {
  "January": "01",
  "February": "02",
  "March": "03",
  "April": "04",
  "May": "05",
  "June": "06",
  "July": "07",
  "August": "08",
  "September": "09",
  "October": "10",
  "November": "11",
  "December": "12"
};

export async function checkAndSeed(db, onProgress = () => {}) {
  try {
    onProgress("Checking database status...");
    const settingsRef = doc(db, "settings", "kuriSettings");
    const settingsSnap = await getDoc(settingsRef);

    if (settingsSnap.exists() && settingsSnap.data().seedCompleted) {
      onProgress("Database already seeded. Loading application...");
      return false;
    }

    onProgress("Fetching initial data from Kuri_KL.json...");
    const response = await fetch("./data/Kuri_KL.json");
    if (!response.ok) {
      throw new Error(`Failed to fetch Kuri_KL.json: ${response.statusText}`);
    }
    const data = await response.json();

    // 1. Filter for members (rows with numeric "Sl No.")
    const memberRows = data.filter(row => row["Sl No."] !== null && typeof row["Sl No."] === "number");
    const totalMembers = memberRows.length;
    onProgress(`Found ${totalMembers} members. Starting seeding...`);

    // Seed settings first
    await setDoc(settingsRef, {
      seedCompleted: true,
      kuriName: "KL2 Kuri",
      monthlyContribution: 500,
      monthlyTarget: 14000,
      year: 2026
    });

    // Seed members, monthlyLedgers, and initial payments
    for (let i = 0; i < totalMembers; i++) {
      const row = memberRows[i];
      const serialNo = row["Sl No."];
      const name = row["Name"];
      const memberId = `member_${serialNo}`;

      onProgress(`Seeding member ${i + 1}/${totalMembers}: ${name}`);

      // Save Member
      await setDoc(doc(db, "members", memberId), {
        id: memberId,
        serialNo: Number(serialNo),
        name: name,
        active: true
      });

      // Prepare Ledger
      const ledger = {
        memberId: memberId,
        January: 0,
        February: 0,
        March: 0,
        April: 0,
        May: 0,
        June: 0,
        July: 0,
        August: 0,
        September: 0,
        October: 0,
        November: 0,
        December: 0
      };

      // Populate Ledger & Generate Payments
      for (const [jsonKey, fullMonth] of Object.entries(MONTH_MAP)) {
        const value = row[jsonKey];
        if (value !== null && value !== undefined && typeof value === "number" && value > 0) {
          ledger[fullMonth] = value;

          // Create payment record
          const monthNum = MONTH_NUMBERS[fullMonth];
          const paymentDate = `2026-${monthNum}-10T10:00:00.000Z`; // Seeded around the 10th
          await addDoc(collection(db, "payments"), {
            memberId: memberId,
            amount: value,
            paymentDate: paymentDate,
            note: `Initial seeding for ${fullMonth}`
          });
        }
      }

      // Save Ledger
      await setDoc(doc(db, "monthlyLedger", memberId), ledger);
    }

    // Seed Lots based on historical data & repeating lot schedule
    onProgress("Seeding lot history...");
    const lotHistory = [
      {
        month: "January",
        numberOfLots: 2,
        balanceBefore: 14000,
        balanceAfter: 2000,
        winners: [
          { serialNo: 2, name: "Munna", lotAmount: 6000, lotDate: "2026-01-15" },
          { serialNo: 3, name: "Aslam", lotAmount: 6000, lotDate: "2026-01-15" }
        ]
      },
      {
        month: "February",
        numberOfLots: 2,
        balanceBefore: 16000,
        balanceAfter: 4000,
        winners: [
          { serialNo: 4, name: "Munna 2 (c/o)", lotAmount: 6000, lotDate: "2026-02-15" },
          { serialNo: 7, name: "Shibil", lotAmount: 6000, lotDate: "2026-02-15" }
        ]
      },
      {
        month: "March",
        numberOfLots: 3,
        balanceBefore: 18000,
        balanceAfter: 0,
        winners: [
          { serialNo: 9, name: "Midlaj", lotAmount: 6000, lotDate: "2026-03-15" },
          { serialNo: 11, name: "Shadhil", lotAmount: 6000, lotDate: "2026-03-15" },
          { serialNo: 14, name: "Midlaj 2", lotAmount: 6000, lotDate: "2026-03-15" }
        ]
      },
      {
        month: "April",
        numberOfLots: 2,
        balanceBefore: 14000,
        balanceAfter: 2000,
        winners: [
          { serialNo: 16, name: "Shadil 2", lotAmount: 6000, lotDate: "2026-04-15" },
          { serialNo: 23, name: "Munna 3 (c/o)", lotAmount: 6000, lotDate: "2026-04-15" }
        ]
      },
      {
        month: "May",
        numberOfLots: 2,
        balanceBefore: 16000,
        balanceAfter: 4000,
        winners: [
          { serialNo: 26, name: "Shehzin", lotAmount: 6000, lotDate: "2026-05-15" },
          { serialNo: 28, name: "Sinan C/O Munna", lotAmount: 6000, lotDate: "2026-05-15" }
        ]
      },
      { month: "June", numberOfLots: 3, balanceBefore: 0, balanceAfter: 0, winners: [] },
      { month: "July", numberOfLots: 2, balanceBefore: 0, balanceAfter: 0, winners: [] },
      { month: "August", numberOfLots: 2, balanceBefore: 0, balanceAfter: 0, winners: [] },
      { month: "September", numberOfLots: 3, balanceBefore: 0, balanceAfter: 0, winners: [] },
      { month: "October", numberOfLots: 2, balanceBefore: 0, balanceAfter: 0, winners: [] },
      { month: "November", numberOfLots: 2, balanceBefore: 0, balanceAfter: 0, winners: [] },
      { month: "December", numberOfLots: 3, balanceBefore: 0, balanceAfter: 0, winners: [] }
    ];

    for (const lot of lotHistory) {
      await setDoc(doc(db, "lots", lot.month), lot);
    }

    onProgress("Seeding completed successfully!");
    return true;
  } catch (error) {
    console.error("Error during seeding data:", error);
    onProgress(`Error during seeding: ${error.message}`);
    throw error;
  }
}
