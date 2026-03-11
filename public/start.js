import { setInspectionDetails, readState } from './state.js';
import { showToast } from './toast.js';

const HISTORY_MODE_KEY = 'specscanHistoryMode';
// Default to normal flow when landing on Step 1
try {
    sessionStorage.removeItem(HISTORY_MODE_KEY);
} catch {
    // ignore
}

const form = document.getElementById('startForm');
const tailNumberInput = document.getElementById('tailNumber');
const departmentInput = document.getElementById('department');
const inspectorNameInput = document.getElementById('inspectorName');
const timeStartedDisplay = document.getElementById('timeStartedDisplay');
const startButton = document.getElementById('startCaptureBtn');

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
        showToast('Please fill in all required fields (Tail Number and Inspector Name)', { type: 'warning' });
        return;
    }

    const payload = {
        tailNumber,
        inspectionType,
        inspectorName,
        department,
        startedAt: new Date().toISOString()
    };

    // Starting a new inspection should never be "history mode"
    try {
        sessionStorage.removeItem(HISTORY_MODE_KEY);
    } catch {
        // ignore
    }

    setInspectionDetails(payload);
    window.location.href = 'tag.html';
};

startButton?.addEventListener('click', handleStart);

// Sidebar and panels are in sidebar.js (loaded on all steps).

// (Panel logic lives in sidebar.js)
// ---------------------------------------------------------------------------
// (Bookmarks, Flagged, Clipboard panels - in sidebar.js)
// ---------------------------------------------------------------------------
// Initialize
hydrateForm();

