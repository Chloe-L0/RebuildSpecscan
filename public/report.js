import {
    AREAS,
    readState,
    summarizeDetectionsByArea,
    updateReportOptions
} from './state.js';

const reportSummaryMeta = document.getElementById('reportSummaryMeta');
const totalPhotosEl = document.getElementById('totalPhotos');
const totalDetectionsEl = document.getElementById('totalDetections');
const areasInspectedEl = document.getElementById('areasInspected');
const thumbnailToggle = document.getElementById('thumbnailToggle');
const falsePositiveToggle = document.getElementById('falsePositiveToggle');
const allPhotosToggle = document.getElementById('allPhotosToggle');
const backToResultsBtn = document.getElementById('backToResultsBtn');
const downloadReportBtn = document.getElementById('downloadReportBtn');
const submitInspectionBtn = document.getElementById('submitInspectionBtn');
const reportPreviewDetail = document.getElementById('reportPreviewDetail');

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
    const started = state.inspection.startedAt
        ? new Date(state.inspection.startedAt).toLocaleString()
        : 'Unknown start';
    return `Tail ${state.inspection.tailNumber} · ${state.inspection.inspectionType} · ${inspector} · ${started}`;
};

const computeDetectionTotals = (state, includeFalsePositives) =>
    state.detections.filter((detection) => {
        if (!includeFalsePositives && detection.falsePositive) return false;
        if (typeof detection.confidence === 'number' && detection.confidence < state.analysis.threshold) {
            return false;
        }
        return true;
    }).length;

const renderSummary = () => {
    const state = readState();
    const tagged = state.photos.filter((photo) => Boolean(photo.area));
    const inspectedAreas = new Set(tagged.map((photo) => photo.area));
    const detectionCount = computeDetectionTotals(state, state.report.includeFalsePositives);

    reportSummaryMeta.textContent = formatMeta(state);
    totalPhotosEl.textContent = tagged.length.toString();
    totalDetectionsEl.textContent = detectionCount.toString();
    areasInspectedEl.textContent = inspectedAreas.size.toString();

    const counts = summarizeDetectionsByArea(state);
    const areaDetails = AREAS.filter((area) => inspectedAreas.has(area))
        .map((area) => `${area} (${counts[area] || 0})`)
        .join(', ');

    reportPreviewDetail.textContent = `Export will include ${detectionCount} detection${detectionCount === 1 ? '' : 's'} across ${inspectedAreas.size} area${inspectedAreas.size === 1 ? '' : 's'}: ${areaDetails || 'None'}. Options – Thumbnails: ${state.report.includeThumbnails ? 'ON' : 'OFF'}, False positives: ${state.report.includeFalsePositives ? 'ON' : 'OFF'}, All photos: ${state.report.includeAllPhotos ? 'ON' : 'OFF'}.`;

    thumbnailToggle.checked = state.report.includeThumbnails;
    falsePositiveToggle.checked = state.report.includeFalsePositives;
    allPhotosToggle.checked = state.report.includeAllPhotos;
};

thumbnailToggle?.addEventListener('change', (event) => {
    updateReportOptions({ includeThumbnails: event.target.checked });
    renderSummary();
});

falsePositiveToggle?.addEventListener('change', (event) => {
    updateReportOptions({ includeFalsePositives: event.target.checked });
    renderSummary();
});

allPhotosToggle?.addEventListener('change', (event) => {
    updateReportOptions({ includeAllPhotos: event.target.checked });
    renderSummary();
});

backToResultsBtn?.addEventListener('click', () => {
    window.location.href = 'results.html';
});

downloadReportBtn?.addEventListener('click', () => {
    alert('PDF export is coming soon. Configure your options and submit to finalize the inspection.');
});

submitInspectionBtn?.addEventListener('click', () => {
    window.location.href = 'success.html';
});

const initialState = ensureAnalysisComplete();
if (initialState) {
    renderSummary();
}

