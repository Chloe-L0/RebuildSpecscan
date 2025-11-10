import {
    AREAS,
    dataURLToFile,
    readState,
    recordDetections,
    resetState,
    setAnalysisStatus,
    setAnalysisThreshold,
    setCurrentAreaView,
    setCurrentPhotoIndex,
    summarizeDetectionsByArea,
    toggleFalsePositive,
    toInspectionAreaSlug
} from './state.js';

const statusBanner = document.getElementById('statusBanner');
const statusTitle = document.getElementById('statusTitle');
const statusSubtitle = document.getElementById('statusSubtitle');
const resultMeta = document.getElementById('resultMeta');
const loadingState = document.getElementById('loadingState');
const resultsContent = document.getElementById('resultsContent');
const areaTabs = document.getElementById('areaTabs');
const resultImage = document.getElementById('resultImage');
const overlayLayer = document.getElementById('overlayLayer');
const viewerMeta = document.getElementById('viewerMeta');
const viewerSummary = document.getElementById('viewerSummary');
const thresholdSlider = document.getElementById('thresholdSlider');
const thresholdValue = document.getElementById('thresholdValue');
const detectionList = document.getElementById('detectionList');
const emptyDetectionState = document.getElementById('emptyDetectionState');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const reorganizeBtn = document.getElementById('reorganizeBtn');
const reportBtn = document.getElementById('reportBtn');
const startOverBtn = document.getElementById('startOverBtn');
const saveDraftBtn = document.getElementById('saveDraftBtn');

let activeHighlight = null;

const ensureTaggingComplete = () => {
    const state = readState();
    if (!state.inspection.tailNumber || !state.inspection.startedAt) {
        window.location.replace('index.html');
        return null;
    }
    if (!state.photos.length) {
        window.location.replace('capture.html');
        return null;
    }
    const tagged = state.photos.filter((photo) => photo.area);
    if (!tagged.length) {
        window.location.replace('tag.html');
        return null;
    }
    return state;
};

const taggedPhotos = (state) => state.photos.filter((photo) => Boolean(photo.area));

const toggleLoading = (visible) => {
    loadingState.classList.toggle('hidden', !visible);
    resultsContent.classList.toggle('hidden', visible);
};

const updateStatus = (title, subtitle, meta) => {
    statusTitle.textContent = title;
    statusSubtitle.textContent = subtitle;
    resultMeta.textContent = meta;
};

const runAnalysis = async () => {
    const state = readState();
    const photos = taggedPhotos(state);
    toggleLoading(true);
    updateStatus('Running analysis…', 'Roboflow is processing uploaded imagery.', `${photos.length} photo(s)`);
    setAnalysisStatus('running');

    const aggregated = [];

    try {
        for (const photo of photos) {
            const file = dataURLToFile(photo.dataURL, photo.name);
            const formData = new FormData();
            formData.append('area', toInspectionAreaSlug(photo.area));
            formData.append('image', file, photo.name);

            const response = await fetch('/api/analyze', {
                method: 'POST',
                body: formData
            });

            const payload = await response.json();
            if (!response.ok) {
                throw new Error(payload.message || payload.error || `Unexpected error (${response.status})`);
            }

            const imageWidth = payload.image?.width || payload.imageSize?.w || null;
            const imageHeight = payload.image?.height || payload.imageSize?.h || null;

            const predictions = Array.isArray(payload.predictions) ? payload.predictions : [];
            predictions.forEach((prediction, index) => {
                aggregated.push({
                    id: `${photo.id}-${index}`,
                    photoId: photo.id,
                    photoNumber: photo.number,
                    area: photo.area,
                    class: prediction.class || 'Defect',
                    confidence: typeof prediction.confidence === 'number' ? prediction.confidence : null,
                    bbox: {
                        x: prediction.x ?? null,
                        y: prediction.y ?? null,
                        width: prediction.width ?? null,
                        height: prediction.height ?? null,
                        imageWidth,
                        imageHeight
                    },
                    falsePositive: false
                });
            });
        }

        recordDetections({
            detections: aggregated,
            threshold: 0.5
        });

        const refreshed = readState();
        const counts = summarizeDetectionsByArea(refreshed);
        const nonZeroArea = AREAS.find((area) => counts[area] > 0) ?? taggedPhotos(refreshed)[0]?.area ?? AREAS[0];
        setCurrentAreaView(nonZeroArea);
        setCurrentPhotoIndex(0);
        setAnalysisStatus('complete');
        toggleLoading(false);
        render();
    } catch (error) {
        console.error('Analysis error', error);
        setAnalysisStatus('error', error.message);
        toggleLoading(false);
        updateStatus(
            'Analysis failed',
            error.message || 'Something went wrong while contacting Roboflow.',
            'Retry from Tag step'
        );
        alert(error.message || 'Analysis failed. Please verify your Roboflow configuration.');
    }
};

