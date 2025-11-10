import {
    loadState,
    setDetections,
    toggleFalsePositive
} from './state.js';

const areaTabs = document.getElementById('areaTabs');
const resultImage = document.getElementById('resultImage');
const overlayLayer = document.getElementById('overlayLayer');
const imageMeta = document.getElementById('imageMeta');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const slider = document.getElementById('confidenceSlider');
const sliderValue = document.getElementById('confidenceValue');
const detectionSummary = document.getElementById('detectionSummary');
const detectionsList = document.getElementById('detectionsList');
const emptyState = document.getElementById('emptyState');
const reorganizeBtn = document.getElementById('reorganizeBtn');
const continueReportBtn = document.getElementById('continueReportBtn');
const saveDraftBtn = document.getElementById('saveDraftBtn');

let state = loadState();

if (!state.start) {
    window.location.href = 'index.html';
}

if (state.photos.length === 0) {
    window.location.href = 'capture.html';
}

if (!state.detections.length) {
    const tagged = state.photos.filter(photo => photo.area);
    if (tagged.length) {
        const detections = generateDetections(tagged);
        const firstArea = detections[0]?.area ?? null;
        state = setDetections(detections, firstArea);
    } else {
        window.location.href = 'tag.html';
    }
}

let currentArea = state.areaView || 'All';
const availableAreas = new Set(state.detections.map(det => det.area));
if (!availableAreas.has(currentArea) && currentArea !== 'All') {
    currentArea = 'All';
}

let threshold = 0.5;
let currentPhotoIndex = 0;

sliderValue.textContent = `${slider.value}%`;

renderAreaTabs();
renderView();
renderDetections();
updateNavigation();
updateSummary();

areaTabs?.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-area]');
    if (!tab) return;
    currentArea = tab.dataset.area;
    currentPhotoIndex = 0;
    renderAreaTabs();
    renderView();
    renderDetections();
    updateNavigation();
    updateSummary();
});

slider?.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    sliderValue.textContent = `${value}%`;
    threshold = value / 100;
    renderView();
    renderDetections();
    updateSummary();
});

prevBtn?.addEventListener('click', () => {
    const photos = filteredPhotos();
    if (currentPhotoIndex > 0) {
        currentPhotoIndex -= 1;
        renderView();
        updateNavigation();
    }
});

nextBtn?.addEventListener('click', () => {
    const photos = filteredPhotos();
    if (currentPhotoIndex < photos.length - 1) {
        currentPhotoIndex += 1;
        renderView();
        updateNavigation();
    }
});

reorganizeBtn?.addEventListener('click', () => {
    window.location.href = 'tag.html';
});

continueReportBtn?.addEventListener('click', () => {
    window.location.href = 'report.html';
});

saveDraftBtn?.addEventListener('click', () => {
    saveDraftBtn.textContent = 'Draft Saved';
    saveDraftBtn.disabled = true;
    setTimeout(() => {
        saveDraftBtn.textContent = 'Save Draft';
        saveDraftBtn.disabled = false;
    }, 1500);
});

window.addEventListener('resize', debounce(() => {
    renderView();
}, 120));

function renderAreaTabs() {
    const counts = areaCounts();
    areaTabs.innerHTML = '';
    const areas = ['All', ...Array.from(counts.keys()).filter(area => area !== 'All')];
    areas.forEach((area) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'tab';
        if (area === currentArea) {
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
        }
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', 'detectionsList');
        tab.dataset.area = area;
        const badge = counts.get(area) ?? 0;
        tab.innerHTML = `
            <span>${area}</span>
            <span class="badge">${badge}</span>
        `;
        areaTabs.appendChild(tab);
    });
}

function renderView() {
    const photos = filteredPhotos();
    const detections = filteredDetections();

    if (!photos.length) {
        resultImage.removeAttribute('src');
        resultImage.setAttribute('alt', 'No photo available');
        imageMeta.textContent = 'No photos for this area';
        overlayLayer.innerHTML = '';
        return;
    }

    const photo = photos[currentPhotoIndex] || photos[0];
    imageMeta.textContent = `Photo ${photo.number} · ${photo.name}`;
    const src = photo.dataURL || buildPlaceholderImage(photo);
    resultImage.src = src;
    resultImage.alt = `Inspection photo ${photo.name}`;
    drawOverlay(photo, detections.filter(det => det.photoId === photo.id));
}

