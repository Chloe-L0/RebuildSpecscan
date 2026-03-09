/**
 * Wire Roboflow export button and format choice on the report page.
 * Does not modify report.js.
 */
import { exportRoboflowZip } from './export-roboflow.js';

const exportRoboflowBtn = document.getElementById('exportRoboflowBtn');

function getSelectedFormat() {
    const checked = document.querySelector('input[name="roboflowFormat"]:checked');
    return (checked?.value === 'coco') ? 'coco' : 'annotations';
}

exportRoboflowBtn?.addEventListener('click', async () => {
    const format = getSelectedFormat();
    const label = exportRoboflowBtn.textContent;
    exportRoboflowBtn.disabled = true;
    exportRoboflowBtn.textContent = 'Preparing ZIP…';
    try {
        const result = await exportRoboflowZip(format);
        if (result.ok) {
            exportRoboflowBtn.textContent = 'Downloaded';
            setTimeout(() => { exportRoboflowBtn.textContent = label; }, 2000);
        } else {
            exportRoboflowBtn.textContent = result.message || 'Export failed';
            setTimeout(() => { exportRoboflowBtn.textContent = label; }, 3000);
        }
    } catch (err) {
        exportRoboflowBtn.textContent = 'Export failed';
        setTimeout(() => { exportRoboflowBtn.textContent = label; }, 3000);
    } finally {
        exportRoboflowBtn.disabled = false;
    }
});
