import { clearPhotoAreas, getAreaColor, readState, resetState, setPhotoArea } from './state.js';

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
const logoBtn = document.getElementById('logoBtn');
const hotspotToolbar = document.getElementById('hotspotToolbar');
const hotspotButtons = hotspotToolbar ? Array.from(hotspotToolbar.querySelectorAll('.area-hotspot')) : [];

const SELECTED_AREA_KEY = 'selectedArea';

const selected = new Set();
/** @type {string | null} Last clicked photo id, used as range anchor for shift-click */
let lastClickedPhotoId = null;

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
    if (tagProgress) {
        tagProgress.textContent = `${tagged} of ${total} photo${total === 1 ? '' : 's'} tagged`;
    }
    if (tagSummary) {
        tagSummary.textContent = `Tail ${state.inspection.tailNumber} · ${state.inspection.inspectionType} inspection`;
    }
};

const updateSelectionMeta = () => {
    const state = readState();
    const total = state.photos.length;
    const count = selected.size;
    selectionMeta.textContent = `${total} photo${total === 1 ? '' : 's'} detected`;
    const disableActions = count === 0;
    if (clearTagsBtn) clearTagsBtn.disabled = disableActions;
    if (clearSelectionBtn) {
        // Only disable if there are truly no selections
        clearSelectionBtn.disabled = disableActions;
        // Ensure button is enabled if there are selections
        if (count > 0) {
            clearSelectionBtn.disabled = false;
        }
    }
};

const setActiveHotspots = (area) => {
    hotspotButtons.forEach((button) => {
        const isActive = button.dataset.area === area;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
        
        // Clear inline styles to let CSS handle the styling
        if (isActive) {
            // Clear inline styles when active to let CSS handle it
            button.style.backgroundColor = '';
            button.style.borderColor = '';
            button.style.color = '';
            button.style.boxShadow = '';
        } else {
            // Reset to default white background with #858585 border
            button.style.backgroundColor = '#ffffff';
            button.style.borderColor = '#858585';
            button.style.color = '#10121a';
            button.style.boxShadow = 'none';
        }
    });
};

// Add hover effect handlers for area hotspots
const setupHotspotHovers = () => {
    hotspotButtons.forEach((button) => {
        button.addEventListener('mouseenter', () => {
            if (!button.classList.contains('active')) {
                // Keep white background and #858585 border on hover
                button.style.backgroundColor = '#ffffff';
                button.style.borderColor = '#858585';
                button.style.color = '#10121a';
            }
        });
        
        button.addEventListener('mouseleave', () => {
            if (!button.classList.contains('active')) {
                // Reset to default white background with #858585 border
                button.style.backgroundColor = '#ffffff';
                button.style.borderColor = '#858585';
                button.style.color = '#10121a';
            }
        });
    });
};

const updateNextButton = () => {
    if (!nextBtn) return;
    const state = readState();
    
    // Enable button if all photos are tagged
    // Check that each photo has a non-empty area
    const allTagged = state.photos.length > 0 && 
        state.photos.every((photo) => {
            return photo.area != null && photo.area !== '';
        });
    
    // Explicitly set disabled property
    if (allTagged) {
        nextBtn.disabled = false;
        nextBtn.removeAttribute('disabled');
        nextBtn.classList.remove('disabled');
    } else {
        nextBtn.disabled = true;
        nextBtn.setAttribute('disabled', 'disabled');
    }
    nextBtn.setAttribute('aria-disabled', String(!allTagged));
};

const toggleSelection = (photoId, forceState) => {
    if (forceState === true || (!selected.has(photoId) && forceState === undefined)) {
        selected.add(photoId);
    } else if (forceState === false || selected.has(photoId)) {
        selected.delete(photoId);
    }
    renderPhotos();
};

const HINT_DURATION_MS = 1000;
const HINT_FADE_MS = 200;

/** Show "Please assign area" next to the + button and outline the hotspot toolbar for 1s with fade in/out */
const showAssignAreaPrompt = (photoId) => {
    const card = tagGrid?.querySelector(`[data-photo-id="${photoId}"]`);
    if (!card || !hotspotToolbar) return;
    const footer = card.querySelector('footer');
    const addBtn = footer?.querySelector('.tag-add-btn');
    if (!footer || !addBtn) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'tag-assign-hint-row';
    addBtn.parentNode.insertBefore(wrapper, addBtn);
    wrapper.appendChild(addBtn);

    const hint = document.createElement('span');
    hint.className = 'tag-assign-hint';
    hint.textContent = 'Please assign area';
    wrapper.appendChild(hint);

    requestAnimationFrame(() => {
        hint.classList.add('visible');
        hotspotToolbar.classList.add('prompt-outline');
    });

    const clearPrompt = () => {
        hint.classList.remove('visible');
        hotspotToolbar.classList.remove('prompt-outline');
        setTimeout(() => {
            if (wrapper.parentNode) {
                wrapper.parentNode.insertBefore(addBtn, wrapper);
                wrapper.remove();
            }
        }, HINT_FADE_MS);
    };
    setTimeout(clearPrompt, HINT_DURATION_MS);
};

