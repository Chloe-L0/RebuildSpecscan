/**
 * In-app toast notifications matching VERiiO design.
 * Use showToast(message, { type?, duration? }) instead of alert().
 */

const CONTAINER_ID = 'veriio-toast-container';
const DEFAULT_DURATION = 5000;
const TYPES = ['info', 'success', 'warning', 'error'];

const getContainer = () => {
    let el = document.getElementById(CONTAINER_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = CONTAINER_ID;
        el.className = 'veriio-toast-container';
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('role', 'region');
        el.setAttribute('aria-label', 'Notifications');
        document.body.appendChild(el);
    }
    return el;
};

/**
 * Show an in-app toast notification.
 * @param {string} message - Text to display.
 * @param {{ type?: 'info'|'success'|'warning'|'error', duration?: number }} options
 */
export const showToast = (message, options = {}) => {
    const type = TYPES.includes(options.type) ? options.type : 'info';
    const duration = typeof options.duration === 'number' ? options.duration : DEFAULT_DURATION;

    const container = getContainer();
    const toast = document.createElement('div');
    toast.className = `veriio-toast veriio-toast--${type}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    const text = document.createElement('span');
    text.className = 'veriio-toast-text';
    text.textContent = message;
    toast.appendChild(text);

    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('veriio-toast--visible');
    });

    const remove = () => {
        toast.classList.remove('veriio-toast--visible');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    };

    const timeoutId = duration > 0 ? setTimeout(remove, duration) : null;

    toast.addEventListener('click', () => {
        if (timeoutId) clearTimeout(timeoutId);
        remove();
    });

    return { remove, toast };
};
