import { resetState } from './state.js';

const REPORT_RECEIPT_KEY = 'specscan_report_receipt';

const successDetails = document.getElementById('successDetails');
const startNewBtn = document.getElementById('startNewBtn');
const returnHomeBtn = document.getElementById('returnHomeBtn');

const receipt = readReceipt();

if (receipt) {
    const submittedAt = new Date(receipt.submittedAt);
    successDetails.textContent = `Report ${receipt.reportId} for Tail ${receipt.tailNumber} submitted ${submittedAt.toLocaleString()}.`;
} else {
    successDetails.textContent = 'Inspection submitted.';
}

startNewBtn?.addEventListener('click', () => {
    resetState();
    window.location.href = 'index.html';
});

returnHomeBtn?.addEventListener('click', () => {
    window.location.href = 'index.html';
});

function readReceipt() {
    try {
        const raw = sessionStorage.getItem(REPORT_RECEIPT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        sessionStorage.removeItem(REPORT_RECEIPT_KEY);
        return parsed;
    } catch (error) {
        console.warn('Failed to read report receipt', error);
        sessionStorage.removeItem(REPORT_RECEIPT_KEY);
        return null;
    }
}

