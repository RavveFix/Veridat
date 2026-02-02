import { mountPreactComponent } from '../components/preact-adapter';
import type { ComponentType } from 'preact';

export interface ModalMountOptions<P extends object = Record<string, unknown>> {
    containerId: string;
    Component: ComponentType<P>;
    props: P;
}

/**
 * Helper function to mount a modal component
 * Creates a container if it doesn't exist and mounts the Preact component
 * @returns Cleanup function to unmount the modal
 */
export function mountModal<P extends object>(
    { containerId, Component, props }: ModalMountOptions<P>
): () => void {
    let container = document.getElementById(containerId);

    if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        document.body.appendChild(container);
    }

    const unmount = mountPreactComponent(Component, props, container);

    // Return cleanup function
    return () => {
        if (unmount) {
            unmount();
        } else if (container) {
            // Fallback if no unmount function (shouldn't happen with correct adapter)
            container.innerHTML = '';
        }
    };
}
