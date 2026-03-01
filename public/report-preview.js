/**
 * PDF preview for Export Report page: renders PDF blob to canvases, page navigation, scroll-to-finding.
 */
import { generatePdf } from './report.js';

const reportPreviewPages = document.getElementById('reportPreviewPages');
const reportPreviewLoading = document.getElementById('reportPreviewLoading');
const reportPreviewPagination = document.getElementById('reportPreviewPagination');
const reportPreviewWrap = document.getElementById('reportPreviewWrap');
const reportPreviewPending = document.getElementById('reportPreviewPending');

let lastRendered = { blob: null, pageCount: 0, findingPages: [], pageHeightPx: 992 };
const PREVIEW_DEBOUNCE_MS = 3500;
let previewDebounceTimer = null;

/** Render PDF blob into a container (default: reportPreviewPages). Returns new pageHeightPx from first page. */
async function renderPdfToCanvases(blob, pageCount, targetContainer) {
    const container = targetContainer || reportPreviewPages;
    if (!container || !blob) return null;
    const pdfjsLib = window['pdfjsLib'] || window.pdfjsLib;
    if (!pdfjsLib) {
        if (container === reportPreviewPages) {
            reportPreviewPages.innerHTML = '<p class="muted">PDF preview unavailable (PDF.js not loaded).</p>';
        }
        return null;
    }
    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    const arrayBuffer = await blob.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdf.numPages;
    let firstPageHeight = lastRendered.pageHeightPx || 992;
    for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const scale = 1.2;
        const viewport = page.getViewport({ scale });
        if (i === 1) firstPageHeight = viewport.height;
        const canvas = document.createElement('canvas');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.className = 'report-preview-page-canvas';
        canvas.dataset.page = String(i);
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        container.appendChild(canvas);
    }
    return firstPageHeight;
}

function updatePaginationFromScroll() {
    if (!reportPreviewWrap || !reportPreviewPagination) return;
    const pageHeight = lastRendered.pageHeightPx || 992;
    const scrollTop = reportPreviewWrap.scrollTop;
    const current = Math.min(lastRendered.pageCount, Math.max(1, Math.floor(scrollTop / pageHeight) + 1));
    reportPreviewPagination.textContent = `Page ${current} of ${lastRendered.pageCount || 1}`;
}

export async function refreshReportPreview() {
    if (!reportPreviewPages || !reportPreviewLoading) return;
    if (reportPreviewPending) reportPreviewPending.classList.add('hidden');
    reportPreviewLoading.classList.remove('hidden');
    try {
        const result = await generatePdf({ preview: true });
        if (!result || !result.blob) return;
        const fragment = document.createDocumentFragment();
        const pageHeightPx = await renderPdfToCanvases(result.blob, result.pageCount, fragment);
        lastRendered = {
            blob: result.blob,
            pageCount: result.pageCount || 1,
            findingPages: result.findingPages || [],
            pageHeightPx: pageHeightPx != null ? pageHeightPx : lastRendered.pageHeightPx
        };
        reportPreviewPages.innerHTML = '';
        while (fragment.firstChild) reportPreviewPages.appendChild(fragment.firstChild);
        if (reportPreviewPagination) reportPreviewPagination.textContent = `Page 1 of ${lastRendered.pageCount}`;
    } catch (e) {
        console.error('Preview generation failed', e);
        const msg = (e && e.message) ? String(e.message).replace(/</g, '&lt;').replace(/>/g, '&gt;') : 'Unknown error';
        reportPreviewPages.innerHTML = '<p class="muted">Preview could not be generated: ' + msg + '</p>';
    } finally {
        reportPreviewLoading.classList.add('hidden');
    }
}

function debouncedRefresh() {
    if (reportPreviewPending) reportPreviewPending.classList.remove('hidden');
    if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
    previewDebounceTimer = setTimeout(() => {
        previewDebounceTimer = null;
        refreshReportPreview();
    }, PREVIEW_DEBOUNCE_MS);
}

export function scrollToFindingIndex(findingIndex) {
    const pages = lastRendered.findingPages;
    if (!pages || pages[findingIndex] == null || !reportPreviewWrap) return;
    const pageNum = pages[findingIndex];
    const pageHeight = lastRendered.pageHeightPx || 992;
    const targetScroll = (pageNum - 1) * pageHeight;
    reportPreviewWrap.scrollTo({ top: targetScroll, behavior: 'smooth' });
    if (reportPreviewPagination) reportPreviewPagination.textContent = `Page ${pageNum} of ${lastRendered.pageCount || 1}`;
}

if (reportPreviewWrap) {
    reportPreviewWrap.addEventListener('scroll', updatePaginationFromScroll);
}

window.addEventListener('report-state-changed', debouncedRefresh);
window.scrollToFindingIndex = scrollToFindingIndex;

if (document.querySelector('.report-export-layout')) {
    setTimeout(refreshReportPreview, 150);
}
