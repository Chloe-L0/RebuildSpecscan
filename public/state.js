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
                    saveFlaggedImageToStorage(updated, inspectionContext);
                } else {
                    // Remove from storage when unflagged
                    removeFlaggedImageFromStorage(photoId, inspectionContext);
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
                    saveFlaggedImageToStorage(updated, inspectionContext);
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

export const getInspectionHistory = () => {
    try {
        const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (!raw) return [];
        const list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
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

/** Save current inspection to history (call when user reaches success / completes). */
export const saveInspectionToHistory = (stateSnapshot) => {
    if (!stateSnapshot?.inspection?.tailNumber || !stateSnapshot?.inspection?.startedAt) return;
    const id = stateSnapshot.analysis?.submissionId || `ins-${stateSnapshot.inspection.startedAt}-${Date.now()}`;
    const list = getInspectionHistory();
    if (list.some((item) => item.id === id)) return;
    const entry = {
        id,
        tailNumber: stateSnapshot.inspection.tailNumber || '',
        startedAt: stateSnapshot.inspection.startedAt,
        inspectorName: stateSnapshot.inspection.inspectorName || '',
        department: stateSnapshot.inspection.department || '',
        inspectionType: stateSnapshot.inspection.inspectionType || 'Outbound',
        photosCount: Array.isArray(stateSnapshot.photos) ? stateSnapshot.photos.length : 0
    };
    const next = [entry, ...list].slice(0, HISTORY_MAX);
    setInspectionHistory(next);
    try {
        localStorage.setItem(HISTORY_STATE_PREFIX + id, JSON.stringify(stateSnapshot));
    } catch (e) {
        console.warn('Inspection state save failed (quota?)', e);
    }
};

/** Load a past inspection by id and replace current state. Returns true if loaded. */
export const loadInspectionFromHistory = (id) => {
    try {
        const raw = localStorage.getItem(HISTORY_STATE_PREFIX + id);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        replaceState(parsed);
        return true;
    } catch {
        return false;
    }
};

/** Delete an inspection from history by id */
export const deleteInspectionFromHistory = (id) => {
    try {
        // Remove from history list
        const list = getInspectionHistory();
        const filtered = list.filter((item) => item.id !== id);
        setInspectionHistory(filtered);
        
        // Remove the stored state
        localStorage.removeItem(HISTORY_STATE_PREFIX + id);
        return true;
    } catch (e) {
        console.warn('Failed to delete inspection from history', e);
        return false;
    }
};

// ---------------------------------------------------------------------------
// Flagged Images Storage (Persistent) - localStorage
// ---------------------------------------------------------------------------
const FLAGGED_IMAGES_STORAGE_KEY = 'specscanFlaggedImages';

const saveFlaggedImageToStorage = (photo, inspectionContext = null) => {
    try {
        const existing = getAllFlaggedImages();
        // Use provided inspection context, or read from state as fallback
        const currentInspection = inspectionContext || readState().inspection;
        
        // Create a unique storage ID that combines photo ID with session identifier
        // This ensures each flagged image from each session is saved separately
        let sessionId;
        if (currentInspection?.startedAt) {
            // Use startedAt as session ID (most reliable)
            sessionId = String(currentInspection.startedAt);
        } else if (currentInspection?.tailNumber && currentInspection?.inspectorName) {
            // Create a stable session ID from tail number and inspector name
            // Use a hash-like approach to ensure same session gets same ID
            const sessionKey = `${currentInspection.tailNumber}-${currentInspection.inspectorName}`;
            // Find if there's already a flagged image from this session to reuse its sessionId
            const existingFromSameSession = existing.find((item) => 
                item.inspection?.tailNumber === currentInspection.tailNumber &&
                item.inspection?.inspectorName === currentInspection.inspectorName &&
                !item.inspection?.startedAt
            );
            if (existingFromSameSession?.storageId) {
                // Extract sessionId from existing storageId (format: "sessionId-photoId")
                const parts = existingFromSameSession.storageId.split('-');
                if (parts.length > 1) {
                    // Remove the photoId part to get just the sessionId
                    sessionId = parts.slice(0, -1).join('-');
                } else {
                    sessionId = sessionKey;
                }
            } else {
                // First flagged image from this session - create new sessionId
                sessionId = `${sessionKey}-${Date.now()}`;
            }
        } else {
            // Last resort: use current timestamp (ensures uniqueness)
            sessionId = String(Date.now());
        }
        const storageId = `${sessionId}-${photo.id}`;
        
        // Find if this exact photo from this exact session already exists
        const index = existing.findIndex((item) => item.storageId === storageId);
        
        const flaggedItem = {
            storageId: storageId, // Unique identifier for storage
            id: photo.id, // Original photo ID (for reference)
            number: photo.number,
            name: photo.name,
            dataURL: photo.dataURL,
            area: photo.area || null,
            flagged: true,
            flaggedNote: photo.flaggedNote || '',
            flaggedAt: new Date().toISOString(),
            // Store inspection context if available
            inspection: currentInspection ? {
                tailNumber: currentInspection.tailNumber || '',
                inspectionType: currentInspection.inspectionType || '',
                inspectorName: currentInspection.inspectorName || '',
                department: currentInspection.department || '',
                startedAt: currentInspection.startedAt || null
            } : null
        };
        
        if (index >= 0) {
            // Update existing entry (same photo from same session)
            existing[index] = { ...existing[index], ...flaggedItem };
        } else {
            // Add new entry (preserve all flagged images from all sessions)
            existing.push(flaggedItem);
        }
        
        localStorage.setItem(FLAGGED_IMAGES_STORAGE_KEY, JSON.stringify(existing));
    } catch (e) {
        console.warn('Failed to save flagged image to storage', e);
    }
};

const removeFlaggedImageFromStorage = (photoId, inspectionContext = null) => {
    try {
        const existing = getAllFlaggedImages();
        // Use provided inspection context, or read from state as fallback
        const currentInspection = inspectionContext || readState().inspection;
        
        // Create the same storage ID to find and remove the correct entry
        let sessionId;
        if (currentInspection?.startedAt) {
            sessionId = currentInspection.startedAt;
        } else if (currentInspection?.tailNumber && currentInspection?.inspectorName) {
            // Try to find by matching tail number and inspector (for current session)
            sessionId = `${currentInspection.tailNumber}-${currentInspection.inspectorName}`;
            // Remove all entries matching this pattern and photoId
            const filtered = existing.filter((item) => {
                const itemSessionId = item.inspection?.startedAt || 
                    (item.inspection?.tailNumber && item.inspection?.inspectorName 
                        ? `${item.inspection.tailNumber}-${item.inspection.inspectorName}` 
                        : null);
                return !(itemSessionId === sessionId && item.id === photoId);
            });
            localStorage.setItem(FLAGGED_IMAGES_STORAGE_KEY, JSON.stringify(filtered));
            return;
        } else {
            sessionId = Date.now();
        }
        const storageId = `${sessionId}-${photoId}`;
        
        // Remove by storageId (unique per session) or fallback to photoId for backward compatibility
        const filtered = existing.filter((item) => 
            item.storageId !== storageId && item.id !== photoId
        );
        localStorage.setItem(FLAGGED_IMAGES_STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {
        console.warn('Failed to remove flagged image from storage', e);
    }
};

export const getAllFlaggedImages = () => {
    try {
        const raw = localStorage.getItem(FLAGGED_IMAGES_STORAGE_KEY);
        if (!raw) return [];
        const list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
};

export const deleteFlaggedImage = (storageIdOrPhotoId) => {
    try {
        const existing = getAllFlaggedImages();
        // Remove by storageId (preferred) or photoId (for backward compatibility)
        const filtered = existing.filter((item) => 
            item.storageId !== storageIdOrPhotoId && item.id !== storageIdOrPhotoId
        );
        localStorage.setItem(FLAGGED_IMAGES_STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {
        console.warn('Failed to delete flagged image from storage', e);
    }
};

/** Save all flagged images from the current session when inspection is completed (step 6) */
export const saveAllFlaggedImagesFromSession = (stateSnapshot) => {
    if (!stateSnapshot?.inspection) return;
    
    const flaggedPhotos = stateSnapshot.photos.filter((photo) => photo.flagged);
    if (flaggedPhotos.length === 0) return;
    
    const inspectionContext = stateSnapshot.inspection;
    
    // Save each flagged image to storage
    flaggedPhotos.forEach((photo) => {
        saveFlaggedImageToStorage(photo, inspectionContext);
    });
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
