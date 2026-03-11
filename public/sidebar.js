/**
 * Shared sidebar navigation and slide-out panels. Load on all steps so the
 * sidebar is available in the same spot with the same functionality (including
 * during verification/detections).
 */
import {
    readState,
    getInspectionHistory,
    loadInspectionFromHistory,
    deleteInspectionFromHistory,
    getBookmarkedIds,
    isBookmarked,
    toggleBookmark,
    getAllFlaggedImages,
    deleteFlaggedImage,
    getAllGeneralNotes,
    deleteGeneralNote,
    togglePhotoFlagged
} from './state.js';
import { showToast } from './toast.js';

const HISTORY_MODE_KEY = 'specscanHistoryMode';

const historyNavBtn = document.getElementById('historyNavBtn');
const historyPanel = document.getElementById('historyPanel');
const historyPanelClose = document.getElementById('historyPanelClose');
const historyBackdrop = document.getElementById('historyBackdrop');
const historyList = document.getElementById('historyList');
const historyEmpty = document.getElementById('historyEmpty');
const historySearch = document.getElementById('historySearch');
const bookmarkNavBtn = document.getElementById('bookmarkNavBtn');
const bookmarkPanel = document.getElementById('bookmarkPanel');
const bookmarkPanelClose = document.getElementById('bookmarkPanelClose');
const bookmarkBackdrop = document.getElementById('bookmarkBackdrop');
const bookmarkList = document.getElementById('bookmarkList');
const bookmarkEmpty = document.getElementById('bookmarkEmpty');
const flaggedImagesNavBtn = document.getElementById('flaggedImagesNavBtn');
const flaggedImagesPanel = document.getElementById('flaggedImagesPanel');
const flaggedImagesPanelClose = document.getElementById('flaggedImagesPanelClose');
const flaggedImagesBackdrop = document.getElementById('flaggedImagesBackdrop');
const flaggedImagesList = document.getElementById('flaggedImagesList');
const flaggedImagesEmpty = document.getElementById('flaggedImagesEmpty');
const flaggedImagesSearch = document.getElementById('flaggedImagesSearch');
const clipboardNavBtn = document.getElementById('clipboardNavBtn');
const clipboardPanel = document.getElementById('clipboardPanel');
const clipboardPanelClose = document.getElementById('clipboardPanelClose');
const clipboardBackdrop = document.getElementById('clipboardBackdrop');
const clipboardList = document.getElementById('clipboardList');
const clipboardEmpty = document.getElementById('clipboardEmpty');
const clipboardSearch = document.getElementById('clipboardSearch');
const navBackBtn = document.querySelector('.nav-back');

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

const formatHistoryDate = (isoString) => {
    if (!isoString) return '—';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
};

const matchesSearch = (entry, q) => {
    if (!q || !q.trim()) return true;
    const lower = q.trim().toLowerCase();
    const tail = (entry.tailNumber || '').toLowerCase();
    const inspector = (entry.inspectorName || '').toLowerCase();
    const type = (entry.inspectionType || '').toLowerCase();
    const dateStr = formatHistoryDate(entry.startedAt).toLowerCase();
    return tail.includes(lower) || inspector.includes(lower) || type.includes(lower) || dateStr.includes(lower);
};