const renderTabs = (state) => {
    const counts = summarizeDetectionsByArea(state);
    const activeArea = state.analysis.currentArea || AREAS[0];
    areaTabs.innerHTML = '';
    AREAS.forEach((area) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `tab${area === activeArea ? ' active' : ''}`;
        tab.innerHTML = `<span>${area}</span><span class="tab-count">${counts[area] || 0}</span>`;
        tab.addEventListener('click', () => {
            setCurrentAreaView(area);
            setCurrentPhotoIndex(0);
            render();
        });
        areaTabs.appendChild(tab);
    });
};

const filterDetections = (state, area, photoId) => {
    const threshold = state.analysis.threshold;
    return state.detections.filter((detection) => {
        if (detection.area !== area) return false;
        if (photoId !== undefined && detection.photoId !== photoId) return false;
        if (detection.falsePositive) return false;
        if (typeof detection.confidence === 'number' && detection.confidence < threshold) return false;
        return true;
    });
};

const renderOverlay = (state, photo) => {
    overlayLayer.innerHTML = '';
    if (!photo) return;

    const detections = filterDetections(state, photo.area, photo.id);
    if (!detections.length) return;

    const rect = resultImage.getBoundingClientRect();
    const naturalWidth = resultImage.naturalWidth || rect.width;
    const naturalHeight = resultImage.naturalHeight || rect.height;

    detections.forEach((detection) => {
        const { bbox } = detection;
        if (
            !bbox ||
            bbox.x == null ||
            bbox.y == null ||
            bbox.width == null ||
            bbox.height == null ||
            !(bbox.imageWidth || naturalWidth) ||
            !(bbox.imageHeight || naturalHeight)
        ) {
            return;
        }

        const imageWidth = bbox.imageWidth || naturalWidth;
        const imageHeight = bbox.imageHeight || naturalHeight;
        const scaleX = rect.width / imageWidth;
        const scaleY = rect.height / imageHeight;

        const left = (bbox.x - bbox.width / 2) * scaleX;
        const top = (bbox.y - bbox.height / 2) * scaleY;
        const width = bbox.width * scaleX;
        const height = bbox.height * scaleY;

        const box = document.createElement('div');
        box.className = 'overlay-box';
        if (activeHighlight === detection.id) {
            box.classList.add('highlight');
        }
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${width}px`;
        box.style.height = `${height}px`;
        box.dataset.predictionId = detection.id;

        const label = document.createElement('div');
        label.className = 'label';
        const confidence = typeof detection.confidence === 'number' ? `${Math.round(detection.confidence * 100)}%` : '—';
        label.textContent = `${detection.class} · ${confidence}`;

        box.appendChild(label);
        overlayLayer.appendChild(box);
    });
};

const renderDetectionList = (state, area, photo) => {
    detectionList.innerHTML = '';
    const relevantDetections = filterDetections(state, area);
    if (!relevantDetections.length) {
        detectionList.classList.add('hidden');
        emptyDetectionState.classList.remove('hidden');
        return;
    }

    detectionList.classList.remove('hidden');
    emptyDetectionState.classList.add('hidden');
    const threshold = Math.round(state.analysis.threshold * 100);

    relevantDetections.forEach((detection) => {
        const card = document.createElement('article');
        card.className = 'detection-card';
        card.dataset.predictionId = detection.id;

        if (detection.falsePositive) {
            card.dataset.muted = 'true';
            card.classList.add('false-positive');
        }

        const title = document.createElement('header');
        title.innerHTML = `<span>${detection.class}</span><span>${typeof detection.confidence === 'number'
            ? `${Math.round(detection.confidence * 100)}%`
            : 'Confidence n/a'}</span>`;

        const meta = document.createElement('div');
        meta.className = 'detection-meta';
        meta.innerHTML = `<span>Photo #${detection.photoNumber}</span><span>${detection.area}</span><span>Threshold ≥${threshold}%</span>`;

        const actions = document.createElement('div');
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'ghost';
        toggle.textContent = detection.falsePositive ? 'Restore Detection' : 'Mark False Positive';
        toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleFalsePositive(detection.id);
            render();
        });
        actions.appendChild(toggle);

        card.append(title, meta, actions);
        card.addEventListener('click', () => {
            activeHighlight = detection.id;
            render();
        });

        detectionList.appendChild(card);
    });

    if (photo) {
        const highlightExists = relevantDetections.some((det) => det.id === activeHighlight);
        if (!highlightExists) {
            activeHighlight = relevantDetections[0]?.id ?? null;
        }
    }
};

