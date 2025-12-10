import {
    addPhotosToState,
    getAreaColor,
    readState,
    removePhotoFromState,
    resetState
} from './state.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const takePhotoBtn = document.getElementById('takePhotoBtn');
const uploadPhotosBtn = document.getElementById('uploadPhotosBtn');
const fileInput = document.getElementById('fileInput');
const mediaGrid = document.getElementById('mediaGrid');
const emptyState = document.getElementById('emptyState');
const continueBtn = document.getElementById('continueBtn');
const cancelBtn = document.getElementById('cancelBtn');
const photoCount = document.getElementById('photoCount');
const aircraftLabel = document.getElementById('aircraftLabel');
const inspectionMeta = document.getElementById('inspectionMeta');

const ensureInspection = () => {
    const state = readState();
    if (!state.inspection.tailNumber || !state.inspection.startedAt) {
        window.location.replace('index.html');
        return null;
    }
    return state;
};

const formatInspectionMeta = (state) => {
    const started = state.inspection.startedAt
        ? new Date(state.inspection.startedAt).toLocaleString()
        : '';
    return `${state.inspection.inspectionType} · ${started}`;
};

const fileToDataURL = (file) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

const renderPhotos = () => {
    const state = readState();
    aircraftLabel.textContent = `Tail ${state.inspection.tailNumber || '—'}`;
    inspectionMeta.textContent = formatInspectionMeta(state);
    const count = state.photos.length;
    photoCount.textContent = count === 1 ? '1 Photo' : `${count} Photos`;

    if (!count) {
        emptyState.classList.remove('hidden');
        mediaGrid.classList.add('hidden');
        continueBtn.disabled = true;
        mediaGrid.innerHTML = '';
        return;
    }

    emptyState.classList.add('hidden');
    mediaGrid.classList.remove('hidden');
    continueBtn.disabled = false;
    mediaGrid.innerHTML = '';

    state.photos.forEach((photo) => {
        const tile = document.createElement('div');
        tile.className = 'photo-tile';

        const thumb = document.createElement('img');
        thumb.className = 'photo-thumb';
        thumb.src = photo.dataURL;
        thumb.alt = photo.name;

        const meta = document.createElement('div');
        meta.className = 'photo-meta';
        meta.innerHTML = `<span>Photo #${photo.number}</span><span class="muted">${photo.name}</span>`;

        const foot = document.createElement('div');
        foot.className = 'photo-actions';
        const areaChip = document.createElement('span');
        areaChip.className = 'chip';
        areaChip.dataset.state = photo.area ? 'assigned' : 'pending';
        areaChip.textContent = photo.area ? photo.area : 'Area unassigned';
        // Apply area-specific color to chip
        if (photo.area) {
            const colors = getAreaColor(photo.area);
            areaChip.style.backgroundColor = colors.light;
            areaChip.style.borderColor = colors.border;
            areaChip.style.color = colors.text;
        }
        const size = document.createElement('span');
        size.className = 'muted';
        size.textContent = 'Tap to tag next step';
        foot.append(areaChip, size);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.innerHTML = '&times;';
        remove.title = 'Remove photo';
        remove.addEventListener('click', () => {
            removePhotoFromState(photo.id);
            renderPhotos();
        });

        tile.append(thumb, meta, foot, remove);
        mediaGrid.appendChild(tile);
    });
};

const processFiles = async (files) => {
    if (!files.length) return;
    const validImages = Array.from(files).filter(
        (file) => file.type.startsWith('image/') && file.size <= MAX_FILE_SIZE
    );
    const rejected = files.length - validImages.length;
    if (!validImages.length) {
        if (rejected) {
            alert('No valid images selected. Ensure files are images under 10MB.');
        }
        return;
    }

    const conversions = await Promise.all(validImages.map((file) => fileToDataURL(file)));
    const newPhotos = conversions.map((dataURL, index) => ({
        name: validImages[index].name || `image_${Date.now()}_${index + 1}.jpg`,
        dataURL
    }));
    addPhotosToState(newPhotos);
    renderPhotos();

    if (rejected > 0) {
        alert(`${rejected} file(s) were skipped. Only image files up to 10MB are allowed.`);
    }
};

takePhotoBtn?.addEventListener('click', () => {
    fileInput.accept = 'image/*';
    fileInput.capture = 'environment';
    fileInput.removeAttribute('multiple');
    fileInput.click();
});

uploadPhotosBtn?.addEventListener('click', () => {
    fileInput.accept = 'image/*';
    fileInput.removeAttribute('capture');
    fileInput.multiple = true;
    fileInput.click();
});

fileInput?.addEventListener('change', (event) => {
    const files = event.target.files || [];
    processFiles(files).finally(() => {
        fileInput.value = '';
    });
});

continueBtn?.addEventListener('click', () => {
    const state = readState();
    if (!state.photos.length) return;
    window.location.href = 'tag.html';
});

cancelBtn?.addEventListener('click', () => {
    resetState();
    window.location.href = 'index.html';
});

const state = ensureInspection();
if (state) {
    renderPhotos();
}

