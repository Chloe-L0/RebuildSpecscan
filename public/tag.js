import { clearPhotoAreas, readState, setPhotoArea } from './state.js';

const tagGrid = document.getElementById('tagGrid');
const emptyState = document.getElementById('emptyTagState');
const selectAllBtn = document.getElementById('selectAllBtn');
const clearSelectionBtn = document.getElementById('clearSelectionBtn');
const clearTagsBtn = document.getElementById('clearTagsBtn');
const selectionMeta = document.getElementById('selectionMeta');
const tagProgress = document.getElementById('tagProgress');
const tagSummary = document.getElementById('tagSummary');
const backBtn = document.getElementById('backBtn');
const nextBtn = document.getElementById('nextBtn');
const areaViewer = document.getElementById('areaViewer');

const SELECTED_AREA_KEY = 'selectedArea';
const selected = new Set();
let areaHotspots = [];

// Debug: Log when model-viewer is ready
if (areaViewer) {
    areaViewer.addEventListener('load', () => {
        console.log('✓ Model loaded successfully');
        // Re-query hotspots after model loads
        areaHotspots = Array.from(areaViewer.querySelectorAll('.area-hotspot'));
        console.log(`✓ Found ${areaHotspots.length} hotspots`);
        
        // Attach event listeners to hotspots
        areaHotspots.forEach((hotspot, index) => {
            console.log(`Hotspot ${index + 1}:`, hotspot.dataset.area);
            hotspot.addEventListener('click', () => {
                const { area } = hotspot.dataset;
                if (!area) return;
                handleAreaSelection(area);
            });
        });
        
        // Restore active state if needed
        const storedArea = sessionStorage.getItem(SELECTED_AREA_KEY);
        if (storedArea) {
            setActiveHotspots(storedArea);
        }
    });

    areaViewer.addEventListener('error', (event) => {
        console.error('✗ Model failed to load:', event);
    });
} else {
    console.error('✗ areaViewer element not found');
}

const ensurePhotos = () => {
    const state = readState();
    if (!state.inspection.tailNumber || !state.inspection.startedAt) {
        window.location.replace('index.html');
        return null;
    }
    if (!state.photos.length) {
        window.location.replace('capture.html');
        return null;
    }
    return state;
};

const updateProgress = () => {
    const state = readState();
    const tagged = state.photos.filter((photo) => Boolean(photo.area)).length;
    const total = state.photos.length;
    tagProgress.textContent = `${tagged} of ${total} photo${total === 1 ? '' : 's'} tagged`;
    tagSummary.textContent = `Tail ${state.inspection.tailNumber} · ${state.inspection.inspectionType} inspection`;
};

const updateSelectionMeta = () => {
    const count = selected.size;
    selectionMeta.textContent =
        count === 0 ? '0 photos selected' : `${count} photo${count === 1 ? '' : 's'} selected`;
    const disableAssign = count === 0;
    if (clearTagsBtn) {
        clearTagsBtn.disabled = disableAssign;
    }
    if (clearSelectionBtn) {
        clearSelectionBtn.disabled = disableAssign;
    }
};

const toggleSelection = (photoId, forceState) => {
    if (forceState === true || (!selected.has(photoId) && forceState === undefined)) {
        selected.add(photoId);
    } else if (forceState === false || selected.has(photoId)) {
        selected.delete(photoId);
    }
    renderPhotos();
};

const createPhotoCard = (photo) => {
    const card = document.createElement('label');
    card.className = 'select-card';
    if (selected.has(photo.id)) {
        card.classList.add('selected');
    }
    if (photo.area) {
        card.classList.add('tagged');
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'select-checkbox';
    checkbox.checked = selected.has(photo.id);
    checkbox.addEventListener('change', (event) => {
        toggleSelection(photo.id, event.target.checked);
        event.stopPropagation();
    });

    const thumb = document.createElement('img');
    thumb.className = 'photo-thumb';
    thumb.src = photo.dataURL;
    thumb.alt = photo.name;

    const areaBadge = document.createElement('span');
    areaBadge.className = 'area-badge';
    areaBadge.textContent = photo.area ? `Tagged: ${photo.area}` : 'Area not assigned';

    const footer = document.createElement('footer');
    footer.innerHTML = `<span class="muted">${photo.name}</span><span>Photo #${photo.number}</span>`;

    card.append(checkbox, thumb, areaBadge, footer);
    card.addEventListener('click', (event) => {
        if (event.target === checkbox) return;
        toggleSelection(photo.id);
    });

    return card;
};

const renderPhotos = () => {
    const state = readState();
    tagGrid.innerHTML = '';

    if (!state.photos.length) {
        tagGrid.classList.add('hidden');
        emptyState.classList.remove('hidden');
        updateProgress();
        updateSelectionMeta();
        return;
    }

    tagGrid.classList.remove('hidden');
    emptyState.classList.add('hidden');

    state.photos.forEach((photo) => {
        tagGrid.appendChild(createPhotoCard(photo));
    });

    updateProgress();
    updateSelectionMeta();
};

const assignAreaToSelection = (area) => {
    if (!selected.size) return;
    setPhotoArea(Array.from(selected), area);
    renderPhotos();
};

const handleClearTags = () => {
    if (!selected.size) return;
    clearPhotoAreas(Array.from(selected));
    renderPhotos();
};

const setActiveHotspots = (area) => {
    areaHotspots.forEach((button) => {
        if (button.dataset.area === area) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });
};

const updateNextButton = () => {
    if (!nextBtn) return;
    const storedArea = sessionStorage.getItem(SELECTED_AREA_KEY);
    nextBtn.disabled = !storedArea;
};

const handleAreaSelection = (area) => {
    console.log('Area selected:', area);
    sessionStorage.setItem(SELECTED_AREA_KEY, area);
    setActiveHotspots(area);
    updateNextButton();
    if (selected.size) {
        assignAreaToSelection(area);
    }
};

// Event listeners
selectAllBtn?.addEventListener('click', () => {
    const state = readState();
    selected.clear();
    state.photos
        .filter((photo) => !photo.area)
        .forEach((photo) => selected.add(photo.id));
    renderPhotos();
});

clearSelectionBtn?.addEventListener('click', () => {
    selected.clear();
    renderPhotos();
});

clearTagsBtn?.addEventListener('click', handleClearTags);

backBtn?.addEventListener('click', () => {
    window.location.href = 'capture.html';
});

nextBtn?.addEventListener('click', () => {
    const area = sessionStorage.getItem(SELECTED_AREA_KEY);
    if (!area) return;
    window.location.href = 'capture.html';
});

// Initialize
const initialState = ensurePhotos();
if (initialState) {
    renderPhotos();
}
updateNextButton();