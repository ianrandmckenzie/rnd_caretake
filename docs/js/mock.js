window.populateMockData = async function() {
    console.log("🚀 Starting mock data generation...");

    // Ensure DB is open
    if (!DB.db) await DB.open();

    const now = new Date();
    // Start from 1st day of previous month
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    // End at last day of next month
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0);

    console.log(`📅 Generating data from ${start.toDateString()} to ${end.toDateString()}`);

    const logs = [];
    const comments = [];

    // Helper to format date as YYYY-MM-DD for ID
    const fmt = (d) => {
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    };

    let current = new Date(start);
    while (current <= end) {
        const dateStr = fmt(current);
        const monthIndex = current.getMonth();
        // Winter months: Jan(0), Feb(1), Mar(2), Apr(3), Nov(10), Dec(11)
        const isWinter = [0, 1, 2, 3, 10, 11].includes(monthIndex);
        const dayOfWeek = current.getDay(); // 0=Sun, 6=Sat

        // --- 1. Dailies ---
        // Always All-Year
        if (TASKS_DATA['Daily (All-Year)']) {
            TASKS_DATA['Daily (All-Year)'].forEach(task => {
                logs.push(createLog(task, 'Daily (All-Year)', current));
            });
        }
        // Winter if applies
        if (isWinter && TASKS_DATA['Daily (Winter)']) {
            TASKS_DATA['Daily (Winter)'].forEach(task => {
                logs.push(createLog(task, 'Daily (Winter)', current));
            });
        }

        // --- 2. Weeklies ---
        // Do them on Fridays (5) to simulate end-of-week wrap up
        if (dayOfWeek === 5 && TASKS_DATA['Weekly']) {
            TASKS_DATA['Weekly'].forEach(task => {
                 logs.push(createLog(task, 'Weekly', current));
            });
        }

        // --- 3. Monthlies ---
        // Do on the 1st of the month
        if (current.getDate() === 1 && TASKS_DATA['Monthly']) {
             TASKS_DATA['Monthly'].forEach(task => {
                 logs.push(createLog(task, 'Monthly', current));
            });
        }

        // --- 4. Twice-Yearly ---
        // Do them on the 15th of EVERY month just so they show up in this test report
        if (current.getDate() === 15 && TASKS_DATA['Twice-Yearly']) {
             TASKS_DATA['Twice-Yearly'].forEach(task => {
                 logs.push(createLog(task, 'Twice-Yearly', current));
            });
        }

        // --- 5. Comments ---
        comments.push({
            id: dateStr,
            dayContent: getRandomComment("day"),
            weekContent: dayOfWeek === 0 ? getRandomComment("week") : "" // Summary on Sunday
        });

        // Next Day
        current.setDate(current.getDate() + 1);
    }

    // Save logs (Using simple loop to ensure transaction safety if bulk not supported)
    console.log(`💾 Saving ${logs.length} logs...`);
    const tx = DB.db.transaction(['logs', 'comments'], 'readwrite');
    const logStore = tx.objectStore('logs');
    const comStore = tx.objectStore('comments');

    logs.forEach(l => logStore.put(l));
    comments.forEach(c => comStore.put(c));

    tx.oncomplete = () => {
        console.log("✅ Mock data generation complete!");
        alert(`Successfully generated ${logs.length} logs and ${comments.length} comments! Reloading page...`);
        window.location.reload();
    };

    tx.onerror = (e) => {
        console.error("Error saving mock data", e);
        alert("Error saving data");
    };
};

window.clearAllData = async function() {
    console.log("⚠️ Clearing all data...");
    if (!DB.db) await DB.open();

    return new Promise((resolve, reject) => {
        const tx = DB.db.transaction(['logs', 'comments'], 'readwrite');
        tx.objectStore('logs').clear();
        tx.objectStore('comments').clear();

        tx.oncomplete = () => {
            console.log("✅ All data cleared!");
            alert("All data cleared! Reloading...");
            window.location.reload();
            resolve();
        };
        tx.onerror = (e) => reject(e);
    });
};

function createLog(title, type, dateObj) {
    // Random time between 8am and 5pm
    const d = new Date(dateObj);
    d.setHours(8 + Math.floor(Math.random() * 9), Math.floor(Math.random() * 60));

    // Format to YYYY-MM-DDTHH:mm (local) to match input type="datetime-local" behavior preferrably,
    // but ISO string works for new Date() parsing.
    // Let's use a manual format that looks like datetime-local just to be consistent with main.js
    const pad = n => String(n).padStart(2,'0');
    const localIso = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    return {
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random(),
        title: title,
        type: type,
        date: localIso,
        completed: true,
        description: "Task completed efficiently. No issues found."
    };
}

function getRandomComment(type) {
    const daily = [
        "All inspections passed. Building is secure.",
        "Routine cleaning completed. Checked all access points.",
        "Quiet day. No incidents to report.",
        "Deliveries accepted and tenants notified.",
        "Heating system monitored, pressure normal.",
        "Walkways cleared and salted."
    ];
    const weekly = [
        "Weekly systems check: GREEN. All maintenance updated.",
        "Garbage disposal area sanitized. Inventory checked.",
        "Tenant feedback review completed - no major concerns.",
        "Grounds maintenance completed for the week.",
        "Full facility walkthrough completed."
    ];
    const list = type === 'week' ? weekly : daily;
    return list[Math.floor(Math.random() * list.length)];
}
