import {
    loadState,
    updatePhotoArea,
    setDetections
} from './state.js';

const AREAS = [
    'Fuselage',
    'Left Wing',
    'Right Wing',
    'Tail',
    'Landing Gear',
    'Engines'
];

const tagProgress = document.getElementById('tagProgress');
const tagBody = document.getElementById('tagBody');
const areaChips = document.getElementById('areaChips');
const analyzeBtn = document.getElementById('analyzeBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const backBtn = document.getElementById('backToCaptureBtn');

let state = loadState();
let selected = new Set();

if (!state.start) {
    window.location.href = 'index.html';
}

if (state.photos.length === 0) {
    window.location.href = 'capture.html';
}

renderProgress();
renderAreaChips();
renderPhotoGrid();
updateAnalyzeState();

selectAllBtn?.addEventListener('click', () => {
    const untaggedIds = state.photos.filter(photo => !photo.area).map(photo => photo.id);
    selected = new Set(untaggedIds);
    renderPhotoGrid();
});

backBtn?.addEventListener('click', () => {
    window.location.href = 'capture.html';
});

analyzeBtn?.addEventListener('click', () => {
    if (!hasTaggedPhotos()) {
        return;
    }
    const detections = generateDetections(state.photos.filter(photo => photo.area));
    const firstArea = detections[0]?.area ?? null;
    setDetections(detections, firstArea);
    window.location.href = 'results.html';
});

function renderProgress() {
    const tagged = state.photos.filter(photo => Boolean(photo.area)).length;
    const total = state.photos.length;
    tagProgress.innerHTML = `
        <strong>Tagging progress</strong>
        <div class="progress-row">
            <span>Tagged <strong>${tagged}</strong> of <strong>${total}</strong> photos</span>
            <span>Tail <strong>${state.start.tailNumber}</strong></span>
            <span>Type <strong>${state.start.inspectionType}</strong></span>
        </div>
    `;
}

function renderPhotoGrid() {
    state = loadState();
    tagBody.innerHTML = '';

    const toolbar = document.createElement('div');
    toolbar.className = 'selection-toolbar';
    toolbar.innerHTML = `
        <div class="helper">${selected.size} photo(s) selected</div>
        <div class="helper">${state.photos.filter(photo => photo.area).length} tagged</div>
    `;
    tagBody.appendChild(toolbar);

    const grid = document.createElement('div');
    grid.className = 'photo-grid';

    state.photos.forEach((photo) => {
        const tile = document.createElement('div');
        tile.className = 'photo-tile selectable';
        if (selected.has(photo.id)) {
            tile.classList.add('selected');
        }

        tile.innerHTML = `
            <div class="photo-thumb" aria-hidden="true"></div>
            <div class="photo-meta">
                <strong>Photo ${photo.number}</strong>
                <span>${photo.name}</span>
                <span>${photo.area ? `Area: ${photo.area}` : 'Area: Not tagged'}</span>
            </div>
        `;

        const thumb = tile.querySelector('.photo-thumb');
        const preview = photo.dataURL || buildPlaceholderImage(photo.number, photo.name);
        thumb.style.backgroundImage = `url('${preview}')`;
        thumb.classList.add('with-image');

        tile.addEventListener('click', () => toggleSelection(photo.id));
        grid.appendChild(tile);
    });

    tagBody.appendChild(grid);
    renderProgress();
    updateAnalyzeState();
}

function renderAreaChips() {
    areaChips.innerHTML = '';
    AREAS.forEach((area) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'area-chip';
        button.textContent = area;
        button.addEventListener('click', () => assignArea(area));
        areaChips.appendChild(button);
    });
}

function toggleSelection(photoId) {
    if (selected.has(photoId)) {
        selected.delete(photoId);
    } else {
        selected.add(photoId);
    }
    renderPhotoGrid();
}

function assignArea(area) {
    if (selected.size === 0) {
        flashSelectionHint();
        return;
    }
    state = updatePhotoArea(Array.from(selected), area);
    selected.clear();
    renderPhotoGrid();
}

function flashSelectionHint() {
    analyzeBtn.classList.add('ghost');
    setTimeout(() => analyzeBtn.classList.remove('ghost'), 250);
}

function hasTaggedPhotos() {
    return state.photos.some(photo => Boolean(photo.area));
}

function updateAnalyzeState() {
    analyzeBtn.disabled = !hasTaggedPhotos();
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

    const detections = [];
    taggedPhotos.forEach((photo, index) => {
        const pool = typesByArea[photo.area] || ['Defect'];
        const type = pool[index % pool.length];
        const confidence = Math.round((0.6 + Math.random() * 0.35) * 100) / 100;
        detections.push({
            id: `${photo.id}-${index}`,
            photoId: photo.id,
            photoNumber: photo.number,
            area: photo.area,
            type,
            confidence,
            isFalsePositive: false
        });
    });

    return detections;
}

function buildPlaceholderImage(number, label) {
    const width = 600;
    const height = 400;
    const background = 'f5f5f7';
    const text = encodeURIComponent(label || `Photo ${number}`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
        <rect width="100%" height="100%" fill="#${background}"/>
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="36" fill="#1b1e2b" opacity="0.45">${text}</text>
    </svg>`;
    return `data:image/svg+xml,${svg}`;
}

