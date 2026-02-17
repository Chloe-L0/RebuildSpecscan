import {
    AREAS,
    addManualDetection,
    dataURLToFile,
    getAreaColor,
    readState,
    recordDetections,
    removeDetection,
    resetState,
    setAnalysisStatus,
    setAnalysisThreshold,
    setCurrentAreaView,
    setCurrentPhotoIndex,
    summarizeDetectionsByArea,
    toggleFalsePositive,
    togglePhotoFlagged,
    toInspectionAreaSlug,
    updateDetectionBbox
} from './state.js';
import { createCroppedThumbnail, THUMBNAIL_HEIGHT } from './thumbnails.js';

// Color palette for different defect classes
const DEFECT_COLORS = [
    { border: '#e11d48', bg: 'rgba(225, 29, 72, 0.18)', label: '#e11d48' }, // Red
    { border: '#2563eb', bg: 'rgba(37, 99, 235, 0.18)', label: '#2563eb' }, // Blue
    { border: '#059669', bg: 'rgba(5, 150, 105, 0.18)', label: '#059669' }, // Green
    { border: '#d97706', bg: 'rgba(217, 119, 6, 0.18)', label: '#d97706' }, // Orange
    { border: '#7c3aed', bg: 'rgba(124, 58, 237, 0.18)', label: '#7c3aed' }, // Purple
    { border: '#dc2626', bg: 'rgba(220, 38, 38, 0.18)', label: '#dc2626' }, // Dark Red
    { border: '#0284c7', bg: 'rgba(2, 132, 199, 0.18)', label: '#0284c7' }, // Cyan
    { border: '#ca8a04', bg: 'rgba(202, 138, 4, 0.18)', label: '#ca8a04' }  // Amber
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

const thumbnailCache = new Map();

const toBox = (detection) => {
    const bbox = detection?.bbox || {};
    const width = bbox.width ?? bbox.w ?? null;
    const height = bbox.height ?? bbox.h ?? null;
    const centerX = bbox.centerX ?? bbox.x ?? null;
    const centerY = bbox.centerY ?? bbox.y ?? null;
    if (width == null || height == null || centerX == null || centerY == null) return null;
    return {
        x1: centerX - width / 2,
        y1: centerY - height / 2,
        x2: centerX + width / 2,
        y2: centerY + height / 2
    };
};

const iou = (a, b) => {
    const x1 = Math.max(a.x1, b.x1);
    const y1 = Math.max(a.y1, b.y1);
    const x2 = Math.min(a.x2, b.x2);
    const y2 = Math.min(a.y2, b.y2);
    const interWidth = Math.max(0, x2 - x1);
    const interHeight = Math.max(0, y2 - y1);
    const interArea = interWidth * interHeight;
    if (interArea === 0) return 0;
    const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
    const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
    const union = areaA + areaB - interArea;
    return union > 0 ? interArea / union : 0;
};

const applyNms = (detections, threshold = 0.5) => {
    const scored = detections
        .map((det) => ({
            det,
            box: toBox(det),
            score:
                typeof det.confidence === 'number'
                    ? det.confidence
                    : typeof det.confidence_percent === 'number'
                    ? det.confidence_percent / 100
                    : 0
        }))
        .filter((item) => item.box);

    scored.sort((a, b) => b.score - a.score);

    const keep = [];
    while (scored.length) {
        const current = scored.shift();
        keep.push(current.det);
        for (let i = scored.length - 1; i >= 0; i -= 1) {
            if (iou(current.box, scored[i].box) > threshold) {
                scored.splice(i, 1);
            }
        }
    }

    // Include any detections without valid boxes unchanged (they can't be NMS'd)
    const noBox = detections.filter((det) => !toBox(det));
    return [...keep, ...noBox];
};

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
const noImageMessage = document.getElementById('noImageMessage');
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const reorganizeBtn = document.getElementById('reorganizeBtn');
const reportBtn = document.getElementById('reportBtn');
const startOverBtn = document.getElementById('startOverBtn');
const saveDraftBtn = document.getElementById('saveDraftBtn');
const flagBtn = document.getElementById('flagBtn');
const flagBtnText = document.getElementById('flagBtnText');
const logoBtn = document.getElementById('logoBtn');

let activeHighlight = null;

// Drawing state for manual annotations
let isDrawing = false;
let drawStartX = 0;
let drawStartY = 0;
let previewBox = null;

// Resize state for manual detection boxes
let isResizing = false;
let resizeHandle = null; // 'nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'
let resizeDetectionId = null;
let resizeStartBox = null; // Original box dimensions when resize started
let resizeStartX = 0;
let resizeStartY = 0;

const getViewerStage = () => document.querySelector('.viewer-stage');

// Get cursor style for resize handle
const getResizeCursor = (handle) => {
    const cursors = {
        'nw': 'nw-resize',
        'n': 'n-resize',
        'ne': 'ne-resize',
        'e': 'e-resize',
        'se': 'se-resize',
        's': 's-resize',
        'sw': 'sw-resize',
        'w': 'w-resize'
    };
    return cursors[handle] || 'default';
};

// Convert screen coordinates to image coordinates
const screenToImageCoords = (screenX, screenY) => {
    if (!resultImage.complete || !resultImage.naturalWidth || !resultImage.naturalHeight) {
        return null;
    }

    const viewerStage = getViewerStage();
    if (!viewerStage) return null;
    
    const container = viewerStage;
    const containerRect = container.getBoundingClientRect();
    const imageRect = resultImage.getBoundingClientRect();
    
    // Get relative position within container
    const relX = screenX - containerRect.left;
    const relY = screenY - containerRect.top;
    
    // Get image offset within container
    const imageOffsetX = imageRect.left - containerRect.left;
    const imageOffsetY = imageRect.top - containerRect.top;
    
    // Get displayed and natural image dimensions
    const displayedWidth = imageRect.width;
    const displayedHeight = imageRect.height;
    const naturalWidth = resultImage.naturalWidth;
    const naturalHeight = resultImage.naturalHeight;
    
    // Check if click is within image bounds
    if (relX < imageOffsetX || relX > imageOffsetX + displayedWidth ||
        relY < imageOffsetY || relY > imageOffsetY + displayedHeight) {
        return null;
    }
    
    // Convert to image coordinates
    const scaleX = naturalWidth / displayedWidth;
    const scaleY = naturalHeight / displayedHeight;
    
    const imageX = (relX - imageOffsetX) * scaleX;
    const imageY = (relY - imageOffsetY) * scaleY;
    
    return { x: imageX, y: imageY };
};

// Create preview box for drawing
const createPreviewBox = (x1, y1, x2, y2) => {
    if (previewBox) {
        previewBox.remove();
    }
    
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    
    previewBox = document.createElement('div');
    previewBox.className = 'overlay-box';
    previewBox.style.position = 'absolute';
    previewBox.style.border = '2px dashed #4a90e2';
    previewBox.style.backgroundColor = 'rgba(74, 144, 226, 0.1)';
    previewBox.style.pointerEvents = 'none';
    previewBox.style.left = `${left}px`;
    previewBox.style.top = `${top}px`;
    previewBox.style.width = `${width}px`;
    previewBox.style.height = `${height}px`;
    previewBox.style.zIndex = '10';
    
    overlayLayer.appendChild(previewBox);
};

// Remove preview box
const removePreviewBox = () => {
    if (previewBox) {
        previewBox.remove();
        previewBox = null;
    }
};

// Handle mouse down - start drawing or resizing
const handleMouseDown = (event) => {
    // Check if clicking on a resize handle
    const handle = event.target.closest('.resize-handle');
    if (handle) {
        isResizing = true;
        resizeHandle = handle.dataset.handle;
        resizeDetectionId = handle.closest('.overlay-box')?.dataset.predictionId;
        resizeStartX = event.clientX;
        resizeStartY = event.clientY;
        
        // Get current detection and store its box
        const state = readState();
        const detection = state.detections.find(d => d.id === resizeDetectionId);
        if (detection && detection.bbox) {
            resizeStartBox = {
                centerX: detection.bbox.centerX,
                centerY: detection.bbox.centerY,
                width: detection.bbox.width,
                height: detection.bbox.height,
                imageWidth: detection.bbox.imageWidth || resultImage.naturalWidth,
                imageHeight: detection.bbox.imageHeight || resultImage.naturalHeight
            };
        }
        
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    
    // Don't start drawing if clicking on a resize handle
    if (event.target.closest('.resize-handle')) {
        // Resize handle click is handled separately
        return;
    }
    
    // Don't start drawing if clicking on a detection box - let the box's click handler handle it
    if (event.target.closest('.overlay-box')) {
        return;
    }
    
    // Don't start drawing if clicking on buttons
    if (event.target.closest('button')) {
        return;
    }
    
    const viewerStage = getViewerStage();
    if (!viewerStage || !resultImage.complete) return;
    
    const container = viewerStage;
    const containerRect = container.getBoundingClientRect();
    const imageRect = resultImage.getBoundingClientRect();
    
    // Check if click is within image bounds
    const relX = event.clientX - containerRect.left;
    const relY = event.clientY - containerRect.top;
    const imageOffsetX = imageRect.left - containerRect.left;
    const imageOffsetY = imageRect.top - containerRect.top;
    
    if (relX < imageOffsetX || relX > imageOffsetX + imageRect.width ||
        relY < imageOffsetY || relY > imageOffsetY + imageRect.height) {
        return;
    }
    
    isDrawing = true;
    drawStartX = event.clientX;
    drawStartY = event.clientY;
    
    event.preventDefault();
    event.stopPropagation();
};

// Handle mouse move - update preview or resize
const handleMouseMove = (event) => {
    // Handle resizing
    if (isResizing && resizeHandle && resizeDetectionId && resizeStartBox) {
        const state = readState();
        const detection = state.detections.find(d => d.id === resizeDetectionId);
        if (!detection || !detection.manual) {
            isResizing = false;
            return;
        }
        
        // Convert mouse movement to image coordinates
        const deltaX = event.clientX - resizeStartX;
        const deltaY = event.clientY - resizeStartY;
        
        const imageRect = resultImage.getBoundingClientRect();
        const scaleX = resizeStartBox.imageWidth / imageRect.width;
        const scaleY = resizeStartBox.imageHeight / imageRect.height;
        
        const deltaImageX = deltaX * scaleX;
        const deltaImageY = deltaY * scaleY;
        
        // Calculate new box dimensions based on handle
        // Note: resizeStartBox uses actual image coordinates (not expanded)
        let newLeft = resizeStartBox.centerX - resizeStartBox.width / 2;
        let newTop = resizeStartBox.centerY - resizeStartBox.height / 2;
        let newRight = resizeStartBox.centerX + resizeStartBox.width / 2;
        let newBottom = resizeStartBox.centerY + resizeStartBox.height / 2;
        
        // Adjust based on which handle is being dragged
        if (resizeHandle.includes('w')) newLeft += deltaImageX;
        if (resizeHandle.includes('e')) newRight += deltaImageX;
        if (resizeHandle.includes('n')) newTop += deltaImageY;
        if (resizeHandle.includes('s')) newBottom += deltaImageY;
        
        // Ensure valid dimensions
        if (newRight <= newLeft) {
            if (resizeHandle.includes('w')) newLeft = newRight - 10;
            else newRight = newLeft + 10;
        }
        if (newBottom <= newTop) {
            if (resizeHandle.includes('n')) newTop = newBottom - 10;
            else newBottom = newTop + 10;
        }
        
        const newWidth = newRight - newLeft;
        const newHeight = newBottom - newTop;
        const newCenterX = newLeft + newWidth / 2;
        const newCenterY = newTop + newHeight / 2;
        
        // Minimum size check
        if (newWidth < 10 || newHeight < 10) {
            return;
        }
        
        // Update detection bbox (store actual image coordinates, not expanded)
        updateDetectionBbox(resizeDetectionId, {
            centerX: newCenterX,
            centerY: newCenterY,
            width: newWidth,
            height: newHeight,
            imageWidth: resizeStartBox.imageWidth,
            imageHeight: resizeStartBox.imageHeight
        });
        
        // Update resize start box for next move event
        resizeStartBox = {
            centerX: newCenterX,
            centerY: newCenterY,
            width: newWidth,
            height: newHeight,
            imageWidth: resizeStartBox.imageWidth,
            imageHeight: resizeStartBox.imageHeight
        };
        resizeStartX = event.clientX;
        resizeStartY = event.clientY;
        
        render();
        event.preventDefault();
        return;
    }
    
    // Handle drawing preview
    if (!isDrawing) return;
    const viewerStage = getViewerStage();
    if (!viewerStage) return;
    
    const container = viewerStage;
    const containerRect = container.getBoundingClientRect();
    const imageRect = resultImage.getBoundingClientRect();
    
    const imageOffsetX = imageRect.left - containerRect.left;
    const imageOffsetY = imageRect.top - containerRect.top;
    
    const currentX = event.clientX;
    const currentY = event.clientY;
    
    // Convert to container-relative coordinates
    const startRelX = drawStartX - containerRect.left;
    const startRelY = drawStartY - containerRect.top;
    const currentRelX = currentX - containerRect.left;
    const currentRelY = currentY - containerRect.top;
    
    createPreviewBox(startRelX, startRelY, currentRelX, currentRelY);
    event.preventDefault();
};

// Handle mouse up - finalize box or resize
const handleMouseUp = async (event) => {
    // Handle resize end
    if (isResizing) {
        isResizing = false;
        resizeHandle = null;
        resizeDetectionId = null;
        resizeStartBox = null;
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    
    if (!isDrawing) return;
    
    const wasDrawing = isDrawing;
    isDrawing = false;
    removePreviewBox();
    
    if (!wasDrawing) return;
    
    const state = readState();
    const area = state.analysis.currentArea || AREAS[0];
    const areaPhotos = state.photos.filter((photo) => photo.area === area);
    if (!areaPhotos.length) return;
    
    const index = state.analysis.currentPhotoIndex ?? 0;
    const currentPhoto = areaPhotos[index];
    if (!currentPhoto) return;
    
    // Convert coordinates
    const startCoords = screenToImageCoords(drawStartX, drawStartY);
    const endCoords = screenToImageCoords(event.clientX, event.clientY);
    
    if (!startCoords || !endCoords) {
        console.log('Failed to convert coordinates', { startCoords, endCoords });
        return;
    }
    
    // Calculate bounding box
    const left = Math.min(startCoords.x, endCoords.x);
    const top = Math.min(startCoords.y, endCoords.y);
    const right = Math.max(startCoords.x, endCoords.x);
    const bottom = Math.max(startCoords.y, endCoords.y);
    
    const width = right - left;
    const height = bottom - top;
    
    // Minimum size check
    if (width < 10 || height < 10) {
        console.log('Box too small', { width, height });
        return;
    }
    
    const centerX = left + width / 2;
    const centerY = top + height / 2;
    
    // Show dialog for defect type
    const defectType = await showDefectTypeDialog();
    if (!defectType || defectType.trim() === '') {
        return;
    }
    
    // Create manual detection
    const detection = {
        photoId: currentPhoto.id,
        photoNumber: currentPhoto.number,
        area: currentPhoto.area,
        class: defectType.trim(),
        bbox: {
            centerX,
            centerY,
            width,
            height,
            imageWidth: resultImage.naturalWidth,
            imageHeight: resultImage.naturalHeight
        }
    };
    
    addManualDetection(detection);
    render();
    event.preventDefault();
    event.stopPropagation();
};

// Show dialog for defect type input
const showDefectTypeDialog = () => {
    return new Promise((resolve) => {
        // Create dialog overlay
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.right = '0';
        overlay.style.bottom = '0';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '10000';
        
        // Create dialog box
        const dialog = document.createElement('div');
        dialog.style.backgroundColor = 'white';
        dialog.style.padding = '24px';
        dialog.style.borderRadius = '8px';
        dialog.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.3)';
        dialog.style.minWidth = '320px';
        dialog.style.maxWidth = '90vw';
        
        // Title
        const title = document.createElement('h3');
        title.textContent = 'Manual Detection';
        title.style.margin = '0 0 16px 0';
        title.style.fontSize = '18px';
        title.style.fontWeight = '600';
        dialog.appendChild(title);
        
        // Instructions
        const instructions = document.createElement('p');
        instructions.textContent = 'Enter the defect type for this detection:';
        instructions.style.margin = '0 0 12px 0';
        instructions.style.color = '#666';
        instructions.style.fontSize = '14px';
        dialog.appendChild(instructions);
        
        // Common defect types
        const commonTypes = ['Scratch', 'Dent', 'Crack', 'Corrosion', 'Paint Damage', 'Other'];
        const typeButtons = document.createElement('div');
        typeButtons.style.display = 'flex';
        typeButtons.style.flexWrap = 'wrap';
        typeButtons.style.gap = '8px';
        typeButtons.style.marginBottom = '16px';
        
        commonTypes.forEach(type => {
            const btn = document.createElement('button');
            btn.textContent = type;
            btn.className = 'secondary';
            btn.style.padding = '8px 16px';
            btn.style.fontSize = '14px';
            btn.addEventListener('click', () => {
                overlay.remove();
                resolve(type);
            });
            typeButtons.appendChild(btn);
        });
        dialog.appendChild(typeButtons);
        
        // Input field
        const inputWrapper = document.createElement('div');
        inputWrapper.style.marginBottom = '16px';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Enter defect type';
        input.style.width = '100%';
        input.style.padding = '10px';
        input.style.border = '1px solid #ddd';
        input.style.borderRadius = '4px';
        input.style.fontSize = '14px';
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (input.value.trim()) {
                    overlay.remove();
                    resolve(input.value.trim());
                }
            } else if (e.key === 'Escape') {
                overlay.remove();
                resolve('');
            }
        });
        input.focus();
        inputWrapper.appendChild(input);
        dialog.appendChild(inputWrapper);
        
        // Buttons
        const buttons = document.createElement('div');
        buttons.style.display = 'flex';
        buttons.style.gap = '8px';
        buttons.style.justifyContent = 'flex-end';
        
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.className = 'ghost';
        cancelBtn.addEventListener('click', () => {
            overlay.remove();
            resolve('');
        });
        buttons.appendChild(cancelBtn);
        
        const confirmBtn = document.createElement('button');
        confirmBtn.textContent = 'Add Detection';
        confirmBtn.className = 'primary';
        confirmBtn.addEventListener('click', () => {
            const value = input.value.trim();
            overlay.remove();
            resolve(value);
        });
        buttons.appendChild(confirmBtn);
        
        dialog.appendChild(buttons);
        overlay.appendChild(dialog);
        
        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve('');
            }
        });
        
        document.body.appendChild(overlay);
    });
};

