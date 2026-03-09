/**
 * Export inspection images and annotations as a ZIP for Roboflow.
 * Single JSON describes all images. User chooses _annotations.json or COCO-style.
 * Includes section (area) per image. No AI vs manual distinction in output.
 */
import { readState, getThresholdForPhoto } from './state.js';

function filterIncludedDetections(state) {
    return state.detections.filter((detection) => {
        if (detection.falsePositive) return false;
        if (detection.manual) return true;
        if (typeof detection.confidence === 'number') {
            const threshold = getThresholdForPhoto(state, detection.photoId);
            if (detection.confidence < threshold) return false;
        }
        return true;
    });
}

/** Convert app bbox (centerX, centerY, width, height) to [x_min, y_min, width, height] in pixels. */
function bboxToXYWH(bbox, imageWidth, imageHeight) {
    const w = bbox.width ?? bbox.w ?? 0;
    const h = bbox.height ?? bbox.h ?? 0;
    const cx = bbox.centerX ?? bbox.x ?? 0;
    const cy = bbox.centerY ?? bbox.y ?? 0;
    const x = Math.max(0, cx - w / 2);
    const y = Math.max(0, cy - h / 2);
    const iw = bbox.imageWidth ?? imageWidth ?? 1;
    const ih = bbox.imageHeight ?? imageHeight ?? 1;
    return {
        x_min: Math.round(x),
        y_min: Math.round(y),
        width: Math.round(w),
        height: Math.round(h),
        imageWidth: iw,
        imageHeight: ih
    };
}

/**
 * Build _annotations.json: one object per image with file, dimensions, section, annotations.
 */
function buildAnnotationsJson(photoEntries) {
    const images = photoEntries.map((entry) => ({
        file: entry.fileName,
        width: entry.width,
        height: entry.height,
        section: entry.section || '',
        annotations: entry.annotations.map((a) => ({
            class: a.class,
            bbox: [a.x_min, a.y_min, a.width, a.height]
        }))
    }));
    return { images };
}

/**
 * Build COCO-style JSON: images[], annotations[], categories[].
 */
function buildCocoJson(photoEntries) {
    const classSet = new Set();
    photoEntries.forEach((e) => e.annotations.forEach((a) => classSet.add(a.class)));
    const categories = Array.from(classSet).sort().map((name, i) => ({ id: i + 1, name }));
    const nameToId = Object.fromEntries(categories.map((c) => [c.name, c.id]));

    const images = [];
    const annotations = [];
    let annId = 1;

    photoEntries.forEach((entry, imageIndex) => {
        const imageId = imageIndex + 1;
        images.push({
            id: imageId,
            file_name: entry.fileName,
            width: entry.width,
            height: entry.height,
            section: entry.section || ''
        });
        entry.annotations.forEach((a) => {
            annotations.push({
                id: annId++,
                image_id: imageId,
                category_id: nameToId[a.class] ?? 1,
                bbox: [a.x_min, a.y_min, a.width, a.height],
                area: a.width * a.height,
                segmentation: [],
                iscrowd: 0
            });
        });
    });

    return {
        info: { description: 'SpecScan inspection export for Roboflow' },
        images,
        annotations,
        categories
    };
}

const cachedDimensions = new Map();
function getImageDimensionsFromDataURL(dataURL) {
    const c = cachedDimensions.get(dataURL);
    if (c) return c;
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const r = { width: img.naturalWidth, height: img.naturalHeight };
            cachedDimensions.set(dataURL, r);
            resolve(r);
        };
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = dataURL;
    });
}

/**
 * Build photo entries with resolved dimensions (async).
 */
async function buildPhotoEntriesAsync(state, includedDetections) {
    const byPhoto = new Map();
    includedDetections.forEach((det) => {
        if (!byPhoto.has(det.photoId)) byPhoto.set(det.photoId, []);
        byPhoto.get(det.photoId).push(det);
    });

    const entries = [];
    let index = 0;
    for (const photo of state.photos) {
        const dets = byPhoto.get(photo.id);
        if (!dets?.length || !photo.dataURL) continue;
        const { width: imageWidth, height: imageHeight } = await getImageDimensionsFromDataURL(photo.dataURL);
        const ext = photo.name?.match(/\.(jpe?g|png|webp)$/i)?.[1]?.toLowerCase() || 'jpg';
        const fileName = `image_${String(++index).padStart(4, '0')}.${ext}`;
        const annotations = dets.map((det) => {
            const b = bboxToXYWH(det.bbox || {}, imageWidth, imageHeight);
            return {
                class: det.class || 'Defect',
                x_min: b.x_min,
                y_min: b.y_min,
                width: b.width,
                height: b.height
            };
        });
        entries.push({
            photo,
            fileName,
            width: imageWidth,
            height: imageHeight,
            section: photo.area || '',
            annotations
        });
    }
    return entries;
}

/**
 * Export dataset as a ZIP. format: 'annotations' | 'coco'
 */
export async function exportRoboflowZip(format) {
    const state = readState();
    const included = filterIncludedDetections(state);
    if (!included.length) {
        return { ok: false, message: 'No included detections to export.' };
    }

    const photoEntries = await buildPhotoEntriesAsync(state, included);
    if (!photoEntries.length) {
        return { ok: false, message: 'No images with detections to export.' };
    }

    const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
    const zip = new JSZip();

    for (const entry of photoEntries) {
        const base64 = entry.photo.dataURL.split(',')[1];
        if (base64) zip.file(entry.fileName, base64, { base64: true });
    }

    const jsonFileName = format === 'coco' ? 'coco_annotations.json' : '_annotations.json';
    const jsonContent = format === 'coco'
        ? JSON.stringify(buildCocoJson(photoEntries), null, 2)
        : JSON.stringify(buildAnnotationsJson(photoEntries), null, 2);
    zip.file(jsonFileName, jsonContent);

    const tail = (state.inspection.tailNumber || 'export').replace(/[^A-Za-z0-9]/g, '_').slice(0, 20);
    const zipFileName = `roboflow_dataset_${tail}_${Date.now()}.zip`;

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = zipFileName;
    a.click();
    URL.revokeObjectURL(url);

    return { ok: true, message: 'Dataset downloaded.', zipFileName };
}