const renderViewer = () => {
    const state = readState();
    const area = state.analysis.currentArea || AREAS[0];
    const areaPhotos = state.photos.filter((photo) => photo.area === area);

    if (!areaPhotos.length) {
        resultImage.removeAttribute('src');
        viewerMeta.textContent = 'No photos tagged for this area';
        viewerSummary.textContent = '';
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        overlayLayer.innerHTML = '';
        renderDetectionList(state, area);
        return;
    }

    let index = state.analysis.currentPhotoIndex ?? 0;
    if (index < 0) index = 0;
    if (index > areaPhotos.length - 1) index = areaPhotos.length - 1;
    setCurrentPhotoIndex(index);
    const currentPhoto = areaPhotos[index];

    viewerMeta.textContent = `Photo ${index + 1} of ${areaPhotos.length} · #${currentPhoto.number}`;
    const detectionsForPhoto = filterDetections(state, area, currentPhoto.id);
    const summary = detectionsForPhoto.length
        ? `${detectionsForPhoto.length} detection${detectionsForPhoto.length === 1 ? '' : 's'}`
        : 'No detections';
    viewerSummary.textContent = summary;

    resultImage.onload = () => renderOverlay(state, currentPhoto);
    resultImage.src = currentPhoto.dataURL;
    if (resultImage.complete && resultImage.naturalWidth) {
        renderOverlay(state, currentPhoto);
    }

    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === areaPhotos.length - 1;

    renderDetectionList(state, area, currentPhoto);
};

const renderThreshold = () => {
    const state = readState();
    const thresholdPct = Math.round(state.analysis.threshold * 100);
    thresholdSlider.value = String(thresholdPct);
    thresholdValue.textContent = `${thresholdPct}%`;
};

const render = () => {
    const state = readState();
    renderTabs(state);
    renderThreshold();
    renderViewer();

    const totalDetections = state.detections.filter((det) => !det.falsePositive).length;
    const totalPhotos = taggedPhotos(state).length;
    updateStatus(
        'Analysis complete',
        `${totalDetections} detection${totalDetections === 1 ? '' : 's'} across ${totalPhotos} tagged photo${totalPhotos === 1 ? '' : 's'}.`,
        `Confidence ≥ ${Math.round(state.analysis.threshold * 100)}%`
    );
};

thresholdSlider?.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    const normalized = Math.max(0, Math.min(100, value)) / 100;
    setAnalysisThreshold(normalized);
    thresholdValue.textContent = `${Math.round(normalized * 100)}%`;
    render();
});

prevBtn?.addEventListener('click', () => {
    const state = readState();
    const area = state.analysis.currentArea || AREAS[0];
    const areaPhotos = state.photos.filter((photo) => photo.area === area);
    const nextIndex = Math.max(0, (state.analysis.currentPhotoIndex ?? 0) - 1);
    if (areaPhotos.length) {
        setCurrentPhotoIndex(nextIndex);
        render();
    }
});

nextBtn?.addEventListener('click', () => {
    const state = readState();
    const area = state.analysis.currentArea || AREAS[0];
    const areaPhotos = state.photos.filter((photo) => photo.area === area);
    const nextIndex = Math.min(areaPhotos.length - 1, (state.analysis.currentPhotoIndex ?? 0) + 1);
    if (areaPhotos.length) {
        setCurrentPhotoIndex(nextIndex);
        render();
    }
});

reorganizeBtn?.addEventListener('click', () => {
    window.location.href = 'tag.html';
});

reportBtn?.addEventListener('click', () => {
    window.location.href = 'report.html';
});

startOverBtn?.addEventListener('click', () => {
    resetState();
    window.location.href = 'index.html';
});

saveDraftBtn?.addEventListener('click', () => {
    alert('Draft saved locally. Submit or export from the Report step to finalize.');
});

const initialState = ensureTaggingComplete();

if (initialState) {
    if (initialState.analysis.status === 'complete' && initialState.detections.length) {
        toggleLoading(false);
        render();
    } else {
        runAnalysis();
    }
}

