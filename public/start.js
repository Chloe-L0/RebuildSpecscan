import { setInspectionDetails, readState } from './state.js';

const form = document.getElementById('startForm');
const tailNumberInput = document.getElementById('tailNumber');
const departmentInput = document.getElementById('department');
const inspectorNameInput = document.getElementById('inspectorName');
const startedAtInput = document.getElementById('startedAt');
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
    startedAtInput.value = formatDateTime(startedAt);

    if (state.inspection.tailNumber) {
        tailNumberInput.value = state.inspection.tailNumber;
    }
    if (state.inspection.department) {
        departmentInput.value = state.inspection.department;
    }
    if (state.inspection.inspectorName) {
        inspectorNameInput.value = state.inspection.inspectorName;
    }
    const radio = form.elements.namedItem('inspectionType');
    if (radio) {
        const inputs = Array.isArray(radio) ? radio : [radio];
        inputs.forEach((input) => {
            input.checked = input.value === state.inspection.inspectionType;
        });
    }
};

const handleStart = () => {
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    const payload = {
        tailNumber: formData.get('tailNumber')?.toString() || '',
        inspectionType: formData.get('inspectionType')?.toString() || 'Inbound',
        inspectorName: formData.get('inspectorName')?.toString() || '',
        department: formData.get('department')?.toString() || '',
        startedAt: new Date().toISOString()
    };

    setInspectionDetails(payload);
    window.location.href = 'capture.html';
};

startButton?.addEventListener('click', handleStart);

hydrateForm();

