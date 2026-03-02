const STORAGE_KEY = 'specscanInspection';

export const AREAS = [
    'FWD Fuselage',
    'MID Fuselage',
    'Wings',
    'AFT Fuselage',
    'Engines',
    'Vertical Stabilizer',
    'Horizontal Stabilizer'
];

// Color scheme for each inspection area (matches technical reference view requirements)
export const AREA_COLORS = {
    'FWD Fuselage': {
        primary: '#14B8A6',      // Teal
        light: 'rgba(20, 184, 166, 0.12)',
        border: 'rgba(20, 184, 166, 0.3)',
        text: '#0f766e'
    },
    'MID Fuselage': {
        primary: '#10B981',      // Green
        light: 'rgba(16, 185, 129, 0.12)',
        border: 'rgba(16, 185, 129, 0.3)',
        text: '#047857'
    },
    'Wings': {
        primary: '#3B82F6',       // Blue
        light: 'rgba(59, 130, 246, 0.12)',
        border: 'rgba(59, 130, 246, 0.3)',
        text: '#1e40af'
    },
    'AFT Fuselage': {
        primary: '#EF4444',       // Red
        light: 'rgba(239, 68, 68, 0.12)',
        border: 'rgba(239, 68, 68, 0.3)',
        text: '#dc2626'
    },
    'Engines': {
        primary: '#A855F7',       // Purple
        light: 'rgba(168, 85, 247, 0.12)',
        border: 'rgba(168, 85, 247, 0.3)',
        text: '#7c3aed'
    },
    'Vertical Stabilizer': {
        primary: '#F97316',       // Orange
        light: 'rgba(249, 115, 22, 0.12)',
        border: 'rgba(249, 115, 22, 0.3)',
        text: '#ea580c'
    },
    'Horizontal Stabilizer': {
        primary: '#EAB308',       // Yellow
        light: 'rgba(234, 179, 8, 0.12)',
        border: 'rgba(234, 179, 8, 0.3)',
        text: '#ca8a04'
    }
};

export const getAreaColor = (area) => {
    return AREA_COLORS[area] || {
        primary: '#62667a',
        light: 'rgba(98, 102, 122, 0.12)',
        border: 'rgba(98, 102, 122, 0.3)',
        text: '#4b5563'
    };
};

