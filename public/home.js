const STORAGE_KEY = 'specscanInspection';

const startBtn = document.getElementById('startBtn');

if (startBtn) {
    startBtn.addEventListener('click', () => {
        sessionStorage.removeItem(STORAGE_KEY);
        window.location.href = 'wizard.html';
    });
}

