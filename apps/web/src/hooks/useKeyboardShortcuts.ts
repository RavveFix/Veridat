import { useEffect } from 'preact/hooks';

interface ShortcutConfig {
    key: string;
    ctrl?: boolean;
    meta?: boolean;  // Cmd on Mac
    shift?: boolean;
    action: () => void;
    description?: string;
}

/**
 * Hook for registering keyboard shortcuts
 * 
 * Usage:
 * useKeyboardShortcuts([
 *   { key: 'n', meta: true, action: () => createNewChat(), description: 'Ny konversation' },
 *   { key: 'Escape', action: () => closeSidebar(), description: 'Stäng sidebar' }
 * ]);
 */
export const useKeyboardShortcuts = (shortcuts: ShortcutConfig[]) => {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if user is typing in an input or textarea
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
                // Allow Escape to work in inputs
                if (e.key !== 'Escape') return;
            }

            for (const shortcut of shortcuts) {
                const metaMatch = shortcut.meta ? (e.metaKey || e.ctrlKey) : true;
                const ctrlMatch = shortcut.ctrl ? e.ctrlKey : true;
                const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;
                const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();

                if (keyMatch && metaMatch && ctrlMatch && shiftMatch) {
                    e.preventDefault();
                    shortcut.action();
                    return;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [shortcuts]);
};

/**
 * Initialize global keyboard shortcuts for the app
 * Call this once in main.ts or App component
 */
export const initKeyboardShortcuts = () => {
    // Cmd+N or Ctrl+N - New conversation
    const handleNewChat = () => {
        window.dispatchEvent(new CustomEvent('create-new-chat'));
    };

    // Escape - Close modals and sidebar
    const handleCloseModalsAndSidebar = () => {
        // Close company modal
        const companyModal = document.getElementById('company-modal');
        if (companyModal && !companyModal.classList.contains('hidden')) {
            companyModal.classList.add('hidden');
            return; // Only close one thing at a time
        }

        // Close settings modal
        const settingsModal = document.getElementById('settings-modal-container');
        if (settingsModal && settingsModal.children.length > 0) {
            settingsModal.innerHTML = '';
            // Dispatch event so main.ts can reset the settingsModalOpen flag
            window.dispatchEvent(new CustomEvent('settings-modal-closed'));
            return;
        }

        // Close history sidebar
        const sidebar = document.getElementById('history-sidebar');
        if (sidebar && !sidebar.classList.contains('hidden')) {
            sidebar.classList.add('hidden');
            return;
        }
    };

    // Cmd+K - Focus search (future feature)
    const handleSearch = () => {
        const searchInput = document.querySelector('#search-input') as HTMLInputElement;
        if (searchInput) {
            searchInput.focus();
        }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        const target = e.target as HTMLElement;
        const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

        // Escape works everywhere
        if (e.key === 'Escape') {
            handleCloseModalsAndSidebar();
            // Also blur any focused input
            if (document.activeElement instanceof HTMLElement) {
                document.activeElement.blur();
            }
            return;
        }

        // Other shortcuts only when not typing
        if (isTyping) return;

        // Cmd/Ctrl + N - New chat
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
            e.preventDefault();
            handleNewChat();
            return;
        }

        // Cmd/Ctrl + K - Search
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            handleSearch();
            return;
        }
    };

    window.addEventListener('keydown', handleKeyDown);

    // Return cleanup function
    return () => window.removeEventListener('keydown', handleKeyDown);
};
