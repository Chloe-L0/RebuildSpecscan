import {
    loadState,
    updateReportOptions
} from './state.js';

const REPORT_RECEIPT_KEY = 'specscan_report_receipt';

const summaryGrid = document.getElementById('summaryGrid');
const reportPreview = document.getElementById('reportPreview');
const exportRadios = document.querySelectorAll('input[name="exportFormat"]');
const includeFalsePositives = document.getElementById('includeFalsePositives');
const includeAllPhotos = document.getElementById('includeAllPhotos');
const backBtn = document.getElementById('backToResultsBtn');
const downloadBtn = document.getElementById('downloadBtn');
const submitBtn = document.getElementById('submitBtn');

let state = loadState();

if (!state.start) {
    window.location.href = 'index.html';
}

if (!state.detections.length) {
    window.location.href = 'results.html';
}

renderSummary();
renderPreview();
initialiseControls();

backBtn?.addEventListener('click', () => {
    window.location.href = 'results.html';
});

downloadBtn?.addEventListener('click', () => {
    downloadBtn.textContent = 'Generating...';
    downloadBtn.disabled = true;
    setTimeout(() => {
        downloadBtn.textContent = 'Download Report';
        downloadBtn.disabled = false;
    }, 1200);
});

submitBtn?.addEventListener('click', () => {
    const receipt = {
        reportId: generateReportId(),
        submittedAt: new Date().toISOString(),
        tailNumber: state.start.tailNumber
    };
    sessionStorage.setItem(REPORT_RECEIPT_KEY, JSON.stringify(receipt));
    window.location.href = 'success.html';
});

exportRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
        state = updateReportOptions({ exportFormat: radio.value });
    });
});

includeFalsePositives?.addEventListener('change', (event) => {
    state = updateReportOptions({ includeFalsePositives: event.target.checked });
});

includeAllPhotos?.addEventListener('change', (event) => {
    state = updateReportOptions({ includeAllPhotos: event.target.checked });
});

function renderSummary() {
    const totalPhotos = state.photos.length;
    const totalDetections = state.detections.length;
    const inspectedAreas = new Set(state.photos.filter(photo => photo.area).map(photo => photo.area));

    summaryGrid.innerHTML = `
        <div class="summary-card">
            <strong>Total Photos</strong>
            <span>${totalPhotos}</span>
        </div>
        <div class="summary-card">
            <strong>Total Defects</strong>
            <span>${totalDetections}</span>
        </div>
        <div class="summary-card">
            <strong>Areas Inspected</strong>
            <span>${Array.from(inspectedAreas).join(', ') || 'Pending'}</span>
        </div>
    `;
}

function renderPreview() {
    const { start, detections } = state;
    const grouped = groupByArea(detections);

    const sections = Array.from(grouped.entries()).map(([area, items]) => {
        const list = items.map((item) => `<li>${item.type} — ${Math.round(item.confidence * 100)}% confidence (Photo ${item.photoNumber})</li>`).join('');
        return `
            <section>
                <strong>${area}</strong>
                <ul>${list}</ul>
            </section>
        `;
    }).join('');

    reportPreview.innerHTML = `
        <h3>Inspection Overview</h3>
        <p class="supporting">
            Tail ${start.tailNumber} · ${start.inspectionType} · Inspector ${start.inspectorName} · ${new Date(start.timestamp).toLocaleString()}
        </p>
        <h4>Findings by Area</h4>
        ${sections || '<p class="muted">No detections recorded.</p>'}
    `;
}

function initialiseControls() {
    const { reportOptions } = state;
    exportRadios.forEach((radio) => {
        radio.checked = radio.value === reportOptions.exportFormat;
    });
    includeFalsePositives.checked = Boolean(reportOptions.includeFalsePositives);
    includeAllPhotos.checked = Boolean(reportOptions.includeAllPhotos);
}

function groupByArea(items) {
    return items.reduce((map, item) => {
        const area = item.area || 'Unassigned';
        if (!map.has(area)) {
            map.set(area, []);
        }
        map.get(area).push(item);
        return map;
    }, new Map());
}

function generateReportId() {
    const base = Math.floor(Math.random() * 900000 + 100000);
    return `RPT-${base}`;
}

