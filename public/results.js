const STORAGE_KEY = 'specscanInspection';

const statusBanner = document.getElementById('statusBanner');
const loadingState = document.getElementById('loadingState');
const resultsContent = document.getElementById('resultsContent');
const resultImage = document.getElementById('resultImage');
const overlayLayer = document.getElementById('overlayLayer');
const detectionList = document.getElementById('detectionList');
const emptyState = document.getElementById('emptyState');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const imageMeta = document.getElementById('imageMeta');
const thresholdSlider = document.getElementById('thresholdSlider');
const thresholdValue = document.getElementById('thresholdValue');
const newSessionBtn = document.getElementById('newSessionBtn');

const state = {
    area: null,
    previews: [],
    results: [],
    currentIndex: 0,
    threshold: 0.5
};

init();

function init() {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
        redirectToWizard();
        return;
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        console.error('Failed to parse session payload', error);
        sessionStorage.removeItem(STORAGE_KEY);
        redirectToWizard();
        return;
    }

    if (!parsed?.area || !Array.isArray(parsed.files) || !parsed.files.length) {
        redirectToWizard();
        return;
    }

    state.area = parsed.area;
    state.previews = parsed.files;
    state.threshold = typeof parsed.threshold === 'number' ? parsed.threshold : 0.5;
    state.currentIndex = typeof parsed.currentIndex === 'number' ? parsed.currentIndex : 0;

    thresholdSlider.value = String(Math.round(state.threshold * 100));
    thresholdValue.textContent = `${Math.round(state.threshold * 100)}%`;

    if (Array.isArray(parsed.results) && parsed.results.length) {
        state.results = normalizeResults(parsed.results);
        state.currentIndex = clamp(state.currentIndex, 0, state.results.length - 1);
        const totalDetections = state.results.reduce((sum, result) => sum + (result.predictions?.length || 0), 0);
        statusBanner.textContent = `Analysis complete · ${totalDetections} detection(s) across ${state.results.length} image(s).`;
        statusBanner.classList.remove('error');
        toggleLoading(false);
        resultsContent?.classList.remove('hidden');
        renderCurrentImage();
    } else {
        analyzeImages();
    }
}

function normalizeResults(results) {
    return results.map((result, index) => {
        const predictions = (result.predictions || []).map((prediction, idx) => ({
            ...prediction,
            imageIndex: typeof prediction.imageIndex === 'number' ? prediction.imageIndex : index,
            id: prediction.id || `${index}-${idx}`
        }));

        return {
            imageIndex: typeof result.imageIndex === 'number' ? result.imageIndex : index,
            filename: result.filename || state.previews[index]?.name || `image_${index + 1}`,
            predictions,
            imageSize: result.imageSize || { w: null, h: null }
        };
    });
}

async function analyzeImages() {
    if (!state.area || !state.previews.length) {
        redirectToWizard();
        return;
    }

    toggleLoading(true);
    resultsContent?.classList.add('hidden');
    statusBanner?.classList.remove('error');
    statusBanner.textContent = 'Running image analysis…';

    const aggregatedResults = [];

    try {
        for (let index = 0; index < state.previews.length; index += 1) {
            const preview = state.previews[index];
            const file = dataURLToFile(preview.dataURL, preview.name, preview.type);
            const formData = new FormData();
            formData.append('area', state.area);
            formData.append('image', file, preview.name);

            const response = await fetch('/api/analyze', {
                method: 'POST',
                body: formData
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.error || `Unexpected error (${response.status})`);
            }

            const predictions = (payload.predictions || []).map((prediction, idx) => ({
                ...prediction,
                imageIndex: index,
                id: `${index}-${idx}`
            }));

            aggregatedResults.push({
                imageIndex: index,
                filename: preview.name,
                predictions,
                imageSize: payload.imageSize || { w: null, h: null }
            });
        }

        state.results = aggregatedResults;
        state.currentIndex = 0;
        state.threshold = 0.5;
        thresholdSlider.value = '50';
        thresholdValue.textContent = '50%';

        const totalDetections = state.results.reduce((sum, result) => sum + (result.predictions?.length || 0), 0);
        statusBanner.textContent = `Analysis complete · ${totalDetections} detection(s) across ${state.results.length} image(s).`;
        toggleLoading(false);
        resultsContent?.classList.remove('hidden');
        renderCurrentImage();
        persistSession();
    } catch (error) {
        console.error('Analysis error', error);
        statusBanner.textContent = error.message || 'Analysis failed';
        statusBanner?.classList.add('error');
        toggleLoading(false);
        resultsContent?.classList.add('hidden');
    }
}

function dataURLToFile(dataURL, fileName, preferredType) {
    if (!dataURL.startsWith('data:')) {
        throw new Error('Invalid image data');
    }

    const [meta, content] = dataURL.split(',');
    const mimeMatch = /data:(.*?);base64/.exec(meta);
    const mimeType = preferredType || (mimeMatch ? mimeMatch[1] : 'image/jpeg');
    const binary = atob(content);
    const buffer = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
        buffer[i] = binary.charCodeAt(i);
    }

    return new File([buffer], fileName, { type: mimeType });
}

