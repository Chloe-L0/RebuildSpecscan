import {
    addPhotosToState,
    getAreaColor,
    readState,
    removePhotoFromState,
    resetState
} from './state.js';

const MAX_FILE_SIZE = 12 * 1024 * 1024;

const takePhotoBtn = document.getElementById('takePhotoBtn');
const uploadPhotosBtn = document.getElementById('uploadPhotosBtn');
const fileInput = document.getElementById('fileInput');
const mediaGrid = document.getElementById('mediaGrid');
const emptyState = document.getElementById('emptyState');
const continueBtn = document.getElementById('continueBtn');
const cancelBtn = document.getElementById('cancelBtn');
const logoBtn = document.getElementById('logoBtn');

let selectedPhotos = new Set();

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

const MAX_DIMENSION = 1920;
const JPEG_QUALITY = 0.82;

/** Load file as image and return compressed data URL to avoid storage quota. */
const fileToCompressedDataURL = (file) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataURL = reader.result;
            if (!dataURL || typeof dataURL !== 'string') {
                reject(new Error('Could not read file'));
                return;
            }
            const img = new Image();
            img.onload = () => {
                try {
                    let w = img.width;
                    let h = img.height;
                    if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
                        if (w >= h) {
                            h = Math.round((h * MAX_DIMENSION) / w);
                            w = MAX_DIMENSION;
                        } else {
                            w = Math.round((w * MAX_DIMENSION) / h);
                            h = MAX_DIMENSION;
                        }
                    }
                    const canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        resolve(dataURL);
                        return;
                    }
                    ctx.drawImage(img, 0, 0, w, h);
                    const out = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
                    resolve(out || dataURL);
                } catch (e) {
                    resolve(dataURL);
                }
            };
            img.onerror = () => reject(new Error('Image failed to load'));
            img.src = dataURL;
        };
        reader.onerror = () => reject(reader.error || new Error('File read failed'));
        reader.readAsDataURL(file);
    });

const uploadArea = document.getElementById('uploadArea');

const renderPhotos = () => {
    const state = readState();
    const count = state.photos.length;

    if (!count) {
        // Show upload area, hide grid
        if (uploadArea) uploadArea.style.display = 'flex';
        if (emptyState) emptyState.classList.remove('hidden');
        if (mediaGrid) {
            mediaGrid.classList.add('hidden');
            mediaGrid.innerHTML = '';
        }
        if (continueBtn) continueBtn.disabled = true;
        return;
    }

    // Hide upload area, show grid
    if (uploadArea) uploadArea.style.display = 'none';
    if (emptyState) emptyState.classList.add('hidden');
    if (mediaGrid) {
        mediaGrid.classList.remove('hidden');
        mediaGrid.innerHTML = '';
    }
    if (continueBtn) continueBtn.disabled = false;

    state.photos.forEach((photo, index) => {
        const tile = document.createElement('div');
        tile.className = 'photo-tile';
        if (selectedPhotos.has(photo.id)) {
            tile.classList.add('selected');
        }
        tile.style.position = 'relative';
        tile.dataset.photoId = photo.id;

        const thumb = document.createElement('img');
        thumb.className = 'photo-thumb';
        thumb.src = photo.dataURL;
        thumb.alt = photo.name;

        const meta = document.createElement('div');
        meta.className = 'photo-meta';
        meta.innerHTML = `<span>Photo #${photo.number}</span><span style="color: #676767;">${photo.name}</span>`;

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
        size.style.color = '#676767';
        size.textContent = 'Tap to tag next step';
        foot.append(areaChip, size);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'remove';
        remove.innerHTML = '&times;';
        remove.title = 'Remove photo';
        remove.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedPhotos.delete(photo.id);
            removePhotoFromState(photo.id);
            renderPhotos();
        });

        tile.addEventListener('click', (e) => {
            if (e.target === remove || e.target.closest('.remove')) return;
            if (selectedPhotos.has(photo.id)) {
                selectedPhotos.delete(photo.id);
            } else {
                selectedPhotos.add(photo.id);
            }
            renderPhotos();
        });

        tile.append(thumb, meta, foot, remove);
        mediaGrid.appendChild(tile);
    });

    // Always add plus icon after the last photo
    const addIcon = document.createElement('div');
    addIcon.className = 'add-photo-icon';
    addIcon.innerHTML = '+';
    addIcon.title = 'Add more photos';
    addIcon.addEventListener('click', () => {
        uploadPhotosBtn?.click();
    });
    mediaGrid.appendChild(addIcon);
};

const isImageFile = (file) => {
    if (file.size > MAX_FILE_SIZE) return false;
    if (file.type && file.type.startsWith('image/')) return true;
    const name = (file.name || '').toLowerCase();
    return /\.(jpe?g|png|gif|webp|bmp)$/.test(name);
};

const processFiles = async (files) => {
    if (!files.length) return;
    const validImages = Array.from(files).filter(isImageFile);
    const rejected = files.length - validImages.length;
    if (!validImages.length) {
        if (rejected) {
            alert('No valid images selected. Use JPEG, PNG, GIF, or WebP under 12MB.');
        }
        return;
    }

    try {
        const conversions = await Promise.all(validImages.map((file) => fileToCompressedDataURL(file)));
        const newPhotos = conversions.map((dataURL, index) => ({
            name: validImages[index].name || `image_${Date.now()}_${index + 1}.jpg`,
            dataURL
        }));
        addPhotosToState(newPhotos);
        renderPhotos();

        if (rejected > 0) {
            alert(`${rejected} file(s) were skipped. Only image files up to 12MB are allowed.`);
        }
    } catch (err) {
        console.error('Upload failed', err);
        const isQuota = err && (err.name === 'QuotaExceededError' || err.code === 22);
        const msg = isQuota
            ? 'Storage limit reached. Try fewer or smaller images.'
            : (err?.message || 'Could not process the selected images. Try different files or smaller sizes.');
        alert(msg);
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

logoBtn?.addEventListener('click', () => {
    const currentStep = document.body.getAttribute('data-step');
    const stepNumber = currentStep ? parseInt(currentStep, 10) : null;
    
    if (stepNumber === 6) {
        // Step 6 (success page) - go directly without confirmation
        window.location.href = 'index.html';
    } else if (stepNumber && stepNumber >= 1 && stepNumber <= 5) {
        // Steps 1-5 - ask for confirmation
        if (confirm('Are you sure you want to abandon the current inspection session? All unsaved progress will be lost.')) {
            resetState();
            window.location.href = 'index.html';
        }
    } else {
        // Fallback - just navigate
        window.location.href = 'index.html';
    }
});

const state = ensureInspection();
if (state) {
    renderPhotos();
}

