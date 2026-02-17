import {
    AREAS,
    readState,
    resetState,
    summarizeDetectionsByArea,
    updatePhotoFlaggedNote,
    updateReportOptions,
    saveGeneralNoteToStorage
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

const reportTailNumber = document.getElementById('reportTailNumber');
const totalPhotosEl = document.getElementById('totalPhotos');
const totalDetectionsEl = document.getElementById('totalDetections');
const areasInspectedEl = document.getElementById('areasInspected');
const thumbnailToggle = document.getElementById('thumbnailToggle');
const falsePositiveToggle = document.getElementById('falsePositiveToggle');
const allPhotosToggle = document.getElementById('allPhotosToggle');
const flaggedImagesToggle = document.getElementById('flaggedImagesToggle');
const flaggedImageNotesToggle = document.getElementById('flaggedImageNotesToggle');
const reportNotesEl = document.getElementById('reportNotes');
const flaggedImagesList = document.getElementById('flaggedImagesList');
const flaggedImagesNotesSection = document.getElementById('flaggedImagesNotesSection');
const logoBtn = document.getElementById('logoBtn');
const backToResultsBtn = document.getElementById('backToResultsBtn');
const downloadReportBtn = document.getElementById('downloadReportBtn');
const submitInspectionBtn = document.getElementById('submitInspectionBtn');

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
        // Manual detections are always included
        if (detection.manual) return true;
        // For confidence-based filtering: only include detections with valid confidence >= threshold
        if (typeof detection.confidence === 'number') {
            return detection.confidence >= state.analysis.threshold;
        }
        // Exclude detections without valid confidence values
        return false;
    }).length;

const renderSummary = () => {
    const state = readState();
    const tagged = state.photos.filter((photo) => Boolean(photo.area));
    const inspectedAreas = new Set(tagged.map((photo) => photo.area));
    const detectionCount = computeDetectionTotals(state, state.report.includeFalsePositives);

    if (reportTailNumber) {
        const tailNumber = state.inspection.tailNumber || '--';
        reportTailNumber.textContent = `Tail ${tailNumber}`;
    }
    if (totalPhotosEl) {
        totalPhotosEl.textContent = tagged.length.toString();
    }
    if (totalDetectionsEl) {
        totalDetectionsEl.textContent = detectionCount.toString();
    }
    if (areasInspectedEl) {
        areasInspectedEl.textContent = inspectedAreas.size.toString();
    }

    // Update toggles
    if (thumbnailToggle) {
        thumbnailToggle.checked = state.report.includeThumbnails;
    }
    if (falsePositiveToggle) {
        falsePositiveToggle.checked = state.report.includeFalsePositives;
    }
    if (allPhotosToggle) {
        allPhotosToggle.checked = state.report.includeAllPhotos;
    }
    if (flaggedImagesToggle) {
        flaggedImagesToggle.checked = state.report.includeFlaggedImages;
    }
    if (flaggedImageNotesToggle) {
        flaggedImageNotesToggle.checked = state.report.includeFlaggedImageNotes;
    }
    if (reportNotesEl) {
        reportNotesEl.value = state.report.notes || '';
    }
    
    // Render flagged images with notes
    renderFlaggedImagesNotes();
};