const renderHistoryList = () => {
    const list = getInspectionHistory();
    const query = (historySearch?.value || '').trim();
    const filtered = query ? list.filter((entry) => matchesSearch(entry, query)) : list;

    if (!historyList || !historyEmpty) return;

    if (filtered.length === 0) {
        historyList.innerHTML = '';
        historyList.classList.add('hidden');
        historyEmpty.classList.remove('hidden');
        return;
    }

    historyEmpty.classList.add('hidden');
    historyList.classList.remove('hidden');
    historyList.innerHTML = filtered
        .map((entry) => {
            const bookmarked = isBookmarked(entry.id);
            return `
        <div class="history-item-wrapper">
            <button type="button" class="history-item" data-history-id="${entry.id}">
                <p class="history-item-tail">${escapeHtml(entry.tailNumber || '—')}</p>
                <p class="history-item-meta">${escapeHtml(formatHistoryDate(entry.startedAt))} · ${escapeHtml(entry.inspectorName || '—')}</p>
                <span class="history-item-type">${escapeHtml(entry.inspectionType || 'Outbound')}</span>
                ${entry.photosCount != null ? `<p class="history-item-meta" style="margin-top:4px">${entry.photosCount} photo${entry.photosCount === 1 ? '' : 's'}</p>` : ''}
            </button>
            <button type="button" class="history-item-bookmark-btn ${bookmarked ? 'is-bookmarked' : ''}" data-history-id="${entry.id}" aria-label="${bookmarked ? 'Remove bookmark' : 'Bookmark'}" title="${bookmarked ? 'Remove bookmark' : 'Bookmark'}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="${bookmarked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
            <button type="button" class="history-item-delete-btn" data-history-id="${entry.id}" aria-label="Delete">×</button>
        </div>
        `;
        })
        .join('');

    historyList.querySelectorAll('.history-item').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            if (e.target.closest('.history-item-delete-btn') || e.target.closest('.history-item-bookmark-btn')) return;
            const id = btn.dataset.historyId;
            if (!id) return;
            if (await loadInspectionFromHistory(id)) {
                closeHistoryPanel();
                try { sessionStorage.setItem(HISTORY_MODE_KEY, '1'); } catch { /* ignore */ }
                window.location.href = 'report.html';
            } else {
                showToast('Could not load that inspection (it may not have been saved due to storage limits).', { type: 'error' });
            }
        });
    });
    historyList.querySelectorAll('.history-item-delete-btn').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.historyId;
            if (!id) return;
            if (confirm('Delete this inspection from history?')) {
                if (await deleteInspectionFromHistory(id)) renderHistoryList();
                else showToast('Failed to delete inspection.', { type: 'error' });
            }
        });
    });
    historyList.querySelectorAll('.history-item-bookmark-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.historyId;
            if (!id) return;
            toggleBookmark(id);
            renderHistoryList();
        });
    });
};

const openHistoryPanel = () => {
    historyPanel?.classList.add('is-open');
    historyPanel?.setAttribute('aria-hidden', 'false');
    historyBackdrop?.classList.remove('hidden');
    historyBackdrop?.classList.add('is-visible');
    historyBackdrop?.setAttribute('aria-hidden', 'false');
    try { renderHistoryList(); } catch (e) {
        console.error('Inspection history failed to load', e);
        if (historyList) { historyList.innerHTML = ''; historyList.classList.add('hidden'); }
        if (historyEmpty) {
            historyEmpty.classList.remove('hidden');
            const t = historyEmpty.querySelector('.history-empty-title');
            const d = historyEmpty.querySelector('.history-empty-desc');
            if (t) t.textContent = 'Could not load inspection history';
            if (d) d.textContent = 'Storage may be unavailable or the data is unavailable. Try again or complete a new inspection.';
        }
    }
    historySearch?.focus();
};

const closeHistoryPanel = () => {
    historyNavBtn?.focus();
    historyPanel?.classList.remove('is-open');
    historyPanel?.setAttribute('aria-hidden', 'true');
    historyBackdrop?.classList.remove('is-visible');
    historyBackdrop?.classList.add('hidden');
    historyBackdrop?.setAttribute('aria-hidden', 'true');
};

const renderBookmarkList = () => {
    const bookmarkedIds = getBookmarkedIds();
    const list = getInspectionHistory().filter((entry) => bookmarkedIds.includes(entry.id));
    if (!bookmarkList || !bookmarkEmpty) return;
    if (list.length === 0) {
        bookmarkList.innerHTML = '';
        bookmarkList.classList.add('hidden');
        bookmarkEmpty.classList.remove('hidden');
        return;
    }
    bookmarkEmpty.classList.add('hidden');
    bookmarkList.classList.remove('hidden');
    bookmarkList.innerHTML = list
        .map((entry) => `
        <div class="history-item-wrapper">
            <button type="button" class="history-item" data-history-id="${entry.id}">
                <p class="history-item-tail">${escapeHtml(entry.tailNumber || '—')}</p>
                <p class="history-item-meta">${escapeHtml(formatHistoryDate(entry.startedAt))} · ${escapeHtml(entry.inspectorName || '—')}</p>
                <span class="history-item-type">${escapeHtml(entry.inspectionType || 'Outbound')}</span>
                ${entry.photosCount != null ? `<p class="history-item-meta" style="margin-top:4px">${entry.photosCount} photo${entry.photosCount === 1 ? '' : 's'}</p>` : ''}
            </button>
        </div>
        `)
        .join('');
    bookmarkList.querySelectorAll('.history-item').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.historyId;
            if (!id) return;
            if (await loadInspectionFromHistory(id)) {
                closeBookmarkPanel();
                try { sessionStorage.setItem(HISTORY_MODE_KEY, '1'); } catch { /* ignore */ }
                window.location.href = 'report.html';
            } else {
                showToast('Could not load that inspection (it may not have been saved due to storage limits).', { type: 'error' });
            }
        });
    });
};

