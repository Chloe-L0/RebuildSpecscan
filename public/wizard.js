const STORAGE_KEY = 'specscanInspection';

const state = {
    area: null,
    files: [],
    previews: []
};

const areaGrid = document.getElementById('areaGrid');
const captureBtn = document.getElementById('captureBtn');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const thumbGrid = document.getElementById('thumbGrid');
const analyzeBtn = document.getElementById('analyzeBtn');

const MAX_FILE_SIZE = 10 * 1024 * 1024;

areaGrid?.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) {
        return;
    }

    areaGrid.querySelectorAll('.chip').forEach((btn) => btn.classList.remove('selected'));
    chip.classList.add('selected');
    state.area = chip.dataset.area ?? null;
    maybeEnableAnalyze();
});

captureBtn?.addEventListener('click', () => {
    fileInput?.setAttribute('capture', 'environment');
    fileInput?.removeAttribute('multiple');
    fileInput?.click();
});

uploadBtn?.addEventListener('click', () => {
    fileInput?.removeAttribute('capture');
    fileInput?.setAttribute('multiple', 'multiple');
    fileInput?.click();
});

fileInput?.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
        return;
    }

    const valid = files.filter((file) => file.type.startsWith('image/') && file.size <= MAX_FILE_SIZE);
    const rejected = files.length - valid.length;
    if (rejected > 0) {
        alert(`${rejected} file(s) were skipped. Only images up to 10 MB are allowed.`);
    }

    for (const file of valid) {
        state.files.push(file);
        const preview = await fileToDataURL(file);
        state.previews.push({ name: file.name, dataURL: preview, type: file.type });
        addThumbnail(state.previews.length - 1);
    }

    maybeEnableAnalyze();
    event.target.value = '';
});

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function addThumbnail(index) {
    const preview = state.previews[index];
    if (!preview) {
        return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'thumb';
    wrapper.dataset.index = String(index);

    const img = document.createElement('img');
    img.src = preview.dataURL;
    img.alt = preview.name;

    const footer = document.createElement('footer');
    footer.textContent = preview.name;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '×';
    button.addEventListener('click', () => removeImage(index));

    wrapper.appendChild(img);
    wrapper.appendChild(footer);
    wrapper.appendChild(button);
    thumbGrid?.appendChild(wrapper);
}

function removeImage(index) {
    state.files.splice(index, 1);
    state.previews.splice(index, 1);

    if (!thumbGrid) {
        return;
    }

    thumbGrid.querySelectorAll('.thumb').forEach((node) => node.remove());
    state.previews.forEach((_, idx) => addThumbnail(idx));
    maybeEnableAnalyze();
}

function maybeEnableAnalyze() {
    if (analyzeBtn) {
        analyzeBtn.disabled = !(state.area && state.files.length);
    }
}

analyzeBtn?.addEventListener('click', () => {
    if (!state.area || !state.files.length) {
        return;
    }

    const filesForSession = state.previews.map((preview, index) => ({
        name: preview.name,
        type: preview.type || state.files[index]?.type || 'image/jpeg',
        dataURL: preview.dataURL
    }));

    const sessionPayload = {
        area: state.area,
        files: filesForSession,
        results: null,
        threshold: 0.5,
        timestamp: Date.now()
    };

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sessionPayload));
    window.location.href = 'results.html';
});

