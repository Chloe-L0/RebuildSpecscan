import {
    AREAS,
    getThresholdForPhoto,
    readState,
    removeDetection,
    restoreDetection,
    resetState,
    summarizeDetectionsByArea,
    updateDetectionCritical,
    updateDetectionNote,
    updatePhotoFlaggedNote,
    updateReportOptions,
    saveGeneralNoteToStorage,
    saveInspectionToHistory
} from './state.js';
import { createCroppedThumbnail, THUMBNAIL_HEIGHT } from './thumbnails.js';
import { PDFDocument, StandardFonts, rgb } from 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm';

// Color palette for different defect classes
const DEFECT_COLORS = [
    { stroke: [225, 29, 72], fill: [225, 29, 72, 0.16] },   // Red
    { stroke: [37, 99, 235], fill: [37, 99, 235, 0.16] },   // Blue
    { stroke: [5, 150, 105], fill: [5, 150, 105, 0.16] },   // Green
    { stroke: [217, 119, 6], fill: [217, 119, 6, 0.16] },   // Orange
    { stroke: [124, 58, 237], fill: [124, 58, 237, 0.16] }, // Purple
    { stroke: [220, 38, 38], fill: [220, 38, 38, 0.16] },  // Dark Red
    { stroke: [2, 132, 199], fill: [2, 132, 199, 0.16] },   // Cyan
    { stroke: [202, 138, 4], fill: [202, 138, 4, 0.16] }    // Amber
];

