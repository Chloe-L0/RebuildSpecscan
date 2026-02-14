import { clearPhotoAreas, getAreaColor, readState, setPhotoArea } from './state.js';

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
const hotspotToolbar = document.getElementById('hotspotToolbar');
const hotspotButtons = hotspotToolbar ? Array.from(hotspotToolbar.querySelectorAll('.area-hotspot')) : [];

const SELECTED_AREA_KEY = 'selectedArea';

const selected = new Set();

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
    const state = readState();
    const total = state.photos.length;
    const count = selected.size;
    selectionMeta.textContent = `${total} photo${total === 1 ? '' : 's'} detected`;
    const disableActions = count === 0;
    if (clearTagsBtn) clearTagsBtn.disabled = disableActions;
    if (clearSelectionBtn) clearSelectionBtn.disabled = disableActions;
};

const setActiveHotspots = (area) => {
    hotspotButtons.forEach((button) => {
        const isActive = button.dataset.area === area;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
        
        // Apply area-specific colors only when not active
        const buttonArea = button.dataset.area;
        if (buttonArea && !isActive) {
            const colors = getAreaColor(buttonArea);
            button.style.backgroundColor = colors.light;
            button.style.borderColor = colors.border;
            button.style.color = colors.text;
            button.style.boxShadow = '0 2px 8px rgba(16, 18, 26, 0.08)';
        } else if (!isActive) {
            // Reset to default when not active
            button.style.backgroundColor = '#f4f5f5';
            button.style.borderColor = 'rgba(16, 18, 26, 0.15)';
            button.style.color = '#10121a';
            button.style.boxShadow = 'none';
        } else {
            // Clear inline styles when active to let CSS handle it
            button.style.backgroundColor = '';
            button.style.borderColor = '';
            button.style.color = '';
            button.style.boxShadow = '';
        }
    });
};

// Add hover effect handlers for area hotspots
const setupHotspotHovers = () => {
    hotspotButtons.forEach((button) => {
        const buttonArea = button.dataset.area;
        if (buttonArea) {
            const colors = getAreaColor(buttonArea);
            
            button.addEventListener('mouseenter', () => {
                if (!button.classList.contains('active')) {
                    button.style.backgroundColor = `${colors.primary}15`;
                    button.style.borderColor = `${colors.primary}60`;
                    button.style.color = colors.primary;
                }
            });
            
            button.addEventListener('mouseleave', () => {
                if (!button.classList.contains('active')) {
                    const isActive = button.classList.contains('active');
                    if (!isActive) {
                        button.style.backgroundColor = colors.light;
                        button.style.borderColor = colors.border;
                        button.style.color = colors.text;
                    }
                }
            });
        }
    });
};

const updateNextButton = () => {
    if (!nextBtn) return;
    const storedArea = sessionStorage.getItem(SELECTED_AREA_KEY);
    nextBtn.disabled = !storedArea;
    nextBtn.setAttribute('aria-disabled', String(!storedArea));
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
    const card = document.createElement('div');
    card.className = 'select-card';
    if (selected.has(photo.id)) {
        card.classList.add('selected');
    }
    if (photo.area) {
        card.classList.add('tagged');
    }

    const thumb = document.createElement('img');
    thumb.className = 'photo-thumb';
    thumb.src = photo.dataURL;
    thumb.alt = photo.name;

    const footer = document.createElement('footer');
    const photoNumber = document.createElement('span');
    photoNumber.textContent = `Photo #${photo.number}`;
    const fileName = document.createElement('span');
    fileName.textContent = photo.name;
    footer.appendChild(photoNumber);
    footer.appendChild(fileName);

    // Add tag badge or + button
    let addBtn = null;
    if (photo.area) {
        const areaBadge = document.createElement('span');
        areaBadge.className = 'area-badge';
        areaBadge.textContent = photo.area;
        const colors = getAreaColor(photo.area);
        areaBadge.style.backgroundColor = colors.light;
        areaBadge.style.borderColor = colors.border;
        areaBadge.style.color = colors.text;
        footer.appendChild(areaBadge);
    } else {
        addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'tag-add-btn';
        addBtn.innerHTML = '+';
        addBtn.title = 'Add tag';
        addBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleSelection(photo.id);
        });
        footer.appendChild(addBtn);
    }

    card.append(thumb, footer);
    
    // Add click handler for card selection
    const handleCardClick = (event) => {
        if (addBtn && (event.target === addBtn || event.target.closest('.tag-add-btn'))) return;
        toggleSelection(photo.id);
    };
    card.addEventListener('click', handleCardClick);

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
    // Clear selection after tagging to make it easy to select a new group
    selected.clear();
    renderPhotos();
};

const handleClearTags = () => {
    if (!selected.size) return;
    clearPhotoAreas(Array.from(selected));
    renderPhotos();
};

const handleAreaSelection = (area) => {
    sessionStorage.setItem(SELECTED_AREA_KEY, area);
    setActiveHotspots(area);
    updateNextButton();
    if (selected.size) {
        assignAreaToSelection(area);
    }
};

hotspotButtons.forEach((button) => {
    button.addEventListener('click', () => {
        const { area } = button.dataset;
        if (!area) return;
        handleAreaSelection(area);
    });
});

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
    if (!area) {
        alert('Select an inspection area before continuing.');
        return;
    }
    const state = readState();
    const unassigned = state.photos.filter((photo) => !photo.area);
    if (unassigned.length) {
        alert(`Assign an area to all photos before continuing. ${unassigned.length} photo${unassigned.length === 1 ? '' : 's'} still unassigned.`);
        return;
    }
    window.location.href = 'results.html';
});

// Initialize hotspot colors on page load
const initializeHotspotColors = () => {
    hotspotButtons.forEach((button) => {
        const buttonArea = button.dataset.area;
        if (buttonArea && !button.classList.contains('active')) {
            const colors = getAreaColor(buttonArea);
            button.style.backgroundColor = colors.light;
            button.style.borderColor = colors.border;
            button.style.color = colors.text;
        }
    });
    setupHotspotHovers();
};

const initialState = ensurePhotos();
if (initialState) {
    renderPhotos();
}

// Initialize hotspot colors
initializeHotspotColors();

const storedArea = sessionStorage.getItem(SELECTED_AREA_KEY);
if (storedArea) {
    setActiveHotspots(storedArea);
}
updateNextButton();

