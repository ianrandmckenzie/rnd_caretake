
/* State & Constants */
const STATE = {
    logs: [],
    filteredLogs: [],
    comments: [], // { date: "YYYY-MM-DD", dayContent: "", weekContent: "" }
    filter: {
        search: "",
        dateRange: "all",
        customStart: "",
        customEnd: ""
    }
};

/* Helpers */
const formatInputDate = (d) => {
    const date = new Date(d);
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const uuid = Helpers.uuid;
const formatDate = Helpers.formatDate;
const formatDisplayDate = Helpers.formatDisplayDate;

const getWeekKey = (dateStr) => {
    const d = new Date(dateStr);
    const start = new Date(d.getFullYear(), 0, 1);
    const days = Math.floor((d - start) / (24 * 60 * 60 * 1000));
    const weekNum = Math.ceil(days / 7);
    return `${d.getFullYear()}-W${weekNum}`;
};

/* Application Logic */

class App {
    static async init() {
        await DB.open();
        await this.syncData();
        UI.init();
        this.applyFilters();
    }

    static async syncData() {
        // 1. Load from IDB
        const localLogs = await DB.getAll("logs");
        const localComments = await DB.getAll("comments");

        // 2. Load from Reports (Source of Truth)
        // We attempt to fetch known filenames.
        let reportLogs = [];
        const candidates = ['logs.json', 'reports/caretaker-logs-export.json', 'caretaker-logs-export.json'];

        for (const file of candidates) {
            try {
                const response = await fetch(file);
                if (response.ok) {
                    try {
                        const txt = await response.text();
                        if (txt.trim()) {
                            const data = JSON.parse(txt);
                            // We prioritize files that have actual content
                            if (Array.isArray(data) && data.length > 0) {
                                console.log(`Loaded data from ${file}`);
                                reportLogs = data;
                                break;
                            }
                        }
                    } catch (parseErr) {
                        console.warn(`${file} found but invalid`, parseErr);
                    }
                }
            } catch (e) {
                // Ignore fetch errors (404 etc)
            }
        }

        // 3. Merge Logic
        // Reports overwrite local if ID matches.
        const logMap = new Map();
        localLogs.forEach(l => logMap.set(l.id, l));

        reportLogs.forEach(l => {
            // Overwrite or Add
            logMap.set(l.id, { ...l, source: 'report' });
        });

        // Convert back to array
        STATE.logs = Array.from(logMap.values());
        STATE.comments = localComments;

        const tx = await DB.getTx("readwrite");
        const store = tx.objectStore("logs");
        // We can clear and rewrite, or put one by one. Validating IDs.
        // For simplicity:
        for (const log of STATE.logs) {
            await store.put(log);
        }
        await tx.done;

        console.log("Data Synced", STATE.logs.length, "entries");
    }

    static addEntry(entry) {
        if (!entry.id) entry.id = uuid();
        const idx = STATE.logs.findIndex(l => l.id === entry.id);
        if (idx > -1) {
            STATE.logs[idx] = entry;
        } else {
            STATE.logs.push(entry);
        }
        DB.put("logs", entry);
        this.applyFilters();
    }

    static deleteEntry(id) {
        STATE.logs = STATE.logs.filter(l => l.id !== id);
        DB.delete("logs", id);
        this.applyFilters();
    }

    static saveComment(date, dayText, weekText) {
        const id = date; // simple key
        const entry = { id, date, dayContent: dayText, weekContent: weekText };

        const idx = STATE.comments.findIndex(c => c.id === id);
        if (idx > -1) STATE.comments[idx] = entry;
        else STATE.comments.push(entry);

        DB.put("comments", entry);
    }

    static getComment(date) {
        return STATE.comments.find(c => c.id === date) || { date, dayContent: "", weekContent: "" };
    }

    static applyFilters() {
        const range = STATE.filter.dateRange;
        const search = STATE.filter.search.toLowerCase();

        let filtered = STATE.logs.sort((a,b) => new Date(b.date) - new Date(a.date));

        // Text Search
        if (search) {
            filtered = filtered.filter(l =>
                (l.title && l.title.toLowerCase().includes(search)) ||
                (l.description && l.description.toLowerCase().includes(search)) ||
                (l.type && l.type.toLowerCase().includes(search))
            );
        }

        // Date Filter
        const now = new Date();
        const startOfDay = (d) => new Date(d.setHours(0,0,0,0));
        let startDate, endDate;

        if (range !== 'all') {
            switch(range) {
                case 'current-week': {
                     // Simple week calculation (Sun-Sat)
                     const d = new Date(now);
                     const day = d.getDay();
                     const diff = d.getDate() - day + (day == 0 ? -6:1); // adjust when day is sunday
                     startDate = new Date(d.setDate(diff));
                     endDate = new Date();
                     break;
                }
                case 'last-week': {
                    const d = new Date(now);
                    d.setDate(d.getDate() - 7);
                    const day = d.getDay();
                    const diff = d.getDate() - day + (day == 0 ? -6:1);
                    startDate = new Date(d.setDate(diff));
                    endDate = new Date(startDate);
                    endDate.setDate(endDate.getDate() + 6);
                    break;
                }
                case 'current-month':
                    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                    endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                    break;
                case 'last-month':
                    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                    endDate = new Date(now.getFullYear(), now.getMonth(), 0);
                    break;
                case 'current-year':
                    startDate = new Date(now.getFullYear(), 0, 1);
                    endDate = new Date(now.getFullYear(), 11, 31);
                    break;
                case 'last-year':
                    startDate = new Date(now.getFullYear() - 1, 0, 1);
                    endDate = new Date(now.getFullYear() - 1, 11, 31);
                    break;
                case 'custom':
                    if (STATE.filter.customStart) startDate = new Date(STATE.filter.customStart);
                    if (STATE.filter.customEnd) endDate = new Date(STATE.filter.customEnd);
                    break;
            }

            if (startDate) {
                filtered = filtered.filter(l => {
                    const d = new Date(l.date);
                    // End date usually inclusive (end of day)
                    if (endDate) endDate.setHours(23,59,59,999);
                    return d >= startDate && (!endDate || d <= endDate);
                });
            }
        }
STATE.filteredLogs = filtered;

        UI.renderTable(filtered);
    }
}

/* UI Manager */
class UI {
    static init() {
        // Event Listeners
        document.getElementById('btn-new-entry').addEventListener('click', () => this.openModal());
        document.getElementById('btn-close-modal').addEventListener('click', () => this.closeModal());
        document.getElementById('btn-cancel-modal').addEventListener('click', () => this.closeModal());
        document.getElementById('btn-save-entry').addEventListener('click', () => this.saveFromModal());
        document.getElementById('btn-delete-entry').addEventListener('click', () => this.deleteFromModal());

        document.getElementById('search-input').addEventListener('input', (e) => {
            STATE.filter.search = e.target.value;
            App.applyFilters();
        });

        document.getElementById('date-range-select').addEventListener('change', (e) => {
            STATE.filter.dateRange = e.target.value;
            const customContainer = document.getElementById('custom-date-container');
            if (e.target.value === 'custom') {
                customContainer.classList.remove('hidden');
            } else {
                customContainer.classList.add('hidden');
                App.applyFilters();
            }
        });

        document.getElementById('date-start').addEventListener('change', (e) => {
            STATE.filter.customStart = e.target.value;
            App.applyFilters();
        });
        document.getElementById('date-end').addEventListener('change', (e) => {
            STATE.filter.customEnd = e.target.value;
            App.applyFilters();
        });

        this.populateTaskOptions();

        // Sidebar Date
        const sidebarDate = document.getElementById('sidebar-date');
        sidebarDate.value = formatDate(new Date());
        sidebarDate.addEventListener('change', () => this.loadSidebarComments());
        this.loadSidebarComments(); // Initial load

        document.getElementById('btn-save-comments').addEventListener('click', () => {
            const date = document.getElementById('sidebar-date').value;
            const dayText = document.getElementById('comment-day').value;
            const weekText = document.getElementById('comment-week').value;
            App.saveComment(date, dayText, weekText);
            alert('Comments saved!');
        });

        // Auto-select type based on title
        document.getElementById('entry-title').addEventListener('input', (e) => {
            const val = e.target.value;
            this.checkDescVisibility();
            for (const [type, tasks] of Object.entries(TASKS_DATA)) {
                if (tasks.includes(val)) {
                    document.getElementById('entry-type').value = type;
                    this.renderPresets(type);
                    break;
                }
            }
        });

        // Presets logic
        document.getElementById('entry-type').addEventListener('change', (e) => this.renderPresets(e.target.value));

        // Export
        document.getElementById('btn-export').addEventListener('click', () => {
             this.exportData('json');
        });

        // Mobile Sidebar Toggle
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const toggleBtn = document.getElementById('btn-toggle-sidebar'); // Keep this if we keep the hamburger or remove logic if button gone
        const mobileSidebarBtn = document.getElementById('btn-mobile-sidebar'); // New Chat Bubble
        const closeBtn = document.getElementById('btn-close-sidebar');

        const toggleSidebar = () => {
            const isClosed = sidebar.classList.contains('-translate-x-full');
            if (isClosed) {
                sidebar.classList.remove('-translate-x-full');
                overlay.classList.remove('hidden');
            } else {
                sidebar.classList.add('-translate-x-full');
                overlay.classList.add('hidden');
            }
        };

        if (toggleBtn) toggleBtn.addEventListener('click', toggleSidebar); // Just in case
        if (mobileSidebarBtn) mobileSidebarBtn.addEventListener('click', toggleSidebar);
        closeBtn.addEventListener('click', toggleSidebar);
        overlay.addEventListener('click', toggleSidebar);

        // Mobile Nav Logic
        const mobileMenuBtn = document.getElementById('btn-mobile-menu');
        const mobileMenuOptions = document.getElementById('mobile-menu-options');
        const mobileNewBtn = document.getElementById('btn-mobile-new');
        const mobileExportBtn = document.getElementById('btn-mobile-export');

        if (mobileMenuBtn) {
            mobileMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                mobileMenuOptions.classList.toggle('hidden');
            });
            // Close menu when clicking outside
            document.addEventListener('click', (e) => {
                if (!mobileMenuOptions.contains(e.target) && e.target !== mobileMenuBtn && !mobileMenuBtn.contains(e.target)) {
                    mobileMenuOptions.classList.add('hidden');
                }
            });
        }

        if (mobileNewBtn) {
            mobileNewBtn.addEventListener('click', () => {
                this.openModal();
            });
        }

        if (mobileExportBtn) {
            mobileExportBtn.addEventListener('click', () => {
                this.exportData('json');
                mobileMenuOptions.classList.add('hidden');
            });
        }
    }

    static populateTaskOptions() {
        const datalist = document.getElementById('task-options');
        datalist.innerHTML = '';
        const order = ['Daily (All-Year)', 'Daily (Winter)', 'Weekly', 'Monthly', 'Twice-Yearly'];

        order.forEach(type => {
            if (TASKS_DATA[type]) {
                TASKS_DATA[type].forEach(task => {
                    const option = document.createElement('option');
                    option.value = task;
                    datalist.appendChild(option);
                });
            }
        });
    }

    static renderTable(logs) {
        const tbody = document.getElementById('table-body');
        const emptyState = document.getElementById('empty-state');
        tbody.innerHTML = '';

        if (logs.length === 0) {
            emptyState.classList.remove('hidden');
            return;
        }
        emptyState.classList.add('hidden');

        logs.forEach(log => {
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-gray-50 cursor-pointer';
            tr.onclick = () => this.openModal(log);
            tr.innerHTML = `
                <td class="hidden md:table-cell px-6 py-4 whitespace-nowrap text-sm text-gray-500">${formatDisplayDate(log.date)}</td>
                <td class="px-6 py-4 whitespace-normal md:whitespace-nowrap text-sm font-medium text-gray-900">
                    <div class="flex flex-col">
                        <span>${log.title}</span>
                        <span class="md:hidden text-xs text-gray-500 font-normal mt-1">${formatDisplayDate(log.date)}</span>
                        <span class="md:hidden text-xs text-gray-400 font-normal">${log.type || ''}</span>
                    </div>
                </td>
                <td class="hidden md:table-cell px-6 py-4 whitespace-nowrap text-sm text-gray-500">${log.type}</td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${log.completed ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}">
                        ${log.completed ? 'Completed' : 'Pending'}
                    </span>
                </td>
                <td class="hidden md:table-cell px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button class="text-primary hover:text-indigo-900">Edit</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    static openModal(log = null) {
        const modal = document.getElementById('entry-modal');
        const title = document.getElementById('modal-title');
        const delBtn = document.getElementById('btn-delete-entry');
        const presetContainer = document.getElementById('preset-container');

        modal.classList.remove('hidden');

        if (log) {
            title.textContent = "Edit Entry";
            delBtn.classList.remove('hidden');
            presetContainer.classList.add('hidden');

            document.getElementById('entry-id').value = log.id;
            document.getElementById('entry-title').value = log.title;
            document.getElementById('entry-type').value = log.type || 'Daily (Winter)';
            document.getElementById('entry-date').value = log.date;
            document.getElementById('entry-desc').value = log.description || '';
        } else {
            title.textContent = "New Entry";
            delBtn.classList.add('hidden');
            presetContainer.classList.remove('hidden');

            document.getElementById('entry-id').value = '';
            document.getElementById('entry-title').value = '';
            document.getElementById('entry-type').value = 'Daily (Winter)';
            document.getElementById('entry-date').value = formatInputDate(new Date());
            document.getElementById('entry-desc').value = '';
        }

        this.checkDescVisibility();
        this.renderPresets(document.getElementById('entry-type').value);
    }

    static closeModal() {
        document.getElementById('entry-modal').classList.add('hidden');
    }

    static saveFromModal() {
        const entry = {
            id: document.getElementById('entry-id').value || null,
            title: document.getElementById('entry-title').value,
            type: document.getElementById('entry-type').value,
            date: document.getElementById('entry-date').value,
            completed: true,
            description: document.getElementById('entry-desc').value
        };

        if(!entry.title) { alert("Title is required"); return; }
        if(!entry.date) { alert("Date is required"); return; }

        App.addEntry(entry);
        this.closeModal();
    }

    static deleteFromModal() {
        const id = document.getElementById('entry-id').value;
        if(id && confirm("Are you sure?")) {
            App.deleteEntry(id);
            this.closeModal();
        }
    }

    static checkDescVisibility() {
        const val = document.getElementById('entry-title').value;
        const container = document.getElementById('desc-container');
        let found = false;

        if (!val) {
            container.classList.add('hidden');
            return;
        }

        for (const tasks of Object.values(TASKS_DATA)) {
            if (tasks.includes(val)) {
                found = true;
                break;
            }
        }

        if (found) {
            container.classList.add('hidden');
        } else {
            container.classList.remove('hidden');
        }
    }

    static renderPresets(type) {
        const container = document.getElementById('preset-tags');
        container.innerHTML = '';

        const presets = TASKS_DATA;
        let displayList = [];

        if (type.startsWith('Daily')) {
            if (presets['Daily (Winter)']) presets['Daily (Winter)'].forEach(t => displayList.push({ task: t, type: 'Daily (Winter)' }));
            if (presets['Daily (All-Year)']) presets['Daily (All-Year)'].forEach(t => displayList.push({ task: t, type: 'Daily (All-Year)' }));
        } else {
           const list = presets[type] || [];
           displayList = list.map(t => ({ task: t, type: type }));
        }

        displayList.forEach(item => {
            const span = document.createElement('button');
            span.className = "bg-white border border-blue-200 text-blue-600 px-2 py-1 rounded-full text-xs hover:bg-blue-50 text-left";
            span.textContent = item.task;

            span.onclick = () => {
                if (item.type.startsWith('Daily')) {
                    if (confirm("Complete task for today?")) {
                        // Fill and Save
                        document.getElementById('entry-title').value = item.task;
                        document.getElementById('entry-type').value = item.type;
                        document.getElementById('entry-date').value = formatInputDate(new Date());

                        // Trigger save immediately
                        App.addEntry({
                            id: document.getElementById('entry-id').value || null,
                            title: item.task,
                            type: item.type,
                            date: formatInputDate(new Date()),
                            completed: true,
                            description: document.getElementById('entry-desc').value
                        });
                        UI.closeModal();
                    }
                } else {
                    // Standard fill
                    document.getElementById('entry-title').value = item.task;
                    UI.checkDescVisibility();
                }
            };
            container.appendChild(span);
        });
    }

    static loadSidebarComments() {
        const date = document.getElementById('sidebar-date').value;
        const comment = App.getComment(date);

        document.getElementById('comment-day').value = comment.dayContent || '';
        document.getElementById('comment-week').value = comment.weekContent || '';
        document.getElementById('week-label').textContent = `(${getWeekKey(date)})`;
    }

    static exportData(format) {
        // Collect current filtered data
        let data = STATE.filteredLogs;

        let content = JSON.stringify(data, null, 2);
        let mime = "application/json";
        let ext = "json";

        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `caretaker-logs-export.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
    }
}

/* DB Wrapper moved to shared.js */

// Start
window.addEventListener('DOMContentLoaded', () => App.init());
