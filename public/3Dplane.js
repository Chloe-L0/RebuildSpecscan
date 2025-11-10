import { readState } from './state.js';

const backBtn = document.getElementById('backBtn');
const nextBtn = document.getElementById('nextBtn');

const ensureInspection = () => {
    const state = readState();
    if (!state.inspection.tailNumber || !state.inspection.startedAt) {
        window.location.replace('index.html');
        return false;
    }
    return true;
};

if (ensureInspection()) {
    backBtn?.addEventListener('click', () => {
        window.location.href = 'index.html';
    });

    nextBtn?.addEventListener('click', () => {
        window.location.href = 'capture.html';
    });
}
