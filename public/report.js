import {
    AREAS,
    readState,
    summarizeDetectionsByArea,
    updateReportOptions
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
    return state.detections.filter((detection) => {
        if (detection.falsePositive) return false;
        if (detection.manual) return true;
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
    const valueX = cursor.margin + 130;
    const maxWidth = 612 - cursor.margin - valueX;
    const lineHeight = 14;
    page.drawText(`${key}:`, { x: keyX, y: cursor.y, size: 12, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
    const lineCount = drawWrappedText(page, value, valueX, cursor.y, {
        font: fonts.regular,
        size: 12,
        color: rgb(0.1, 0.1, 0.1),
        maxWidth,
        lineHeight
    });
    cursor.y -= lineCount * lineHeight;
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

    // ========================================
    // PAGE 1: COVER & SUMMARY
    // ========================================
    
    // Title
    addLine(cursor.page, 'AIRCRAFT INSPECTION REPORT', fonts, cursor, { size: 24, font: fonts.bold, lineHeight: 30 });
    cursor.y -= 10;

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
    
    // Summary table
    if (includedDetections.length > 0) {
        ensureSpace(pdfDoc, cursor, 40);
        
        // Table header with explicit column widths to avoid overlap
        const tableColumns = [
            { key: 'id', label: 'ID', width: 55 },
            { key: 'type', label: 'Defect Type', width: 150 },
            { key: 'location', label: 'Location', width: 140 },
            { key: 'photo', label: 'Photo #', width: 70 },
            { key: 'confidence', label: 'Confidence', width: 90 }
        ];
        let columnX = cursor.margin;
        tableColumns.forEach((col) => {
            col.x = columnX;
            columnX += col.width + 12;
            cursor.page.drawText(col.label, { x: col.x, y: cursor.y, size: 10, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
        });
        
        cursor.y -= 16;
        
        // Table rows
        let findingIndex = 1;
        const rowLineHeight = 12;
        for (const detection of includedDetections) {
            const confidence = detection.manual ? 'Manual' : (typeof detection.confidence === 'number' ? `${Math.round(detection.confidence * 100)}%` : 'N/A');
            const defectType = detection.class || 'Defect';
            const location = detection.area || 'N/A';
            const photoText = `#${detection.photoNumber}`;

            const wrapped = {
                id: wrapText(`F-${String(findingIndex).padStart(3, '0')}`, fonts.regular, 9, tableColumns[0].width),
                type: wrapText(defectType, fonts.regular, 9, tableColumns[1].width),
                location: wrapText(location, fonts.regular, 9, tableColumns[2].width),
                photo: wrapText(photoText, fonts.regular, 9, tableColumns[3].width),
                confidence: wrapText(confidence, fonts.regular, 9, tableColumns[4].width)
            };
            const maxLines = Math.max(...Object.values(wrapped).map((lines) => lines.length));
            const rowHeight = maxLines * rowLineHeight + 4;
            ensureSpace(pdfDoc, cursor, rowHeight + 4);

            drawWrappedText(cursor.page, wrapped.id.join(' '), tableColumns[0].x, cursor.y, {
                font: fonts.regular,
                size: 9,
                color: rgb(0.1, 0.1, 0.1),
                maxWidth: tableColumns[0].width,
                lineHeight: rowLineHeight
            });
            drawWrappedText(cursor.page, defectType, tableColumns[1].x, cursor.y, {
                font: fonts.regular,
                size: 9,
                color: rgb(0.1, 0.1, 0.1),
                maxWidth: tableColumns[1].width,
                lineHeight: rowLineHeight
            });
            drawWrappedText(cursor.page, location, tableColumns[2].x, cursor.y, {
                font: fonts.regular,
                size: 9,
                color: rgb(0.1, 0.1, 0.1),
                maxWidth: tableColumns[2].width,
                lineHeight: rowLineHeight
            });
            drawWrappedText(cursor.page, photoText, tableColumns[3].x, cursor.y, {
                font: fonts.regular,
                size: 9,
                color: rgb(0.1, 0.1, 0.1),
                maxWidth: tableColumns[3].width,
                lineHeight: rowLineHeight
            });
            drawWrappedText(cursor.page, confidence, tableColumns[4].x, cursor.y, {
                font: fonts.regular,
                size: 9,
                color: rgb(0.1, 0.1, 0.1),
                maxWidth: tableColumns[4].width,
                lineHeight: rowLineHeight
            });

            cursor.y -= rowHeight;
            findingIndex++;
        }
    } else {
        addLine(cursor.page, 'No defects met the reporting criteria at the selected threshold.', fonts, cursor, { size: 12 });
    }

    // ========================================
    // PAGES 2+: DETAILED FINDINGS (COMPACT)
    // ========================================
    
    if (includedDetections.length > 0) {
        cursor.y -= 20;
        ensureSpace(pdfDoc, cursor, 100);
        addSectionTitle('DETAILED FINDINGS');

        let findingIndex = 1;
        const THUMBNAIL_SIZE = THUMBNAIL_HEIGHT;
        const THUMBNAIL_MARGIN = 20;
        const THUMBNAIL_TOP_PADDING = 16; // Gap between text block and thumbnail
        const DETAILS_X = cursor.margin + THUMBNAIL_SIZE + THUMBNAIL_MARGIN;
        const FINDING_HEIGHT = THUMBNAIL_SIZE + THUMBNAIL_TOP_PADDING + 80; // Space per finding
        const FINDINGS_PER_PAGE = 2;

        for (const detection of includedDetections) {
            // Check if we need a new page (allow space for 2 findings per page)
            const findingsOnPage = (findingIndex - 1) % FINDINGS_PER_PAGE;
            if (findingsOnPage === 0 && findingIndex > 1) {
                cursor.page = pdfDoc.addPage([612, 792]);
                cursor.y = 792 - cursor.margin;
            }
            
            ensureSpace(pdfDoc, cursor, FINDING_HEIGHT);
            
            const photo = state.photos.find((p) => p.id === detection.photoId);
            const confidence = detection.manual ? 'Manual' : (typeof detection.confidence === 'number' ? `${Math.round(detection.confidence * 100)}%` : 'Not recorded');
            const bbox = detection.bbox || {};
            const dims = bbox.width && bbox.height
                ? `${Math.round(bbox.width)} × ${Math.round(bbox.height)} px`
                : 'Not recorded';

            const detectionLabel = detection.manual ? 'Manual Detection' : 'AI Detection';
            const findingTitle = `Finding F-${String(findingIndex).padStart(3, '0')}: ${detection.class || 'Defect'}`;
            
            const findingStartY = cursor.y;
            
            // Title
            const maxDetailWidth = 612 - DETAILS_X - cursor.margin;
            const titleLines = wrapText(findingTitle, fonts.bold, 12, maxDetailWidth);
            titleLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X,
                    y: cursor.y - idx * 14,
                    size: 12,
                    font: fonts.bold,
                    color: rgb(0.1, 0.1, 0.1)
                });
            });
            cursor.y -= titleLines.length * 14;
            
            // Subtitle
            const subtitle = `${detection.area || 'Unknown component'} · ${detectionLabel}`;
            const subtitleLines = wrapText(subtitle, fonts.regular, 10, maxDetailWidth);
            subtitleLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X,
                    y: cursor.y - idx * 12,
                    size: 10,
                    font: fonts.regular,
                    color: rgb(0.4, 0.4, 0.4)
                });
            });
            cursor.y -= subtitleLines.length * 12 + 8;

            // Details on right side
            let detailY = cursor.y;
            
            const detailWidth = maxDetailWidth - 55;
            cursor.page.drawText('Location:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
            const locationLines = wrapText(`${detection.area || 'Area N/A'} · Photo #${detection.photoNumber}`, fonts.regular, 9, detailWidth);
            locationLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X + 55,
                    y: detailY - idx * 12,
                    size: 9,
                    font: fonts.regular,
                    color: rgb(0.1, 0.1, 0.1)
                });
            });
            detailY -= 14;

            cursor.page.drawText('Type:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
            const typeLines = wrapText(detection.class || 'Defect', fonts.regular, 9, detailWidth);
            typeLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X + 55,
                    y: detailY - idx * 12,
                    size: 9,
                    font: fonts.regular,
                    color: rgb(0.1, 0.1, 0.1)
                });
            });
            detailY -= Math.max(typeLines.length, 1) * 12;

            cursor.page.drawText('Dimensions:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
            const dimLines = wrapText(dims, fonts.regular, 9, detailWidth);
            dimLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X + 55,
                    y: detailY - idx * 12,
                    size: 9,
                    font: fonts.regular,
                    color: rgb(0.1, 0.1, 0.1)
                });
            });
            detailY -= Math.max(dimLines.length, 1) * 12;

            const labelWidth = detailWidth;
            if (detection.manual) {
                cursor.page.drawText('Detection:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
                drawWrappedText(cursor.page, 'Manual', DETAILS_X + 55, detailY, {
                    font: fonts.regular,
                    size: 9,
                    color: rgb(0.1, 0.1, 0.1),
                    maxWidth: labelWidth,
                    lineHeight: 12
                });
            } else {
                cursor.page.drawText('Confidence:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
                drawWrappedText(cursor.page, confidence, DETAILS_X + 55, detailY, {
                    font: fonts.regular,
                    size: 9,
                    color: rgb(0.1, 0.1, 0.1),
                    maxWidth: labelWidth,
                    lineHeight: 12
                });
            }
            detailY -= 14;

            cursor.page.drawText('Action:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
            const actionLines = wrapText('Verify and remediate', fonts.regular, 9, labelWidth);
            actionLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X + 55,
                    y: detailY - idx * 12,
                    size: 9,
                    font: fonts.regular,
                    color: rgb(0.1, 0.1, 0.1)
                });
            });

            // Thumbnail on left side
            if (photo?.dataURL) {
                try {
                    const thumbResult = await createCroppedThumbnail(photo.dataURL, detection.bbox, THUMBNAIL_SIZE);
                    const thumbImage = await pdfDoc.embedPng(thumbResult.src);
                    const displayWidth = THUMBNAIL_SIZE;
                    const scale = displayWidth / thumbResult.width;
                    const displayHeight = thumbResult.height * scale;
                    // Place thumbnail below the text block to avoid overlap
                    const thumbY = findingStartY - THUMBNAIL_TOP_PADDING - displayHeight;
                    
                    cursor.page.drawImage(thumbImage, {
                        x: cursor.margin,
                        y: thumbY,
                        width: displayWidth,
                        height: displayHeight
                    });
                } catch (error) {
                    console.error('Failed to embed thumbnail', error);
                }
            }

            // Move cursor down for next finding
            cursor.y = findingStartY - FINDING_HEIGHT;
            findingIndex += 1;
        }
    }

    // ========================================
    // LAST PAGE: FULL RESOLUTION IMAGES (OPTIONAL)
    // ========================================
    
    if (state.report.includeThumbnails && includedDetections.length > 0) {
        cursor.y -= 30;
        ensureSpace(pdfDoc, cursor, 100);
        addSectionTitle('FULL RESOLUTION IMAGES');
        
        // Group detections by photo to avoid duplicates
        const photoMap = new Map();
        includedDetections.forEach((detection) => {
            const photo = state.photos.find((p) => p.id === detection.photoId);
            if (photo && !photoMap.has(photo.id)) {
                photoMap.set(photo.id, { photo, detections: [] });
            }
            if (photo) {
                photoMap.get(photo.id).detections.push(detection);
            }
        });

        const imagesPerPage = 2;
        const imageWidth = (612 - cursor.margin * 3) / 2; // 2 images with margins
        let imagesOnPage = 0;
        let currentX = cursor.margin;
        let currentY = cursor.y;

        for (const [photoId, { photo, detections }] of photoMap) {
            if (imagesOnPage >= imagesPerPage) {
                cursor.page = pdfDoc.addPage([612, 792]);
                cursor.y = 792 - cursor.margin;
                currentY = cursor.y;
                currentX = cursor.margin;
                imagesOnPage = 0;
            }

            try {
                const annotated = await createAnnotatedImage(photo, detections, null);
                const pngImage = await pdfDoc.embedPng(annotated);
                const scale = imageWidth / pngImage.width;
                const displayHeight = pngImage.height * scale;

                // Label
                cursor.page.drawText(`Photo #${photo.number} - ${photo.area || 'Unknown'}`, {
                    x: currentX,
                    y: currentY,
                    size: 10,
                    font: fonts.bold,
                    color: rgb(0.1, 0.1, 0.1)
                });
                currentY -= 16;

                // Image
                cursor.page.drawImage(pngImage, {
                    x: currentX,
                    y: currentY - displayHeight,
                    width: imageWidth,
                    height: displayHeight
                });

                currentX += imageWidth + cursor.margin;
                if (currentX + imageWidth > 612 - cursor.margin) {
                    currentX = cursor.margin;
                    currentY -= displayHeight + 40;
                    imagesOnPage++;
                } else {
                    imagesOnPage++;
                }
            } catch (error) {
                console.error('Failed to embed full resolution image', error);
            }
        }
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