const AREA_SLUG_LOOKUP = {
    'FWD Fuselage': 'fwd-fuselage',
    'MID Fuselage': 'mid-fuselage',
    'Wings': 'wings',
    'AFT Fuselage': 'aft-fuselage',
    'Engines': 'engine',
    'Vertical Stabilizer': 'vertical-stabilizer',
    'Horizontal Stabilizer': 'horizontal-stabilizer'
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
        department: '',
        startedAt: null
    },
    photos: [],
    nextPhotoId: 1,
    detections: [],
    analysis: {
        completed: false,
        status: 'idle',
        threshold: 0.01,
        /** Per-photo confidence threshold (0–1). Keyed by photoId. Falls back to analysis.threshold when not set. */
        photoThresholds: {},
        currentArea: null,
        currentPhotoIndex: 0,
        error: null,
        submissionId: null
    },
    report: {
        includeThumbnails: true,
        includeFalsePositives: false,
        includeAllPhotos: true,
        includeFlaggedImages: false,
        includeFlaggedImageNotes: false,
        notes: ''
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

export const setInspectionDetails = ({ tailNumber, inspectionType, inspectorName, department, startedAt }) =>
    updateState((draft) => {
        draft.inspection.tailNumber = tailNumber.trim();
        draft.inspection.inspectionType = inspectionType;
        draft.inspection.inspectorName = inspectorName.trim();
        draft.inspection.department = (department || '').trim();
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
                area: photo.area ?? null,
                flagged: photo.flagged ?? false,
                flaggedNote: photo.flaggedNote ?? ''
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

export const recordDetections = ({ detections, threshold }) =>
    updateState((draft) => {
        draft.detections = detections;
        draft.analysis = {
            ...draft.analysis,
            completed: true,
            status: 'complete',
            // Only update threshold if explicitly provided, otherwise preserve current threshold
            threshold: threshold !== undefined ? threshold : draft.analysis.threshold,
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

/** Get the confidence threshold for a photo (0–1). Uses per-photo value if set, else global default. */
export const getThresholdForPhoto = (stateSnapshot, photoId) => {
    if (!stateSnapshot?.analysis) return 0.01;
    const perPhoto = stateSnapshot.analysis.photoThresholds?.[photoId];
    if (typeof perPhoto === 'number') return perPhoto;
    return stateSnapshot.analysis.threshold != null ? stateSnapshot.analysis.threshold : 0.01;
};

export const setPhotoThreshold = (photoId, threshold) =>
    updateState((draft) => {
        if (!draft.analysis.photoThresholds) draft.analysis.photoThresholds = {};
        draft.analysis.photoThresholds[photoId] = threshold;
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

export const summarizeDetectionsByArea = (stateSnapshot = readState(), options = {}) => {
    const { threshold: singleThreshold } = options;
    const counts = Object.fromEntries(AREAS.map((area) => [area, 0]));
    const usePerPhotoThresholds = singleThreshold === undefined;
    stateSnapshot.detections.forEach((detection) => {
        if (detection.falsePositive) return;
        // Manual detections are always included
        if (detection.manual) {
            const photo = stateSnapshot.photos.find((p) => p.id === detection.photoId);
            if (photo?.area && counts.hasOwnProperty(photo.area)) {
                counts[photo.area] += 1;
            }
            return;
        }
        const th = usePerPhotoThresholds
            ? getThresholdForPhoto(stateSnapshot, detection.photoId)
            : singleThreshold;
        if (typeof detection.confidence === 'number' && detection.confidence >= th) {
            const photo = stateSnapshot.photos.find((p) => p.id === detection.photoId);
            if (photo?.area && counts.hasOwnProperty(photo.area)) {
                counts[photo.area] += 1;
            }
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

export const addManualDetection = (detection) =>
    updateState((draft) => {
        // Generate unique ID for manual detection
        const maxId = draft.detections.reduce((max, det) => {
            const match = det.id?.match(/^manual-(\d+)$/);
            if (match) {
                const num = parseInt(match[1], 10);
                return Math.max(max, num);
            }
            return max;
        }, 0);
        const newId = `manual-${maxId + 1}`;
        
        draft.detections.push({
            id: newId,
            ...detection,
            manual: true,
            confidence: 'Manual',
            falsePositive: false
        });
        return draft;
    });

export const removeDetection = (detectionId) =>
    updateState((draft) => {
        draft.detections = draft.detections.filter((detection) => detection.id !== detectionId);
        return draft;
    });

export const restoreDetection = (detection) =>
    updateState((draft) => {
        if (detection && detection.id) {
            draft.detections.push(detection);
        }
        return draft;
    });

export const updateDetectionBbox = (detectionId, bbox) =>
    updateState((draft) => {
        draft.detections = draft.detections.map((detection) => {
            if (detection.id === detectionId) {
                return {
                    ...detection,
                    bbox: { ...detection.bbox, ...bbox }
                };
            }
            return detection;
        });
        return draft;
    });

export const updateDetectionNote = (detectionId, note) =>
    updateState((draft) => {
        draft.detections = draft.detections.map((detection) => {
            if (detection.id === detectionId) {
                return { ...detection, note: note != null ? String(note).trim() : '' };
            }
            return detection;
        });
        return draft;
    });

export const updateDetectionCritical = (detectionId, critical) =>
    updateState((draft) => {
        draft.detections = draft.detections.map((detection) => {
            if (detection.id === detectionId) {
                return { ...detection, critical: Boolean(critical) };
            }
            return detection;
        });
        return draft;
    });

export const updateDetectionClass = (detectionId, className) =>
    updateState((draft) => {
        draft.detections = draft.detections.map((detection) => {
            if (detection.id === detectionId) {
                return { ...detection, class: className != null ? String(className).trim() || 'Defect' : detection.class };
            }
            return detection;
        });
        return draft;
    });

export const togglePhotoFlagged = (photoId) => {
    const stateBeforeUpdate = readState();
    const inspectionContext = stateBeforeUpdate.inspection;
    updateState((draft) => {
        draft.photos = draft.photos.map((photo) => {
            if (photo.id === photoId) {
                const updated = { ...photo, flagged: !photo.flagged };
                // Save to localStorage when flagged (pass inspection context directly)
                if (updated.flagged) {
                    void saveFlaggedImageToStorage(updated, inspectionContext);
                } else {
                    void removeFlaggedImageFromStorage(photoId, inspectionContext);
                }
                return updated;
            }
            return photo;
        });
        return draft;
    });
};

export const updatePhotoFlaggedNote = (photoId, note) => {
    const stateBeforeUpdate = readState();
    const inspectionContext = stateBeforeUpdate.inspection;
    updateState((draft) => {
        draft.photos = draft.photos.map((photo) => {
            if (photo.id === photoId) {
                const updated = { ...photo, flaggedNote: note || '' };
                // Update localStorage if photo is flagged (pass inspection context directly)
                if (updated.flagged) {
                    void saveFlaggedImageToStorage(updated, inspectionContext);
                }
                return updated;
            }
            return photo;
        });
        return draft;
    });
};

// ---------------------------------------------------------------------------
// Inspection History (Recent Reports) - localStorage
// ---------------------------------------------------------------------------
const HISTORY_STORAGE_KEY = 'specscanInspectionHistory';
const HISTORY_STATE_PREFIX = 'specscanInspection_';
const HISTORY_MAX = 20;

// ---------------------------------------------------------------------------
// Inspection state persistence for history (IndexedDB fallback for large data)
// ---------------------------------------------------------------------------
const HISTORY_DB_NAME = 'specscan';
const HISTORY_DB_VERSION = 2;
const HISTORY_DB_STORE = 'inspectionStates';
const FLAGGED_IMAGES_DB_STORE = 'flaggedImages';

const openHistoryDb = () =>
    new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('indexedDB unavailable'));
            return;
        }
        const req = indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(HISTORY_DB_STORE)) {
                db.createObjectStore(HISTORY_DB_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(FLAGGED_IMAGES_DB_STORE)) {
                db.createObjectStore(FLAGGED_IMAGES_DB_STORE, { keyPath: 'storageId' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'));
    });

const putInspectionStateToDb = async (id, snapshot) => {
    const db = await openHistoryDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HISTORY_DB_STORE, 'readwrite');
        tx.oncomplete = () => {
            db.close();
            resolve(true);
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error || new Error('Failed to write inspection state'));
        };
        const store = tx.objectStore(HISTORY_DB_STORE);
        store.put({ id, snapshot, savedAt: Date.now() });
    });
};

const getInspectionStateFromDb = async (id) => {
    const db = await openHistoryDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HISTORY_DB_STORE, 'readonly');
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
            db.close();
            reject(tx.error || new Error('Failed to read inspection state'));
        };
        const store = tx.objectStore(HISTORY_DB_STORE);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result?.snapshot ?? null);
        req.onerror = () => reject(req.error || new Error('Failed to read inspection state'));
    });
};

const deleteInspectionStateFromDb = async (id) => {
    const db = await openHistoryDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(HISTORY_DB_STORE, 'readwrite');
        tx.oncomplete = () => {
            db.close();
            resolve(true);
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error || new Error('Failed to delete inspection state'));
        };
        const store = tx.objectStore(HISTORY_DB_STORE);
        store.delete(id);
    });
};

