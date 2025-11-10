const STORAGE_KEY = 'specscan_flow_state';

const DEFAULT_STATE = {
    start: null,
    photos: [],
    detections: [],
    falsePositives: [],
    areaView: null,
    reportOptions: {
        exportFormat: 'PDF',
        includeFalsePositives: true,
        includeAllPhotos: true
    },
    counters: {
        photo: 1
    }
};

export function loadState() {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return structuredClone(DEFAULT_STATE);
        }
        const parsed = JSON.parse(raw);
        return {
            ...structuredClone(DEFAULT_STATE),
            ...parsed,
            reportOptions: {
                ...DEFAULT_STATE.reportOptions,
                ...(parsed.reportOptions || {})
            },
            counters: {
                ...DEFAULT_STATE.counters,
                ...(parsed.counters || {})
            }
        };
    } catch (error) {
        console.warn('Unable to load state; resetting.', error);
        sessionStorage.removeItem(STORAGE_KEY);
        return structuredClone(DEFAULT_STATE);
    }
}

export function saveState(nextState) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    return nextState;
}

export function resetState() {
    sessionStorage.removeItem(STORAGE_KEY);
    return structuredClone(DEFAULT_STATE);
}

export function setStartDetails(payload) {
    const state = loadState();
    state.start = {
        tailNumber: payload.tailNumber.trim(),
        inspectionType: payload.inspectionType,
        inspectorName: payload.inspectorName.trim(),
        timestamp: payload.timestamp,
        notes: payload.notes?.trim() || ''
    };
    state.photos = [];
    state.detections = [];
    state.falsePositives = [];
    state.areaView = null;
    state.counters.photo = 1;
    return saveState(state);
}

export function addPhoto(photo) {
    const state = loadState();
    const id = generateId();
    const number = state.counters.photo;
    state.counters.photo += 1;
    state.photos.push({
        id,
        number,
        name: photo.name || `Photo ${number}`,
        capturedAt: photo.capturedAt ?? new Date().toISOString(),
        area: photo.area ?? null,
        status: photo.status ?? 'new',
        dataURL: photo.dataURL ?? null
    });
    return saveState(state);
}

function generateId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'id-' + Math.random().toString(36).slice(2, 10);
}

export function removePhoto(photoId) {
    const state = loadState();
    state.photos = state.photos.filter(photo => photo.id !== photoId);
    return saveState(state);
}

export function updatePhotoArea(photoIds, area) {
    const state = loadState();
    state.photos = state.photos.map(photo => {
        if (photoIds.includes(photo.id)) {
            return { ...photo, area };
        }
        return photo;
    });
    return saveState(state);
}

export function setDetections(detections, areaView = null) {
    const state = loadState();
    state.detections = detections;
    state.falsePositives = state.falsePositives.filter(id =>
        detections.some(detection => detection.id === id)
    );
    state.areaView = areaView;
    return saveState(state);
}

export function toggleFalsePositive(id) {
    const state = loadState();
    if (state.falsePositives.includes(id)) {
        state.falsePositives = state.falsePositives.filter(existing => existing !== id);
    } else {
        state.falsePositives.push(id);
    }
    return saveState(state);
}

export function updateReportOptions(options) {
    const state = loadState();
    state.reportOptions = {
        ...state.reportOptions,
        ...options
    };
    return saveState(state);
}

