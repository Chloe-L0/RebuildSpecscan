import { setInspectionDetails, readState } from './state.js';

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
    const radio = form?.elements.namedItem('inspectionType');
    if (radio) {
        const inputs = Array.isArray(radio) ? radio : [radio];
        const inspectionType = state.inspection.inspectionType || 'Outbound';
        
        inputs.forEach((input) => {
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
    const inspectionTypeRadio = form?.elements.namedItem('inspectionType');
    let inspectionType = 'Outbound';
    if (inspectionTypeRadio) {
        const inputs = Array.isArray(inspectionTypeRadio) ? inspectionTypeRadio : [inspectionTypeRadio];
        const checked = inputs.find(input => input.checked);
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

// Initialize
hydrateForm();