function renderDetections() {
    detectionsList.innerHTML = '';
    const detections = filteredDetections();

    if (!detections.length) {
        emptyState.classList.remove('hidden');
        return;
    }
    emptyState.classList.add('hidden');

    detections.forEach((detection) => {
        const card = document.createElement('div');
        card.className = 'detection-card';
        if (state.falsePositives.includes(detection.id)) {
            card.classList.add('muted');
        }
        card.innerHTML = `
            <div class="detection-header">
                <strong>${detection.type}</strong>
                <button class="toggle-flag" type="button">${state.falsePositives.includes(detection.id) ? 'Undo Flag' : 'Mark False Positive'}</button>
            </div>
            <div class="helper">Confidence ${Math.round(detection.confidence * 100)}% · Photo ${detection.photoNumber} · ${detection.area}</div>
        `;

        card.querySelector('.toggle-flag')?.addEventListener('click', () => {
            state = toggleFalsePositive(detection.id);
            renderDetections();
            renderView();
            updateSummary();
        });

        detectionsList.appendChild(card);
    });
}

function updateNavigation() {
    const photos = filteredPhotos();
    prevBtn.disabled = currentPhotoIndex === 0;
    nextBtn.disabled = currentPhotoIndex >= photos.length - 1;
}

function updateSummary() {
    const detections = filteredDetections();
    detectionSummary.textContent = `${detections.length} detection${detections.length === 1 ? '' : 's'} visible`;
}

function filteredPhotos() {
    const relevant = currentArea === 'All'
        ? state.photos
        : state.photos.filter(photo => photo.area === currentArea);
    return relevant.length ? relevant : state.photos;
}

function filteredDetections() {
    return state.detections.filter((det) => {
        const areaMatch = currentArea === 'All' || det.area === currentArea;
        const confidenceMatch = det.confidence >= threshold;
        return areaMatch && confidenceMatch;
    });
}

function areaCounts() {
    const counts = new Map();
    state.detections.forEach((det) => {
        counts.set(det.area, (counts.get(det.area) || 0) + 1);
    });
    const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
    counts.set('All', total);
    return counts;
}

function generateDetections(taggedPhotos) {
    const typesByArea = {
        'Fuselage': ['Rivet Crack', 'Loose Panel', 'Corrosion'],
        'Left Wing': ['Surface Dent', 'Fastener Out', 'Fuel Stain'],
        'Right Wing': ['Surface Dent', 'Fastener Out', 'Fuel Stain'],
        'Tail': ['Control Surface Wear', 'Sealant Voids'],
        'Landing Gear': ['Hydraulic Leak', 'Wear Indicator'],
        'Engines': ['Oil Residue', 'Blade Nick', 'Exhaust Soot']
    };

    return taggedPhotos.map((photo, index) => {
        const pool = typesByArea[photo.area] || ['Defect'];
        return {
            id: `${photo.id}-${index}`,
            photoId: photo.id,
            photoNumber: photo.number,
            area: photo.area,
            type: pool[index % pool.length],
            confidence: Math.round((0.6 + Math.random() * 0.35) * 100) / 100
        };
    });
}

function buildPlaceholderImage(photo) {
    const width = 800;
    const height = 520;
    const background = 'f5f5f7';
    const text = encodeURIComponent(`Photo ${photo.number}`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <rect width="100%" height="100%" fill="#${background}"/>
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="48" fill="#1b1e2b" opacity="0.45">${text}</text>
    </svg>`;
    return `data:image/svg+xml,${svg}`;
}

function drawOverlay(photo, detections) {
    overlayLayer.innerHTML = '';
    if (!detections.length) return;
    detections.forEach((det, index) => {
        const [top, left, width, height] = seededBox(det.id, index);
        const box = document.createElement('div');
        box.className = 'box';
        box.style.top = `${top}%`;
        box.style.left = `${left}%`;
        box.style.width = `${width}%`;
        box.style.height = `${height}%`;
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = `${det.type} · ${Math.round(det.confidence * 100)}%`;
        box.appendChild(label);
        overlayLayer.appendChild(box);
    });
}

function seededBox(id, offset) {
    let hash = 0;
    for (let i = 0; i < id.length; i += 1) {
        hash = (hash << 5) - hash + id.charCodeAt(i);
        hash |= 0;
    }
    const base = Math.abs(hash + offset * 997);
    const top = 10 + (base % 60);
    const left = 10 + ((base >> 3) % 50);
    const width = 20 + ((base >> 5) % 30);
    const height = 20 + ((base >> 7) % 35);
    return [Math.min(top, 70), Math.min(left, 60), width, height];
}

function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => fn.apply(null, args), wait);
    };
}