const openBookmarkPanel = () => {
    bookmarkPanel?.classList.add('is-open');
    bookmarkPanel?.setAttribute('aria-hidden', 'false');
    bookmarkBackdrop?.classList.remove('hidden');
    bookmarkBackdrop?.classList.add('is-visible');
    bookmarkBackdrop?.setAttribute('aria-hidden', 'false');
    renderBookmarkList();
};

const closeBookmarkPanel = () => {
    bookmarkNavBtn?.focus();
    bookmarkPanel?.classList.remove('is-open');
    bookmarkPanel?.setAttribute('aria-hidden', 'true');
    bookmarkBackdrop?.classList.remove('is-visible');
    bookmarkBackdrop?.classList.add('hidden');
    bookmarkBackdrop?.setAttribute('aria-hidden', 'true');
};

const formatFlaggedDate = (isoString) => {
    if (!isoString) return '—';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const matchesFlaggedSearch = (item, q) => {
    if (!q || !q.trim()) return true;
    const lower = q.trim().toLowerCase();
    const area = (item.area || '').toLowerCase();
    const note = (item.flaggedNote || '').toLowerCase();
    const tail = (item.inspection?.tailNumber || '').toLowerCase();
    return area.includes(lower) || note.includes(lower) || tail.includes(lower);
};

const getMergedFlaggedImagesList = async () => {
    const state = readState();
    const inspection = state?.inspection;
    const photos = state?.photos || [];
    const currentFlagged = photos
        .filter((p) => p && p.flagged)
        .map((photo) => ({
            storageId: `current-${inspection?.startedAt ?? ''}-${photo.id}`,
            id: photo.id,
            number: photo.number,
            name: photo.name,
            dataURL: photo.dataURL,
            area: photo.area || null,
            flaggedNote: photo.flaggedNote || '',
            flaggedAt: new Date().toISOString(),
            inspection: inspection ? { tailNumber: inspection.tailNumber || '', inspectionType: inspection.inspectionType || '', inspectorName: inspection.inspectorName || '', startedAt: inspection.startedAt || null } : null,
            isCurrentSession: true
        }));
    const stored = await getAllFlaggedImages();
    const storedFiltered = stored.filter((item) => item.inspection?.startedAt !== inspection?.startedAt);
    return [...currentFlagged, ...storedFiltered];
};

const renderFlaggedImagesList = async () => {
    const list = await getMergedFlaggedImagesList();
    const query = (flaggedImagesSearch?.value || '').trim();
    const filtered = query ? list.filter((item) => matchesFlaggedSearch(item, query)) : list;
    if (!flaggedImagesList || !flaggedImagesEmpty) return;
    if (filtered.length === 0) {
        flaggedImagesList.innerHTML = '';
        flaggedImagesList.classList.add('hidden');
        flaggedImagesEmpty.classList.remove('hidden');
        return;
    }
    flaggedImagesEmpty.classList.add('hidden');
    flaggedImagesList.classList.remove('hidden');
    const sorted = [...filtered].sort((a, b) => {
        const dateA = a.flaggedAt ? new Date(a.flaggedAt).getTime() : 0;
        const dateB = b.flaggedAt ? new Date(b.flaggedAt).getTime() : 0;
        return dateB - dateA;
    });
    flaggedImagesList.innerHTML = sorted
        .map((item) => {
            const isCurrent = Boolean(item.isCurrentSession);
            const deleteAttrs = isCurrent
                ? `data-current="true" data-photo-id="${item.id}" data-flagged-id="${escapeHtml(item.storageId)}"`
                : `data-flagged-id="${escapeHtml(item.storageId || item.id)}"`;
            return `
        <div class="flagged-image-item-panel">
            <div class="flagged-image-item-header">
                <div class="flagged-image-item-info">
                    <p class="flagged-image-item-title">Photo #${escapeHtml(item.number || '—')} - ${escapeHtml(item.area || 'Unknown Area')}</p>
                    <p class="flagged-image-item-meta">${escapeHtml(formatFlaggedDate(item.flaggedAt))}</p>
                    ${item.inspection?.tailNumber ? `<p class="flagged-image-item-meta">Tail: ${escapeHtml(item.inspection.tailNumber)}</p>` : ''}
                </div>
                <button type="button" class="flagged-image-delete-btn" ${deleteAttrs} aria-label="Remove from flagged">×</button>
            </div>
            <div class="flagged-image-item-preview">
                <img src="${item.dataURL ? escapeHtml(item.dataURL) : ''}" alt="Photo #${escapeHtml(item.number || '—')}" style="max-width: 100%; max-height: 200px; border-radius: 4px; object-fit: contain;">
            </div>
            ${item.flaggedNote ? `
            <div class="flagged-image-item-note">
                <p class="flagged-image-note-label">Note:</p>
                <p class="flagged-image-note-text">${escapeHtml(item.flaggedNote)}</p>
            </div>
            ` : ''}
        </div>
        `;
        })
        .join('');
};

const openFlaggedImagesPanel = () => {
    flaggedImagesPanel?.classList.add('is-open');
    flaggedImagesPanel?.setAttribute('aria-hidden', 'false');
    flaggedImagesBackdrop?.classList.remove('hidden');
    flaggedImagesBackdrop?.classList.add('is-visible');
    flaggedImagesBackdrop?.setAttribute('aria-hidden', 'false');
    renderFlaggedImagesList();
    flaggedImagesSearch?.focus();
};

const closeFlaggedImagesPanel = () => {
    flaggedImagesNavBtn?.focus();
    flaggedImagesPanel?.classList.remove('is-open');
    flaggedImagesPanel?.setAttribute('aria-hidden', 'true');
    flaggedImagesBackdrop?.classList.remove('is-visible');
    flaggedImagesBackdrop?.classList.add('hidden');
    flaggedImagesBackdrop?.setAttribute('aria-hidden', 'true');
};

const formatNoteDate = (isoString) => {
    if (!isoString) return '—';
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const matchesNoteSearch = (item, q) => {
    if (!q || !q.trim()) return true;
    const lower = q.trim().toLowerCase();
    const note = (item.note || '').toLowerCase();
    const tail = (item.inspection?.tailNumber || '').toLowerCase();
    const inspector = (item.inspection?.inspectorName || '').toLowerCase();
    const type = (item.inspection?.inspectionType || '').toLowerCase();
    return note.includes(lower) || tail.includes(lower) || inspector.includes(lower) || type.includes(lower);
};

const renderClipboardList = () => {
    const list = getAllGeneralNotes();
    const query = (clipboardSearch?.value || '').trim();
    const filtered = query ? list.filter((item) => matchesNoteSearch(item, query)) : list;
    if (!clipboardList || !clipboardEmpty) return;
    if (filtered.length === 0) {
        clipboardList.innerHTML = '';
        clipboardList.classList.add('hidden');
        clipboardEmpty.classList.remove('hidden');
        return;
    }
    clipboardEmpty.classList.add('hidden');
    clipboardList.classList.remove('hidden');
    const sorted = [...filtered].sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
    });
    clipboardList.innerHTML = sorted
        .map((item) => `
        <div class="general-note-item-panel">
            <div class="general-note-item-header">
                <div class="general-note-item-info">
                    <p class="general-note-item-meta">${escapeHtml(formatNoteDate(item.createdAt))}</p>
                    ${item.inspection?.tailNumber ? `<p class="general-note-item-meta">Tail: ${escapeHtml(item.inspection.tailNumber)}</p>` : ''}
                    ${item.inspection?.inspectorName ? `<p class="general-note-item-meta">Inspector: ${escapeHtml(item.inspection.inspectorName)}</p>` : ''}
                    ${item.inspection?.inspectionType ? `<p class="general-note-item-meta">Type: ${escapeHtml(item.inspection.inspectionType)}</p>` : ''}
                </div>
                <button type="button" class="general-note-delete-btn" data-note-id="${item.id}" aria-label="Delete">×</button>
            </div>
            <div class="general-note-item-content">
                <p class="general-note-text">${escapeHtml(item.note)}</p>
            </div>
        </div>
        `)
        .join('');
    clipboardList.querySelectorAll('.general-note-delete-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.noteId;
            if (!id) return;
            if (confirm('Delete this note?')) {
                deleteGeneralNote(id);
                renderClipboardList();
            }
        });
    });
};

