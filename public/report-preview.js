/**
 * PDF preview for Export Report page: renders PDF blob to canvases, page navigation, scroll-to-finding.
 */
import { generatePdf } from './report.js';

const reportPreviewPages = document.getElementById('reportPreviewPages');
const reportPreviewLoading = document.getElementById('reportPreviewLoading');
const reportPreviewPagination = document.getElementById('reportPreviewPagination');
const reportPreviewWrap = document.getElementById('reportPreviewWrap');
const reportPreviewPending = document.getElementById('reportPreviewPending');
const reportPreviewPrev = document.getElementById('reportPreviewPrev');
const reportPreviewNext = document.getElementById('reportPreviewNext');
const reportPreviewPageInput = document.getElementById('reportPreviewPageInput');
const reportPreviewPageCount = document.getElementById('reportPreviewPageCount');

let lastRendered = { blob: null, pageCount: 0, findingPages: [], pageHeightPx: 992 };
const PREVIEW_DEBOUNCE_MS = 3500;
const PREVIEW_PAGE_GAP = 16;
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

function getPageHeightWithGap() {
    return (lastRendered.pageHeightPx || 992) + PREVIEW_PAGE_GAP;
}

function updatePaginationFromScroll() {
    if (!reportPreviewWrap) return;
    const step = getPageHeightWithGap();
    const scrollTop = reportPreviewWrap.scrollTop;
    const current = Math.min(lastRendered.pageCount, Math.max(1, Math.floor(scrollTop / step) + 1));
    if (reportPreviewPageInput && document.activeElement !== reportPreviewPageInput) {
        reportPreviewPageInput.value = String(current);
        reportPreviewPageInput.max = String(lastRendered.pageCount || 1);
    }
    if (reportPreviewPageCount) reportPreviewPageCount.textContent = String(lastRendered.pageCount || 1);
    if (reportPreviewPrev) reportPreviewPrev.disabled = current <= 1;
    if (reportPreviewNext) reportPreviewNext.disabled = current >= (lastRendered.pageCount || 1);
}

function goToPage(pageNum) {
    if (!reportPreviewWrap) return;
    const total = lastRendered.pageCount || 1;
    const page = Math.max(1, Math.min(total, Math.floor(Number(pageNum)) || 1));
    const step = getPageHeightWithGap();
    const targetScroll = (page - 1) * step;
    reportPreviewWrap.scrollTo({ top: targetScroll, behavior: 'smooth' });
    if (reportPreviewPageInput) reportPreviewPageInput.value = String(page);
}

function goToPrevPage() {
    if (!reportPreviewWrap) return;
    const step = getPageHeightWithGap();
    const newScroll = Math.max(0, reportPreviewWrap.scrollTop - step);
    reportPreviewWrap.scrollTo({ top: newScroll, behavior: 'smooth' });
}

function goToNextPage() {
    if (!reportPreviewWrap) return;
    const step = getPageHeightWithGap();
    const maxScroll = Math.max(0, (lastRendered.pageCount - 1) * step);
    const newScroll = Math.min(maxScroll, reportPreviewWrap.scrollTop + step);
    reportPreviewWrap.scrollTo({ top: newScroll, behavior: 'smooth' });
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
        const pageHeight = lastRendered.pageHeightPx || 992;
        const wrapHeight = pageHeight + 32;
        if (reportPreviewWrap) {
            reportPreviewWrap.style.flex = 'none';
            reportPreviewWrap.style.height = `${wrapHeight}px`;
            reportPreviewWrap.style.maxHeight = `${wrapHeight}px`;
            reportPreviewWrap.scrollTop = 0;
        }
        updatePaginationFromScroll();
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
    const step = getPageHeightWithGap();
    const targetScroll = (pageNum - 1) * step;
    reportPreviewWrap.scrollTo({ top: targetScroll, behavior: 'smooth' });
    updatePaginationFromScroll();
}

if (reportPreviewWrap) {
    reportPreviewWrap.addEventListener('scroll', updatePaginationFromScroll);
}
if (reportPreviewPrev) reportPreviewPrev.addEventListener('click', goToPrevPage);
if (reportPreviewNext) reportPreviewNext.addEventListener('click', goToNextPage);

if (reportPreviewPageInput) {
    reportPreviewPageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            goToPage(reportPreviewPageInput.value);
            reportPreviewPageInput.blur();
        }
    });
    reportPreviewPageInput.addEventListener('change', () => goToPage(reportPreviewPageInput.value));
}

document.addEventListener('keydown', (e) => {
    if (!reportPreviewWrap || !document.querySelector('.report-export-layout')) return;
    if (e.target.closest('input') || e.target.closest('textarea') || e.target.closest('button')) return;
    if (e.key === 'ArrowLeft') { goToPrevPage(); e.preventDefault(); }
    if (e.key === 'ArrowRight') { goToNextPage(); e.preventDefault(); }
});

window.addEventListener('report-state-changed', debouncedRefresh);
window.scrollToFindingIndex = scrollToFindingIndex;

if (document.querySelector('.report-export-layout')) {
    setTimeout(refreshReportPreview, 150);
}
