// Toast types
type ToastType = 'success' | 'error' | 'info';

// Standalone function to show toast (for non-React contexts)
let globalShowToast: ((message: string, type?: ToastType) => void) | null = null;

export const setGlobalToast = (fn: (message: string, type?: ToastType) => void) => {
    globalShowToast = fn;
};

export const showToast = (message: string, type: ToastType = 'success') => {
    if (globalShowToast) {
        globalShowToast(message, type);
    } else {
        console.log(`Toast [${type}]: ${message}`);
    }
};