const getColorForClass = (className) => {
    if (!className) return DEFECT_COLORS[0];
    // Hash the class name to get a consistent color
    let hash = 0;
    for (let i = 0; i < className.length; i++) {
        hash = className.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % DEFECT_COLORS.length;
    return DEFECT_COLORS[index];
};

const reportTailNumber = document.getElementById('reportTailNumber');
const reportEditorMeta = document.getElementById('reportEditorMeta');
const reportFindingsList = document.getElementById('reportFindingsList');
const reportBulkDeleteBtn = document.getElementById('reportBulkDeleteBtn');
const generateFinalReportBtn = document.getElementById('generateFinalReportBtn');
const thumbnailToggle = document.getElementById('thumbnailToggle');
const falsePositiveToggle = document.getElementById('falsePositiveToggle');
const allPhotosToggle = document.getElementById('allPhotosToggle');
const flaggedImagesToggle = document.getElementById('flaggedImagesToggle');
const flaggedImageNotesToggle = document.getElementById('flaggedImageNotesToggle');
const reportNotesEl = document.getElementById('reportNotes');
const flaggedImagesList = document.getElementById('flaggedImagesList');
const flaggedImagesNotesSection = document.getElementById('flaggedImagesNotesSection');
const logoBtn = document.getElementById('logoBtn');
const backToResultsBtn = document.getElementById('backToResultsBtn');
const submitInspectionBtn = document.getElementById('submitInspectionBtn');

const HISTORY_MODE_KEY = 'specscanHistoryMode';
const inHistoryMode = (() => {
    try {
        return sessionStorage.getItem(HISTORY_MODE_KEY) === '1';
    } catch {
        return false;
    }
})();

if (inHistoryMode && backToResultsBtn) {
    backToResultsBtn.style.display = 'none';
    backToResultsBtn.setAttribute('aria-hidden', 'true');
}

const dispatchReportStateChanged = () => window.dispatchEvent(new CustomEvent('report-state-changed'));

const ensureAnalysisComplete = () => {
    const state = readState();
    if (!state.inspection.tailNumber || !state.inspection.startedAt) {
        window.location.replace('index.html');
        return null;
    }
    const taggedPhotos = state.photos.filter((photo) => photo.area);
    if (!taggedPhotos.length) {
        window.location.replace('tag.html');
        return null;
    }
    if (!state.analysis.completed) {
        window.location.replace('results.html');
        return null;
    }
    return state;
};

const formatMeta = (state) => {
    const inspector = state.inspection.inspectorName || 'Unassigned inspector';
    const dept = state.inspection.department ? ` · ${state.inspection.department}` : '';
    const started = state.inspection.startedAt
        ? new Date(state.inspection.startedAt).toLocaleString()
        : 'Unknown start';
    return `Tail ${state.inspection.tailNumber} · ${state.inspection.inspectionType}${dept} · ${inspector} · ${started}`;
};

const computeDetectionTotals = (state, includeFalsePositives) =>
    state.detections.filter((detection) => {
        if (!includeFalsePositives && detection.falsePositive) return false;
        if (detection.manual) return true;
        if (typeof detection.confidence === 'number') {
            const threshold = getThresholdForPhoto(state, detection.photoId);
            return detection.confidence >= threshold;
        }
        return false;
    }).length;

const renderSummary = () => {
    const state = readState();
    const tagged = state.photos.filter((photo) => Boolean(photo.area));

    if (reportTailNumber) {
        const tailNumber = state.inspection.tailNumber || '--';
        reportTailNumber.textContent = `Tail ${tailNumber}`;
    }
    if (reportEditorMeta) {
        reportEditorMeta.textContent = formatMeta(state);
    }

    // Update toggles
    if (thumbnailToggle) {
        thumbnailToggle.checked = state.report.includeThumbnails;
    }
    if (falsePositiveToggle) {
        falsePositiveToggle.checked = state.report.includeFalsePositives;
    }
    if (allPhotosToggle) {
        allPhotosToggle.checked = state.report.includeAllPhotos;
    }
    if (flaggedImagesToggle) {
        flaggedImagesToggle.checked = state.report.includeFlaggedImages;
    }
    if (flaggedImageNotesToggle) {
        flaggedImageNotesToggle.checked = state.report.includeFlaggedImageNotes;
    }
    if (reportNotesEl) {
        reportNotesEl.value = state.report.notes || '';
    }
    
    renderFlaggedImagesNotes();
    renderFindingsList();
};

const renderFlaggedImagesNotes = () => {
    const state = readState();
    const flaggedPhotos = state.photos.filter((photo) => photo.flagged);
    
    if (!flaggedImagesList || !flaggedImagesNotesSection) return;
    
    // Show/hide section based on whether there are flagged images
    if (flaggedPhotos.length === 0) {
        flaggedImagesNotesSection.style.display = 'none';
        return;
    }
    
    flaggedImagesNotesSection.style.display = 'block';
    flaggedImagesList.innerHTML = '';
    
    flaggedPhotos.forEach((photo) => {
        const item = document.createElement('div');
        item.className = 'flagged-image-item';
        item.dataset.photoId = photo.id;
        
        const header = document.createElement('div');
        header.className = 'flagged-image-header';
        
        const title = document.createElement('h4');
        title.className = 'flagged-image-title';
        title.textContent = `Photo #${photo.number} - ${photo.area || 'Unknown Area'}`;
        header.appendChild(title);
        
        // Thumbnail preview
        const thumbnail = document.createElement('div');
        thumbnail.className = 'flagged-image-thumbnail';
        const img = document.createElement('img');
        img.src = photo.dataURL;
        img.alt = `Photo #${photo.number}`;
        img.style.maxWidth = '120px';
        img.style.maxHeight = '120px';
        img.style.objectFit = 'contain';
        img.style.borderRadius = '4px';
        img.style.border = '1px solid rgba(0, 0, 0, 0.1)';
        thumbnail.appendChild(img);
        
        const content = document.createElement('div');
        content.className = 'flagged-image-content';
        
        const noteLabel = document.createElement('label');
        noteLabel.className = 'flagged-image-note-label';
        noteLabel.textContent = 'Note:';
        noteLabel.setAttribute('for', `flagged-note-${photo.id}`);
        
        const noteInput = document.createElement('textarea');
        noteInput.id = `flagged-note-${photo.id}`;
        noteInput.className = 'flagged-image-note-input';
        noteInput.placeholder = 'Add a note about this flagged image...';
        noteInput.rows = 3;
        noteInput.value = photo.flaggedNote || '';
        
        // Update note on input
        noteInput.addEventListener('input', (event) => {
            updatePhotoFlaggedNote(photo.id, event.target.value);
        });
        
        content.appendChild(noteLabel);
        content.appendChild(noteInput);
        
        item.appendChild(header);
        item.appendChild(thumbnail);
        item.appendChild(content);
        flaggedImagesList.appendChild(item);
    });
};

// Line-style icons (stroke 2, 24x24)
const FINDING_ICONS = {
    chevronDown: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    chevronUp: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6"/></svg>',
    flag: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
    eye: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    trash: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>'
};

let selectedFindingIds = new Set();
let expandedFindingId = null;
let lastDeletedDetection = null;
let undoToastTimer = null;
const NOTE_SAVE_DEBOUNCE_MS = 1000;

const reportFindingsBulkBar = document.getElementById('reportFindingsBulkBar');
const reportFindingsBulkCount = document.getElementById('reportFindingsBulkCount');
const reportBulkFlagBtn = document.getElementById('reportBulkFlagBtn');
const reportBulkClearBtn = document.getElementById('reportBulkClearBtn');
const reportFindingsToast = document.getElementById('reportFindingsToast');
const reportFindingsToastUndo = document.getElementById('reportFindingsToastUndo');
const findingDetailModal = document.getElementById('findingDetailModal');
const findingDetailModalBackdrop = document.getElementById('findingDetailModalBackdrop');
const findingDetailModalClose = document.getElementById('findingDetailModalClose');
const findingDetailModalTitle = document.getElementById('findingDetailModalTitle');
const findingDetailModalMeta = document.getElementById('findingDetailModalMeta');
const findingDetailModalImageWrap = document.getElementById('findingDetailModalImageWrap');
const findingDetailModalImage = document.getElementById('findingDetailModalImage');
const findingDetailModalOverlay = document.getElementById('findingDetailModalOverlay');

function updateBulkBar() {
    const n = selectedFindingIds.size;
    if (!reportFindingsBulkBar || !reportFindingsBulkCount) return;
    reportFindingsBulkBar.classList.toggle('hidden', n === 0);
    reportFindingsBulkCount.textContent = n === 1 ? '1 selected' : `${n} selected`;
}

let pinchZoomInitialDistance = null;
let pinchZoomInitialScale = 1;
let pinchZoomCurrentScale = 1;

function getTouchDistance(touches) {
    if (touches.length < 2) return 0;
    const a = touches[0];
    const b = touches[1];
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

function openFindingDetailModal(photo, detection, findingId) {
    if (!findingDetailModal || !findingDetailModalImage || !findingDetailModalOverlay) return;
    const wrap = findingDetailModalImageWrap;
    if (wrap && wrap._pinchHandlers) {
        wrap.removeEventListener('touchstart', wrap._pinchHandlers.onPinchStart);
        wrap.removeEventListener('touchmove', wrap._pinchHandlers.onPinchMove);
        wrap.removeEventListener('touchend', wrap._pinchHandlers.onPinchEnd);
        wrap._pinchHandlers = null;
    }
    const bbox = detection?.bbox || {};
    const confidence = detection?.manual ? 'Manual' : (typeof detection?.confidence === 'number' ? `${Math.round(detection.confidence * 100)}%` : '—');
    const type = (detection?.class || 'Defect').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    findingDetailModalTitle.textContent = findingId;
    findingDetailModalMeta.innerHTML = `
        <span><strong>Type:</strong> ${type}</span>
        <span><strong>Location:</strong> ${detection?.area || '—'} · Photo #${detection?.photoNumber ?? '—'}</span>
        <span><strong>Confidence:</strong> ${confidence}</span>`;
    findingDetailModalImage.alt = `${findingId} – full resolution`;
    findingDetailModalImage.src = photo?.dataURL || '';
    findingDetailModalOverlay.innerHTML = '';
    pinchZoomCurrentScale = 1;
    findingDetailModalImage.style.transform = 'scale(1)';

    function positionBbox() {
        findingDetailModalOverlay.innerHTML = '';
        const img = findingDetailModalImage;
        const rect = img.getBoundingClientRect();
        const wrapRect = findingDetailModalImageWrap?.getBoundingClientRect();
        if (!wrapRect || rect.width === 0 || rect.height === 0) return;
        const sourceWidth = bbox.imageWidth || img.naturalWidth || 1;
        const sourceHeight = bbox.imageHeight || img.naturalHeight || 1;
        const centerX = bbox.centerX ?? bbox.x ?? 0;
        const centerY = bbox.centerY ?? bbox.y ?? 0;
        const w = bbox.width ?? bbox.w ?? 0;
        const h = bbox.height ?? bbox.h ?? 0;
        const scaleX = rect.width / sourceWidth;
        const scaleY = rect.height / sourceHeight;
        const left = (centerX - w / 2) * scaleX;
        const top = (centerY - h / 2) * scaleY;
        const boxW = w * scaleX;
        const boxH = h * scaleY;
        const box = document.createElement('div');
        box.className = 'finding-detail-modal-bbox';
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${boxW}px`;
        box.style.height = `${boxH}px`;
        findingDetailModalOverlay.style.left = `${rect.left - wrapRect.left}px`;
        findingDetailModalOverlay.style.top = `${rect.top - wrapRect.top}px`;
        findingDetailModalOverlay.style.width = `${rect.width}px`;
        findingDetailModalOverlay.style.height = `${rect.height}px`;
        findingDetailModalOverlay.appendChild(box);
    }

    findingDetailModalImage.onload = () => {
        positionBbox();
        setTimeout(positionBbox, 50);
    };
    if (findingDetailModalImage.complete && findingDetailModalImage.naturalWidth) {
        positionBbox();
    }

    const resizeHandler = () => {
        if (findingDetailModal.classList.contains('hidden')) return;
        positionBbox();
    };
    window.addEventListener('resize', resizeHandler);
    findingDetailModal._resizeHandler = resizeHandler;

    findingDetailModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    const onPinchStart = (e) => {
        if (e.touches.length === 2) {
            pinchZoomInitialDistance = getTouchDistance(e.touches);
            pinchZoomInitialScale = pinchZoomCurrentScale;
        }
    };
    const onPinchMove = (e) => {
        if (e.touches.length === 2 && pinchZoomInitialDistance != null) {
            e.preventDefault();
            const dist = getTouchDistance(e.touches);
            const scale = (dist / pinchZoomInitialDistance) * pinchZoomInitialScale;
            pinchZoomCurrentScale = Math.max(0.5, Math.min(4, scale));
            findingDetailModalImage.style.transform = `scale(${pinchZoomCurrentScale})`;
        }
    };
    const onPinchEnd = (e) => {
        if (e.touches.length < 2) pinchZoomInitialDistance = null;
    };
    findingDetailModalImageWrap.addEventListener('touchstart', onPinchStart, { passive: true });
    findingDetailModalImageWrap.addEventListener('touchmove', onPinchMove, { passive: false });
    findingDetailModalImageWrap.addEventListener('touchend', onPinchEnd, { passive: true });
    findingDetailModalImageWrap._pinchHandlers = { onPinchStart, onPinchMove, onPinchEnd };
}

function closeFindingDetailModal() {
    if (!findingDetailModal) return;
    findingDetailModal.classList.add('hidden');
    document.body.style.overflow = '';
    if (findingDetailModal._resizeHandler) {
        window.removeEventListener('resize', findingDetailModal._resizeHandler);
        findingDetailModal._resizeHandler = null;
    }
    const wrap = findingDetailModalImageWrap;
    if (wrap && wrap._pinchHandlers) {
        wrap.removeEventListener('touchstart', wrap._pinchHandlers.onPinchStart);
        wrap.removeEventListener('touchmove', wrap._pinchHandlers.onPinchMove);
        wrap.removeEventListener('touchend', wrap._pinchHandlers.onPinchEnd);
        wrap._pinchHandlers = null;
    }
}

function showUndoToast(deletedDetection) {
    lastDeletedDetection = deletedDetection;
    if (undoToastTimer) clearTimeout(undoToastTimer);
    if (reportFindingsToast) {
        reportFindingsToast.classList.remove('hidden');
        const text = reportFindingsToast.querySelector('.report-findings-toast-text');
        if (text) text.textContent = 'Finding deleted.';
    }
    undoToastTimer = setTimeout(() => {
        lastDeletedDetection = null;
        if (reportFindingsToast) reportFindingsToast.classList.add('hidden');
    }, 5000);
}

function hideUndoToast() {
    if (undoToastTimer) clearTimeout(undoToastTimer);
    undoToastTimer = null;
    lastDeletedDetection = null;
    if (reportFindingsToast) reportFindingsToast.classList.add('hidden');
}

reportFindingsToastUndo?.addEventListener('click', () => {
    if (lastDeletedDetection) {
        restoreDetection(lastDeletedDetection);
        hideUndoToast();
        renderSummary();
        dispatchReportStateChanged();
    }
});

reportBulkFlagBtn?.addEventListener('click', () => {
    selectedFindingIds.forEach((id) => updateDetectionCritical(id, true));
    renderSummary();
    dispatchReportStateChanged();
});
reportBulkDeleteBtn?.addEventListener('click', () => {
    const toDelete = Array.from(selectedFindingIds);
    if (toDelete.length === 0) return;
    const state = readState();
    const first = state.detections.find((d) => d.id === toDelete[0]);
    toDelete.forEach((id) => removeDetection(id));
    selectedFindingIds.clear();
    updateBulkBar();
    if (first) showUndoToast(first);
    renderSummary();
    dispatchReportStateChanged();
});
reportBulkClearBtn?.addEventListener('click', () => {
    selectedFindingIds.clear();
    updateBulkBar();
    renderFindingsList();
});

function initBulkBarIcons() {
    const flagIcon = document.querySelector('#reportBulkFlagBtn .report-finding-icon[data-icon="flag"]');
    const trashIcon = document.querySelector('#reportBulkDeleteBtn .report-finding-icon[data-icon="trash"]');
    if (flagIcon) flagIcon.innerHTML = FINDING_ICONS.flag;
    if (trashIcon) trashIcon.innerHTML = FINDING_ICONS.trash;
}
initBulkBarIcons();

findingDetailModalClose?.addEventListener('click', closeFindingDetailModal);
findingDetailModalBackdrop?.addEventListener('click', closeFindingDetailModal);
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && findingDetailModal && !findingDetailModal.classList.contains('hidden')) {
        closeFindingDetailModal();
    }
});

document.addEventListener('click', (e) => {
    if (expandedFindingId && !e.target.closest('.report-finding-card')) {
        expandedFindingId = null;
        reportFindingsList?.querySelectorAll('.report-finding-card').forEach((c) => c.classList.remove('report-finding-card-expanded'));
    }
});

const renderFindingsList = () => {
    const state = readState();
    const included = filterIncludedDetections(state);
    if (!reportFindingsList) return;
    reportFindingsList.innerHTML = '';
    updateBulkBar();

    included.forEach((detection, index) => {
        const photo = state.photos.find((p) => p.id === detection.photoId);
        const confidence = detection.manual ? 'Manual' : (typeof detection.confidence === 'number' ? `${Math.round(detection.confidence * 100)}%` : '—');
        const findingId = `F-${String(index + 1).padStart(3, '0')}`;
        const safeType = (detection.class || 'Defect').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const isExpanded = expandedFindingId === detection.id;
        const isSelected = selectedFindingIds.has(detection.id);
        const isFlagged = Boolean(detection.critical);

        const card = document.createElement('div');
        card.className = 'report-finding-card';
        card.dataset.detectionId = detection.id;
        card.dataset.findingIndex = String(index);
        if (isExpanded) card.classList.add('report-finding-card-expanded');
        if (isSelected) card.classList.add('report-finding-card-selected');
        if (isFlagged) card.classList.add('report-finding-card-flagged');
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-expanded', String(isExpanded));

        const rawNote = (detection.note && String(detection.note).trim()) ? String(detection.note).trim() : '';
        const notePreview = rawNote
            ? (rawNote.replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 60) + (rawNote.length > 60 ? '…' : ''))
            : '';
        const collapsedHtml = `
            <div class="report-finding-card-collapsed">
                <label class="report-finding-check" onclick="event.stopPropagation()">
                    <input type="checkbox" class="report-finding-cb" data-id="${detection.id}" ${isSelected ? 'checked' : ''} aria-label="Select finding">
                </label>
                <div class="report-finding-thumb report-finding-thumb-sm" data-id="${detection.id}"></div>
                <div class="report-finding-summary">
                    <span class="report-finding-id">${findingId}</span>
                    <span class="report-finding-type">${safeType}</span>
                    <span class="report-finding-loc">${(detection.area || '—')} · Photo #${detection.photoNumber || '—'}</span>
                    <span class="report-finding-conf">${confidence}</span>
                    ${notePreview ? `<span class="report-finding-note-preview">${notePreview}</span>` : ''}
                </div>
                <span class="report-finding-chevron" aria-hidden="true">${FINDING_ICONS.chevronDown}</span>
            </div>
            <div class="report-finding-card-expanded-content">
                <div class="report-finding-expanded-thumb" data-id="${detection.id}"></div>
                <div class="report-finding-expanded-body">
                    <div class="report-finding-expanded-meta">
                        <span class="report-finding-id">${findingId}</span>
                        <span class="report-finding-type">${safeType}</span>
                        <span class="report-finding-loc">${(detection.area || '—')} · Photo #${detection.photoNumber || '—'}</span>
                        <span class="report-finding-conf">${confidence}</span>
                    </div>
                    <label class="report-finding-notes-label">Notes</label>
                    <textarea class="report-finding-notes" data-id="${detection.id}" placeholder="Add notes…" rows="3" aria-label="Notes for finding"></textarea>
                    <div class="report-finding-notes-saved hidden" aria-live="polite">Saved</div>
                    <div class="report-finding-actions">
                        <button type="button" class="report-finding-action-btn" data-action="flag" data-id="${detection.id}" title="Flag as critical">
                            <span class="report-finding-icon">${FINDING_ICONS.flag}</span>
                            <span>Flag as Critical</span>
                        </button>
                        <button type="button" class="report-finding-action-btn" data-action="view" data-id="${detection.id}" data-index="${index}" title="View in report">
                            <span class="report-finding-icon">${FINDING_ICONS.eye}</span>
                            <span>View Detail</span>
                        </button>
                        <button type="button" class="report-finding-action-btn report-finding-action-delete" data-action="delete" data-id="${detection.id}" title="Delete finding">
                            <span class="report-finding-icon">${FINDING_ICONS.trash}</span>
                            <span>Delete</span>
                        </button>
                    </div>
                </div>
                <span class="report-finding-chevron report-finding-chevron-up" aria-hidden="true">${FINDING_ICONS.chevronUp}</span>
            </div>`;
        card.innerHTML = collapsedHtml;

        const thumbSm = card.querySelector('.report-finding-thumb-sm');
        const thumbLg = card.querySelector('.report-finding-expanded-thumb');
        const loadThumb = (el, size) => {
            if (!photo?.dataURL || !detection.bbox || !el) return;
            createCroppedThumbnail(photo.dataURL, detection.bbox, size).then((r) => {
                const img = document.createElement('img');
                img.src = r.src;
                img.alt = findingId;
                el.appendChild(img);
            });
        };
        loadThumb(thumbSm, 56);
        loadThumb(thumbLg, 120);

        const notesEl = card.querySelector('.report-finding-notes');
        const savedEl = card.querySelector('.report-finding-notes-saved');
        notesEl.value = detection.note || '';
        let noteDebounce = null;
        notesEl.addEventListener('input', () => {
            if (noteDebounce) clearTimeout(noteDebounce);
            if (savedEl) savedEl.classList.add('hidden');
            noteDebounce = setTimeout(() => {
                updateDetectionNote(detection.id, notesEl.value);
                if (savedEl) {
                    savedEl.classList.remove('hidden');
                    setTimeout(() => savedEl.classList.add('hidden'), 2000);
                }
                dispatchReportStateChanged();
            }, NOTE_SAVE_DEBOUNCE_MS);
        });

        const cb = card.querySelector('.report-finding-cb');
        cb.addEventListener('change', (e) => {
            e.stopPropagation();
            const id = e.target.dataset.id;
            if (e.target.checked) selectedFindingIds.add(id); else selectedFindingIds.delete(id);
            updateBulkBar();
            card.classList.toggle('report-finding-card-selected', selectedFindingIds.has(id));
        });

        card.querySelectorAll('.report-finding-action-btn').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const action = btn.dataset.action;
                if (action === 'flag') {
                    updateDetectionCritical(id, true);
                    card.classList.add('report-finding-card-flagged');
                    dispatchReportStateChanged();
                } else if (action === 'view') {
                    const det = readState().detections.find((d) => d.id === id);
                    const ph = readState().photos.find((p) => p.id === det?.photoId);
                    const idx = parseInt(btn.dataset.index, 10);
                    const findingId = `F-${String(idx + 1).padStart(3, '0')}`;
                    if (ph && det) openFindingDetailModal(ph, det, findingId);
                } else if (action === 'delete') {
                    const det = readState().detections.find((d) => d.id === id);
                    removeDetection(id);
                    selectedFindingIds.delete(id);
                    if (det) showUndoToast(det);
                    renderSummary();
                    dispatchReportStateChanged();
                }
            });
        });

        card.addEventListener('click', (e) => {
            if (e.target.closest('label') || e.target.closest('input') || e.target.closest('textarea') || e.target.closest('.report-finding-action-btn')) return;
            const id = card.dataset.detectionId;
            const willExpand = expandedFindingId !== id;
            expandedFindingId = willExpand ? id : null;
            reportFindingsList.querySelectorAll('.report-finding-card').forEach((c) => {
                c.classList.remove('report-finding-card-expanded');
                c.setAttribute('aria-expanded', 'false');
            });
            if (willExpand) {
                card.classList.add('report-finding-card-expanded');
                card.setAttribute('aria-expanded', 'true');
                requestAnimationFrame(() => {
                    card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                });
            }
        });

        card.addEventListener('keydown', (e) => {
            if (e.target.matches('textarea, input') || e.target.closest('textarea, input')) {
                return;
            }
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                card.click();
            }
            if (e.key === 'Delete' && card.classList.contains('report-finding-card-expanded')) {
                const delBtn = card.querySelector('[data-action="delete"]');
                if (delBtn) delBtn.click();
            }
        });

        reportFindingsList.appendChild(card);
    });
};

const filterIncludedDetections = (state) => {
    return state.detections.filter((detection) => {
        if (detection.falsePositive) return false;
        if (detection.manual) return true;
        if (typeof detection.confidence === 'number') {
            const threshold = getThresholdForPhoto(state, detection.photoId);
            if (detection.confidence < threshold) return false;
        }
        return true;
    });
};

const formatUTCDate = (isoString) => {
    if (!isoString) return 'Not provided';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return 'Not provided';
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const min = String(date.getUTCMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
};

const formatDuration = (startIso, endIso = new Date().toISOString()) => {
    if (!startIso) return 'Not recorded';
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 'Not recorded';
    const minutes = Math.round((end - start) / 60000);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${minutes}m`;
};

const buildFileName = (state) => {
    const type = (state.inspection.inspectionType || 'INSPECTION').toUpperCase();
    const reg = (state.inspection.tailNumber || 'AIRCRAFT').replace(/[^A-Z0-9]/gi, '').toUpperCase() || 'AIRCRAFT';
    const date = state.inspection.startedAt ? new Date(state.inspection.startedAt) : new Date();
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${type}_${reg}_${yyyy}${mm}${dd}.pdf`;
};

const loadImage = (src) =>
    new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
    });

const createAnnotatedImage = async (photo, detections, highlightId) => {
    const image = await loadImage(photo.dataURL);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return photo.dataURL;

    ctx.drawImage(image, 0, 0, width, height);
    detections.forEach((detection) => {
        const bbox = detection.bbox || {};
        const centerX = bbox.centerX ?? bbox.x ?? null;
        const centerY = bbox.centerY ?? bbox.y ?? null;
        const boxWidth = bbox.width ?? bbox.w ?? null;
        const boxHeight = bbox.height ?? bbox.h ?? null;
        const sourceWidth = bbox.imageWidth || width;
        const sourceHeight = bbox.imageHeight || height;
        if (centerX == null || centerY == null || boxWidth == null || boxHeight == null) return;

        // Scale API coordinates to the original image dimensions
        const scaleX = width / sourceWidth;
        const scaleY = height / sourceHeight;

        // Expand boxes slightly to fully cover defects
        const expandFactor = 1.25;
        const scaledWidth = boxWidth * scaleX * expandFactor;
        const scaledHeight = boxHeight * scaleY * expandFactor;

        // Convert center-based coordinates to top-left for canvas drawing
        const left = centerX * scaleX - scaledWidth / 2;
        const top = centerY * scaleY - scaledHeight / 2;

        ctx.lineWidth = Math.max(2, Math.round(width * 0.002));
        const isPrimary = detection.id === highlightId;
        const classColor = getColorForClass(detection.class);
        
        if (isPrimary) {
            ctx.strokeStyle = '#ffd54f';
            ctx.fillStyle = 'rgba(255, 213, 79, 0.3)';
        } else {
            const [r, g, b] = classColor.stroke;
            const [fr, fg, fb, fa] = classColor.fill;
            ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
            ctx.fillStyle = `rgba(${fr}, ${fg}, ${fb}, ${fa})`;
        }
        ctx.strokeRect(left, top, scaledWidth, scaledHeight);
        ctx.fillRect(left, top, scaledWidth, scaledHeight);

        const [r, g, b] = isPrimary ? [255, 213, 79] : classColor.stroke;
        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.font = `${Math.max(14, Math.round(width * 0.015))}px Arial`;
        const label = detection.class || 'Defect';
        ctx.fillText(label, left + 6, Math.max(16, top + 16));
    });

    return canvas.toDataURL('image/png');
};

const addLine = (page, text, fonts, cursor, options = {}) => {
    const { font = fonts.regular, size = 12, color = rgb(0.1, 0.1, 0.1), lineHeight = 16 } = options;
    page.drawText(text, { x: cursor.margin, y: cursor.y, size, font, color });
    cursor.y -= lineHeight;
};

const wrapText = (text, font, size, maxWidth) => {
    if (!text) return [''];
    const words = text.split(/\s+/);
    const lines = [];
    let currentLine = '';
    words.forEach((word) => {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const width = font.widthOfTextAtSize(testLine, size);
        if (width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    });
    if (currentLine) lines.push(currentLine);
    return lines.length ? lines : [''];
};

const drawWrappedText = (page, text, x, y, options) => {
    const { font, size, color, maxWidth, lineHeight } = options;
    const lines = wrapText(text, font, size, maxWidth);
    lines.forEach((line, idx) => {
        page.drawText(line, { x, y: y - idx * lineHeight, size, font, color });
    });
    return lines.length;
};

const addKeyValue = (page, key, value, fonts, cursor) => {
    const keyX = cursor.margin;
    const valueX = cursor.margin + 140;
    const maxWidth = (cursor.pageWidth || 612) - cursor.margin - valueX;
    const lineHeight = Math.round(PDF_LAYOUT.bodySize * PDF_LAYOUT.lineHeight);
    page.drawText(`${key}:`, { x: keyX, y: cursor.y, size: PDF_LAYOUT.bodySize, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
    const lineCount = drawWrappedText(page, value, valueX, cursor.y, {
        font: fonts.regular,
        size: PDF_LAYOUT.bodySize,
        color: rgb(0.1, 0.1, 0.1),
        maxWidth,
        lineHeight
    });
    cursor.y -= lineCount * lineHeight;
};

const PDF_HEADER_CLEARANCE = 40;
const PDF_FOOTER_CLEARANCE = 44;

const ensureSpace = (pdfDoc, cursor, needed) => {
    const minY = cursor.margin + PDF_FOOTER_CLEARANCE;
    if (cursor.y - needed <= minY) {
        cursor.page = pdfDoc.addPage([cursor.pageWidth, cursor.pageHeight]);
        cursor.y = cursor.pageHeight - cursor.margin - PDF_HEADER_CLEARANCE;
    }
};

// A4, 1" margins, typography (natural Title Case, reduced size spread)
const PDF_LAYOUT = {
    pageWidth: 612,
    pageHeight: 792,
    margin: 72,
    titleSize: 22,
    sectionSize: 16,
    subsectionSize: 13,
    bodySize: 11,
    captionSize: 9,
    lineHeight: 1.2,
    gapSection: 24,
    gapParagraph: 12,
    gapSubsection: 16,
    gapItem: 12,
    tableHeaderBg: 0.898,
    tableRowAlt: 0.976,
    tableBorder: 0.8,
    captionGray: 0.4,
    cellPadH: 12,
    cellPadV: 8,
    tableRowGap: 8
};

const addHeaderAndFooter = (pdfDoc, fonts, state) => {
    const pages = pdfDoc.getPages();
    const totalPages = pages.length;
    if (totalPages === 0) return;
    const insp = (state && state.inspection) || {};
    const tail = insp.tailNumber || '—';
    const dateStr = insp.startedAt
        ? new Date(insp.startedAt).toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/-/g, '-')
        : '—';
    const inspector = insp.inspectorName || '—';
    const dept = (insp.department || 'Maintenance QA').trim();
    const { margin, pageHeight, pageWidth } = PDF_LAYOUT;
    const gray = rgb(0.25, 0.25, 0.25);
    for (let i = 0; i < totalPages; i++) {
        const page = pages[i];
        const pageNum = i + 1;
        if (i > 0) {
            page.drawText('Aircraft Inspection Report', {
                x: margin,
                y: pageHeight - margin + 10,
                size: 10,
                font: fonts.bold,
                color: gray
            });
            page.drawText(`Tail: ${tail} | Date: ${dateStr}`, {
                x: margin,
                y: pageHeight - margin,
                size: 9,
                font: fonts.regular,
                color: gray
            });
        }
        page.drawText(`Inspector: ${inspector} | ${dept}`, {
            x: margin,
            y: margin - 16,
            size: 9,
            font: fonts.regular,
            color: gray
        });
        page.drawText(`Page ${pageNum} of ${totalPages}`, {
            x: pageWidth - margin - fonts.regular.widthOfTextAtSize(`Page ${pageNum} of ${totalPages}`, 9),
            y: margin - 16,
            size: 9,
            font: fonts.regular,
            color: gray
        });
    }
};

const drawTable = (page, fonts, cursor, columns, rows, options = {}) => {
    const { headerBg = PDF_LAYOUT.tableHeaderBg, rowAlt = PDF_LAYOUT.tableRowAlt, border = PDF_LAYOUT.tableBorder, pdfDoc, contentBottomY } = options;
    const lineH = PDF_LAYOUT.bodySize + 2;
    const cellPadH = PDF_LAYOUT.cellPadH;
    const cellPadV = PDF_LAYOUT.cellPadV;
    const rowGap = PDF_LAYOUT.tableRowGap || 4;
    const margin = PDF_LAYOUT.margin;
    const pageWidth = PDF_LAYOUT.pageWidth;
    const pageHeight = PDF_LAYOUT.pageHeight;
    const tableWidth = pageWidth - margin * 2;
    const rowHeight = 2 * lineH + cellPadV * 2 + rowGap;
    const gray = rgb(0.1, 0.1, 0.1);
    const borderColor = rgb(border, border, border);
    const totalColWidth = columns.reduce((sum, col) => sum + (col.width || 0), 0);
    const scale = totalColWidth > 0 && totalColWidth > tableWidth ? tableWidth / totalColWidth : 1;
    let colX = margin;
    columns.forEach((col) => {
        const w = Math.max(1, Math.floor((col.width || 0) * scale));
        col.x = colX;
        col.width = w;
        colX += w;
    });
    const startX = margin;
    const bottomY = contentBottomY ?? margin + 40;

    const drawHeaderRow = (p, yPos) => {
        p.drawRectangle({
            x: startX,
            y: yPos - rowHeight,
            width: tableWidth,
            height: rowHeight,
            color: rgb(headerBg, headerBg, headerBg),
            borderColor,
            borderWidth: 1
        });
        columns.forEach((col) => {
            const label = (col.label != null) ? String(col.label) : '';
            const alignRight = col.align === 'right';
            const x = alignRight ? col.x + col.width - cellPadH - fonts.bold.widthOfTextAtSize(label, PDF_LAYOUT.bodySize) : col.x + cellPadH;
            p.drawText(label, { x, y: yPos - rowHeight + cellPadV + 2, size: PDF_LAYOUT.bodySize, font: fonts.bold, color: gray });
        });
    };

    let y = cursor.y;
    let currentPage = cursor.page;
    drawHeaderRow(currentPage, y);
    y -= rowHeight;

    rows.forEach((row, idx) => {
        if (pdfDoc && y - rowHeight < bottomY) {
            cursor.page = pdfDoc.addPage([cursor.pageWidth, cursor.pageHeight]);
            cursor.y = pageHeight - margin;
            currentPage = cursor.page;
            y = cursor.y;
            drawHeaderRow(currentPage, y);
            y -= rowHeight;
        }
        const bg = idx % 2 === 1 ? rgb(rowAlt, rowAlt, rowAlt) : undefined;
        if (bg) {
            currentPage.drawRectangle({
                x: startX,
                y: y - rowHeight,
                width: tableWidth,
                height: rowHeight,
                color: bg,
                borderColor,
                borderWidth: 1
            });
        } else {
            currentPage.drawRectangle({
                x: startX,
                y: y - rowHeight,
                width: tableWidth,
                height: rowHeight,
                borderColor,
                borderWidth: 1
            });
        }
        columns.forEach((col) => {
            const text = row[col.key] != null ? String(row[col.key]) : '';
            const alignRight = col.align === 'right';
            const maxW = col.width - cellPadH * 2;
            const lines = wrapText(text, fonts.regular, PDF_LAYOUT.bodySize, maxW);
            lines.slice(0, 2).forEach((line, i) => {
                const tx = alignRight ? col.x + col.width - cellPadH - fonts.regular.widthOfTextAtSize(line, PDF_LAYOUT.bodySize) : col.x + cellPadH;
                currentPage.drawText(line, { x: tx, y: y - cellPadV - (i + 1) * lineH, size: PDF_LAYOUT.bodySize, font: fonts.regular, color: gray });
            });
        });
        y -= rowHeight;
    });
    cursor.y = y - PDF_LAYOUT.gapParagraph;
    cursor.page = currentPage;
};

const generatePdf = async (options = {}) => {
    const { preview = false } = options;
    const state = readState();
    if (!state) throw new Error('No inspection state');
    if (!state.detections) state.detections = [];
    if (!state.analysis) state.analysis = { threshold: 0.01 };
    const inspection = state.inspection || {};
    const reportOpts = state.report || {
        includeThumbnails: true,
        includeFalsePositives: false,
        includeAllPhotos: true,
        includeFlaggedImages: false,
        includeFlaggedImageNotes: false,
        notes: ''
    };
    const photos = state.photos || [];
    const includedDetections = filterIncludedDetections(state);
    const findingPages = [];
    const areasInspected = Array.from(new Set(photos.filter((p) => p && p.area).map((p) => p.area)));
    const pdfDoc = await PDFDocument.create();
    const fonts = {
        regular: await pdfDoc.embedStandardFont(StandardFonts.Helvetica),
        bold: await pdfDoc.embedStandardFont(StandardFonts.HelveticaBold)
    };

    const { pageWidth, pageHeight, margin } = PDF_LAYOUT;
    const cursor = {
        margin,
        pageHeight,
        pageWidth,
        page: pdfDoc.addPage([pageWidth, pageHeight]),
        y: pageHeight - margin
    };

    const addSectionTitle = (text, size = PDF_LAYOUT.sectionSize) => {
        ensureSpace(pdfDoc, cursor, 36);
        cursor.page.drawText(text, { x: cursor.margin, y: cursor.y, size, font: fonts.bold, color: rgb(0.08, 0.08, 0.08) });
        cursor.y -= Math.round(size * PDF_LAYOUT.lineHeight) + 10;
    };

    const addSubsectionTitle = (text) => {
        ensureSpace(pdfDoc, cursor, 28);
        cursor.page.drawText(text, { x: cursor.margin, y: cursor.y, size: PDF_LAYOUT.subsectionSize, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
        cursor.y -= Math.round(PDF_LAYOUT.subsectionSize * PDF_LAYOUT.lineHeight) + 8;
    };

    // ========================================
    // PAGE 1: HEADER & SUMMARY
    // ========================================
    addLine(cursor.page, 'Aircraft Inspection Report', fonts, cursor, { size: PDF_LAYOUT.titleSize, font: fonts.bold, lineHeight: Math.round(PDF_LAYOUT.titleSize * PDF_LAYOUT.lineHeight) });
    cursor.y -= PDF_LAYOUT.gapSection + 4;

    addSectionTitle('Aircraft Information');
    const aircraftRows = [
        { key: 'Registration', value: inspection.tailNumber || 'Not provided' },
        { key: 'Make/Model', value: inspection.makeModel || 'Not provided' },
        { key: 'Serial Number', value: inspection.serialNumber || 'Not provided' },
        { key: 'Department', value: inspection.department || 'Not provided' },
        { key: 'Inspection Type', value: `${String(inspection.inspectionType || 'Inbound').replace(/^\w/, (c) => c.toUpperCase())} Inspection` },
        { key: 'Inspection Date', value: formatUTCDate(inspection.startedAt) },
        { key: 'Total Time', value: inspection.totalTime || 'Not provided' },
        { key: 'Session Duration', value: formatDuration(inspection.startedAt) }
    ];
    drawTable(cursor.page, fonts, cursor,
        [{ key: 'key', label: 'Field', width: 160 }, { key: 'value', label: 'Value', width: pageWidth - margin * 2 - 160 - 2 }],
        aircraftRows.map((r) => ({ key: r.key, value: r.value }))
    );
    cursor.y -= PDF_LAYOUT.gapParagraph + 4;

    addSectionTitle('Inspection Authority');
    addKeyValue(cursor.page, 'Inspector Name', inspection.inspectorName || 'Not assigned', fonts, cursor);
    cursor.y -= PDF_LAYOUT.gapParagraph + 4;

    addSectionTitle('Inspection Scope');
    addKeyValue(cursor.page, 'Areas Inspected', areasInspected.length ? areasInspected.join(', ') : 'Not recorded', fonts, cursor);
    addKeyValue(cursor.page, 'Inspection Method', 'Computer Vision Analysis', fonts, cursor);
    cursor.y -= PDF_LAYOUT.gapParagraph + 4;

    addSectionTitle('Notes');
    const notesText = (reportOpts.notes || '').trim() || 'None';
    ensureSpace(pdfDoc, cursor, 60);
    const notesMaxWidth = pageWidth - cursor.margin * 2;
    const notesLineHeight = Math.round(PDF_LAYOUT.bodySize * PDF_LAYOUT.lineHeight);
    const notesLineCount = drawWrappedText(cursor.page, notesText, cursor.margin, cursor.y, {
        font: fonts.regular,
        size: PDF_LAYOUT.bodySize,
        color: rgb(0.1, 0.1, 0.1),
        maxWidth: notesMaxWidth,
        lineHeight: notesLineHeight
    });
    cursor.y -= notesLineCount * notesLineHeight;
    cursor.y -= PDF_LAYOUT.gapParagraph + 4;

    addSectionTitle('Findings Count Summary');
    const findingsSummaryText = `${includedDetections.length} finding(s) at current confidence threshold.`;
    cursor.page.drawText(findingsSummaryText, { x: cursor.margin, y: cursor.y, size: PDF_LAYOUT.bodySize, font: fonts.regular, color: rgb(0.1, 0.1, 0.1) });
    cursor.y -= notesLineHeight;

    // ========================================
    // PAGE 2: FLAGGED IMAGES (if enabled)
    // ========================================
    if (reportOpts.includeFlaggedImages) {
        const flaggedPhotos = photos.filter((photo) => photo && photo.flagged);
        if (flaggedPhotos.length > 0) {
            const flaggedImgH = 300;
            ensureSpace(pdfDoc, cursor, PDF_LAYOUT.gapSection + 28 + flaggedImgH + 80);
            addSectionTitle('Flagged Images — Defects Requiring Attention');
            const imageMargin = 12;
            const flaggedImgW = 400;
            const captionGap = 12;
            const gap = 24;
            let currentY = cursor.y;
            let currentX = cursor.margin;
            for (const photo of flaggedPhotos) {
                ensureSpace(pdfDoc, cursor, flaggedImgH + 100);
                currentY = cursor.y;
                try {
                    const photoDetections = includedDetections.filter((det) => det.photoId === photo.id);
                    const annotated = await createAnnotatedImage(photo, photoDetections, null);
                    const pngImage = await pdfDoc.embedPng(annotated);
                    const scale = Math.min((flaggedImgW - imageMargin * 2) / pngImage.width, (flaggedImgH - imageMargin * 2) / pngImage.height);
                    const w = pngImage.width * scale;
                    const h = pngImage.height * scale;
                    cursor.page.drawText(`Photo #${photo.number} — ${photo.area || 'Unknown'}`, {
                        x: currentX,
                        y: currentY,
                        size: PDF_LAYOUT.subsectionSize,
                        font: fonts.bold,
                        color: rgb(0.1, 0.1, 0.1)
                    });
                    currentY -= 16;
                    cursor.page.drawRectangle({
                        x: currentX,
                        y: currentY - flaggedImgH,
                        width: flaggedImgW,
                        height: flaggedImgH,
                        borderColor: rgb(0.867, 0.867, 0.867),
                        borderWidth: 1
                    });
                    cursor.page.drawImage(pngImage, {
                        x: currentX + imageMargin + (flaggedImgW - imageMargin * 2 - w) / 2,
                        y: currentY - flaggedImgH + imageMargin + (flaggedImgH - imageMargin * 2 - h) / 2,
                        width: w,
                        height: h
                    });
                    currentY -= flaggedImgH + captionGap;
                    if (reportOpts.includeFlaggedImageNotes && photo.flaggedNote && photo.flaggedNote.trim()) {
                        const noteLines = wrapText(`Note: ${photo.flaggedNote.trim()}`, fonts.regular, PDF_LAYOUT.captionSize, flaggedImgW - 4);
                        noteLines.forEach((line, idx) => {
                            cursor.page.drawText(line, {
                                x: currentX,
                                y: currentY - idx * 12,
                                size: PDF_LAYOUT.captionSize,
                                font: fonts.regular,
                                color: rgb(PDF_LAYOUT.captionGray, PDF_LAYOUT.captionGray, PDF_LAYOUT.captionGray)
                            });
                        });
                        currentY -= noteLines.length * 12 + captionGap;
                    }
                    currentY -= gap;
                    cursor.y = currentY;
                } catch (error) {
                    console.error('Failed to embed flagged image', error);
                }
            }
            cursor.y -= PDF_LAYOUT.gapSection;
        }
    }

    // ========================================
    // TECHNICAL REFERENCE (new page only if needed)
    // ========================================
    cursor.y -= 36;
    ensureSpace(pdfDoc, cursor, PDF_LAYOUT.gapSection + 120);
    addSectionTitle('Aircraft Sectioning for Inspection Process');
    
    addSubsectionTitle('Section Color Legend');
    ensureSpace(pdfDoc, cursor, 100);
    
    // Color legend entries with exact hex values
    const sectionColors = [
        { name: 'FWD Fuselage', color: [20, 184, 166] },   // Teal #14B8A6
        { name: 'MID Fuselage', color: [16, 185, 129] },   // Green #10B981
        { name: 'Wings', color: [59, 130, 246] },          // Blue #3B82F6
        { name: 'AFT Fuselage', color: [239, 68, 68] },    // Red #EF4444
        { name: 'Engines', color: [168, 85, 247] },        // Purple #A855F7
        { name: 'Vertical Stabilizer', color: [249, 115, 22] }, // Orange #F97316
        { name: 'Horizontal Stabilizer', color: [234, 179, 8] } // Yellow #EAB308
    ];
    
    let legendX = cursor.margin;
    let legendY = cursor.y;
    const legendLineHeight = 16;
    const legendBoxSize = 20; // Increased to 20px
    const legendSpacing = 8; // Space between entries
    const itemsPerRow = 3;
    const itemWidth = 180; // Width per item including box and text
    
    sectionColors.forEach((section, idx) => {
        if (idx > 0 && idx % itemsPerRow === 0) {
            legendY -= legendLineHeight + 4;
            legendX = cursor.margin;
        }
        
        // Color box (20x20px)
        cursor.page.drawRectangle({
            x: legendX,
            y: legendY - legendBoxSize,
            width: legendBoxSize,
            height: legendBoxSize,
            color: rgb(
                section.color[0] / 255,
                section.color[1] / 255,
                section.color[2] / 255
            ),
            borderColor: rgb(0.1, 0.1, 0.1),
            borderWidth: 0.5
        });
        
        // Section name
        cursor.page.drawText(section.name, {
            x: legendX + legendBoxSize + 8,
            y: legendY - 2,
            size: 9,
            font: fonts.regular,
            color: rgb(0.1, 0.1, 0.1)
        });
        
        legendX += itemWidth;
    });
    
    cursor.y = legendY - legendLineHeight - PDF_LAYOUT.gapSubsection - 20;
    addSubsectionTitle('Technical Reference Views');
    const viewSpacing = 20;
    const availableWidth = pageWidth - cursor.margin * 2;
    const viewWidth = Math.min(300, Math.floor((availableWidth - viewSpacing * 2) / 3));
    const viewHeightTarget = Math.round(viewWidth * (200 / 300));
    ensureSpace(pdfDoc, cursor, viewHeightTarget + 60);

    // Try to capture 3D views - wait for viewer to be ready
    let technicalViews = { top: null, side: null, front: null };
    
    // Wait for 3D viewer functions to be available (they're loaded as a module)
    let attempts = 0;
    const maxAttempts = 50; // Wait up to 5 seconds
    while (typeof window === 'undefined' || 
           (!window.captureTechnicalViewsWithWait && !window.captureTechnicalViews) && 
           attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }
    
    console.log('Checking for 3D capture functions:', {
        hasCaptureTechnicalViewsWithWait: typeof window !== 'undefined' && !!window.captureTechnicalViewsWithWait,
        hasCaptureTechnicalViews: typeof window !== 'undefined' && !!window.captureTechnicalViews,
        attempts: attempts
    });
    
    if (typeof window !== 'undefined' && window.captureTechnicalViewsWithWait) {
        try {
            console.log('Attempting to capture 3D technical views for PDF using captureTechnicalViewsWithWait...');
            technicalViews = await window.captureTechnicalViewsWithWait();
            console.log('3D views captured:', {
                top: !!technicalViews.top,
                side: !!technicalViews.side,
                front: !!technicalViews.front,
                topLength: technicalViews.top ? technicalViews.top.length : 0,
                sideLength: technicalViews.side ? technicalViews.side.length : 0,
                frontLength: technicalViews.front ? technicalViews.front.length : 0
            });
        } catch (error) {
            console.error('Failed to capture technical views with wait:', error);
            // Fallback to regular capture if available
            if (window.captureTechnicalViews) {
                try {
                    console.log('Trying fallback capture...');
                    technicalViews = await window.captureTechnicalViews();
                    console.log('Fallback capture result:', {
                        top: !!technicalViews.top,
                        side: !!technicalViews.side,
                        front: !!technicalViews.front
                    });
                } catch (fallbackError) {
                    console.error('Fallback capture also failed:', fallbackError);
                }
            }
        }
    } else if (typeof window !== 'undefined' && window.captureTechnicalViews) {
        // Fallback to regular capture
        try {
            console.log('Using regular captureTechnicalViews (no wait function available)...');
            technicalViews = await window.captureTechnicalViews();
            console.log('Regular capture result:', {
                top: !!technicalViews.top,
                side: !!technicalViews.side,
                front: !!technicalViews.front
            });
        } catch (error) {
            console.error('Failed to capture technical views:', error);
        }
    } else {
        console.warn('No 3D capture functions available on window object');
    }
    
    // Display views: target 300x200pt each, fit in page
    const viewsPerRow = 3;
    const totalViewsWidth = (viewWidth * viewsPerRow) + (viewSpacing * (viewsPerRow - 1));
    const startX = cursor.margin + (cursor.pageWidth - cursor.margin * 2 - totalViewsWidth) / 2;
    
    const views = [
        { key: 'top', label: 'Top View', dataUrl: technicalViews.top },
        { key: 'side', label: 'Side View', dataUrl: technicalViews.side },
        { key: 'front', label: 'Front View', dataUrl: technicalViews.front }
    ];
    
    let currentX = startX;
    const viewsStartY = cursor.y;
    let maxViewHeight = 0;
    
    // First pass: embed images and calculate heights while maintaining aspect ratio
    const viewData = [];
    for (let i = 0; i < views.length; i++) {
        const view = views[i];
        
        try {
            if (view.dataUrl) {
                // Embed screenshot and get dimensions
                const viewImage = await pdfDoc.embedPng(view.dataUrl);
                const imageDims = viewImage.scale(1);
                const imageAspectRatio = imageDims.height / imageDims.width;
                const displayHeight = viewWidth * imageAspectRatio;
                
                viewData.push({
                    image: viewImage,
                    width: viewWidth,
                    height: displayHeight,
                    label: view.label,
                    hasImage: true
                });
                
                maxViewHeight = Math.max(maxViewHeight, displayHeight);
            } else {
                const placeholderHeight = viewHeightTarget;
                viewData.push({
                    image: null,
                    width: viewWidth,
                    height: placeholderHeight,
                    label: view.label,
                    hasImage: false
                });
                maxViewHeight = Math.max(maxViewHeight, placeholderHeight);
            }
        } catch (error) {
            console.error(`Failed to embed ${view.key} view:`, error);
            viewData.push({
                image: null,
                width: viewWidth,
                height: viewHeightTarget,
                label: view.label,
                hasImage: false
            });
            maxViewHeight = Math.max(maxViewHeight, viewHeightTarget);
        }
    }
    
    // Second pass: draw all views aligned to top
    currentX = startX;
    for (let i = 0; i < viewData.length; i++) {
        const view = viewData[i];
        const viewY = viewsStartY - view.height;
        
        if (view.hasImage && view.image) {
            // Draw image maintaining aspect ratio
            cursor.page.drawImage(view.image, {
                x: currentX,
                y: viewY,
                width: view.width,
                height: view.height
            });
        } else {
            // Draw placeholder
            cursor.page.drawRectangle({
                x: currentX,
                y: viewY,
                width: view.width,
                height: view.height,
                borderColor: rgb(0.8, 0.8, 0.8),
                borderWidth: 1
            });
            const placeholderText = wrapText('View not available', fonts.regular, 9, view.width - 10);
            drawWrappedText(cursor.page, placeholderText.join(' '), currentX + 5, viewY + view.height / 2, {
                font: fonts.regular,
                size: 9,
                color: rgb(0.5, 0.5, 0.5),
                maxWidth: view.width - 10,
                lineHeight: 12
            });
        }
        
        // View label centered below image
        const labelWidth = fonts.regular.widthOfTextAtSize(view.label, 10);
        cursor.page.drawText(view.label, {
            x: currentX + (view.width - labelWidth) / 2,
            y: viewY - 14,
            size: 10,
            font: fonts.bold,
            color: rgb(0.1, 0.1, 0.1)
        });
        
        currentX += view.width + viewSpacing;
    }
    
    const viewLabelHeight = 26;
    cursor.y = viewsStartY - maxViewHeight - viewLabelHeight - PDF_LAYOUT.gapItem;
    addSubsectionTitle('Heat Mapping Legend');
    const heatLegendText = 'Color intensity indicates defect concentration: White = 0 defects, Yellow-Orange gradient = 1-9 defects, Bright Red = 10+ defects. Heat mapping is overlaid on each section\'s designated color (Teal FWD, Green MID, Blue Wings, Red AFT, Purple Engines, Orange Vertical Stabilizer, Yellow Horizontal Stabilizer). Only inspected sections display color-coding; uninspected areas appear in neutral gray.';
    const heatLegendLines = wrapText(heatLegendText, fonts.regular, PDF_LAYOUT.captionSize, pageWidth - cursor.margin * 2);
    heatLegendLines.forEach((line, idx) => {
        cursor.page.drawText(line, {
            x: cursor.margin,
            y: cursor.y - idx * 12,
            size: PDF_LAYOUT.captionSize,
            font: fonts.regular,
            color: rgb(PDF_LAYOUT.captionGray, PDF_LAYOUT.captionGray, PDF_LAYOUT.captionGray)
        });
    });
    cursor.y -= heatLegendLines.length * 12 + PDF_LAYOUT.gapSection + 8;

    // ========================================
    // FINDINGS SUMMARY TABLE (continues from previous section; paginates if needed)
    // ========================================
    const summaryRows = includedDetections.length > 0
        ? includedDetections.map((detection, idx) => ({
            id: `F-${String(idx + 1).padStart(3, '0')}`,
            type: detection.class || 'Defect',
            location: detection.area || 'N/A',
            photo: `#${detection.photoNumber}`,
            confidence: detection.manual ? 'Manual' : (typeof detection.confidence === 'number' ? `${Math.round(detection.confidence * 100)}%` : 'N/A'),
            note: (detection.note && String(detection.note).trim()) ? String(detection.note).trim() : '—'
          }))
        : [];
    const lineH = PDF_LAYOUT.bodySize + 2;
    const tableRowHeight = 2 * lineH + PDF_LAYOUT.cellPadV * 2 + (PDF_LAYOUT.tableRowGap || 4);
    const findingsTableHeight = (1 + summaryRows.length) * tableRowHeight;
    const footerClearance = 40;
    const sectionTitleHeight = 28;
    ensureSpace(pdfDoc, cursor, PDF_LAYOUT.gapSection + sectionTitleHeight + tableRowHeight + footerClearance);
    addSectionTitle('Findings Summary');
    if (includedDetections.length > 0) {
        const summaryCols = [
            { key: 'id', label: 'ID', width: 44 },
            { key: 'type', label: 'Defect Type', width: 82 },
            { key: 'location', label: 'Location', width: 82 },
            { key: 'photo', label: 'Photo #', width: 48, align: 'right' },
            { key: 'confidence', label: 'Confidence', width: 62, align: 'right' },
            { key: 'note', label: 'Note', width: 150 }
        ];
        drawTable(cursor.page, fonts, cursor, summaryCols, summaryRows, {
            pdfDoc,
            contentBottomY: margin + PDF_FOOTER_CLEARANCE
        });
    } else {
        cursor.page.drawText('No defects met the reporting criteria at the selected threshold.', {
            x: cursor.margin,
            y: cursor.y,
            size: PDF_LAYOUT.bodySize,
            font: fonts.regular,
            color: rgb(0.1, 0.1, 0.1)
        });
        cursor.y -= 20;
    }

    // ========================================
    // PAGES 5+: DETAILED FINDINGS (card layout)
    // ========================================
    if (includedDetections.length > 0) {
        cursor.y -= PDF_LAYOUT.gapSection;
        ensureSpace(pdfDoc, cursor, 380);
        addSectionTitle('Detailed Findings');

        let findingIndex = 1;
        const BORDER_W = 4;
        const CARD_THUMB_W = 200;
        const CARD_THUMB_H = 150;
        const CARD_GAP = 28;
        const CARD_MIN_H = 320;
        const CARD_PAD = 20;
        const DETAILS_X = cursor.margin + BORDER_W + CARD_THUMB_W + CARD_PAD;

        for (const detection of includedDetections) {
            ensureSpace(pdfDoc, cursor, CARD_MIN_H + CARD_GAP);
            if (preview) findingPages.push(pdfDoc.getPageCount());

            const photo = photos.find((p) => p && p.id === detection.photoId);
            const confidence = detection.manual ? 'Manual' : (typeof detection.confidence === 'number' ? `${Math.round(detection.confidence * 100)}%` : 'Not recorded');
            const bbox = detection.bbox || {};
            const dims = bbox.width && bbox.height
                ? `${Math.round(bbox.width)} × ${Math.round(bbox.height)} px`
                : 'Not recorded';
            const isCritical = Boolean(detection.critical);

            const detectionLabel = detection.manual ? 'Manual Detection' : 'AI Detection';
            const findingTitle = `Finding F-${String(findingIndex).padStart(3, '0')}: ${detection.class || 'Defect'}`;

            const findingStartY = cursor.y;
            const maxDetailWidth = Math.max(120, pageWidth - DETAILS_X - cursor.margin - 12);

            cursor.page.drawRectangle({
                x: cursor.margin,
                y: cursor.y - CARD_MIN_H,
                width: BORDER_W,
                height: CARD_MIN_H,
                color: isCritical ? rgb(0.863, 0.149, 0.278) : rgb(0.9, 0.9, 0.9)
            });
            
            // Title and Subtitle on right side (detail area), spanning down
            // Title - draw at top, then move down
            const titleLines = wrapText(findingTitle, fonts.bold, 12, maxDetailWidth);
            const titleY = cursor.y;
            titleLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X,
                    y: titleY - idx * 14,
                    size: 12,
                    font: fonts.bold,
                    color: rgb(0.1, 0.1, 0.1)
                });
            });
            const titleHeight = titleLines.length * 14;
            const titleBottom = titleY - titleHeight;
            cursor.y = titleBottom - 4; // 4px gap after title
            
            // Subtitle - draw below title, then move down
            const subtitle = `${detection.area || 'Unknown component'} · ${detectionLabel}`;
            const subtitleLines = wrapText(subtitle, fonts.regular, 10, maxDetailWidth);
            const subtitleY = cursor.y;
            subtitleLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X,
                    y: subtitleY - idx * 12,
                    size: 10,
                    font: fonts.regular,
                    color: rgb(0.4, 0.4, 0.4)
                });
            });
            const subtitleHeight = subtitleLines.length * 12;
            const subtitleBottom = subtitleY - subtitleHeight;
            cursor.y = subtitleBottom - 8; // 8px gap after subtitle

            const thumbnailAndDetailsStartY = subtitleBottom - 8;
            let detailY = thumbnailAndDetailsStartY;
            const detailWidth = maxDetailWidth - 55;
            // Detail fields with compact 11px line spacing
            cursor.page.drawText('Location:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
            const locationLines = wrapText(`${detection.area || 'Area N/A'} · Photo #${detection.photoNumber}`, fonts.regular, 9, detailWidth);
            locationLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X + 55,
                    y: detailY - idx * 11,
                    size: 9,
                    font: fonts.regular,
                    color: rgb(0.1, 0.1, 0.1)
                });
            });
            detailY -= Math.max(locationLines.length, 1) * 11;

            cursor.page.drawText('Type:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
            const typeLines = wrapText(detection.class || 'Defect', fonts.regular, 9, detailWidth);
            typeLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X + 55,
                    y: detailY - idx * 11,
                    size: 9,
                    font: fonts.regular,
                    color: rgb(0.1, 0.1, 0.1)
                });
            });
            detailY -= Math.max(typeLines.length, 1) * 11;

            cursor.page.drawText('Dimensions:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
            const dimLines = wrapText(dims, fonts.regular, 9, detailWidth);
            dimLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X + 55,
                    y: detailY - idx * 11,
                    size: 9,
                    font: fonts.regular,
                    color: rgb(0.1, 0.1, 0.1)
                });
            });
            detailY -= Math.max(dimLines.length, 1) * 11;

            const labelWidth = detailWidth;
            if (detection.manual) {
                cursor.page.drawText('Detection:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
                const manualLines = drawWrappedText(cursor.page, 'Manual', DETAILS_X + 55, detailY, {
                    font: fonts.regular,
                    size: 9,
                    color: rgb(0.1, 0.1, 0.1),
                    maxWidth: labelWidth,
                    lineHeight: 11
                });
                detailY -= Math.max(manualLines, 1) * 11; // Move down by actual lines drawn
            } else {
                cursor.page.drawText('Confidence:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
                const confidenceLines = drawWrappedText(cursor.page, confidence, DETAILS_X + 55, detailY, {
                    font: fonts.regular,
                    size: 9,
                    color: rgb(0.1, 0.1, 0.1),
                    maxWidth: labelWidth,
                    lineHeight: 11
                });
                detailY -= Math.max(confidenceLines, 1) * 11; // Move down by actual lines drawn
            }

            cursor.page.drawText('Action:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
            const actionLines = wrapText('Verify and remediate', fonts.regular, 9, labelWidth);
            actionLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X + 55,
                    y: detailY - idx * 11,
                    size: 9,
                    font: fonts.regular,
                    color: rgb(0.1, 0.1, 0.1)
                });
            });
            detailY -= Math.max(actionLines.length, 1) * 11; // Move down after action lines

            if (detection.note && String(detection.note).trim()) {
                cursor.page.drawText('Notes:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
                const noteLines = drawWrappedText(cursor.page, String(detection.note).trim(), DETAILS_X + 55, detailY, {
                    font: fonts.regular,
                    size: 9,
                    color: rgb(0.1, 0.1, 0.1),
                    maxWidth: labelWidth,
                    lineHeight: 11
                });
                detailY -= Math.max(noteLines, 1) * 11;
            }

            // Calculate bottom of details section for cursor positioning
            const detailsBottom = detailY;
            
            // Thumbnail on left side - aligned top with detail fields
            let thumbnailBottom = findingStartY; // Default if no thumbnail
            if (photo?.dataURL) {
                try {
                    const thumbResult = await createCroppedThumbnail(photo.dataURL, detection.bbox, CARD_THUMB_H);
                    const thumbImage = await pdfDoc.embedPng(thumbResult.src);
                    const aspectRatio = thumbResult.width / thumbResult.height;
                    let w = thumbResult.width;
                    let h = thumbResult.height;
                    if (h > CARD_THUMB_H) { h = CARD_THUMB_H; w = h * aspectRatio; }
                    if (w > CARD_THUMB_W) { w = CARD_THUMB_W; h = w / aspectRatio; }
                    const thumbY = thumbnailAndDetailsStartY - h;
                    cursor.page.drawRectangle({
                        x: cursor.margin + BORDER_W,
                        y: thumbY,
                        width: CARD_THUMB_W,
                        height: CARD_THUMB_H,
                        borderColor: rgb(0.867, 0.867, 0.867),
                        borderWidth: 1
                    });
                    cursor.page.drawImage(thumbImage, {
                        x: cursor.margin + BORDER_W + (CARD_THUMB_W - w) / 2,
                        y: thumbY + (CARD_THUMB_H - h) / 2,
                        width: w,
                        height: h
                    });
                    thumbnailBottom = thumbY;
                } catch (error) {
                    console.error('Failed to embed thumbnail', error);
                }
            }

            const findingBottom = Math.min(detailsBottom, thumbnailBottom);
            cursor.y = findingBottom - CARD_GAP;
            findingIndex += 1;
        }
    }

    // ========================================
    // FULL RESOLUTION IMAGES (optional; new page only if needed)
    // ========================================
    if (reportOpts.includeThumbnails && includedDetections.length > 0) {
        ensureSpace(pdfDoc, cursor, PDF_LAYOUT.gapSection + 28 + 200);
        addSectionTitle('Full Resolution Images');
        const photoMap = new Map();
        includedDetections.forEach((detection) => {
            const photo = photos.find((p) => p && p.id === detection.photoId);
            if (photo && !photoMap.has(photo.id)) {
                photoMap.set(photo.id, { photo, detections: [] });
            }
            if (photo) {
                photoMap.get(photo.id).detections.push(detection);
            }
        });

        const fullGap = 24;
        const fullImageMargin = 12;
        const fullCaptionGap = 12;
        const colWidth = (pageWidth - cursor.margin * 2 - fullGap) / 2;
        const fullImgW = Math.min(600, colWidth);
        const fullImgH = Math.round(fullImgW * (450 / 600));
        let currentY = cursor.y;
        let currentX = cursor.margin;
        let col = 0;

        for (const [, { photo, detections }] of photoMap) {
            if (col === 2) {
                currentY -= fullImgH + fullCaptionGap + fullGap;
                if (currentY - fullImgH - 50 < cursor.margin) {
                    cursor.page = pdfDoc.addPage([pageWidth, pageHeight]);
                    currentY = pageHeight - cursor.margin;
                    cursor.y = currentY;
                }
                currentX = cursor.margin;
                col = 0;
            }
            try {
                const annotated = await createAnnotatedImage(photo, detections, null);
                const pngImage = await pdfDoc.embedPng(annotated);
                const scale = Math.min((fullImgW - fullImageMargin * 2) / pngImage.width, (fullImgH - fullImageMargin * 2) / pngImage.height);
                const w = pngImage.width * scale;
                const h = pngImage.height * scale;
                cursor.page.drawText(`Photo #${photo.number} — ${photo.area || 'Unknown'}`, {
                    x: currentX,
                    y: currentY,
                    size: PDF_LAYOUT.subsectionSize,
                    font: fonts.bold,
                    color: rgb(0.1, 0.1, 0.1)
                });
                currentY -= fullCaptionGap;
                cursor.page.drawRectangle({
                    x: currentX,
                    y: currentY - fullImgH,
                    width: fullImgW,
                    height: fullImgH,
                    borderColor: rgb(0.867, 0.867, 0.867),
                    borderWidth: 1
                });
                cursor.page.drawImage(pngImage, {
                    x: currentX + fullImageMargin + (fullImgW - fullImageMargin * 2 - w) / 2,
                    y: currentY - fullImgH + fullImageMargin + (fullImgH - fullImageMargin * 2 - h) / 2,
                    width: w,
                    height: h
                });
                if (col === 0) {
                    currentX += colWidth + fullGap;
                } else {
                    currentY -= fullImgH + fullCaptionGap + fullGap;
                }
                col++;
            } catch (error) {
                console.error('Failed to embed full resolution image', error);
            }
        }
    }

    addHeaderAndFooter(pdfDoc, fonts, state);
    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    if (preview) {
        return { blob, pageCount: pdfDoc.getPageCount(), findingPages };
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildFileName(state);
    link.click();
    URL.revokeObjectURL(url);
};

