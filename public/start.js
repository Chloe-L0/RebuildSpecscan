import { setStartDetails, resetState } from './state.js';

const form = document.getElementById('startForm');
const timestampField = document.getElementById('timestamp');

function formatDateTime(date) {
    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function initialiseTimestamp() {
    const now = new Date();
    timestampField.value = formatDateTime(now);
    timestampField.dataset.iso = now.toISOString();
}

function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {
        tailNumber: String(formData.get('tailNumber') || '').toUpperCase(),
        inspectionType: String(formData.get('inspectionType') || ''),
        inspectorName: String(formData.get('inspectorName') || ''),
        timestamp: timestampField.dataset.iso || new Date().toISOString(),
        notes: String(formData.get('notes') || '')
    };

    setStartDetails(payload);
    window.location.href = 'capture.html';
}

resetState();
initialiseTimestamp();
form?.addEventListener('submit', handleSubmit);