const openClipboardPanel = () => {
    clipboardPanel?.classList.add('is-open');
    clipboardPanel?.setAttribute('aria-hidden', 'false');
    clipboardBackdrop?.classList.remove('hidden');
    clipboardBackdrop?.classList.add('is-visible');
    clipboardBackdrop?.setAttribute('aria-hidden', 'false');
    renderClipboardList();
    clipboardSearch?.focus();
};

const closeClipboardPanel = () => {
    clipboardNavBtn?.focus();
    clipboardPanel?.classList.remove('is-open');
    clipboardPanel?.setAttribute('aria-hidden', 'true');
    clipboardBackdrop?.classList.remove('is-visible');
    clipboardBackdrop?.classList.add('hidden');
    clipboardBackdrop?.setAttribute('aria-hidden', 'true');
};

historyNavBtn?.addEventListener('click', openHistoryPanel);
historyPanelClose?.addEventListener('click', closeHistoryPanel);
historyBackdrop?.addEventListener('click', closeHistoryPanel);
historySearch?.addEventListener('input', () => renderHistoryList());
historySearch?.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHistoryPanel(); });

bookmarkNavBtn?.addEventListener('click', openBookmarkPanel);
bookmarkPanelClose?.addEventListener('click', closeBookmarkPanel);
bookmarkBackdrop?.addEventListener('click', closeBookmarkPanel);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && bookmarkPanel?.classList.contains('is-open')) closeBookmarkPanel(); });

