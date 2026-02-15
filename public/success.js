import { generateReportId, readState, resetState, setSubmissionId } from './state.js';
import { generatePdf } from './report.js';

const reportIdEl = document.getElementById('reportId');
const successMeta = document.getElementById('successMeta');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');
const newInspectionBtn = document.getElementById('newInspectionBtn');
const returnHomeBtn = document.getElementById('returnHomeBtn');

const ensureFlowCompleted = () => {
    const state = readState();
    if (!state.inspection.tailNumber || !state.inspection.startedAt) {
        window.location.replace('index.html');
        return null;
    }
    if (!state.analysis.completed) {
        window.location.replace('results.html');
        return null;
    }
    return state;
};

const renderSuccess = () => {
    const state = readState();
    let submissionId = state.analysis.submissionId;
    if (!submissionId) {
        submissionId = generateReportId();
        setSubmissionId(submissionId);
    }

    const inspector = state.inspection.inspectorName || 'Inspector';
    const detections = state.detections.filter((detection) => !detection.falsePositive).length;
    reportIdEl.textContent = submissionId;
    successMeta.textContent = `${state.inspection.inspectionType} · ${inspector} · ${detections} confirmed detection${detections === 1 ? '' : 's'}`;
};

downloadPdfBtn?.addEventListener('click', async () => {
    const originalLabel = downloadPdfBtn.textContent;
    downloadPdfBtn.disabled = true;
    downloadPdfBtn.textContent = 'Generating PDF…';
    try {
        await generatePdf();
    } catch (error) {
        console.error('PDF generation failed', error);
        alert(error.message || 'Unable to generate PDF. Please try again.');
    } finally {
        downloadPdfBtn.disabled = false;
        downloadPdfBtn.textContent = originalLabel;
    }
});

newInspectionBtn?.addEventListener('click', () => {
    resetState();
    window.location.href = 'index.html';
});

returnHomeBtn?.addEventListener('click', () => {
    resetState();
    window.location.href = 'index.html';
});

const initialState = ensureFlowCompleted();
if (initialState) {
    renderSuccess();
}

