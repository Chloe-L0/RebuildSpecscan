import {
    setInspectionDetails,
    readState,
    getInspectionHistory,
    loadInspectionFromHistory
} from './state.js';

const form = document.getElementById('startForm');
const tailNumberInput = document.getElementById('tailNumber');
const departmentInput = document.getElementById('department');
const inspectorNameInput = document.getElementById('inspectorName');
const timeStartedDisplay = document.getElementById('timeStartedDisplay');
const startButton = document.getElementById('startCaptureBtn');
const historyNavBtn = document.getElementById('historyNavBtn');
const historyPanel = document.getElementById('historyPanel');
const historyPanelClose = document.getElementById('historyPanelClose');
const historyBackdrop = document.getElementById('historyBackdrop');
const historyList = document.getElementById('historyList');
const historyEmpty = document.getElementById('historyEmpty');
const historySearch = document.getElementById('historySearch');

const formatDateTime = (date) =>
    date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });

const hydrateForm = () => {
    const state = readState();
    const now = new Date();
    const startedAt = state.inspection.startedAt ? new Date(state.inspection.startedAt) : now;
    
    // Update time display in header
    if (timeStartedDisplay) {
        timeStartedDisplay.textContent = formatDateTime(startedAt);
    }

    if (state.inspection.tailNumber && tailNumberInput) {
        tailNumberInput.value = state.inspection.tailNumber;
    }
    if (state.inspection.department && departmentInput) {
        departmentInput.value = state.inspection.department;
    }
    if (state.inspection.inspectorName && inspectorNameInput) {
        inspectorNameInput.value = state.inspection.inspectorName;
    }
    
    // Update inspection type radio buttons and toggle button states
    const inputs = form?.querySelectorAll('input[name="inspectionType"]');
    if (inputs && inputs.length > 0) {
        const inspectionType = state.inspection.inspectionType || 'Outbound';
        
        inputs.forEach((input) => {
            if (input instanceof HTMLInputElement) {
                input.checked = input.value === inspectionType;
                // Update toggle button visual state
                const toggleButton = input.closest('.toggle-button');
                if (toggleButton) {
                    if (input.checked) {
                        toggleButton.classList.add('active');
                    } else {
                        toggleButton.classList.remove('active');
                    }
                }
            }
        });
    }
};

// Handle toggle button clicks
const toggleButtons = document.querySelectorAll('.toggle-button');
toggleButtons.forEach((button) => {
    button.addEventListener('click', () => {
        const radio = button.querySelector('input[type="radio"]');
        if (radio) {
            radio.checked = true;
            // Update all toggle buttons
            toggleButtons.forEach((btn) => btn.classList.remove('active'));
            button.classList.add('active');
        }
    });
});

const handleStart = () => {
    // Get all form data (from both forms if needed)
    const tailNumber = tailNumberInput?.value || '';
    const inspectorName = inspectorNameInput?.value || '';
    const department = departmentInput?.value || '';
    
    // Get inspection type from radio buttons
    const inspectionTypeInputs = form?.querySelectorAll('input[name="inspectionType"]');
    let inspectionType = 'Outbound';
    if (inspectionTypeInputs && inspectionTypeInputs.length > 0) {
        const checked = Array.from(inspectionTypeInputs).find(input => input instanceof HTMLInputElement && input.checked);
        if (checked) {
            inspectionType = checked.value;
        }
    }

    // Validate required fields
    if (!tailNumber || !inspectorName) {
        alert('Please fill in all required fields (Tail Number and Inspector Name)');
        return;
    }

    const payload = {
        tailNumber,
        inspectionType,
        inspectorName,
        department,
        startedAt: new Date().toISOString()
    };

    setInspectionDetails(payload);
    window.location.href = 'capture.html';
};

startButton?.addEventListener('click', handleStart);

// ---------------------------------------------------------------------------
// Inspection History panel (clock icon)
// ---------------------------------------------------------------------------
const formatHistoryDate = (isoString) => {
    if (!isoString) return '—';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const matchesSearch = (entry, q) => {
    if (!q || !q.trim()) return true;
    const lower = q.trim().toLowerCase();
    const tail = (entry.tailNumber || '').toLowerCase();
    const inspector = (entry.inspectorName || '').toLowerCase();
    const type = (entry.inspectionType || '').toLowerCase();
    const dateStr = formatHistoryDate(entry.startedAt).toLowerCase();
    return tail.includes(lower) || inspector.includes(lower) || type.includes(lower) || dateStr.includes(lower);
};

const renderHistoryList = () => {
    const list = getInspectionHistory();
    const query = (historySearch?.value || '').trim();
    const filtered = query ? list.filter((entry) => matchesSearch(entry, query)) : list;

    if (!historyList || !historyEmpty) return;

    if (filtered.length === 0) {
        historyList.innerHTML = '';
        historyList.classList.add('hidden');
        historyEmpty.classList.remove('hidden');
        return;
    }

    historyEmpty.classList.add('hidden');
    historyList.classList.remove('hidden');
    historyList.innerHTML = filtered
        .map(
            (entry) => `
        <button type="button" class="history-item" data-history-id="${entry.id}">
            <p class="history-item-tail">${escapeHtml(entry.tailNumber || '—')}</p>
            <p class="history-item-meta">${escapeHtml(formatHistoryDate(entry.startedAt))} · ${escapeHtml(entry.inspectorName || '—')}</p>
            <span class="history-item-type">${escapeHtml(entry.inspectionType || 'Outbound')}</span>
            ${entry.photosCount != null ? `<p class="history-item-meta" style="margin-top:4px">${entry.photosCount} photo${entry.photosCount === 1 ? '' : 's'}</p>` : ''}
        </button>
        `
        )
        .join('');

    historyList.querySelectorAll('.history-item').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.historyId;
            if (!id) return;
            if (loadInspectionFromHistory(id)) {
                closeHistoryPanel();
                window.location.href = 'results.html';
            } else {
                alert('Could not load that inspection.');
            }
        });
    });
};

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

const openHistoryPanel = () => {
    historyPanel?.classList.add('is-open');
    historyPanel?.setAttribute('aria-hidden', 'false');
    historyBackdrop?.classList.remove('hidden');
    historyBackdrop?.classList.add('is-visible');
    historyBackdrop?.setAttribute('aria-hidden', 'false');
    renderHistoryList();
    historySearch?.focus();
};

const closeHistoryPanel = () => {
    historyPanel?.classList.remove('is-open');
    historyPanel?.setAttribute('aria-hidden', 'true');
    historyBackdrop?.classList.remove('is-visible');
    historyBackdrop?.classList.add('hidden');
    historyBackdrop?.setAttribute('aria-hidden', 'true');
};

historyNavBtn?.addEventListener('click', openHistoryPanel);
historyPanelClose?.addEventListener('click', closeHistoryPanel);
historyBackdrop?.addEventListener('click', closeHistoryPanel);
historySearch?.addEventListener('input', () => renderHistoryList());
historySearch?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeHistoryPanel();
});

// Initialize
hydrateForm();