// Export generatePdf for use in other modules
export { generatePdf };

thumbnailToggle?.addEventListener('change', (event) => {
    updateReportOptions({ includeThumbnails: event.target.checked });
    renderSummary();
    dispatchReportStateChanged();
});

falsePositiveToggle?.addEventListener('change', (event) => {
    updateReportOptions({ includeFalsePositives: event.target.checked });
    renderSummary();
    dispatchReportStateChanged();
});

allPhotosToggle?.addEventListener('change', (event) => {
    updateReportOptions({ includeAllPhotos: event.target.checked });
    renderSummary();
    dispatchReportStateChanged();
});

flaggedImagesToggle?.addEventListener('change', (event) => {
    updateReportOptions({ includeFlaggedImages: event.target.checked });
    renderSummary();
    dispatchReportStateChanged();
});

flaggedImageNotesToggle?.addEventListener('change', (event) => {
    updateReportOptions({ includeFlaggedImageNotes: event.target.checked });
    renderSummary();
    dispatchReportStateChanged();
});

reportNotesEl?.addEventListener('input', () => {
    updateReportOptions({ notes: reportNotesEl.value });
    dispatchReportStateChanged();
});

// Save note only when user leaves the field (blur event) to prevent duplicates
// Using a debounce mechanism to avoid saving multiple times
let saveNoteTimeout = null;
reportNotesEl?.addEventListener('blur', () => {
    // Clear any pending save
    if (saveNoteTimeout) {
        clearTimeout(saveNoteTimeout);
    }
    
    // Save after a short delay to ensure we have the final value
    saveNoteTimeout = setTimeout(() => {
        const state = readState();
        if (reportNotesEl.value && reportNotesEl.value.trim()) {
            const inspectionContext = state.inspection ? {
                tailNumber: state.inspection.tailNumber || '',
                inspectionType: state.inspection.inspectionType || '',
                inspectorName: state.inspection.inspectorName || '',
                startedAt: state.inspection.startedAt || null
            } : null;
            saveGeneralNoteToStorage(reportNotesEl.value.trim(), inspectionContext);
        }
    }, 100);
});

backToResultsBtn?.addEventListener('click', () => {
    if (inHistoryMode) return;
    window.location.href = 'results.html';
});

generateFinalReportBtn?.addEventListener('click', async () => {
    const btn = generateFinalReportBtn;
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Generating…';
    try {
        await generatePdf();
        window.location.href = 'success.html';
    } catch (error) {
        console.error('PDF generation failed', error);
        alert(error.message || 'Unable to generate PDF. Please try again.');
    } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
    }
});

submitInspectionBtn?.addEventListener('click', () => {
    window.location.href = 'success.html';
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

const initialState = ensureAnalysisComplete();
if (initialState) {
    saveInspectionToHistory(initialState);
    renderSummary();
    dispatchReportStateChanged();
}

window.addEventListener('report-state-changed', () => {
    renderFlaggedImagesNotes();
    renderFindingsList();
});

