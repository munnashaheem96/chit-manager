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

// Export Table As Image (PNG) up to current month status
export async function exportTableAsImage(tableId, currentMonthIndex, MONTHS) {
  const table = document.getElementById(tableId);
  if (!table) {
    showToast("Table not found.", "error");
    return;
  }

  try {
    showToast("Preparing image download...", "info");

    // Create a temporary off-screen wrapper container for rendering
    const exportContainer = document.createElement("div");
    exportContainer.style.position = "absolute";
    exportContainer.style.left = "-9999px";
    exportContainer.style.top = "-9999px";
    exportContainer.style.width = "auto";
    exportContainer.style.padding = "24px";

    const isLight = document.body.classList.contains("light-mode");
    const bgColor = isLight ? "#f8fafc" : "#0b0f19";
    const textColor = isLight ? "#0f172a" : "#f3f4f6";
    const borderColor = isLight ? "rgba(0, 0, 0, 0.08)" : "rgba(255, 255, 255, 0.08)";

    exportContainer.style.backgroundColor = bgColor;
    exportContainer.style.color = textColor;
    exportContainer.style.fontFamily = "'Outfit', sans-serif";
    exportContainer.style.borderRadius = "12px";
    exportContainer.style.border = `1px solid ${borderColor}`;

    // Premium Header block for the image
    const header = document.createElement("div");
    header.style.marginBottom = "20px";
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";

    const today = new Date();
    const currentYear = today.getFullYear();

    const titleInfo = document.createElement("div");
    titleInfo.innerHTML = `
      <h2 style="margin: 0; font-size: 1.6rem; font-weight: 700; background: linear-gradient(135deg, ${isLight ? '#4f46e5' : '#6366f1'}, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">KL2 KURI BOARD</h2>
      <p style="margin: 4px 0 0 0; font-size: 0.9rem; color: ${isLight ? '#475569' : '#9ca3af'}; font-weight: 500;">Ledger status up to ${MONTHS[currentMonthIndex]} ${currentYear}</p>
    `;
    header.appendChild(titleInfo);

    const logo = document.createElement("div");
    logo.style.width = "40px";
    logo.style.height = "40px";
    logo.style.background = `linear-gradient(135deg, ${isLight ? '#4f46e5' : '#6366f1'}, #818cf8)`;
    logo.style.borderRadius = "8px";
    logo.style.display = "flex";
    logo.style.alignItems = "center";
    logo.style.justifyContent = "center";
    logo.style.color = "white";
    logo.style.fontWeight = "700";
    logo.style.fontSize = "1.3rem";
    logo.style.boxShadow = "0 4px 12px rgba(99, 102, 241, 0.2)";
    logo.textContent = "KL";
    header.appendChild(logo);

    exportContainer.appendChild(header);

    // Clone the table
    const clonedTable = table.cloneNode(true);
    
    // Process the cloned table cells
    const rows = clonedTable.querySelectorAll("tr");
    rows.forEach(row => {
      const cells = Array.from(row.cells);
      for (let i = cells.length - 1; i >= 0; i--) {
        const cell = cells[i];
        
        // Hide columns after the current month
        if (i > currentMonthIndex + 2) {
          cell.remove();
        } else {
          // Remove stickiness of headers/first columns so they render in standard grid flow
          cell.style.position = "static";
          cell.style.left = "auto";
          cell.style.top = "auto";
          cell.style.zIndex = "auto";
          cell.style.transform = "none";
          cell.style.borderColor = borderColor;
          
          // Force specific colors on key columns/rows if in dark mode
          if (i === 0 || i === 1) {
            cell.style.backgroundColor = isLight ? "#ffffff" : "#111827";
          }
          if (row.classList.contains("summary-row")) {
            cell.style.backgroundColor = isLight ? "#ffffff" : "#111827";
          }
        }
      }
    });

    exportContainer.appendChild(clonedTable);
    document.body.appendChild(exportContainer);

    // Use html2canvas to capture the offscreen node
    const canvas = await html2canvas(exportContainer, {
      backgroundColor: bgColor,
      scale: 2,
      logging: false,
      useCORS: true,
      allowTaint: true
    });

    // Clean up temporary DOM element
    document.body.removeChild(exportContainer);

    // Trigger local download of image
    const imgData = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = `KL2_Kuri_Board_Status_${MONTHS[currentMonthIndex]}_${currentYear}.png`;
    link.href = imgData;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast("Image downloaded successfully!", "success");
  } catch (error) {
    console.error("Image export failed:", error);
    showToast(`Failed to export image: ${error.message}`, "error");
  }
}
