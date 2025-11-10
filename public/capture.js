import {
    loadState,
    addPhoto as addPhotoToState,
    removePhoto as removePhotoFromState,
    resetState
} from './state.js';

const banner = document.getElementById('progressBanner');
const stage = document.getElementById('captureStage');
const grid = document.getElementById('photoGrid');
const takePhotoBtn = document.getElementById('takePhotoBtn');
const uploadPhotosBtn = document.getElementById('uploadPhotosBtn');
const fileInput = document.getElementById('fileInput');
const continueBtn = document.getElementById('continueToTagBtn');
const cancelBtn = document.getElementById('cancelCaptureBtn');

let state = loadState();

if (!state.start) {
    window.location.href = 'index.html';
}

renderProgress();
renderPhotos();

takePhotoBtn?.addEventListener('click', () => {
    const nextNumber = state.counters.photo ?? state.photos.length + 1;
    const label = `Captured Photo ${nextNumber}`;
    const dataURL = buildPlaceholderImage(nextNumber, label);
    state = addPhotoToState({ name: label, status: 'captured', dataURL });
    renderPhotos();
    updateContinueState();
});

uploadPhotosBtn?.addEventListener('click', () => {
    fileInput?.click();
});

fileInput?.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
        return;
    }

    for (const file of files) {
        const dataURL = await readFileAsDataURL(file);
        state = addPhotoToState({
            name: file.name,
            status: 'uploaded',
            dataURL
        });
    }

    renderPhotos();
    updateContinueState();
    event.target.value = '';
});

continueBtn?.addEventListener('click', () => {
    if (state.photos.length === 0) {
        return;
    }
    window.location.href = 'tag.html';
});

cancelBtn?.addEventListener('click', () => {
    resetState();
    window.location.href = 'index.html';
});

function renderProgress() {
    const { start, photos } = state;
    const photoCount = photos.length;
    const photoLabel = photoCount === 1 ? 'photo' : 'photos';
    banner.innerHTML = `
        <strong>Inspection context</strong>
        <div class="progress-row">
            <span>Tail <strong>${start.tailNumber}</strong></span>
            <span>Type <strong>${start.inspectionType}</strong></span>
            <span>Inspector <strong>${start.inspectorName}</strong></span>
        </div>
        <div class="status-grid">
            <div class="helper">Captured <strong>${photoCount}</strong> ${photoLabel}</div>
        </div>
    `;
}

function renderPhotos() {
    state = loadState();
    const { photos } = state;
    grid.innerHTML = '';

    if (!photos.length) {
        stage.innerHTML = `
            <div>
                <strong>No photos captured yet</strong>
                <p class="muted">Use the buttons below to capture live imagery or upload existing shots from the hangar floor.</p>
            </div>
        `;
        updateContinueState();
        renderProgress();
        return;
    }

    stage.innerHTML = `
        <div>
            <strong>${photos.length} photos ready</strong>
            <p class="muted">Continue capturing as needed or proceed to organize the imagery.</p>
        </div>
    `;

    photos.forEach((photo) => {
        const tile = document.createElement('div');
        tile.className = 'photo-tile';
        tile.innerHTML = `
            <div class="photo-thumb" aria-hidden="true"></div>
            <div class="photo-meta">
                <strong>Photo ${photo.number}</strong>
                <span>${photo.name}</span>
                <span>${photo.area ? `Area: ${formatArea(photo.area)}` : 'Area: Pending tag'}</span>
            </div>
            <button class="tile-close" type="button" aria-label="Remove photo ${photo.number}">×</button>
        `;

        const thumb = tile.querySelector('.photo-thumb');
        const preview = photo.dataURL || buildPlaceholderImage(photo.number, photo.name);
        thumb.style.backgroundImage = `url('${preview}')`;
        thumb.classList.add('with-image');

        tile.querySelector('.tile-close')?.addEventListener('click', () => {
            state = removePhotoFromState(photo.id);
            renderPhotos();
            updateContinueState();
        });

        grid.appendChild(tile);
    });

    renderProgress();
    updateContinueState();
}

function updateContinueState() {
    continueBtn.disabled = state.photos.length === 0;
}

function formatArea(area) {
    switch (area) {
        case 'Fuselage':
            return 'Fuselage';
        case 'Left Wing':
            return 'Left Wing';
        case 'Right Wing':
            return 'Right Wing';
        case 'Tail':
            return 'Tail';
        case 'Landing Gear':
            return 'Landing Gear';
        case 'Engines':
            return 'Engines';
        default:
            return area;
    }
}

function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
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