// Resize handler for updating bounding boxes when window is resized
let resizeTimeout;
const handleWindowResize = () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        const state = readState();
        const area = state.analysis.currentArea || AREAS[0];
        const areaPhotos = state.photos.filter((photo) => photo.area === area);
        if (areaPhotos.length) {
            const index = state.analysis.currentPhotoIndex ?? 0;
            const currentPhoto = areaPhotos[index];
            if (currentPhoto && resultImage.complete && resultImage.naturalWidth && resultImage.naturalHeight) {
                renderOverlay(state, currentPhoto);
            }
        }
    }, 100);
};

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
    if (statusTitle) statusTitle.textContent = title;
    if (statusSubtitle) statusSubtitle.textContent = subtitle;
    if (resultMeta) {
        // Format as "CONFIDENCE > X%" for the filter pill
        if (meta && meta.includes('Confidence')) {
            const thresholdMatch = meta.match(/(\d+)%/);
            if (thresholdMatch) {
                resultMeta.textContent = `CONFIDENCE > ${thresholdMatch[1]}%`;
            } else {
                resultMeta.textContent = meta;
            }
        } else {
            resultMeta.textContent = meta || '--';
        }
    }
};

const runAnalysis = async () => {
    const state = readState();
    const photos = taggedPhotos(state);
    toggleLoading(true);
    updateStatus('Running analysis…', 'Roboflow is processing uploaded imagery.', `${photos.length} photo(s)`);
    setAnalysisStatus('running');

    thumbnailCache.clear();
    const aggregated = [];

    try {
        for (const photo of photos) {
            const file = dataURLToFile(photo.dataURL, photo.name);
            const formData = new FormData();
            formData.append('area', toInspectionAreaSlug(photo.area));
            formData.append('confidence', '1');
            formData.append('image', file, photo.name);

            // Use overlap=60 to have Roboflow suppress duplicate detections server-side
            const response = await fetch('/api/analyze?overlap=60', {
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
                const numericConfidence =
                    typeof prediction.confidence === 'number'
                        ? prediction.confidence
                        : typeof prediction.confidence_percent === 'number'
                        ? prediction.confidence_percent / 100
                        : null;

                const centerX = prediction.x_center ?? prediction.x ?? null;
                const centerY = prediction.y_center ?? prediction.y ?? null;

                aggregated.push({
                    id: `${photo.id}-${index}`,
                    photoId: photo.id,
                    photoNumber: photo.number,
                    area: photo.area,
                    class: prediction.class || 'Defect',
                    confidence: numericConfidence,
                    bbox: {
                        x: prediction.x ?? prediction.x_center ?? null,
                        y: prediction.y ?? prediction.y_center ?? null,
                        width: prediction.width ?? prediction.w ?? null,
                        height: prediction.height ?? prediction.h ?? null,
                        centerX,
                        centerY,
                        imageWidth,
                        imageHeight
                    },
                    falsePositive: false
                });
            });
        }

        // Run NMS per photo so counts per image stay correct (don't merge boxes across images)
        const byPhoto = new Map();
        for (const det of aggregated) {
            const id = det.photoId;
            if (!byPhoto.has(id)) byPhoto.set(id, []);
            byPhoto.get(id).push(det);
        }
        const deduped = [];
        byPhoto.forEach((dets) => deduped.push(...applyNms(dets, 0.5)));

        // Record detections without changing the current threshold (preserve user's slider setting)
        recordDetections({
            detections: deduped
            // Don't pass threshold - let recordDetections preserve the current threshold
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
    const counts = summarizeDetectionsByArea(state, { threshold: state.analysis.threshold });
    const activeArea = state.analysis.currentArea || AREAS[0];
    areaTabs.innerHTML = '';
    AREAS.forEach((area) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `tab${area === activeArea ? ' active' : ''}`;
        tab.innerHTML = `<span>${area}</span><span class="tab-count">${counts[area] || 0}</span>`;
        
        // Apply same styling as step 4: white background with #858585 border when unselected, dark green when selected
        if (area === activeArea) {
            tab.style.backgroundColor = '#2d5016';
            tab.style.borderColor = '#2d5016';
            tab.style.color = '#ffffff';
            tab.style.boxShadow = '0 8px 20px rgba(45, 80, 22, 0.3)';
        } else {
            tab.style.backgroundColor = '#ffffff';
            tab.style.borderColor = '#858585';
            tab.style.color = '#10121a';
            tab.style.boxShadow = 'none';
        }
        
        tab.addEventListener('click', () => {
            setCurrentAreaView(area);
            setCurrentPhotoIndex(0);
            render();
        });
        areaTabs.appendChild(tab);
    });
};

const filterDetections = (state, area, options = {}) => {
    const { photoId, includeFalsePositives = false } = options;
    const threshold = state.analysis.threshold;
    return state.detections.filter((detection) => {
        if (detection.area !== area) return false;
        if (photoId !== undefined && detection.photoId !== photoId) return false;
        if (!includeFalsePositives && detection.falsePositive) return false;
        // Manual detections are always included (they bypass threshold)
        if (detection.manual) return true;
        // For confidence-based filtering: only include detections with valid confidence >= threshold
        if (typeof detection.confidence === 'number') {
            // Show detections with confidence >= threshold (Roboflow-style)
            return detection.confidence >= threshold;
        }
        // Exclude detections without valid confidence values when filtering by threshold
        return false;
    });
};

const renderOverlay = (state, photo) => {
    overlayLayer.innerHTML = '';
    if (!photo || !resultImage.complete) return;

    // Hide false positives on the main image overlay
    const detections = filterDetections(state, photo.area, { photoId: photo.id, includeFalsePositives: false });
    if (!detections.length) return;

    // Get the container (viewer-stage) dimensions
    const container = overlayLayer.parentElement;
    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;

    // Get the actual displayed image element dimensions and position from DOM
    const imageRect = resultImage.getBoundingClientRect();
    const displayedImageWidth = imageRect.width;
    const displayedImageHeight = imageRect.height;

    // Calculate image offset relative to container (accounting for container's viewport position)
    // Since overlay is positioned absolutely within container, we need container-relative coordinates
    const imageOffsetX = imageRect.left - containerRect.left;
    const imageOffsetY = imageRect.top - containerRect.top;

    // Get the natural/original image dimensions
    const imageNaturalWidth = resultImage.naturalWidth;
    const imageNaturalHeight = resultImage.naturalHeight;

    if (!imageNaturalWidth || !imageNaturalHeight || !displayedImageWidth || !displayedImageHeight) {
        console.warn('Image dimensions not available', {
            natural: { width: imageNaturalWidth, height: imageNaturalHeight },
            displayed: { width: displayedImageWidth, height: displayedImageHeight }
        });
        return;
    }

    detections.forEach((detection) => {
        const { bbox } = detection;
        if (
            !bbox ||
            bbox.width == null ||
            bbox.height == null
        ) {
            return;
        }

        // Get the source image dimensions from API response
        // Roboflow API returns image dimensions in the response
        // If not available, use natural image dimensions as fallback
        const sourceImageWidth = bbox.imageWidth || imageNaturalWidth;
        const sourceImageHeight = bbox.imageHeight || imageNaturalHeight;

        // Roboflow API returns center-based coordinates (x_center, y_center, width, height)
        // Coordinates are in pixels relative to sourceImageWidth × sourceImageHeight
        const centerX = bbox.centerX !== undefined ? bbox.centerX : (bbox.x !== undefined ? bbox.x : null);
        const centerY = bbox.centerY !== undefined ? bbox.centerY : (bbox.y !== undefined ? bbox.y : null);

        if (centerX == null || centerY == null) {
            console.warn('Missing center coordinates for detection', detection.id);
            return;
        }

        // Calculate scale factors from API image dimensions to displayed image dimensions
        // API coordinates are relative to sourceImageWidth × sourceImageHeight
        // Displayed image has dimensions displayedImageWidth × displayedImageHeight (from DOM, already accounts for object-fit: contain)
        const scaleX = displayedImageWidth / sourceImageWidth;
        const scaleY = displayedImageHeight / sourceImageHeight;

        // Scale coordinates from API dimensions to displayed dimensions
        const scaledCenterX = centerX * scaleX;
        const scaledCenterY = centerY * scaleY;
        const expandFactor = 1.25; // enlarge boxes to fully cover defects
        const scaledWidth = bbox.width * scaleX * expandFactor;
        const scaledHeight = bbox.height * scaleY * expandFactor;

        // Convert center-based coordinates to top-left coordinates
        // Add image offset to account for image position within the container
        const left = imageOffsetX + scaledCenterX - (scaledWidth / 2);
        const top = imageOffsetY + scaledCenterY - (scaledHeight / 2);

        const box = document.createElement('div');
        box.className = 'overlay-box';
        const isHighlighted = activeHighlight === detection.id;
        
        // Manual detections use grey color, AI detections use class-based colors
        // All detections turn yellow when highlighted
        if (isHighlighted) {
            // All highlighted detections use yellow
            box.classList.add('highlight');
            box.style.borderWidth = '4px';
            box.style.borderColor = '#ffd54f';
            box.style.backgroundColor = 'rgba(255, 213, 79, 0.3)';
            box.style.boxShadow = '0 0 0 2px rgba(255, 213, 79, 0.4)';
        } else if (detection.manual) {
            // Manual detections: grey when not highlighted
            box.style.borderWidth = '3px';
            box.style.borderColor = '#9ca3af'; // Grey border
            box.style.backgroundColor = 'rgba(156, 163, 175, 0.2)'; // Light grey background
        } else {
            // AI detections use class-based colors when not highlighted
            const classColor = getColorForClass(detection.class);
            box.style.borderWidth = '3px';
            box.style.borderColor = classColor.border;
            box.style.backgroundColor = classColor.bg;
        }
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${scaledWidth}px`;
        box.style.height = `${scaledHeight}px`;
        box.dataset.predictionId = detection.id;
        box.style.pointerEvents = 'all';
        box.style.cursor = 'pointer';
        
        // Make detection boxes clickable to highlight corresponding thumbnail
        box.addEventListener('click', (e) => {
            // Don't trigger if clicking on resize handle
            if (e.target.closest('.resize-handle')) {
                return;
            }
            activeHighlight = detection.id;
            render();
            // Scroll the highlighted card into view
            requestAnimationFrame(() => {
                const highlightedCard = detectionList.querySelector(`[data-prediction-id="${detection.id}"]`);
                if (highlightedCard) {
                    highlightedCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
        });
        
        // Add resize handles for manual detections (shown on hover)
        if (detection.manual) {
            box.classList.add('manual-detection');
            box.style.pointerEvents = 'all'; // Allow interaction with manual detection boxes
            
            // Create resize handles container (hidden by default, shown on hover)
            const handlesContainer = document.createElement('div');
            handlesContainer.className = 'resize-handles-container';
            handlesContainer.style.position = 'absolute';
            handlesContainer.style.top = '0';
            handlesContainer.style.left = '0';
            handlesContainer.style.width = '100%';
            handlesContainer.style.height = '100%';
            handlesContainer.style.pointerEvents = 'none';
            handlesContainer.style.opacity = '0';
            handlesContainer.style.transition = 'opacity 0.2s ease';
            
            // Create resize handles (corners and edges)
            const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
            handles.forEach(handle => {
                const handleEl = document.createElement('div');
                handleEl.className = 'resize-handle';
                handleEl.dataset.handle = handle;
                handleEl.style.position = 'absolute';
                handleEl.style.width = '8px';
                handleEl.style.height = '8px';
                // Use grey for resize handles on manual detections (matches grey box color)
                handleEl.style.backgroundColor = isHighlighted ? '#ffd54f' : '#9ca3af';
                handleEl.style.border = '1px solid #ffffff';
                handleEl.style.borderRadius = '2px';
                handleEl.style.cursor = getResizeCursor(handle);
                handleEl.style.zIndex = '100';
                handleEl.style.pointerEvents = 'all';
                
                // Position handles
                if (handle === 'nw') {
                    handleEl.style.top = '-4px';
                    handleEl.style.left = '-4px';
                } else if (handle === 'n') {
                    handleEl.style.top = '-4px';
                    handleEl.style.left = '50%';
                    handleEl.style.transform = 'translateX(-50%)';
                } else if (handle === 'ne') {
                    handleEl.style.top = '-4px';
                    handleEl.style.right = '-4px';
                } else if (handle === 'e') {
                    handleEl.style.top = '50%';
                    handleEl.style.right = '-4px';
                    handleEl.style.transform = 'translateY(-50%)';
                } else if (handle === 'se') {
                    handleEl.style.bottom = '-4px';
                    handleEl.style.right = '-4px';
                } else if (handle === 's') {
                    handleEl.style.bottom = '-4px';
                    handleEl.style.left = '50%';
                    handleEl.style.transform = 'translateX(-50%)';
                } else if (handle === 'sw') {
                    handleEl.style.bottom = '-4px';
                    handleEl.style.left = '-4px';
                } else if (handle === 'w') {
                    handleEl.style.top = '50%';
                    handleEl.style.left = '-4px';
                    handleEl.style.transform = 'translateY(-50%)';
                }
                
                handlesContainer.appendChild(handleEl);
            });
            
            // Show handles on hover and update handle colors based on highlight state
            const updateHandleColors = () => {
                const isHighlightedNow = activeHighlight === detection.id;
                handlesContainer.querySelectorAll('.resize-handle').forEach(handle => {
                    handle.style.backgroundColor = isHighlightedNow ? '#ffd54f' : '#9ca3af';
                });
            };
            
            box.addEventListener('mouseenter', () => {
                handlesContainer.style.opacity = '1';
                handlesContainer.style.pointerEvents = 'all';
                updateHandleColors();
            });
            
            box.addEventListener('mouseleave', () => {
                if (!isResizing) {
                    handlesContainer.style.opacity = '0';
                    handlesContainer.style.pointerEvents = 'none';
                }
            });
            
            // Update handle colors when highlight changes
            updateHandleColors();
            
            box.appendChild(handlesContainer);
        }

        const label = document.createElement('div');
        label.className = 'label';
        // All highlighted detections use yellow label, otherwise use detection-specific colors
        if (isHighlighted) {
            label.style.backgroundColor = '#ffd54f';
        } else if (detection.manual) {
            label.style.backgroundColor = '#9ca3af'; // Grey for manual detections
        } else {
            const classColor = getColorForClass(detection.class);
            label.style.backgroundColor = classColor.label;
        }
        const confidence = detection.manual ? 'Manual' : (typeof detection.confidence === 'number' ? `${Math.round(detection.confidence * 100)}%` : '—');
        label.textContent = `${detection.class} · ${confidence}`;

        box.appendChild(label);
        overlayLayer.appendChild(box);
    });
};

const renderDetectionList = (state, area, photo) => {
    detectionList.innerHTML = '';
    // Filter detections by area and current photo (if photo is provided)
    const filterOptions = { includeFalsePositives: true };
    if (photo) {
        filterOptions.photoId = photo.id;
    }
    const relevantDetections = filterDetections(state, area, filterOptions);
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

        // Add highlight class if this detection is currently highlighted
        if (activeHighlight === detection.id && !detection.falsePositive) {
            card.classList.add('highlighted');
        }

        if (detection.falsePositive) {
            card.dataset.muted = 'true';
            card.classList.add('false-positive');
        }

        const thumbWrapper = document.createElement('div');
        thumbWrapper.className = 'detection-thumb';
        // Thumbnails are fixed at 80px × 80px via CSS - no need to set inline styles

        const detectionPhoto = state.photos.find((p) => p.id === detection.photoId);
        if (detectionPhoto?.dataURL) {
            const thumbImg = document.createElement('img');
            thumbImg.alt = `${detection.class || 'Defect'} thumbnail`;
            thumbImg.loading = 'lazy';
            thumbWrapper.appendChild(thumbImg);

            const cacheKey = detection.id;
            const cached = thumbnailCache.get(cacheKey);
            if (cached) {
                thumbImg.src = cached.src;
            } else {
                createCroppedThumbnail(detectionPhoto.dataURL, detection.bbox)
                    .then((result) => {
                        thumbnailCache.set(cacheKey, result);
                        thumbImg.src = result.src;
                    })
                    .catch(() => {
                        thumbImg.src = detectionPhoto.dataURL;
                    });
            }
        } else {
            const placeholder = document.createElement('div');
            placeholder.className = 'thumb-placeholder';
            placeholder.textContent = 'No preview';
            thumbWrapper.appendChild(placeholder);
        }

        card.appendChild(thumbWrapper);

        const body = document.createElement('div');
        body.className = 'detection-body';

        const title = document.createElement('header');
        let confidenceLabel;
        if (detection.manual) {
            confidenceLabel = 'Manual';
        } else {
            const confidenceValue =
                typeof detection.confidence === 'number' ? Math.round(detection.confidence * 100) : null;
            confidenceLabel = confidenceValue != null ? `${confidenceValue}%` : 'Confidence n/a';
        }
        title.innerHTML = `<span>${detection.class}</span><span>${confidenceLabel}</span>`;
        body.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'detection-meta';

        const photoSpan = document.createElement('span');
        photoSpan.textContent = `Photo #${detection.photoNumber}`;

        const areaSpan = document.createElement('span');
        areaSpan.textContent = detection.area;

        if (!detection.manual) {
            const thresholdSpan = document.createElement('span');
            thresholdSpan.textContent = `Threshold ≥${threshold}%`;
            meta.append(photoSpan, areaSpan, thresholdSpan);
        } else {
            meta.append(photoSpan, areaSpan);
        }

        const coordsText = (() => {
            const box = detection.bbox || {};
            if (box.centerX != null && box.centerY != null) {
                return `Center: (${Math.round(box.centerX)}, ${Math.round(box.centerY)})`;
            }
            if (box.x != null && box.y != null) {
                return `Position: (${Math.round(box.x)}, ${Math.round(box.y)})`;
            }
            return '';
        })();

        if (coordsText) {
            const coordsSpan = document.createElement('span');
            coordsSpan.textContent = coordsText;
            meta.appendChild(coordsSpan);
        }

        if (detection.falsePositive) {
            const flag = document.createElement('span');
            flag.className = 'meta-flag';
            flag.textContent = 'False positive';
            meta.appendChild(flag);
        }

        body.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'detection-actions';
        
        // For manual detections, show delete button instead of false positive toggle
        if (detection.manual) {
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'ghost toggle-icon';
            deleteBtn.setAttribute('aria-label', 'Delete manual detection');
            deleteBtn.textContent = '×';
            deleteBtn.style.color = 'var(--danger)';
            deleteBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                if (activeHighlight === detection.id) {
                    activeHighlight = null;
                }
                if (confirm('Delete this manual detection?')) {
                    removeDetection(detection.id);
                    render();
                }
            });
            actions.appendChild(deleteBtn);
        } else {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'ghost toggle-icon';
            toggle.setAttribute('aria-label', detection.falsePositive ? 'Restore detection' : 'Mark false positive');
            // Use icon-style glyphs to match previous UI
            toggle.textContent = detection.falsePositive ? '↻' : '×';
            toggle.addEventListener('click', (event) => {
                event.stopPropagation();
                if (!detection.falsePositive && activeHighlight === detection.id) {
                    activeHighlight = null;
                }
                toggleFalsePositive(detection.id);
                render();
            });
            actions.appendChild(toggle);
        }

        body.appendChild(actions);
        card.appendChild(body);
        card.addEventListener('click', () => {
            if (detection.falsePositive) return;
            activeHighlight = detection.id;
            render();
            // Scroll the highlighted card into view after render completes
            requestAnimationFrame(() => {
                const highlightedCard = detectionList.querySelector(`[data-prediction-id="${detection.id}"]`);
                if (highlightedCard) {
                    highlightedCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
        });

        detectionList.appendChild(card);
    });

    if (photo) {
        const highlightExists = relevantDetections.some((det) => det.id === activeHighlight && !det.falsePositive);
        if (!highlightExists && relevantDetections.length > 0) {
            const firstActive = relevantDetections.find((det) => !det.falsePositive);
            activeHighlight = firstActive?.id ?? relevantDetections[0]?.id ?? null;
            // Re-render overlay if highlight changed
            if (activeHighlight !== null) {
                renderOverlay(state, photo);
            }
        } else if (relevantDetections.length === 0) {
            activeHighlight = null;
        }
    }
};

// Update cursor based on what's being hovered
const updateCursor = (event) => {
    const viewerStage = getViewerStage();
    if (!viewerStage) return;
    
    // Check if hovering over a resize handle
    if (event.target.closest('.resize-handle')) {
        viewerStage.style.cursor = getResizeCursor(event.target.closest('.resize-handle').dataset.handle);
        return;
    }
    
    // Check if hovering over a manual detection box
    if (event.target.closest('.manual-detection')) {
        viewerStage.style.cursor = 'move';
        return;
    }
    
    // Default: crosshair for drawing
    viewerStage.style.cursor = 'crosshair';
};

const renderViewer = () => {
    const state = readState();
    const area = state.analysis.currentArea || AREAS[0];
    const areaPhotos = state.photos.filter((photo) => photo.area === area);

    if (!areaPhotos.length) {
        resultImage.removeAttribute('src');
        resultImage.style.display = 'none';
        if (noImageMessage) {
            noImageMessage.classList.remove('hidden');
        }
        viewerMeta.textContent = 'No photos tagged for this area';
        viewerSummary.textContent = '';
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        overlayLayer.innerHTML = '';
        renderDetectionList(state, area);
        return;
    }
    
    // Show image and hide message when photos exist
    resultImage.style.display = 'block';
    if (noImageMessage) {
        noImageMessage.classList.add('hidden');
    }
    
    // Set default crosshair cursor for drawing
    const viewerStage = getViewerStage();
    if (viewerStage) {
        viewerStage.style.cursor = 'crosshair';
    }

    let index = state.analysis.currentPhotoIndex ?? 0;
    if (index < 0) index = 0;
    if (index > areaPhotos.length - 1) index = areaPhotos.length - 1;
    setCurrentPhotoIndex(index);
    const currentPhoto = areaPhotos[index];

    viewerMeta.textContent = `Photo ${index + 1} of ${areaPhotos.length} · #${currentPhoto.number}`;
    const detectionsForPhoto = filterDetections(state, area, { photoId: currentPhoto.id });
    const summary = detectionsForPhoto.length
        ? `${detectionsForPhoto.length} detection${detectionsForPhoto.length === 1 ? '' : 's'}`
        : 'No detections';
    viewerSummary.textContent = summary;
    
    // Update flag button state
    if (flagBtn && flagBtnText) {
        const isFlagged = currentPhoto.flagged || false;
        flagBtn.classList.toggle('flagged', isFlagged);
        flagBtnText.textContent = isFlagged ? 'Flagged' : 'Flag Image';
    }

    // Set up image load handler
    const handleImageLoad = () => {
        // Wait for layout to be ready before rendering overlay
        requestAnimationFrame(() => {
            renderOverlay(state, currentPhoto);
        });
    };

    resultImage.onload = handleImageLoad;
    resultImage.src = currentPhoto.dataURL;
    
    // If image is already loaded, render overlay immediately
    if (resultImage.complete && resultImage.naturalWidth && resultImage.naturalHeight) {
        handleImageLoad();
    }

    // Ensure resize handler is set up (only once)
    if (!window.__resultsResizeHandlerAttached) {
        window.addEventListener('resize', handleWindowResize);
        window.__resultsResizeHandlerAttached = true;
    }
    
    // Drawing handlers should already be attached, but ensure they are
    if (!window.__resultsDrawingHandlersAttached) {
        const viewerStage = getViewerStage();
        if (viewerStage) {
            viewerStage.addEventListener('mousedown', handleMouseDown);
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            window.__resultsDrawingHandlersAttached = true;
        }
    }

    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === areaPhotos.length - 1;

    renderDetectionList(state, area, currentPhoto);
};

const renderThreshold = () => {
    const state = readState();
    // Convert threshold from decimal (0-1) to percentage (0-100)
    const thresholdPct = Math.round(state.analysis.threshold * 100);
    // Ensure threshold is between 0 and 100
    const clampedPct = Math.max(0, Math.min(100, thresholdPct));
    if (thresholdSlider) {
        thresholdSlider.value = String(clampedPct);
    }
    if (thresholdValue) {
        thresholdValue.textContent = `${clampedPct}%`;
    }
};

const render = () => {
    const state = readState();
    renderTabs(state);
    renderThreshold();
    renderViewer();

    const totalDetections = state.detections.filter((det) => !det.falsePositive).length;
    const totalPhotos = taggedPhotos(state).length;
    const thresholdPct = Math.max(0, Math.min(100, Math.round(state.analysis.threshold * 100)));
    updateStatus(
        'Analysis complete',
        `${totalDetections} detection${totalDetections === 1 ? '' : 's'} across ${totalPhotos} tagged photo${totalPhotos === 1 ? '' : 's'}.`,
        `Confidence ≥ ${thresholdPct}%`
    );
};

thresholdSlider?.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    // Ensure value is between 0 and 100, then convert to decimal (0-1 range)
    const clampedValue = Math.max(0, Math.min(100, value));
    const normalized = clampedValue / 100;
    
    // Update threshold in state
    setAnalysisThreshold(normalized);
    
    // Update display immediately for responsive feedback
    if (thresholdValue) {
        thresholdValue.textContent = `${clampedValue}%`;
    }
    
    // Re-render to apply the new threshold filter
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

startOverBtn?.addEventListener('click', () => {
    resetState();
    window.location.href = 'index.html';
});

saveDraftBtn?.addEventListener('click', () => {
    alert('Draft saved locally. Submit or export from the Report step to finalize.');
});

// Add Manual Detection button - provides quick access
addManualBtn?.addEventListener('click', () => {
    // Drawing is always enabled, button just provides visual feedback
    const viewerStage = getViewerStage();
    if (viewerStage) {
        viewerStage.focus();
    }
});

// Flag button handler
flagBtn?.addEventListener('click', () => {
    const state = readState();
    const area = state.analysis.currentArea || AREAS[0];
    const areaPhotos = state.photos.filter((photo) => photo.area === area);
    const index = state.analysis.currentPhotoIndex ?? 0;
    const currentPhoto = areaPhotos[index];
    if (currentPhoto) {
        togglePhotoFlagged(currentPhoto.id);
        render();
    }
});

// Attach drawing handlers as soon as DOM is ready
const attachDrawingHandlers = () => {
    if (window.__resultsDrawingHandlersAttached) return;
    
    const viewerStage = getViewerStage();
    if (viewerStage) {
        viewerStage.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
        window.__resultsDrawingHandlersAttached = true;
        console.log('Drawing handlers attached');
    } else {
        // Retry if viewer-stage doesn't exist yet
        setTimeout(attachDrawingHandlers, 100);
    }
};

// Try to attach handlers immediately, and also when DOMContentLoaded fires
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachDrawingHandlers);
} else {
    attachDrawingHandlers();
}

const initialState = ensureTaggingComplete();

// Set default crosshair cursor for drawing (always enabled)
const viewerStage = getViewerStage();
if (viewerStage) {
    viewerStage.style.cursor = 'crosshair';
    
    // Update cursor on mouse move to show appropriate cursor
    viewerStage.addEventListener('mousemove', updateCursor);
}

if (initialState) {
    if (initialState.analysis.status === 'complete' && initialState.detections.length) {
        toggleLoading(false);
        render();
    } else {
        runAnalysis();
    }
}

