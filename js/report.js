
class ReportApp {
    static async init() {
        await DB.open();

        // Set default month to current
        const now = new Date();
        const monthInput = document.getElementById('report-month');
        monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        document.getElementById('btn-generate').addEventListener('click', () => this.generateReport());

        // Auto generate
        this.generateReport();
    }

    static async generateReport() {
        const monthStr = document.getElementById('report-month').value; // YYYY-MM
        if (!monthStr) return;

        const [year, month] = monthStr.split('-').map(Number);
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0, 23, 59, 59);

        document.getElementById('report-title').textContent = `Caretaker Log Report - ${startDate.toLocaleString('default', { month: 'long', year: 'numeric' })}`;
        document.getElementById('report-container').classList.remove('hidden');

        // Fetch logs
        const allLogs = await DB.getAll('logs');
        const comments = await DB.getAll('comments');

        // Filter by month
        const logs = allLogs.filter(l => {
            const d = new Date(l.date);
            return d >= startDate && d <= endDate;
        });

        // Determine Weeks in Month
        // Logic requested: Ensure the partial week is at the END.
        // Standard bucket: (Sun-Sat). This leaves partial weeks at start and end.
        // Requested behavior: "Make it so the LAST table is the one with the fewest days"
        // This implies we should group by 7 days starting from Day 1, regardless of actual weekday?
        // Or shift days to fill the first week?
        // "Week 1 with only 3 days" -> likely Wed-Sat.
        // If we want FULL weeks at the start, we can just group by chunks of 7 days: [1-7], [8-14], [15-21], ...
        // This ignores the actual calendar "Sunday-Saturday" boundaries, but fulfills "Last week has fewer items".
        // It creates "Work Weeks" relative to the month start rather than calendar weeks.

        const weeks = [];
        const daysInMonth = endDate.getDate();
        let currentWeek = [];

        for (let d = 1; d <= daysInMonth; d++) {
            const date = new Date(year, month - 1, d);
            currentWeek.push(date);

            // if we have 7 days, or we are at the very end of the month
            if (currentWeek.length === 7 || d === daysInMonth) {
                weeks.push([...currentWeek]);
                currentWeek = [];
            }
        }

        this.renderDailyTables(weeks, logs, comments);
        this.renderWeeklyTable(weeks, logs, comments);
        this.renderMonthlyTable(logs);
    }

    static renderDailyTables(weeks, logs, comments) {
        const container = document.getElementById('daily-container');
        container.innerHTML = '';

        // Added title
        const header = document.createElement('div');
        header.className = 'col-span-12';
        header.innerHTML = '<h2 class="text-xl font-bold mt-4 mb-2">Caretaker Log - Daily Tasks</h2>';
        container.appendChild(header);

        const dailyTasks = [
            ...TASKS_DATA['Daily (Winter)'],
            ...TASKS_DATA['Daily (All-Year)']
        ];

        weeks.forEach((weekDays, index) => {
            const weekNum = index + 1;

            // Create Table Structure
            const tableWrapper = document.createElement('div');
            // Logic: col-span-12 now
            tableWrapper.className = 'col-span-12 p-1 mb-4';

            tableWrapper.innerHTML = `
                <h3 class="font-bold text-lg mb-1">Week ${weekNum}</h3>
                <table>
                    <thead>
                        <tr>
                            <th class="task-col">Task Description</th>
                            ${weekDays.map(d => `<th>${d.getDate()} (${d.toLocaleDateString('en-US', { weekday: 'short' })})</th>`).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${dailyTasks.map(taskName => `
                            <tr>
                                <td class="task-col text-left px-2 truncate" title="${taskName}">${taskName}</td>
                                ${weekDays.map(d => {
                                    const dateStr = Helpers.formatDate(d);
                                    // Find log for this task on this day
                                    const entry = logs.find(l =>
                                        l.title === taskName &&
                                        Helpers.formatDate(l.date) === dateStr &&
                                        l.completed
                                    );

                                    let content = "";
                                    if (entry) {
                                        // Human readable time
                                        content = new Date(entry.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                                    }
                                    return `<td>${content}</td>`;
                                }).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td class="task-col font-bold bg-gray-50 text-left px-2">Comments</td>
                            ${weekDays.map(d => {
                                const dateStr = Helpers.formatDate(d);
                                const comm = comments.find(c => c.id === dateStr);
                                return `<td class="text-left align-top italic text-gray-600 leading-tight" style="max-width: 100px;">${comm ? comm.dayContent || '' : ''}</td>`;
                            }).join('')}
                        </tr>
                    </tfoot>
                </table>
            `;
            container.appendChild(tableWrapper);
        });
    }

    static renderWeeklyTable(weeks, logs, comments) {
        const theadRow = document.querySelector('#table-weekly thead tr');
        const tasks = TASKS_DATA['Weekly'];
        const tbody = document.getElementById('tbody-weekly');

        // Reset Header (keep first col)
        while (theadRow.children.length > 1) { theadRow.removeChild(theadRow.lastChild); }

        // Add Week Cols
        weeks.forEach((_, i) => {
            const th = document.createElement('th');
            th.textContent = `W${i+1}`;
            theadRow.appendChild(th);
        });

        // Build Rows
        tbody.innerHTML = tasks.map(taskName => `
            <tr>
                <td class="task-col">${taskName}</td>
                ${weeks.map((_, i) => {
                    // Check if task completed in this week range
                    // We need to check filtering by date range of the week
                    // Simplified: check if any log in this week matches
                    const weekStart = weeks[i][0];
                    const weekEnd = weeks[i][weeks[i].length-1];
                    // Make inclusive comparison
                    const entry = logs.find(l => {
                        const d = new Date(l.date);
                        // Strip times for comparison safety
                        const dTime = d.setHours(0,0,0,0);
                        return l.title === taskName &&
                               l.completed &&
                               dTime >= weekStart.setHours(0,0,0,0) &&
                               dTime <= weekEnd.setHours(23,59,59,999);
                    });

                    return `<td>${entry ? Helpers.formatDisplayDate(entry.date) : ''}</td>`;
                }).join('')}
            </tr>
        `).join('');

        const commentRow = document.createElement('tr');
        commentRow.innerHTML = `
            <td class="task-col font-bold bg-gray-50">Comments from Week</td>
            ${weeks.map(weekDays => {
                const notes = weekDays.map(d => {
                    const c = comments.find(x => x.id === Helpers.formatDate(d));
                    return c && c.weekContent ? `[${d.getDate()}]: ${c.weekContent}` : null;
                }).filter(Boolean).join('\n');
                return `<td class="text-left italic text-xs leading-tight">${notes}</td>`;
            }).join('')}
        `;
        tbody.appendChild(commentRow);
    }

    static renderMonthlyTable(logs) {
        const tbody = document.getElementById('tbody-monthly');
        const tasks = [
            ...TASKS_DATA['Monthly'],
            ...TASKS_DATA['Twice-Yearly']
        ]; // Should we include Twice Yearly? Prompt implies "Monthly Report", so usually Monthly tasks. User asked for "second table... description, timestamp".

        tbody.innerHTML = tasks.map(taskName => {
             const entry = logs.find(l => l.title === taskName && l.completed);
             return `
                <tr>
                    <td class="task-col text-left px-2">${taskName}</td>
                    <td>${entry ? Helpers.formatDisplayDate(entry.date) : ''}</td>
                </tr>
             `;
        }).join('');
    }
}

window.addEventListener('DOMContentLoaded', () => ReportApp.init());
