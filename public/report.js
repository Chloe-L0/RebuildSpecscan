import {
    AREAS,
    readState,
    summarizeDetectionsByArea,
    updateReportOptions
} from './state.js';
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
    const dept = state.inspection.department ? ` · ${state.inspection.department}` : '';
    const started = state.inspection.startedAt
        ? new Date(state.inspection.startedAt).toLocaleString()
        : 'Unknown start';
    return `Tail ${state.inspection.tailNumber} · ${state.inspection.inspectionType}${dept} · ${inspector} · ${started}`;
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

const filterIncludedDetections = (state) => {
    const includeFalsePositives = state.report.includeFalsePositives;
    return state.detections.filter((detection) => {
        if (!includeFalsePositives && detection.falsePositive) return false;
        if (typeof detection.confidence === 'number' && detection.confidence < state.analysis.threshold) return false;
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

const addKeyValue = (page, key, value, fonts, cursor) => {
    page.drawText(`${key}:`, { x: cursor.margin, y: cursor.y, size: 12, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
    page.drawText(value, { x: cursor.margin + 120, y: cursor.y, size: 12, font: fonts.regular, color: rgb(0.1, 0.1, 0.1) });
    cursor.y -= 16;
};

const ensureSpace = (pdfDoc, cursor, needed) => {
    if (cursor.y - needed <= cursor.margin) {
        cursor.page = pdfDoc.addPage([612, 792]);
        cursor.y = 792 - cursor.margin;
    }
};

const generatePdf = async () => {
    const state = readState();
    const includedDetections = filterIncludedDetections(state);
    const areasInspected = Array.from(new Set(state.photos.filter((p) => p.area).map((p) => p.area)));
    const pdfDoc = await PDFDocument.create();
    const fonts = {
        regular: await pdfDoc.embedStandardFont(StandardFonts.Helvetica),
        bold: await pdfDoc.embedStandardFont(StandardFonts.HelveticaBold)
    };

    const cursor = {
        margin: 50,
        page: pdfDoc.addPage([612, 792]),
        y: 792 - 50
    };

    const addSectionTitle = (text) => {
        ensureSpace(pdfDoc, cursor, 28);
        cursor.page.drawText(text, { x: cursor.margin, y: cursor.y, size: 16, font: fonts.bold, color: rgb(0.08, 0.08, 0.08) });
        cursor.y -= 22;
    };

    // Title
    addLine(cursor.page, 'AIRCRAFT INSPECTION REPORT', fonts, cursor, { size: 20, font: fonts.bold, lineHeight: 26 });
    cursor.y -= 6;

    addSectionTitle('AIRCRAFT INFORMATION');
    addKeyValue(cursor.page, 'Registration', state.inspection.tailNumber || 'Not provided', fonts, cursor);
    addKeyValue(cursor.page, 'Make/Model', state.inspection.makeModel || 'Not provided', fonts, cursor);
    addKeyValue(cursor.page, 'Serial Number', state.inspection.serialNumber || 'Not provided', fonts, cursor);
    addKeyValue(cursor.page, 'Department', state.inspection.department || 'Not provided', fonts, cursor);
    addKeyValue(
        cursor.page,
        'Inspection Type',
        `${(state.inspection.inspectionType || 'Inbound').toUpperCase()} INSPECTION`,
        fonts,
        cursor
    );
    addKeyValue(cursor.page, 'Inspection Date', formatUTCDate(state.inspection.startedAt), fonts, cursor);
    addKeyValue(cursor.page, 'Total Time', state.inspection.totalTime || 'Not provided', fonts, cursor);
    addKeyValue(cursor.page, 'Session Duration', formatDuration(state.inspection.startedAt), fonts, cursor);

    cursor.y -= 6;
    addSectionTitle('INSPECTION AUTHORITY');
    addKeyValue(cursor.page, 'Inspector Name', state.inspection.inspectorName || 'Not assigned', fonts, cursor);

    cursor.y -= 6;
    addSectionTitle('INSPECTION SCOPE');
    addKeyValue(cursor.page, 'Areas Inspected', areasInspected.length ? areasInspected.join(', ') : 'Not recorded', fonts, cursor);
    addKeyValue(cursor.page, 'Inspection Method', 'Computer Vision Analysis', fonts, cursor);

    cursor.y -= 12;
    addSectionTitle('FINDINGS SUMMARY');
    addKeyValue(cursor.page, 'Total Defects Detected', includedDetections.length.toString(), fonts, cursor);

    cursor.y -= 12;
    addSectionTitle('DETAILED FINDINGS');

    if (!includedDetections.length) {
        addLine(cursor.page, 'No defects met the reporting criteria at the selected threshold.', fonts, cursor, { size: 12 });
    }

    let findingIndex = 1;
    for (const detection of includedDetections) {
        ensureSpace(pdfDoc, cursor, 220);
        const photo = state.photos.find((p) => p.id === detection.photoId);
        const photoDetections = includedDetections.filter((det) => det.photoId === detection.photoId);
        const confidence = typeof detection.confidence === 'number' ? `${Math.round(detection.confidence * 100)}%` : 'Not recorded';
        const bbox = detection.bbox || {};
        const dims =
            bbox.width && bbox.height
                ? `${Math.round(bbox.width)} × ${Math.round(bbox.height)} px`
                : 'Not recorded';

        addLine(
            cursor.page,
            `Finding F-${String(findingIndex).padStart(3, '0')}: ${detection.class || 'Defect'} in ${detection.area || 'Unknown component'}`,
            fonts,
            cursor,
            { size: 14, font: fonts.bold, lineHeight: 20 }
        );
        addKeyValue(cursor.page, 'Location', `${detection.area || 'Area N/A'} · Photo #${detection.photoNumber}`, fonts, cursor);
        addKeyValue(cursor.page, 'Defect Type', detection.class || 'Defect', fonts, cursor);
        addKeyValue(cursor.page, 'Dimensions', dims, fonts, cursor);
        addKeyValue(cursor.page, 'AI Confidence', confidence, fonts, cursor);
        addKeyValue(
            cursor.page,
            'Description',
            `Automated detection on ${detection.area || 'area'} (Photo #${detection.photoNumber}).`,
            fonts,
            cursor
        );
        addKeyValue(cursor.page, 'Required Action', 'Maintenance technician to verify and remediate as needed.', fonts, cursor);
        addKeyValue(cursor.page, 'Estimated Repair Time', detection.estimatedTime || 'Not estimated', fonts, cursor);

        if (photo?.dataURL) {
            try {
                const annotated = await createAnnotatedImage(photo, photoDetections, detection.id);
                const pngImage = await pdfDoc.embedPng(annotated);
                const maxWidth = 612 - cursor.margin * 2;
                const scale = Math.min(1, maxWidth / pngImage.width);
                const displayWidth = pngImage.width * scale;
                const displayHeight = pngImage.height * scale;

                ensureSpace(pdfDoc, cursor, displayHeight + 24);
                cursor.page.drawText('Photographic Evidence', {
                    x: cursor.margin,
                    y: cursor.y,
                    size: 12,
                    font: fonts.bold,
                    color: rgb(0.1, 0.1, 0.1)
                });
                cursor.y -= 16;
                cursor.page.drawImage(pngImage, {
                    x: cursor.margin,
                    y: cursor.y - displayHeight,
                    width: displayWidth,
                    height: displayHeight
                });
                cursor.y -= displayHeight + 18;
            } catch (error) {
                console.error('Failed to embed photo', error);
                addLine(cursor.page, 'Photographic evidence unavailable for this finding.', fonts, cursor);
            }
        } else {
            addLine(cursor.page, 'Photographic evidence unavailable for this finding.', fonts, cursor);
        }

        findingIndex += 1;
        cursor.y -= 4;
    }

    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildFileName(state);
    link.click();
    URL.revokeObjectURL(url);
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

downloadReportBtn?.addEventListener('click', async () => {
    const originalLabel = downloadReportBtn.textContent;
    downloadReportBtn.disabled = true;
    downloadReportBtn.textContent = 'Generating PDF…';
    try {
        await generatePdf();
    } catch (error) {
        console.error('PDF generation failed', error);
        alert(error.message || 'Unable to generate PDF. Please try again.');
    } finally {
        downloadReportBtn.disabled = false;
        downloadReportBtn.textContent = originalLabel;
    }
});

submitInspectionBtn?.addEventListener('click', () => {
    window.location.href = 'success.html';
});

const initialState = ensureAnalysisComplete();
if (initialState) {
    renderSummary();
}

