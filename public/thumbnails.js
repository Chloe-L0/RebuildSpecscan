const THUMBNAIL_HEIGHT = 140;

const clampNumber = (value, min, max) => {
    if (Number.isNaN(value)) return min;
    if (value < min) return min;
    if (value > max) return max;
    return value;
};

// Shared thumbnail generator used by UI and PDF
export const createCroppedThumbnail = (dataURL, bbox, targetHeight = THUMBNAIL_HEIGHT) =>
    new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
            const imageWidth = image.naturalWidth || image.width;
            const imageHeight = image.naturalHeight || image.height;
            const width = bbox?.width ?? bbox?.w ?? null;
            const height = bbox?.height ?? bbox?.h ?? null;
            const centerX = bbox?.centerX ?? bbox?.x ?? null;
            const centerY = bbox?.centerY ?? bbox?.y ?? null;

            if (!width || !height || !centerX || !centerY || !imageWidth || !imageHeight) {
                resolve({ src: dataURL, width: targetHeight, height: targetHeight });
                return;
            }

            const cropWidth = Math.max(width, imageWidth * 0.08);
            const cropHeight = Math.max(height, imageHeight * 0.08);
            const cropLeft = clampNumber(centerX - cropWidth / 2, 0, imageWidth - cropWidth);
            const cropTop = clampNumber(centerY - cropHeight / 2, 0, imageHeight - cropHeight);

            const scale = targetHeight / cropHeight;
            const targetWidth = clampNumber(Math.round(cropWidth * scale), targetHeight * 0.6, targetHeight * 2.2);

            const canvas = document.createElement('canvas');
            canvas.width = Math.round(targetWidth);
            canvas.height = Math.round(targetHeight);
            const ctx = canvas.getContext('2d', { alpha: true });
            if (!ctx) {
                resolve({ src: dataURL, width: targetWidth, height: targetHeight });
                return;
            }
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(
                image,
                cropLeft,
                cropTop,
                cropWidth,
                cropHeight,
                0,
                0,
                canvas.width,
                canvas.height
            );
            resolve({ src: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height });
        };
        image.onerror = reject;
        image.src = dataURL;
    });

export { THUMBNAIL_HEIGHT };

