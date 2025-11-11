import {
    AREAS,
    dataURLToFile,
    readState,
    recordDetections,
    resetState,
    setAnalysisStatus,
    setAnalysisThreshold,
    setCurrentAreaView,
    setCurrentPhotoIndex,
    summarizeDetectionsByArea,
    toggleFalsePositive,
    toInspectionAreaSlug
} from './state.js';

const THUMBNAIL_HEIGHT = 140;

const clampNumber = (value, min, max) => {
    if (Number.isNaN(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
};

const thumbnailCache = new Map();

const createCroppedThumbnail = (dataURL, bbox) =>
    new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const imageWidth = image.naturalWidth || image.width;
            const imageHeight = image.naturalHeight || image.height;
            const width = bbox?.width ?? bbox?.w ?? null;
            const height = bbox?.height ?? bbox?.h ?? null;
            const centerX = bbox?.centerX ?? bbox?.x ?? null;
            const centerY = bbox?.centerY ?? bbox?.y ?? null;

            if (!width || !height || !centerX || !centerY || !imageWidth || !imageHeight) {
                resolve({ src: dataURL, width: THUMBNAIL_HEIGHT });
                return;
            }

            const cropWidth = Math.max(width, imageWidth * 0.08);
            const cropHeight = Math.max(height, imageHeight * 0.08);
            const cropLeft = clampNumber(centerX - cropWidth / 2, 0, imageWidth - cropWidth);
            const cropTop = clampNumber(centerY - cropHeight / 2, 0, imageHeight - cropHeight);

            const scale = THUMBNAIL_HEIGHT / cropHeight;
            const targetHeight = THUMBNAIL_HEIGHT;
            const targetWidth = clampNumber(Math.round(cropWidth * scale), targetHeight * 0.6, targetHeight * 2.2);

            const canvas = document.createElement('canvas');
            canvas.width = Math.round(targetWidth);
            canvas.height = Math.round(targetHeight);
            const ctx = canvas.getContext('2d', { alpha: true });
            if (!ctx) {
                resolve({ src: dataURL, width: targetHeight });
                return;
            }
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(
                image,
                cropLeft,
                cropTop,
                cropWidth,
                cropHeight,
                0,
                0,
                canvas.width,
                canvas.height
            );
            resolve({ src: canvas.toDataURL('image/png'), width: canvas.width });
        };
        image.onerror = reject;
        image.src = dataURL;
    });

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
const prevBtn = document.getElementById('prevBtn');
const nextBtn = document.getElementById('nextBtn');
const reorganizeBtn = document.getElementById('reorganizeBtn');
const reportBtn = document.getElementById('reportBtn');
const startOverBtn = document.getElementById('startOverBtn');
const saveDraftBtn = document.getElementById('saveDraftBtn');