flaggedImagesNavBtn?.addEventListener('click', openFlaggedImagesPanel);
flaggedImagesPanelClose?.addEventListener('click', closeFlaggedImagesPanel);
flaggedImagesBackdrop?.addEventListener('click', closeFlaggedImagesPanel);
flaggedImagesSearch?.addEventListener('input', () => renderFlaggedImagesList());
flaggedImagesSearch?.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFlaggedImagesPanel(); });

flaggedImagesList?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.flagged-image-delete-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const isCurrent = btn.getAttribute('data-current') === 'true';
    const photoId = btn.getAttribute('data-photo-id');
    const storageId = btn.getAttribute('data-flagged-id');
    if (!storageId && !photoId) return;
    if (!confirm('Remove this image from flagged?')) return;
    if (isCurrent && photoId != null && photoId !== '') {
        const numId = /^\d+$/.test(String(photoId)) ? parseInt(photoId, 10) : null;
        if (numId != null) togglePhotoFlagged(numId);
    } else if (storageId) {
        await deleteFlaggedImage(storageId);
    }
    await renderFlaggedImagesList();
});

clipboardNavBtn?.addEventListener('click', openClipboardPanel);
clipboardPanelClose?.addEventListener('click', closeClipboardPanel);
clipboardBackdrop?.addEventListener('click', closeClipboardPanel);
clipboardSearch?.addEventListener('input', () => renderClipboardList());
clipboardSearch?.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeClipboardPanel(); });

navBackBtn?.addEventListener('click', () => {
    const step = document.body.getAttribute('data-step');
    const n = step ? parseInt(step, 10) : 0;
    if (n <= 1) return;
    const routes = { 2: 'index.html', 3: 'tag.html', 4: 'results.html', 5: 'report.html' };
    const href = routes[n];
    if (href) window.location.href = href;
});