function renderCurrentImage() {
    const current = state.results[state.currentIndex];
    if (!current) {
        return;
    }

    const preview = state.previews[current.imageIndex];
    imageMeta.textContent = `${preview?.name || current.filename} · ${state.currentIndex + 1} / ${state.results.length}`;

    renderDetections(current.predictions);
    resultImage.onload = () => {
        drawOverlay(current.predictions);
    };
    resultImage.src = preview?.dataURL || '';
    if (resultImage.complete && resultImage.naturalWidth) {
        drawOverlay(current.predictions);
    }

    prevBtn.disabled = state.currentIndex === 0;
    nextBtn.disabled = state.currentIndex >= state.results.length - 1;
}

function drawOverlay(predictions) {
    overlayLayer.innerHTML = '';
    const threshold = state.threshold;
    const filtered = predictions.filter((prediction) => typeof prediction.confidence !== 'number' || prediction.confidence >= threshold);

    if (!filtered.length) {
        return;
    }

    const rect = resultImage.getBoundingClientRect();
    const naturalWidth = resultImage.naturalWidth || rect.width;
    const naturalHeight = resultImage.naturalHeight || rect.height;
    const scaleX = rect.width / naturalWidth;
    const scaleY = rect.height / naturalHeight;

    filtered.forEach((prediction) => {
        if (
            typeof prediction.x !== 'number' ||
            typeof prediction.y !== 'number' ||
            typeof prediction.width !== 'number' ||
            typeof prediction.height !== 'number'
        ) {
            return;
        }

        const left = (prediction.x - prediction.width / 2) * scaleX;
        const top = (prediction.y - prediction.height / 2) * scaleY;
        const width = prediction.width * scaleX;
        const height = prediction.height * scaleY;

        const box = document.createElement('div');
        box.className = 'box';
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;
        box.dataset.predictionId = prediction.id;

        const label = document.createElement('div');
        label.className = 'label';
        const confidence = typeof prediction.confidence === 'number' ? `${Math.round(prediction.confidence * 100)}%` : '';
        label.textContent = confidence ? `${prediction.class || 'Defect'} · ${confidence}` : prediction.class || 'Defect';

        box.appendChild(label);
        overlayLayer.appendChild(box);
    });
}

function renderDetections(predictions) {
    detectionList.innerHTML = '';
    const filtered = predictions.filter((prediction) => typeof prediction.confidence !== 'number' || prediction.confidence >= state.threshold);

    if (!filtered.length) {
        emptyState?.classList.remove('hidden');
        return;
    }

    emptyState?.classList.add('hidden');

    filtered.forEach((prediction) => {
        const item = document.createElement('div');
        item.className = 'list-item';
        item.dataset.predictionId = prediction.id;

        const title = document.createElement('span');
        title.className = 'title';
        title.textContent = prediction.class || 'Defect';

        const meta = document.createElement('span');
        meta.className = 'meta';
        const confidence = typeof prediction.confidence === 'number' ? `${Math.round(prediction.confidence * 100)}% confidence` : 'Confidence unavailable';
        meta.textContent = confidence;

        item.appendChild(title);
        item.appendChild(meta);
        item.addEventListener('click', () => highlightPrediction(prediction.id));
        detectionList.appendChild(item);
    });
}

function highlightPrediction(predictionId) {
    overlayLayer.querySelectorAll('.box').forEach((box) => {
        box.classList.toggle('highlight', box.dataset.predictionId === predictionId);
    });

    detectionList.querySelectorAll('.list-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.predictionId === predictionId);
    });
}

prevBtn?.addEventListener('click', () => {
    if (state.currentIndex > 0) {
        state.currentIndex -= 1;
        renderCurrentImage();
        persistSession();
    }
});

nextBtn?.addEventListener('click', () => {
    if (state.currentIndex < state.results.length - 1) {
        state.currentIndex += 1;
        renderCurrentImage();
        persistSession();
    }
});

thresholdSlider?.addEventListener('input', (event) => {
    const value = Number(event.target.value) / 100;
    state.threshold = value;
    thresholdValue.textContent = `${event.target.value}%`;
    renderCurrentImage();
    persistSession();
});

newSessionBtn?.addEventListener('click', () => {
    sessionStorage.removeItem(STORAGE_KEY);
    window.location.href = 'wizard.html';
});

window.addEventListener('resize', () => {
    if (state.results.length) {
        renderCurrentImage();
    }
});

function toggleLoading(visible) {
    loadingState?.classList.toggle('active', visible);
}

function persistSession() {
    const payload = {
        area: state.area,
        files: state.previews,
        results: state.results,
        threshold: state.threshold,
        currentIndex: state.currentIndex,
        timestamp: Date.now()
    };

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function redirectToWizard() {
    window.location.href = 'wizard.html';
}

function clamp(value, min, max) {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

