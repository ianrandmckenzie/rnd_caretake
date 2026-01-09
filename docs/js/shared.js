
const DB_NAME = "CaretakerDB";
const DB_VERSION = 1;

/* Tasks Configuration */
const TASKS_DATA = {
    'Daily (Winter)': ['Snow removal', 'Application of salt'],
    'Daily (All-Year)': ['Tidying of lobby, laundry, ski room', 'Emptying (4) Waste cans', 'Wiping down bathroom fixtures, floor', 'Building Walk-thru and spot clean'],
    'Weekly': ['Vacuum hallways, stairs, elevators', 'Spot clean spills on carpets', 'Clean Laundry room floor', 'Clean dryers and lint traps', 'Vacuum games room floor', 'Wipe down laundry machines', 'Clean windows and mirrors'],
    'Monthly': ['Refresh Pest Control traps', 'Clean carpets in high traffic areas', 'Dust horizontal surfaces', 'Keep light fixtures, vents, walls clean'],
    'Twice-Yearly': ['Clean under/behind laundry machines', 'Clean all carpets', 'Do outdoor clean up around grounds', 'Clean Ice Machine', 'Paint touch ups on doors and w']
};

/* IndexedDB Wrapper */
const DB = {
    db: null,
    async open() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onerror = () => reject(req.error);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains("logs")) {
                    db.createObjectStore("logs", { keyPath: "id" });
                }
                if (!db.objectStoreNames.contains("comments")) {
                    db.createObjectStore("comments", { keyPath: "id" }); // id = date string
                }
            };
            req.onsuccess = () => {
                this.db = req.result;
                resolve(this.db);
            };
        });
    },
    async getAll(storeName) {
        return new Promise((resolve) => {
            const tx = this.db.transaction(storeName, "readonly");
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
        });
    },
    async put(storeName, data) {
         return new Promise((resolve) => {
            const tx = this.db.transaction(storeName, "readwrite");
            const store = tx.objectStore(storeName);
            store.put(data);
            tx.oncomplete = () => resolve();
        });
    },
    async delete(storeName, id) {
        return new Promise((resolve) => {
            const tx = this.db.transaction(storeName, "readwrite");
            const store = tx.objectStore(storeName);
            store.delete(id);
            tx.oncomplete = () => resolve();
        });
    },
    async getTx(type) {
         return this.db.transaction(["logs", "comments"], type);
    }
};

const Helpers = {
    formatDate: (d) => new Date(d).toISOString().split('T')[0],
    formatDisplayDate: (d) => new Date(d).toLocaleString(),
    uuid: () => Date.now().toString(36) + Math.random().toString(36).substr(2)
};
