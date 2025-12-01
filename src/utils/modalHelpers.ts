import { mountPreactComponent } from '../components/preact-adapter';

export interface ModalMountOptions {
    containerId: string;
    Component: any;
    props: Record<string, any>;
}

/**
 * Helper function to mount a modal component
 * Creates a container if it doesn't exist and mounts the Preact component
 * @returns Cleanup function to unmount the modal
 */
export function mountModal({ containerId, Component, props }: ModalMountOptions): () => void {
    let container = document.getElementById(containerId);

    if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        document.body.appendChild(container);
    }

    mountPreactComponent(Component, props, container);

    // Return cleanup function
    return () => {
        if (container) {
            container.innerHTML = '';
        }
    };
}