const createPhotoCard = (photo) => {
    const card = document.createElement('div');
    card.className = 'select-card';
    card.dataset.photoId = photo.id;
    // Check if photo is selected - this should be false after clearing
    const isSelected = selected.has(photo.id);
    if (isSelected) {
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
        // Use same style as selected buttons (dark green)
        areaBadge.style.backgroundColor = '#2d5016';
        areaBadge.style.borderColor = '#2d5016';
        areaBadge.style.color = '#ffffff';
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
            showAssignAreaPrompt(photo.id);
        });
        footer.appendChild(addBtn);
    }

    card.append(thumb, footer);
    
    // Add click handler for card selection (single toggle, or shift-click range)
    const handleCardClick = (event) => {
        if (addBtn && (event.target === addBtn || event.target.closest('.tag-add-btn'))) return;
        const state = readState();
        const photos = state.photos;
        const currentIndex = photos.findIndex((p) => p.id === photo.id);
        if (currentIndex === -1) {
            toggleSelection(photo.id);
            lastClickedPhotoId = photo.id;
            return;
        }
        if (event.shiftKey && lastClickedPhotoId != null) {
            const lastIndex = photos.findIndex((p) => p.id === lastClickedPhotoId);
            const from = lastIndex === -1 ? currentIndex : Math.min(lastIndex, currentIndex);
            const to = lastIndex === -1 ? currentIndex : Math.max(lastIndex, currentIndex);
            for (let i = from; i <= to; i++) {
                selected.add(photos[i].id);
            }
            lastClickedPhotoId = photo.id;
            renderPhotos();
        } else {
            toggleSelection(photo.id);
            lastClickedPhotoId = photo.id;
        }
    };
    card.addEventListener('click', handleCardClick);

    return card;
};

const renderPhotos = () => {
    const state = readState();
    // Clear the grid completely
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

    // Recreate all cards - this ensures selected state is properly reflected
    state.photos.forEach((photo) => {
        const card = createPhotoCard(photo);
        tagGrid.appendChild(card);
    });

    updateProgress();
    updateSelectionMeta();
    updateNextButton(); // Update button state when photos are rendered
};

const assignAreaToSelection = (area) => {
    if (!selected.size) return;
    setPhotoArea(Array.from(selected), area);
    // Clear selection after tagging to make it easy to select a new group
    selected.clear();
    renderPhotos();
    updateNextButton(); // Update button state after assigning area
};

const handleClearTags = () => {
    if (!selected.size) return;
    clearPhotoAreas(Array.from(selected));
    renderPhotos();
    updateNextButton(); // Update button state after clearing tags
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
    lastClickedPhotoId = null;
    state.photos
        .filter((photo) => !photo.area)
        .forEach((photo) => selected.add(photo.id));
    renderPhotos();
});

if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Clear assigned areas of selected photo cards
        if (selected.size > 0) {
            clearPhotoAreas(Array.from(selected));
            // Re-render to update UI - cards will show + button instead of area badge
            renderPhotos();
        }
    });
}

clearTagsBtn?.addEventListener('click', handleClearTags);

backBtn?.addEventListener('click', () => {
    window.location.href = 'capture.html';
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

nextBtn?.addEventListener('click', (e) => {
    // Always check state on click, even if button appears disabled
    const state = readState();
    
    // Check if all photos have areas (handle null, undefined, and empty strings)
    const unassigned = state.photos.filter((photo) => {
        const hasArea = photo.area && 
                       (typeof photo.area === 'string' ? photo.area.trim() !== '' : Boolean(photo.area));
        return !hasArea;
    });
    
    if (unassigned.length) {
        alert(`Assign an area to all photos before continuing. ${unassigned.length} photo${unassigned.length === 1 ? '' : 's'} still unassigned.`);
        updateNextButton(); // Update button state
        return;
    }
    if (state.photos.length === 0) {
        alert('Please add photos before continuing.');
        return;
    }
    
    // Navigate to results page
    window.location.href = 'results.html';
});

// Initialize hotspot colors on page load
const initializeHotspotColors = () => {
    hotspotButtons.forEach((button) => {
        if (!button.classList.contains('active')) {
            // Set default white background with #858585 border
            button.style.backgroundColor = '#ffffff';
            button.style.borderColor = '#858585';
            button.style.color = '#10121a';
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

// Update button state - use setTimeout to ensure DOM is ready
setTimeout(() => {
    updateNextButton();
}, 0);

// Also update whenever the page becomes visible (in case state changed in another tab)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        updateNextButton();
    }
});

