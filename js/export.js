import { doc, setDoc, collection, getDocs, writeBatch, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { showToast } from "./app.js";

// Export CSV
export function exportCSV(filename, headers, rows) {
  const csvContent = "data:text/csv;charset=utf-8," 
    + [headers.join(","), ...rows.map(e => e.map(val => `"${val}"`).join(","))].join("\n");
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Export PDF (using jsPDF + jspdf-autotable)
export function exportPDF(filename, title, subtitle, headers, rows) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Color Palette
  const primaryColor = [99, 102, 241]; // Indigo

  // Add Document Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(31, 41, 55);
  doc.text(title, 14, 22);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  doc.text(subtitle, 14, 28);

  // Divider Line
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.5);
  doc.line(14, 32, 196, 32);

  // Table Generation
  doc.autoTable({
    startY: 36,
    head: [headers],
    body: rows,
    theme: 'striped',
    headStyles: {
      fillColor: primaryColor,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9
    },
    bodyStyles: {
      fontSize: 9,
      textColor: [55, 65, 81]
    },
    alternateRowStyles: {
      fillColor: [249, 250, 251]
    },
    margin: { left: 14, right: 14 }
  });

  // Save PDF
  doc.save(`${filename}.pdf`);
}

// Export Excel (using SheetJS)
export function exportExcel(filename, sheetname, headers, rows) {
  const wsData = [headers, ...rows];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  
  XLSX.utils.book_append_sheet(wb, ws, sheetname);
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

// Export Full Database Backup (JSON)
export async function exportBackupJSON(db) {
  try {
    showToast("Generating full database backup...", "info");

    const backup = {
      settings: [],
      members: [],
      payments: [],
      monthlyLedger: [],
      lots: []
    };

    // Helper to query all docs in a collection
    const getCollectionDocs = async (colName) => {
      const snap = await getDocs(collection(db, colName));
      const docs = [];
      snap.forEach(d => {
        docs.push({ id: d.id, ...d.data() });
      });
      return docs;
    };

    backup.settings = await getCollectionDocs("settings");
    backup.members = await getCollectionDocs("members");
    backup.payments = await getCollectionDocs("payments");
    backup.monthlyLedger = await getCollectionDocs("monthlyLedger");
    backup.lots = await getCollectionDocs("lots");

    const jsonString = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.href = url;
    link.download = `KL2_Kuri_Backup_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast("Backup file downloaded successfully!", "success");
  } catch (error) {
    console.error("Backup failed:", error);
    showToast(`Backup failed: ${error.message}`, "error");
  }
}

// Import Database Backup (JSON)
export async function importBackupJSON(db, file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const backup = JSON.parse(e.target.result);

        // Simple validation
        if (!backup.settings || !backup.members || !backup.payments || !backup.monthlyLedger || !backup.lots) {
          throw new Error("Invalid backup file format. Missing core collections.");
        }

        showToast("Restoring database backup...", "info");

        // Helper to purge existing collections
        const purgeCollection = async (colName) => {
          const snap = await getDocs(collection(db, colName));
          const batch = writeBatch(db);
          snap.forEach(d => {
            batch.delete(d.ref);
          });
          await batch.commit();
        };

        // Purge existing data
        await purgeCollection("settings");
        await purgeCollection("members");
        await purgeCollection("payments");
        await purgeCollection("monthlyLedger");
        await purgeCollection("lots");

        // Seed settings
        const batchSettings = writeBatch(db);
        backup.settings.forEach(s => {
          const { id, ...data } = s;
          batchSettings.set(doc(db, "settings", id), data);
        });
        await batchSettings.commit();

        // Seed members
        const batchMembers = writeBatch(db);
        backup.members.forEach(m => {
          const { id, ...data } = m;
          batchMembers.set(doc(db, "members", id), data);
        });
        await batchMembers.commit();

        // Seed monthlyLedger
        const batchLedger = writeBatch(db);
        backup.monthlyLedger.forEach(l => {
          const { id, ...data } = l;
          batchLedger.set(doc(db, "monthlyLedger", id), data);
        });
        await batchLedger.commit();

        // Seed lots
        const batchLots = writeBatch(db);
        backup.lots.forEach(lot => {
          const { id, ...data } = lot;
          batchLots.set(doc(db, "lots", id), data);
        });
        await batchLots.commit();

        // Seed payments (might be larger, batch in chunks)
        let count = 0;
        let batchPayments = writeBatch(db);
        for (const p of backup.payments) {
          const { id, ...data } = p;
          batchPayments.set(doc(db, "payments", id), data);
          count++;
          if (count % 400 === 0) {
            await batchPayments.commit();
            batchPayments = writeBatch(db);
          }
        }
        if (count % 400 !== 0) {
          await batchPayments.commit();
        }

        showToast("Database restored! Reloading application...", "success");
        setTimeout(() => {
          window.location.reload();
        }, 1500);

        resolve(true);
      } catch (err) {
        console.error("Import failed:", err);
        showToast(`Import failed: ${err.message}`, "error");
        reject(err);
      }
    };
    reader.onerror = () => {
      showToast("Failed to read backup file.", "error");
      reject(new Error("File read error"));
    };
    reader.readAsText(file);
  });
}
