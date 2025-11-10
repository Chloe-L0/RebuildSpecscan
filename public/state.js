const STORAGE_KEY = 'specscanInspection';

export const AREAS = [
    'Fuselage',
    'Left Wing',
    'Right Wing',
    'Tail',
    'Landing Gear',
    'Engines'
];

const AREA_SLUG_LOOKUP = {
    Fuselage: 'fuselage',
    'Left Wing': 'left-wing',
    'Right Wing': 'right-wing',
    Tail: 'tail',
    'Landing Gear': 'landing-gear',
    Engines: 'engine'
};

export const toInspectionAreaSlug = (area) => {
    if (!area) return '';
    if (AREA_SLUG_LOOKUP[area]) {
        return AREA_SLUG_LOOKUP[area];
    }
    return area
        .toString()
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-');
};

const DEFAULT_STATE = {
    inspection: {
        tailNumber: '',
        inspectionType: 'Inbound',
        inspectorName: '',
        startedAt: null
    },
    photos: [],
    nextPhotoId: 1,
    detections: [],
    analysis: {
        completed: false,
        status: 'idle',
        threshold: 0.5,
        currentArea: null,
        currentPhotoIndex: 0,
        error: null,
        submissionId: null
    },
    report: {
        includeThumbnails: true,
        includeFalsePositives: false,
        includeAllPhotos: true
    }
};

const clone = (value) => {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
};

const hydrate = (raw) => {
    if (!raw) return clone(DEFAULT_STATE);
    const merged = clone(DEFAULT_STATE);
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        Object.assign(merged.inspection, parsed.inspection || {});
        merged.photos = Array.isArray(parsed.photos) ? parsed.photos : [];
        merged.nextPhotoId = parsed.nextPhotoId || 1;
        merged.detections = Array.isArray(parsed.detections) ? parsed.detections : [];
        merged.analysis = { ...merged.analysis, ...(parsed.analysis || {}) };
        merged.report = { ...merged.report, ...(parsed.report || {}) };
    } catch (error) {
        console.warn('Failed to hydrate state, using defaults', error);
    }
    return merged;
};

let state = hydrate(sessionStorage.getItem(STORAGE_KEY));

const persist = () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

export const readState = () => clone(state);

export const replaceState = (nextState) => {
    state = hydrate(nextState);
    persist();
    return readState();
};

export const resetState = () => {
    state = clone(DEFAULT_STATE);
    persist();
    return readState();
};

export const updateState = (mutator) => {
    const draft = readState();
    const result = mutator(draft);
    state = result ? hydrate(result) : draft;
    persist();
    return readState();
};

export const setInspectionDetails = ({ tailNumber, inspectionType, inspectorName, startedAt }) =>
    updateState((draft) => {
        draft.inspection.tailNumber = tailNumber.trim();
        draft.inspection.inspectionType = inspectionType;
        draft.inspection.inspectorName = inspectorName.trim();
        draft.inspection.startedAt = startedAt;
        draft.photos = [];
        draft.nextPhotoId = 1;
        draft.detections = [];
        draft.analysis = { ...DEFAULT_STATE.analysis };
        return draft;
    });

export const addPhotosToState = (photos) =>
    updateState((draft) => {
        photos.forEach((photo) => {
            draft.photos.push({
                id: draft.nextPhotoId,
                number: draft.photos.length + 1,
                name: photo.name,
                dataURL: photo.dataURL,
                area: photo.area ?? null
            });
            draft.nextPhotoId += 1;
        });
        draft.analysis = { ...draft.analysis, completed: false, status: 'idle', error: null };
        return draft;
    });

export const removePhotoFromState = (photoId) =>
    updateState((draft) => {
        draft.photos = draft.photos.filter((photo) => photo.id !== photoId).map((photo, index) => ({
            ...photo,
            number: index + 1
        }));
        draft.detections = draft.detections.filter((detection) => detection.photoId !== photoId);
        draft.analysis = { ...draft.analysis, completed: false, status: 'idle', error: null };
        return draft;
    });

export const setPhotoArea = (photoIds, area) =>
    updateState((draft) => {
        draft.photos = draft.photos.map((photo) => {
            if (photoIds.includes(photo.id)) {
                return { ...photo, area };
            }
            return photo;
        });
        draft.analysis = { ...draft.analysis, completed: false, status: 'idle', error: null };
        return draft;
    });

export const clearPhotoAreas = (photoIds) =>
    updateState((draft) => {
        draft.photos = draft.photos.map((photo) => {
            if (photoIds.includes(photo.id)) {
                return { ...photo, area: null };
            }
            return photo;
        });
        draft.analysis = { ...draft.analysis, completed: false, status: 'idle', error: null };
        return draft;
    });

export const recordDetections = ({ detections, threshold = 0.5 }) =>
    updateState((draft) => {
        draft.detections = detections;
        draft.analysis = {
            ...draft.analysis,
            completed: true,
            status: 'complete',
            threshold,
            error: null
        };
        return draft;
    });

export const setAnalysisStatus = (status, message = null) =>
    updateState((draft) => {
        draft.analysis.status = status;
        draft.analysis.error = message;
        return draft;
    });

export const setAnalysisThreshold = (threshold) =>
    updateState((draft) => {
        draft.analysis.threshold = threshold;
        return draft;
    });

export const setSubmissionId = (id) =>
    updateState((draft) => {
        draft.analysis.submissionId = id;
        return draft;
    });

export const setCurrentAreaView = (area) =>
    updateState((draft) => {
        draft.analysis.currentArea = area;
        draft.analysis.currentPhotoIndex = 0;
        return draft;
    });

export const setCurrentPhotoIndex = (index) =>
    updateState((draft) => {
        draft.analysis.currentPhotoIndex = index;
        return draft;
    });

export const toggleFalsePositive = (detectionId) =>
    updateState((draft) => {
        draft.detections = draft.detections.map((detection) => {
            if (detection.id === detectionId) {
                return { ...detection, falsePositive: !detection.falsePositive };
            }
            return detection;
        });
        return draft;
    });

export const updateReportOptions = (options) =>
    updateState((draft) => {
        draft.report = { ...draft.report, ...options };
        return draft;
    });

export const dataURLToFile = (dataURL, fileName, preferredType = 'image/jpeg') => {
    if (!dataURL.startsWith('data:')) {
        throw new Error('Invalid image data');
    }
    const [meta, content] = dataURL.split(',');
    const mimeMatch = /data:(.*?);base64/.exec(meta);
    const mimeType = mimeMatch ? mimeMatch[1] : preferredType;
    const binary = atob(content);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        buffer[i] = binary.charCodeAt(i);
    }
    return new File([buffer], fileName, { type: mimeType });
};

export const summarizeDetectionsByArea = (stateSnapshot = readState()) => {
    const counts = Object.fromEntries(AREAS.map((area) => [area, 0]));
    stateSnapshot.detections.forEach((detection) => {
        const photo = stateSnapshot.photos.find((p) => p.id === detection.photoId);
        if (photo?.area && counts.hasOwnProperty(photo.area)) {
            counts[photo.area] += detection.falsePositive ? 0 : 1;
        }
    });
    return counts;
};

export const generateReportId = () => {
    const stateSnapshot = readState();
    const tail = stateSnapshot.inspection.tailNumber.replace(/[^A-Z0-9]/gi, '').toUpperCase() || 'TAIL';
    const timestamp = Date.now().toString(36).toUpperCase();
    return `${tail}-${timestamp}`.slice(0, 18);
};