const renderFlaggedImagesNotes = () => {
    const state = readState();
    const flaggedPhotos = state.photos.filter((photo) => photo.flagged);
    
    if (!flaggedImagesList || !flaggedImagesNotesSection) return;
    
    // Show/hide section based on whether there are flagged images
    if (flaggedPhotos.length === 0) {
        flaggedImagesNotesSection.style.display = 'none';
        return;
    }
    
    flaggedImagesNotesSection.style.display = 'block';
    flaggedImagesList.innerHTML = '';
    
    flaggedPhotos.forEach((photo) => {
        const item = document.createElement('div');
        item.className = 'flagged-image-item';
        item.dataset.photoId = photo.id;
        
        const header = document.createElement('div');
        header.className = 'flagged-image-header';
        
        const title = document.createElement('h4');
        title.className = 'flagged-image-title';
        title.textContent = `Photo #${photo.number} - ${photo.area || 'Unknown Area'}`;
        header.appendChild(title);
        
        // Thumbnail preview
        const thumbnail = document.createElement('div');
        thumbnail.className = 'flagged-image-thumbnail';
        const img = document.createElement('img');
        img.src = photo.dataURL;
        img.alt = `Photo #${photo.number}`;
        img.style.maxWidth = '120px';
        img.style.maxHeight = '120px';
        img.style.objectFit = 'contain';
        img.style.borderRadius = '4px';
        img.style.border = '1px solid rgba(0, 0, 0, 0.1)';
        thumbnail.appendChild(img);
        
        const content = document.createElement('div');
        content.className = 'flagged-image-content';
        
        const noteLabel = document.createElement('label');
        noteLabel.className = 'flagged-image-note-label';
        noteLabel.textContent = 'Note:';
        noteLabel.setAttribute('for', `flagged-note-${photo.id}`);
        
        const noteInput = document.createElement('textarea');
        noteInput.id = `flagged-note-${photo.id}`;
        noteInput.className = 'flagged-image-note-input';
        noteInput.placeholder = 'Add a note about this flagged image...';
        noteInput.rows = 3;
        noteInput.value = photo.flaggedNote || '';
        
        // Update note on input
        noteInput.addEventListener('input', (event) => {
            updatePhotoFlaggedNote(photo.id, event.target.value);
        });
        
        content.appendChild(noteLabel);
        content.appendChild(noteInput);
        
        item.appendChild(header);
        item.appendChild(thumbnail);
        item.appendChild(content);
        flaggedImagesList.appendChild(item);
    });
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

    cursor.y -= 6;
    addSectionTitle('NOTES');
    const notesText = (state.report.notes || '').trim() || 'None';
    ensureSpace(pdfDoc, cursor, 80);
    const notesMaxWidth = 612 - cursor.margin * 2;
    const notesLineHeight = 14;
    const notesLineCount = drawWrappedText(cursor.page, notesText, cursor.margin, cursor.y, {
        font: fonts.regular,
        size: 12,
        color: rgb(0.1, 0.1, 0.1),
        maxWidth: notesMaxWidth,
        lineHeight: notesLineHeight
    });
    cursor.y -= notesLineCount * notesLineHeight;

    // ========================================
    // FLAGGED IMAGES SECTION (if enabled)
    // ========================================
    if (state.report.includeFlaggedImages) {
        const flaggedPhotos = state.photos.filter((photo) => photo.flagged);
        if (flaggedPhotos.length > 0) {
            cursor.y -= 20;
            ensureSpace(pdfDoc, cursor, 100);
            addSectionTitle('FLAGGED IMAGES - DEFECTS REQUIRING ATTENTION');
            
            const imagesPerPage = 2;
            const imageWidth = (612 - cursor.margin * 3) / 2; // 2 images with margins
            let imagesOnPage = 0;
            let currentX = cursor.margin;
            let currentY = cursor.y;
            let lastDisplayHeight = 0;
            
            for (const photo of flaggedPhotos) {
                if (imagesOnPage >= imagesPerPage) {
                    cursor.page = pdfDoc.addPage([612, 792]);
                    cursor.y = 792 - cursor.margin;
                    currentY = cursor.y;
                    currentX = cursor.margin;
                    imagesOnPage = 0;
                }
                
                try {
                    // Get detections for this photo
                    const photoDetections = includedDetections.filter((det) => det.photoId === photo.id);
                    const annotated = await createAnnotatedImage(photo, photoDetections, null);
                    const pngImage = await pdfDoc.embedPng(annotated);
                    const scale = imageWidth / pngImage.width;
                    const displayHeight = pngImage.height * scale;
                    lastDisplayHeight = displayHeight;
                    
                    // Ensure we have space for the image
                    if (currentY - displayHeight - 30 < cursor.margin) {
                        cursor.page = pdfDoc.addPage([612, 792]);
                        cursor.y = 792 - cursor.margin;
                        currentY = cursor.y;
                        currentX = cursor.margin;
                        imagesOnPage = 0;
                    }
                    
                    // Label
                    cursor.page.drawText(`Flagged Image - Photo #${photo.number} - ${photo.area || 'Unknown'}`, {
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
                    
                    // Add note if enabled and note exists
                    let noteHeight = 0;
                    if (state.report.includeFlaggedImageNotes && photo.flaggedNote && photo.flaggedNote.trim()) {
                        const noteY = currentY - displayHeight - 8;
                        const noteText = `Note: ${photo.flaggedNote.trim()}`;
                        const noteMaxWidth = imageWidth;
                        const noteLines = wrapText(noteText, fonts.regular, 9, noteMaxWidth);
                        noteHeight = noteLines.length * 11 + 4;
                        
                        // Ensure we have space for the note
                        if (noteY - noteHeight < cursor.margin) {
                            cursor.page = pdfDoc.addPage([612, 792]);
                            cursor.y = 792 - cursor.margin;
                            currentY = cursor.y;
                            currentX = cursor.margin;
                            imagesOnPage = 0;
                            // Redraw label and image on new page
                            cursor.page.drawText(`Flagged Image - Photo #${photo.number} - ${photo.area || 'Unknown'}`, {
                                x: currentX,
                                y: currentY,
                                size: 10,
                                font: fonts.bold,
                                color: rgb(0.1, 0.1, 0.1)
                            });
                            currentY -= 16;
                            cursor.page.drawImage(pngImage, {
                                x: currentX,
                                y: currentY - displayHeight,
                                width: imageWidth,
                                height: displayHeight
                            });
                        }
                        
                        // Draw note below image
                        const finalNoteY = currentY - displayHeight - 8;
                        noteLines.forEach((line, idx) => {
                            cursor.page.drawText(line, {
                                x: currentX,
                                y: finalNoteY - idx * 11,
                                size: 9,
                                font: fonts.regular,
                                color: rgb(0.1, 0.1, 0.1)
                            });
                        });
                    }
                    
                    currentX += imageWidth + cursor.margin;
                    if (currentX + imageWidth > 612 - cursor.margin) {
                        currentX = cursor.margin;
                        currentY -= displayHeight + noteHeight + 40;
                        imagesOnPage++;
                    } else {
                        imagesOnPage++;
                    }
                    
                    // Update cursor position
                    if (currentX === cursor.margin) {
                        cursor.y = currentY;
                    }
                } catch (error) {
                    console.error('Failed to embed flagged image', error);
                }
            }
            
            // Update cursor after flagged images section
            if (currentX === cursor.margin) {
                cursor.y = currentY;
            } else {
                cursor.y = currentY - lastDisplayHeight - 40;
            }
            cursor.y -= 20;
        }
    }

    cursor.y -= 12;
    addSectionTitle('AIRCRAFT SECTIONING FOR INSPECTION PROCESS');
    
    // Section color legend
    ensureSpace(pdfDoc, cursor, 150);
    cursor.page.drawText('Section Color Legend:', { 
        x: cursor.margin, 
        y: cursor.y, 
        size: 12, 
        font: fonts.bold, 
        color: rgb(0.1, 0.1, 0.1) 
    });
    cursor.y -= 18;
    
    // Color legend entries with exact hex values
    const sectionColors = [
        { name: 'FWD Fuselage', color: [20, 184, 166] },   // Teal #14B8A6
        { name: 'MID Fuselage', color: [16, 185, 129] },   // Green #10B981
        { name: 'Wings', color: [59, 130, 246] },          // Blue #3B82F6
        { name: 'AFT Fuselage', color: [239, 68, 68] },    // Red #EF4444
        { name: 'Engines', color: [168, 85, 247] },        // Purple #A855F7
        { name: 'Vertical Stabilizer', color: [249, 115, 22] }, // Orange #F97316
        { name: 'Horizontal Stabilizer', color: [234, 179, 8] } // Yellow #EAB308
    ];
    
    let legendX = cursor.margin;
    let legendY = cursor.y;
    const legendLineHeight = 16;
    const legendBoxSize = 20; // Increased to 20px
    const legendSpacing = 8; // Space between entries
    const itemsPerRow = 3;
    const itemWidth = 180; // Width per item including box and text
    
    sectionColors.forEach((section, idx) => {
        if (idx > 0 && idx % itemsPerRow === 0) {
            legendY -= legendLineHeight + 4;
            legendX = cursor.margin;
        }
        
        // Color box (20x20px)
        cursor.page.drawRectangle({
            x: legendX,
            y: legendY - legendBoxSize,
            width: legendBoxSize,
            height: legendBoxSize,
            color: rgb(
                section.color[0] / 255,
                section.color[1] / 255,
                section.color[2] / 255
            ),
            borderColor: rgb(0.1, 0.1, 0.1),
            borderWidth: 0.5
        });
        
        // Section name
        cursor.page.drawText(section.name, {
            x: legendX + legendBoxSize + 8,
            y: legendY - 2,
            size: 9,
            font: fonts.regular,
            color: rgb(0.1, 0.1, 0.1)
        });
        
        legendX += itemWidth;
    });
    
    cursor.y = legendY - legendLineHeight - 20;
    
    // Technical reference views
    ensureSpace(pdfDoc, cursor, 200);
    cursor.page.drawText('Technical Reference Views:', {
        x: cursor.margin,
        y: cursor.y,
        size: 12,
        font: fonts.bold,
        color: rgb(0.1, 0.1, 0.1)
    });
    cursor.y -= 18;
    
    // Try to capture 3D views - wait for viewer to be ready
    let technicalViews = { top: null, side: null, front: null };
    
    // Wait for 3D viewer functions to be available (they're loaded as a module)
    let attempts = 0;
    const maxAttempts = 50; // Wait up to 5 seconds
    while (typeof window === 'undefined' || 
           (!window.captureTechnicalViewsWithWait && !window.captureTechnicalViews) && 
           attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }
    
    console.log('Checking for 3D capture functions:', {
        hasCaptureTechnicalViewsWithWait: typeof window !== 'undefined' && !!window.captureTechnicalViewsWithWait,
        hasCaptureTechnicalViews: typeof window !== 'undefined' && !!window.captureTechnicalViews,
        attempts: attempts
    });
    
    if (typeof window !== 'undefined' && window.captureTechnicalViewsWithWait) {
        try {
            console.log('Attempting to capture 3D technical views for PDF using captureTechnicalViewsWithWait...');
            technicalViews = await window.captureTechnicalViewsWithWait();
            console.log('3D views captured:', {
                top: !!technicalViews.top,
                side: !!technicalViews.side,
                front: !!technicalViews.front,
                topLength: technicalViews.top ? technicalViews.top.length : 0,
                sideLength: technicalViews.side ? technicalViews.side.length : 0,
                frontLength: technicalViews.front ? technicalViews.front.length : 0
            });
        } catch (error) {
            console.error('Failed to capture technical views with wait:', error);
            // Fallback to regular capture if available
            if (window.captureTechnicalViews) {
                try {
                    console.log('Trying fallback capture...');
                    technicalViews = await window.captureTechnicalViews();
                    console.log('Fallback capture result:', {
                        top: !!technicalViews.top,
                        side: !!technicalViews.side,
                        front: !!technicalViews.front
                    });
                } catch (fallbackError) {
                    console.error('Fallback capture also failed:', fallbackError);
                }
            }
        }
    } else if (typeof window !== 'undefined' && window.captureTechnicalViews) {
        // Fallback to regular capture
        try {
            console.log('Using regular captureTechnicalViews (no wait function available)...');
            technicalViews = await window.captureTechnicalViews();
            console.log('Regular capture result:', {
                top: !!technicalViews.top,
                side: !!technicalViews.side,
                front: !!technicalViews.front
            });
        } catch (error) {
            console.error('Failed to capture technical views:', error);
        }
    } else {
        console.warn('No 3D capture functions available on window object');
    }
    
    // Display views with proper aspect ratio and spacing
    // Total available width: 512px (612 - 50 margin on each side)
    // Three views with 20px gaps: (512 - 40) / 3 = ~157px per view
    const viewSpacing = 20;
    const availableWidth = 512; // 612 - cursor.margin * 2
    const viewWidth = Math.floor((availableWidth - (viewSpacing * 2)) / 3); // ~157px
    const viewsPerRow = 3;
    const totalViewsWidth = (viewWidth * viewsPerRow) + (viewSpacing * (viewsPerRow - 1));
    const startX = cursor.margin + (612 - cursor.margin * 2 - totalViewsWidth) / 2;
    
    const views = [
        { key: 'top', label: 'Top View', dataUrl: technicalViews.top },
        { key: 'side', label: 'Side View', dataUrl: technicalViews.side },
        { key: 'front', label: 'Front View', dataUrl: technicalViews.front }
    ];
    
    let currentX = startX;
    const viewsStartY = cursor.y;
    let maxViewHeight = 0;
    
    // First pass: embed images and calculate heights while maintaining aspect ratio
    const viewData = [];
    for (let i = 0; i < views.length; i++) {
        const view = views[i];
        
        try {
            if (view.dataUrl) {
                // Embed screenshot and get dimensions
                const viewImage = await pdfDoc.embedPng(view.dataUrl);
                const imageDims = viewImage.scale(1);
                const imageAspectRatio = imageDims.height / imageDims.width;
                const displayHeight = viewWidth * imageAspectRatio;
                
                viewData.push({
                    image: viewImage,
                    width: viewWidth,
                    height: displayHeight,
                    label: view.label,
                    hasImage: true
                });
                
                maxViewHeight = Math.max(maxViewHeight, displayHeight);
            } else {
                // Placeholder rectangle
                const placeholderHeight = viewWidth * 0.75; // 3:4 aspect ratio placeholder
                viewData.push({
                    image: null,
                    width: viewWidth,
                    height: placeholderHeight,
                    label: view.label,
                    hasImage: false
                });
                maxViewHeight = Math.max(maxViewHeight, placeholderHeight);
            }
        } catch (error) {
            console.error(`Failed to embed ${view.key} view:`, error);
            const placeholderHeight = viewWidth * 0.75;
            viewData.push({
                image: null,
                width: viewWidth,
                height: placeholderHeight,
                label: view.label,
                hasImage: false
            });
            maxViewHeight = Math.max(maxViewHeight, placeholderHeight);
        }
    }
    
    // Second pass: draw all views aligned to top
    currentX = startX;
    for (let i = 0; i < viewData.length; i++) {
        const view = viewData[i];
        const viewY = viewsStartY - view.height;
        
        if (view.hasImage && view.image) {
            // Draw image maintaining aspect ratio
            cursor.page.drawImage(view.image, {
                x: currentX,
                y: viewY,
                width: view.width,
                height: view.height
            });
        } else {
            // Draw placeholder
            cursor.page.drawRectangle({
                x: currentX,
                y: viewY,
                width: view.width,
                height: view.height,
                borderColor: rgb(0.8, 0.8, 0.8),
                borderWidth: 1
            });
            const placeholderText = wrapText('View not available', fonts.regular, 9, view.width - 10);
            drawWrappedText(cursor.page, placeholderText.join(' '), currentX + 5, viewY + view.height / 2, {
                font: fonts.regular,
                size: 9,
                color: rgb(0.5, 0.5, 0.5),
                maxWidth: view.width - 10,
                lineHeight: 12
            });
        }
        
        // View label centered below image
        const labelWidth = fonts.regular.widthOfTextAtSize(view.label, 10);
        cursor.page.drawText(view.label, {
            x: currentX + (view.width - labelWidth) / 2,
            y: viewY - 14,
            size: 10,
            font: fonts.bold,
            color: rgb(0.1, 0.1, 0.1)
        });
        
        currentX += view.width + viewSpacing;
    }
    
    cursor.y = viewsStartY - maxViewHeight - 40;
    
    // Heat mapping legend
    ensureSpace(pdfDoc, cursor, 50);
    cursor.page.drawText('Heat Mapping Legend:', {
        x: cursor.margin,
        y: cursor.y,
        size: 10,
        font: fonts.bold,
        color: rgb(0.1, 0.1, 0.1)
    });
    cursor.y -= 14;
    
    const heatLegendText = 'Color intensity indicates defect concentration: White = 0 defects, Yellow-Orange gradient = 1-9 defects, Bright Red = 10+ defects. Heat mapping is overlaid on each section\'s designated color (Teal FWD, Green MID, Blue Wings, Red AFT, Purple Engines, Orange Vertical Stabilizer, Yellow Horizontal Stabilizer). Only inspected sections display color-coding; uninspected areas appear in neutral gray.';
    const heatLegendLines = wrapText(heatLegendText, fonts.regular, 9, 612 - cursor.margin * 2);
    heatLegendLines.forEach((line, idx) => {
        cursor.page.drawText(line, {
            x: cursor.margin,
            y: cursor.y - idx * 12,
            size: 9,
            font: fonts.regular,
            color: rgb(0.1, 0.1, 0.1)
        });
    });
    cursor.y -= heatLegendLines.length * 12 + 12;

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
        const THUMBNAIL_MAX_HEIGHT = 120; // Maximum thumbnail height
        const THUMBNAIL_WIDTH = 140; // Base width for thumbnail area calculation
        const THUMBNAIL_MARGIN = 18; // Gap between thumbnail and detail text (15-20px)
        const DETAILS_X = cursor.margin + THUMBNAIL_WIDTH + THUMBNAIL_MARGIN;
        const FINDING_HEIGHT = 175; // Compact: ~25px title/subtitle + ~120px content + ~30px spacing
        const FINDINGS_PER_PAGE = 4; // Target 3-4 findings per page

        for (const detection of includedDetections) {
            // Check if we need a new page (target 3-4 findings per page)
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
            const maxDetailWidth = 612 - DETAILS_X - cursor.margin;
            
            // Title and Subtitle on right side (detail area), spanning down
            // Title - draw at top, then move down
            const titleLines = wrapText(findingTitle, fonts.bold, 12, maxDetailWidth);
            const titleY = cursor.y;
            titleLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X,
                    y: titleY - idx * 14,
                    size: 12,
                    font: fonts.bold,
                    color: rgb(0.1, 0.1, 0.1)
                });
            });
            const titleHeight = titleLines.length * 14;
            const titleBottom = titleY - titleHeight;
            cursor.y = titleBottom - 4; // 4px gap after title
            
            // Subtitle - draw below title, then move down
            const subtitle = `${detection.area || 'Unknown component'} · ${detectionLabel}`;
            const subtitleLines = wrapText(subtitle, fonts.regular, 10, maxDetailWidth);
            const subtitleY = cursor.y;
            subtitleLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X,
                    y: subtitleY - idx * 12,
                    size: 10,
                    font: fonts.regular,
                    color: rgb(0.4, 0.4, 0.4)
                });
            });
            const subtitleHeight = subtitleLines.length * 12;
            const subtitleBottom = subtitleY - subtitleHeight;
            cursor.y = subtitleBottom - 8; // 8px gap after subtitle

            // Details start below subtitle - thumbnail aligns with details top
            // This is where both thumbnail and details should start (after title/subtitle)
            const thumbnailAndDetailsStartY = subtitleBottom - 8; // Start details after subtitle gap
            let detailY = thumbnailAndDetailsStartY; // Start details at this position
            
            const detailWidth = maxDetailWidth - 55;
            // Detail fields with compact 11px line spacing
            cursor.page.drawText('Location:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
            const locationLines = wrapText(`${detection.area || 'Area N/A'} · Photo #${detection.photoNumber}`, fonts.regular, 9, detailWidth);
            locationLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X + 55,
                    y: detailY - idx * 11,
                    size: 9,
                    font: fonts.regular,
                    color: rgb(0.1, 0.1, 0.1)
                });
            });
            detailY -= Math.max(locationLines.length, 1) * 11;

            cursor.page.drawText('Type:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
            const typeLines = wrapText(detection.class || 'Defect', fonts.regular, 9, detailWidth);
            typeLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X + 55,
                    y: detailY - idx * 11,
                    size: 9,
                    font: fonts.regular,
                    color: rgb(0.1, 0.1, 0.1)
                });
            });
            detailY -= Math.max(typeLines.length, 1) * 11;

            cursor.page.drawText('Dimensions:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
            const dimLines = wrapText(dims, fonts.regular, 9, detailWidth);
            dimLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X + 55,
                    y: detailY - idx * 11,
                    size: 9,
                    font: fonts.regular,
                    color: rgb(0.1, 0.1, 0.1)
                });
            });
            detailY -= Math.max(dimLines.length, 1) * 11;

            const labelWidth = detailWidth;
            if (detection.manual) {
                cursor.page.drawText('Detection:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
                const manualLines = drawWrappedText(cursor.page, 'Manual', DETAILS_X + 55, detailY, {
                    font: fonts.regular,
                    size: 9,
                    color: rgb(0.1, 0.1, 0.1),
                    maxWidth: labelWidth,
                    lineHeight: 11
                });
                detailY -= Math.max(manualLines, 1) * 11; // Move down by actual lines drawn
            } else {
                cursor.page.drawText('Confidence:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
                const confidenceLines = drawWrappedText(cursor.page, confidence, DETAILS_X + 55, detailY, {
                    font: fonts.regular,
                    size: 9,
                    color: rgb(0.1, 0.1, 0.1),
                    maxWidth: labelWidth,
                    lineHeight: 11
                });
                detailY -= Math.max(confidenceLines, 1) * 11; // Move down by actual lines drawn
            }

            cursor.page.drawText('Action:', { x: DETAILS_X, y: detailY, size: 9, font: fonts.bold, color: rgb(0.1, 0.1, 0.1) });
            const actionLines = wrapText('Verify and remediate', fonts.regular, 9, labelWidth);
            actionLines.forEach((line, idx) => {
                cursor.page.drawText(line, {
                    x: DETAILS_X + 55,
                    y: detailY - idx * 11,
                    size: 9,
                    font: fonts.regular,
                    color: rgb(0.1, 0.1, 0.1)
                });
            });
            detailY -= Math.max(actionLines.length, 1) * 11; // Move down after action lines

            // Calculate bottom of details section for cursor positioning
            const detailsBottom = detailY;
            
            // Thumbnail on left side - aligned top with detail fields
            let thumbnailBottom = findingStartY; // Default if no thumbnail
            if (photo?.dataURL) {
                try {
                    const thumbResult = await createCroppedThumbnail(photo.dataURL, detection.bbox, THUMBNAIL_MAX_HEIGHT);
                    const thumbImage = await pdfDoc.embedPng(thumbResult.src);
                    // Scale thumbnail to fit max height while maintaining aspect ratio
                    const aspectRatio = thumbResult.width / thumbResult.height;
                    let displayHeight = thumbResult.height;
                    let displayWidth = thumbResult.width;
                    
                    // Constrain to maximum height
                    if (displayHeight > THUMBNAIL_MAX_HEIGHT) {
                        displayHeight = THUMBNAIL_MAX_HEIGHT;
                        displayWidth = displayHeight * aspectRatio;
                    }
                    
                    // Ensure width doesn't exceed allocated space
                    if (displayWidth > THUMBNAIL_WIDTH) {
                        displayWidth = THUMBNAIL_WIDTH;
                        displayHeight = displayWidth / aspectRatio;
                    }
                    
                    // Place thumbnail aligned with detail fields (top aligned at thumbnailAndDetailsStartY)
                    const thumbY = thumbnailAndDetailsStartY - displayHeight;
                    
                    cursor.page.drawImage(thumbImage, {
                        x: cursor.margin,
                        y: thumbY,
                        width: displayWidth,
                        height: displayHeight
                    });
                    
                    // Track thumbnail bottom for cursor positioning
                    thumbnailBottom = thumbY;
                } catch (error) {
                    console.error('Failed to embed thumbnail', error);
                }
            }

            // Move cursor down for next finding
            // Use the lower of: details bottom or thumbnail bottom
            const findingBottom = Math.min(detailsBottom, thumbnailBottom);
            cursor.y = findingBottom - 30; // 30px gap before next finding
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

// Export generatePdf for use in other modules
export { generatePdf };

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

flaggedImagesToggle?.addEventListener('change', (event) => {
    updateReportOptions({ includeFlaggedImages: event.target.checked });
    renderSummary();
});

flaggedImageNotesToggle?.addEventListener('change', (event) => {
    updateReportOptions({ includeFlaggedImageNotes: event.target.checked });
    renderSummary();
});

reportNotesEl?.addEventListener('input', () => {
    updateReportOptions({ notes: reportNotesEl.value });
});

// Save note only when user leaves the field (blur event) to prevent duplicates
// Using a debounce mechanism to avoid saving multiple times
let saveNoteTimeout = null;
reportNotesEl?.addEventListener('blur', () => {
    // Clear any pending save
    if (saveNoteTimeout) {
        clearTimeout(saveNoteTimeout);
    }
    
    // Save after a short delay to ensure we have the final value
    saveNoteTimeout = setTimeout(() => {
        const state = readState();
        if (reportNotesEl.value && reportNotesEl.value.trim()) {
            const inspectionContext = state.inspection ? {
                tailNumber: state.inspection.tailNumber || '',
                inspectionType: state.inspection.inspectionType || '',
                inspectorName: state.inspection.inspectorName || '',
                startedAt: state.inspection.startedAt || null
            } : null;
            saveGeneralNoteToStorage(reportNotesEl.value.trim(), inspectionContext);
        }
    }, 100);
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

const initialState = ensureAnalysisComplete();
if (initialState) {
    renderSummary();
}