let activeHighlight = null;

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
    statusTitle.textContent = title;
    statusSubtitle.textContent = subtitle;
    resultMeta.textContent = meta;
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

            const response = await fetch('/api/analyze', {
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

        recordDetections({
            detections: aggregated,
            threshold: 0.5
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
    const counts = summarizeDetectionsByArea(state);
    const activeArea = state.analysis.currentArea || AREAS[0];
    areaTabs.innerHTML = '';
    AREAS.forEach((area) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `tab${area === activeArea ? ' active' : ''}`;
        tab.innerHTML = `<span>${area}</span><span class="tab-count">${counts[area] || 0}</span>`;
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
        if (typeof detection.confidence === 'number' && detection.confidence < threshold) return false;
        return true;
    });
};

const renderOverlay = (state, photo) => {
    overlayLayer.innerHTML = '';
    if (!photo || !resultImage.complete) return;

    const detections = filterDetections(state, photo.area, { photoId: photo.id });
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
        const scaledWidth = bbox.width * scaleX;
        const scaledHeight = bbox.height * scaleY;

        // Convert center-based coordinates to top-left coordinates
        // Add image offset to account for image position within the container
        const left = imageOffsetX + scaledCenterX - (scaledWidth / 2);
        const top = imageOffsetY + scaledCenterY - (scaledHeight / 2);

        const box = document.createElement('div');
        box.className = 'overlay-box';
        const isHighlighted = activeHighlight === detection.id;
        if (isHighlighted) {
            box.classList.add('highlight');
            box.style.borderWidth = '4px';
        } else {
            box.style.borderWidth = '3px';
        }
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
        box.style.width = `${scaledWidth}px`;
        box.style.height = `${scaledHeight}px`;
        box.dataset.predictionId = detection.id;

        const label = document.createElement('div');
        label.className = 'label';
        const confidence = typeof detection.confidence === 'number' ? `${Math.round(detection.confidence * 100)}%` : '—';
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
        const confidenceValue =
            typeof detection.confidence === 'number' ? Math.round(detection.confidence * 100) : null;
        const confidenceLabel = confidenceValue != null ? `${confidenceValue}%` : 'Confidence n/a';
        title.innerHTML = `<span>${detection.class}</span><span>${confidenceLabel}</span>`;
        body.appendChild(title);

        const meta = document.createElement('div');
        meta.className = 'detection-meta';

        const photoSpan = document.createElement('span');
        photoSpan.textContent = `Photo #${detection.photoNumber}`;

        const areaSpan = document.createElement('span');
        areaSpan.textContent = detection.area;

        const thresholdSpan = document.createElement('span');
        thresholdSpan.textContent = `Threshold ≥${threshold}%`;

        meta.append(photoSpan, areaSpan, thresholdSpan);

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
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'ghost toggle-icon';
        toggle.setAttribute('aria-label', detection.falsePositive ? 'Restore detection' : 'Mark false positive');
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

const renderViewer = () => {
    const state = readState();
    const area = state.analysis.currentArea || AREAS[0];
    const areaPhotos = state.photos.filter((photo) => photo.area === area);

    if (!areaPhotos.length) {
        resultImage.removeAttribute('src');
        viewerMeta.textContent = 'No photos tagged for this area';
        viewerSummary.textContent = '';
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        overlayLayer.innerHTML = '';
        renderDetectionList(state, area);
        return;
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

    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === areaPhotos.length - 1;

    renderDetectionList(state, area, currentPhoto);
};

const renderThreshold = () => {
    const state = readState();
    const thresholdPct = Math.round(state.analysis.threshold * 100);
    thresholdSlider.value = String(thresholdPct);
    thresholdValue.textContent = `${thresholdPct}%`;
};

const render = () => {
    const state = readState();
    renderTabs(state);
    renderThreshold();
    renderViewer();

    const totalDetections = state.detections.filter((det) => !det.falsePositive).length;
    const totalPhotos = taggedPhotos(state).length;
    updateStatus(
        'Analysis complete',
        `${totalDetections} detection${totalDetections === 1 ? '' : 's'} across ${totalPhotos} tagged photo${totalPhotos === 1 ? '' : 's'}.`,
        `Confidence ≥ ${Math.round(state.analysis.threshold * 100)}%`
    );
};

thresholdSlider?.addEventListener('input', (event) => {
    const value = Number(event.target.value);
    const normalized = Math.max(0, Math.min(100, value)) / 100;
    setAnalysisThreshold(normalized);
    thresholdValue.textContent = `${Math.round(normalized * 100)}%`;
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

startOverBtn?.addEventListener('click', () => {
    resetState();
    window.location.href = 'index.html';
});

saveDraftBtn?.addEventListener('click', () => {
    alert('Draft saved locally. Submit or export from the Report step to finalize.');
});

const initialState = ensureTaggingComplete();

if (initialState) {
    if (initialState.analysis.status === 'complete' && initialState.detections.length) {
        toggleLoading(false);
        render();
    } else {
        runAnalysis();
    }
}

