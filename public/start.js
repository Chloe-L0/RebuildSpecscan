import {
    setInspectionDetails,
    readState,
    getInspectionHistory,
    loadInspectionFromHistory,
    getAllFlaggedImages,
    deleteFlaggedImage
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
const flaggedImagesNavBtn = document.getElementById('flaggedImagesNavBtn');
const flaggedImagesPanel = document.getElementById('flaggedImagesPanel');
const flaggedImagesPanelClose = document.getElementById('flaggedImagesPanelClose');
const flaggedImagesBackdrop = document.getElementById('flaggedImagesBackdrop');
const flaggedImagesList = document.getElementById('flaggedImagesList');
const flaggedImagesEmpty = document.getElementById('flaggedImagesEmpty');
const flaggedImagesSearch = document.getElementById('flaggedImagesSearch');

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

// ---------------------------------------------------------------------------
// Flagged Images panel (flag icon)
// ---------------------------------------------------------------------------
const formatFlaggedDate = (isoString) => {
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

const matchesFlaggedSearch = (item, q) => {
    if (!q || !q.trim()) return true;
    const lower = q.trim().toLowerCase();
    const area = (item.area || '').toLowerCase();
    const note = (item.flaggedNote || '').toLowerCase();
    const tail = (item.inspection?.tailNumber || '').toLowerCase();
    return area.includes(lower) || note.includes(lower) || tail.includes(lower);
};

const renderFlaggedImagesList = () => {
    const list = getAllFlaggedImages();
    const query = (flaggedImagesSearch?.value || '').trim();
    const filtered = query ? list.filter((item) => matchesFlaggedSearch(item, query)) : list;

    if (!flaggedImagesList || !flaggedImagesEmpty) return;

    if (filtered.length === 0) {
        flaggedImagesList.innerHTML = '';
        flaggedImagesList.classList.add('hidden');
        flaggedImagesEmpty.classList.remove('hidden');
        return;
    }

    flaggedImagesEmpty.classList.add('hidden');
    flaggedImagesList.classList.remove('hidden');
    
    // Sort by flaggedAt date (newest first)
    const sorted = [...filtered].sort((a, b) => {
        const dateA = a.flaggedAt ? new Date(a.flaggedAt).getTime() : 0;
        const dateB = b.flaggedAt ? new Date(b.flaggedAt).getTime() : 0;
        return dateB - dateA;
    });
    
    flaggedImagesList.innerHTML = sorted
        .map(
            (item) => `
        <div class="flagged-image-item-panel">
            <div class="flagged-image-item-header">
                <div class="flagged-image-item-info">
                    <p class="flagged-image-item-title">Photo #${escapeHtml(item.number || '—')} - ${escapeHtml(item.area || 'Unknown Area')}</p>
                    <p class="flagged-image-item-meta">${escapeHtml(formatFlaggedDate(item.flaggedAt))}</p>
                    ${item.inspection?.tailNumber ? `<p class="flagged-image-item-meta">Tail: ${escapeHtml(item.inspection.tailNumber)}</p>` : ''}
                </div>
                <button type="button" class="flagged-image-delete-btn" data-flagged-id="${item.id}" aria-label="Delete">×</button>
            </div>
            <div class="flagged-image-item-preview">
                <img src="${escapeHtml(item.dataURL)}" alt="Photo #${escapeHtml(item.number || '—')}" style="max-width: 100%; max-height: 200px; border-radius: 4px; object-fit: contain;">
            </div>
            ${item.flaggedNote ? `
            <div class="flagged-image-item-note">
                <p class="flagged-image-note-label">Note:</p>
                <p class="flagged-image-note-text">${escapeHtml(item.flaggedNote)}</p>
            </div>
            ` : ''}
        </div>
        `
        )
        .join('');

    // Add delete button handlers
    flaggedImagesList.querySelectorAll('.flagged-image-delete-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.flaggedId;
            if (!id) return;
            if (confirm('Delete this flagged image?')) {
                deleteFlaggedImage(id);
                renderFlaggedImagesList();
            }
        });
    });
};

const openFlaggedImagesPanel = () => {
    flaggedImagesPanel?.classList.add('is-open');
    flaggedImagesPanel?.setAttribute('aria-hidden', 'false');
    flaggedImagesBackdrop?.classList.remove('hidden');
    flaggedImagesBackdrop?.classList.add('is-visible');
    flaggedImagesBackdrop?.setAttribute('aria-hidden', 'false');
    renderFlaggedImagesList();
    flaggedImagesSearch?.focus();
};

const closeFlaggedImagesPanel = () => {
    flaggedImagesPanel?.classList.remove('is-open');
    flaggedImagesPanel?.setAttribute('aria-hidden', 'true');
    flaggedImagesBackdrop?.classList.remove('is-visible');
    flaggedImagesBackdrop?.classList.add('hidden');
    flaggedImagesBackdrop?.setAttribute('aria-hidden', 'true');
};

flaggedImagesNavBtn?.addEventListener('click', openFlaggedImagesPanel);
flaggedImagesPanelClose?.addEventListener('click', closeFlaggedImagesPanel);
flaggedImagesBackdrop?.addEventListener('click', closeFlaggedImagesPanel);
flaggedImagesSearch?.addEventListener('input', () => renderFlaggedImagesList());
flaggedImagesSearch?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFlaggedImagesPanel();
});

// Initialize
hydrateForm();