// Flagged images in IndexedDB (avoids localStorage quota)
const putFlaggedImageToDb = async (item) => {
    const db = await openHistoryDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(FLAGGED_IMAGES_DB_STORE, 'readwrite');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
        tx.objectStore(FLAGGED_IMAGES_DB_STORE).put(item);
    });
};

const getAllFlaggedImagesFromDb = async () => {
    const db = await openHistoryDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(FLAGGED_IMAGES_DB_STORE, 'readonly');
        const req = tx.objectStore(FLAGGED_IMAGES_DB_STORE).getAll();
        tx.oncomplete = () => { db.close(); resolve(req.result || []); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
};

const deleteFlaggedImageFromDb = async (storageIdOrPhotoId) => {
    const db = await openHistoryDb();
    const all = await new Promise((resolve, reject) => {
        const tx = db.transaction(FLAGGED_IMAGES_DB_STORE, 'readonly');
        const req = tx.objectStore(FLAGGED_IMAGES_DB_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
    });
    const idStr = String(storageIdOrPhotoId);
    const idNum = /^\d+$/.test(idStr) ? parseInt(idStr, 10) : NaN;
    const toDelete = all.filter((item) =>
        item.storageId === storageIdOrPhotoId || item.storageId === idStr ||
        item.id === storageIdOrPhotoId || (!Number.isNaN(idNum) && Number(item.id) === idNum)
    ).map((item) => item.storageId);
    if (toDelete.length === 0) return;
    const db2 = await openHistoryDb();
    const tx = db2.transaction(FLAGGED_IMAGES_DB_STORE, 'readwrite');
    const writeStore = tx.objectStore(FLAGGED_IMAGES_DB_STORE);
    toDelete.forEach((id) => writeStore.delete(id));
    await new Promise((resolve, reject) => {
        tx.oncomplete = () => { db2.close(); resolve(); };
        tx.onerror = () => { db2.close(); reject(tx.error); };
    });
};

export const getInspectionHistory = () => {
    try {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (!raw) return [];
        const list = JSON.parse(raw);
        if (!Array.isArray(list)) return [];
        return list.filter((entry) => entry && typeof entry.id === 'string' && entry.id.length > 0);
    } catch {
        return [];
    }
};

const setInspectionHistory = (list) => {
    try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
        console.warn('Inspection history save failed', e);
    }
};

/** Save current inspection to history (call when user reaches report step or success). Uses IndexedDB first to avoid localStorage quota. */
export const saveInspectionToHistory = async (stateSnapshot) => {
    if (!stateSnapshot?.inspection?.tailNumber || !stateSnapshot?.inspection?.startedAt) return;
    const id = `ins-${stateSnapshot.inspection.startedAt}`;
    const list = getInspectionHistory();
    const entry = {
        id,
        tailNumber: stateSnapshot.inspection.tailNumber || '',
        startedAt: stateSnapshot.inspection.startedAt,
        inspectorName: stateSnapshot.inspection.inspectorName || '',
        department: stateSnapshot.inspection.department || '',
        inspectionType: stateSnapshot.inspection.inspectionType || 'Outbound',
        photosCount: Array.isArray(stateSnapshot.photos) ? stateSnapshot.photos.length : 0,
        storage: 'idb'
    };
    let next;
    const existingIndex = list.findIndex((item) => item.id === id);
    if (existingIndex >= 0) {
        next = [...list];
        next[existingIndex] = entry;
    } else {
        next = [entry, ...list].slice(0, HISTORY_MAX);
    }
    setInspectionHistory(next);

    try {
        await putInspectionStateToDb(id, stateSnapshot);
    } catch (_idbErr) {
        try {
            localStorage.setItem(HISTORY_STATE_PREFIX + id, JSON.stringify(stateSnapshot));
            const listAfter = getInspectionHistory();
            const idx = listAfter.findIndex((item) => item.id === id);
            if (idx >= 0) {
                const updated = [...listAfter];
                updated[idx] = { ...updated[idx], storage: 'local' };
                setInspectionHistory(updated);
            }
        } catch (e) {
            console.warn('Inspection state could not be saved (storage full). Try completing with fewer photos.', e);
        }
    }
};

/** Check if stored state exists for a history id (so we can hide stale entries). */
export const hasInspectionState = (id) => {
    if (!id || typeof id !== 'string') return false;
    try {
        const raw = localStorage.getItem(HISTORY_STATE_PREFIX + id);
        return Boolean(raw);
    } catch {
        return false;
    }
};

/** Load a past inspection by id and replace current state. Returns true if loaded. */
export const loadInspectionFromHistory = async (id) => {
    try {
        const raw = localStorage.getItem(HISTORY_STATE_PREFIX + id);
        if (raw) {
            const parsed = JSON.parse(raw);
            replaceState(parsed);
            return true;
        }
        const fromDb = await getInspectionStateFromDb(id);
        if (!fromDb) return false;
        replaceState(fromDb);
        return true;
    } catch (e) {
        console.warn('Failed to load inspection from history', e);
        return false;
    }
};

/** Delete an inspection from history by id */
export const deleteInspectionFromHistory = async (id) => {
    try {
        // Remove from history list
        const list = getInspectionHistory();
        const filtered = list.filter((item) => item.id !== id);
        setInspectionHistory(filtered);
        
        // Remove the stored state
        localStorage.removeItem(HISTORY_STATE_PREFIX + id);
        try {
            await deleteInspectionStateFromDb(id);
        } catch (e) {
            // Ignore: state may have been in localStorage only
            console.warn('Failed to delete IndexedDB inspection state', e);
        }
        return true;
    } catch (e) {
        console.warn('Failed to delete inspection from history', e);
        return false;
    }
};

// ---------------------------------------------------------------------------
// Bookmarked sessions (Inspection History bookmarks)
// ---------------------------------------------------------------------------
const BOOKMARKS_STORAGE_KEY = 'specscanBookmarks';

export const getBookmarkedIds = () => {
    try {
        const raw = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
        if (!raw) return [];
        const list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
};

const setBookmarkedIds = (ids) => {
    try {
        localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(ids));
    } catch (e) {
        console.warn('Bookmarks save failed', e);
    }
};

export const isBookmarked = (id) => getBookmarkedIds().includes(id);

export const addBookmark = (id) => {
    if (!id || typeof id !== 'string') return;
    const ids = getBookmarkedIds();
    if (ids.includes(id)) return;
    setBookmarkedIds([...ids, id]);
};

export const removeBookmark = (id) => {
    if (!id || typeof id !== 'string') return;
    const ids = getBookmarkedIds().filter((x) => x !== id);
    setBookmarkedIds(ids);
};

export const toggleBookmark = (id) => {
    if (!id || typeof id !== 'string') return false;
    const ids = getBookmarkedIds();
    const idx = ids.indexOf(id);
    if (idx >= 0) {
        setBookmarkedIds(ids.filter((_, i) => i !== idx));
        return false;
    }
    setBookmarkedIds([...ids, id]);
    return true;
};

// ---------------------------------------------------------------------------
// Flagged Images Storage (Persistent) - localStorage
// ---------------------------------------------------------------------------
const FLAGGED_IMAGES_STORAGE_KEY = 'specscanFlaggedImages';

/** Compute storageId for a flagged photo (used for both save and remove). */
const getFlaggedStorageId = (photo, currentInspection, existing) => {
    let sessionId;
    if (currentInspection?.startedAt) {
        sessionId = String(currentInspection.startedAt);
    } else if (currentInspection?.tailNumber && currentInspection?.inspectorName) {
        const sessionKey = `${currentInspection.tailNumber}-${currentInspection.inspectorName}`;
        const existingFromSameSession = existing.find((item) =>
            item.inspection?.tailNumber === currentInspection.tailNumber &&
            item.inspection?.inspectorName === currentInspection.inspectorName &&
            !item.inspection?.startedAt
        );
        if (existingFromSameSession?.storageId) {
            const parts = existingFromSameSession.storageId.split('-');
            sessionId = parts.length > 1 ? parts.slice(0, -1).join('-') : sessionKey;
        } else {
            sessionId = `${sessionKey}-${Date.now()}`;
        }
    } else {
        sessionId = String(Date.now());
    }
    return `${sessionId}-${photo.id}`;
};

const saveFlaggedImageToStorage = async (photo, inspectionContext = null) => {
    const currentInspection = inspectionContext || readState().inspection;
    let existing = [];
    try {
        existing = await getAllFlaggedImagesFromDb();
    } catch {
        // IDB may not exist yet; use empty list for storageId computation
    }
    const storageId = getFlaggedStorageId(photo, currentInspection, existing);
    const flaggedItem = {
        storageId,
        id: photo.id,
        number: photo.number,
        name: photo.name,
        dataURL: photo.dataURL,
        area: photo.area || null,
        flagged: true,
        flaggedNote: photo.flaggedNote || '',
        flaggedAt: new Date().toISOString(),
        inspection: currentInspection ? {
            tailNumber: currentInspection.tailNumber || '',
            inspectionType: currentInspection.inspectionType || '',
            inspectorName: currentInspection.inspectorName || '',
            department: currentInspection.department || '',
            startedAt: currentInspection.startedAt || null
        } : null
    };
    try {
        await putFlaggedImageToDb(flaggedItem);
    } catch (e) {
        console.warn('Failed to save flagged image to storage', e);
    }
};

const removeFlaggedImageFromStorage = async (photoId, inspectionContext = null) => {
    const currentInspection = inspectionContext || readState().inspection;
    let existing = [];
    try {
        existing = await getAllFlaggedImagesFromDb();
    } catch {
        return;
    }
    let storageId;
    if (currentInspection?.startedAt) {
        storageId = `${currentInspection.startedAt}-${photoId}`;
    } else if (currentInspection?.tailNumber && currentInspection?.inspectorName) {
        const match = existing.find((item) => item.id === photoId &&
            item.inspection?.tailNumber === currentInspection.tailNumber &&
            item.inspection?.inspectorName === currentInspection.inspectorName);
        if (match) storageId = match.storageId;
        else return;
    } else {
        storageId = `${Date.now()}-${photoId}`;
    }
    try {
        await deleteFlaggedImageFromDb(storageId);
    } catch (e) {
        console.warn('Failed to remove flagged image from storage', e);
    }
};

/** One-time migration: move flagged images from localStorage to IndexedDB. */
const migrateFlaggedImagesToIdb = async (list) => {
    if (!Array.isArray(list) || list.length === 0) return;
    try {
        for (const item of list) {
            if (item && item.storageId) await putFlaggedImageToDb(item);
        }
        localStorage.removeItem(FLAGGED_IMAGES_STORAGE_KEY);
    } catch (e) {
        console.warn('Migration of flagged images to IndexedDB failed', e);
    }
};

/** Returns all flagged images from IndexedDB (async to avoid localStorage quota). Migrates from localStorage once if needed. */
export const getAllFlaggedImages = async () => {
    try {
        const fromIdb = await getAllFlaggedImagesFromDb();
        if (fromIdb.length > 0) return fromIdb;
        const raw = localStorage.getItem(FLAGGED_IMAGES_STORAGE_KEY);
        if (!raw) return [];
        const list = JSON.parse(raw);
        if (!Array.isArray(list) || list.length === 0) return [];
        void migrateFlaggedImagesToIdb(list);
        return list;
    } catch {
        return [];
    }
};

export const deleteFlaggedImage = async (storageIdOrPhotoId) => {
    try {
        await deleteFlaggedImageFromDb(storageIdOrPhotoId);
    } catch (e) {
        console.warn('Failed to delete flagged image from storage', e);
    }
};

/** Save all flagged images from the current session when inspection is completed (step 6) */
export const saveAllFlaggedImagesFromSession = async (stateSnapshot) => {
    if (!stateSnapshot?.inspection) return;
    const flaggedPhotos = stateSnapshot.photos.filter((photo) => photo.flagged);
    if (flaggedPhotos.length === 0) return;
    const inspectionContext = stateSnapshot.inspection;
    for (const photo of flaggedPhotos) {
        await saveFlaggedImageToStorage(photo, inspectionContext);
    }
};

// ---------------------------------------------------------------------------
// General Notes Storage (Persistent) - localStorage
// ---------------------------------------------------------------------------
const GENERAL_NOTES_STORAGE_KEY = 'specscanGeneralNotes';

export const saveGeneralNoteToStorage = (note, inspectionContext) => {
    try {
        if (!note || !note.trim()) return; // Don't save empty notes
        
        const existing = getAllGeneralNotes();
        const trimmedNote = note.trim();
        
        // Check if this exact note already exists (same content and same inspection context)
        // Only check notes from the last 5 minutes to allow updates if user edits
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        const recentNote = existing.find((item) => {
            const itemTime = item.createdAt ? new Date(item.createdAt).getTime() : 0;
            const sameContent = item.note === trimmedNote;
            const sameContext = JSON.stringify(item.inspection) === JSON.stringify(inspectionContext);
            const isRecent = itemTime > fiveMinutesAgo;
            return sameContent && sameContext && isRecent;
        });
        
        // If a recent duplicate exists, don't save again
        if (recentNote) {
            return;
        }
        
        const noteId = `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const noteItem = {
            id: noteId,
            note: trimmedNote,
            createdAt: new Date().toISOString(),
            inspection: inspectionContext || null
        };
        
        existing.push(noteItem);
        
        // Keep only the last 100 notes to prevent storage issues
        const trimmed = existing.slice(-100);
        
        localStorage.setItem(GENERAL_NOTES_STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
        console.warn('Failed to save general note to storage', e);
    }
};

export const getAllGeneralNotes = () => {
    try {
        const raw = localStorage.getItem(GENERAL_NOTES_STORAGE_KEY);
        if (!raw) return [];
        const list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
};

export const deleteGeneralNote = (noteId) => {
    try {
        const existing = getAllGeneralNotes();
        const filtered = existing.filter((item) => item.id !== noteId);
        localStorage.setItem(GENERAL_NOTES_STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {
        console.warn('Failed to delete general note from storage', e);
    }
};

// Keep Netlify function warm: ping /api/health every 4 min (initial + interval), silent errors
const KEEPALIVE_MS = 4 * 60 * 1000;
const pingHealth = () => { fetch('/api/health').catch(() => {}); };
pingHealth();
setInterval(pingHealth, KEEPALIVE_MS);
