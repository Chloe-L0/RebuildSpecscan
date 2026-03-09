/**
 * Annotation preview in the report step: switch left column to a scrolling list
 * of images with bounding boxes. Does not modify report.js.
 */
import { readState, getThresholdForPhoto } from './state.js';

function filterIncludedDetections(state) {
    return state.detections.filter((det) => {
        if (det.falsePositive) return false;
        if (det.manual) return true;
        if (typeof det.confidence === 'number') {
            const threshold = getThresholdForPhoto(state, det.photoId);
            if (det.confidence < threshold) return false;
        }
        return true;
    });
}

const COLORS = [
    '#e11d48', '#2563eb', '#059669', '#d97706', '#7c3aed',
    '#dc2626', '#0284c7', '#ca8a04'
];
function getColorForClass(className) {
    if (!className) return COLORS[0];
    let hash = 0;
    for (let i = 0; i < className.length; i++) hash = className.charCodeAt(i) + ((hash << 5) - hash);
    return COLORS[Math.abs(hash) % COLORS.length];
}

function buildPhotoEntries(state, includedDetections) {
    const byPhoto = new Map();
    includedDetections.forEach((det) => {
        if (!byPhoto.has(det.photoId)) byPhoto.set(det.photoId, []);
        byPhoto.get(det.photoId).push(det);
    });
    const entries = [];
    state.photos.forEach((photo) => {
        const dets = byPhoto.get(photo.id);
        if (!dets?.length || !photo.dataURL) return;
        entries.push({ photo, section: photo.area || '', detections: dets });
    });
    return entries;
}

function renderAnnotationPreview() {
    const listEl = document.getElementById('annotationPreviewList');
    if (!listEl) return;
    const state = readState();
    const included = filterIncludedDetections(state);
    const entries = buildPhotoEntries(state, included);
    listEl.innerHTML = '';
    if (!entries.length) {
        const empty = document.createElement('p');
        empty.className = 'annotation-preview-empty';
        empty.textContent = 'No images with annotations to show.';
        listEl.appendChild(empty);
        return;
    }
    entries.forEach((entry) => {
        const item = document.createElement('div');
        item.className = 'annotation-preview-item';
        const sectionLabel = document.createElement('div');
        sectionLabel.className = 'annotation-preview-item-section';
        sectionLabel.textContent = entry.section || 'Unassigned';
        item.appendChild(sectionLabel);
        const wrap = document.createElement('div');
        wrap.className = 'annotation-preview-item-image-wrap';
        const img = document.createElement('img');
        img.className = 'annotation-preview-item-image';
        img.alt = '';
        img.src = entry.photo.dataURL;
        wrap.appendChild(img);
        const overlay = document.createElement('div');
        overlay.className = 'annotation-preview-item-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        img.decode().then(() => {
            const iw = img.naturalWidth || 1;
            const ih = img.naturalHeight || 1;
            entry.detections.forEach((det) => {
                const bbox = det.bbox || {};
                const w = bbox.width ?? bbox.w ?? 0;
                const h = bbox.height ?? bbox.h ?? 0;
                const cx = bbox.centerX ?? bbox.x ?? 0;
                const cy = bbox.centerY ?? bbox.y ?? 0;
                const srcW = bbox.imageWidth ?? iw;
                const srcH = bbox.imageHeight ?? ih;
                const left = ((cx - w / 2) / srcW) * 100;
                const top = ((cy - h / 2) / srcH) * 100;
                const width = (w / srcW) * 100;
                const height = (h / srcH) * 100;
                const box = document.createElement('div');
                box.className = 'annotation-preview-bbox';
                box.style.left = `${left}%`;
                box.style.top = `${top}%`;
                box.style.width = `${width}%`;
                box.style.height = `${height}%`;
                box.style.borderColor = getColorForClass(det.class);
                const label = document.createElement('span');
                label.className = 'annotation-preview-bbox-label';
                label.style.backgroundColor = getColorForClass(det.class);
                label.textContent = det.class || 'Defect';
                box.appendChild(label);
                overlay.appendChild(box);
            });
        }).catch(() => {});
        wrap.appendChild(overlay);
        item.appendChild(wrap);
        listEl.appendChild(item);
    });
}

function showReportView() {
    const panel = document.getElementById('reportPreviewPanel');
    const wrap = document.getElementById('annotationPreviewWrap');
    const reportBtn = document.getElementById('reportViewBtn');
    const annotationBtn = document.getElementById('annotationViewBtn');
    if (panel) panel.classList.remove('hidden');
    if (wrap) wrap.classList.add('hidden');
    if (reportBtn) { reportBtn.classList.add('active'); reportBtn.setAttribute('aria-pressed', 'true'); }
    if (annotationBtn) { annotationBtn.classList.remove('active'); annotationBtn.setAttribute('aria-pressed', 'false'); }
}

function showAnnotationView() {
    const panel = document.getElementById('reportPreviewPanel');
    const wrap = document.getElementById('annotationPreviewWrap');
    const reportBtn = document.getElementById('reportViewBtn');
    const annotationBtn = document.getElementById('annotationViewBtn');
    if (panel) panel.classList.add('hidden');
    if (wrap) wrap.classList.remove('hidden');
    if (reportBtn) { reportBtn.classList.remove('active'); reportBtn.setAttribute('aria-pressed', 'false'); }
    if (annotationBtn) { annotationBtn.classList.add('active'); annotationBtn.setAttribute('aria-pressed', 'true'); }
    renderAnnotationPreview();
}

function init() {
    const reportViewBtn = document.getElementById('reportViewBtn');
    const annotationViewBtn = document.getElementById('annotationViewBtn');
    reportViewBtn?.addEventListener('click', () => showReportView());
    annotationViewBtn?.addEventListener('click', () => showAnnotationView());
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
