import { render, ComponentType } from 'preact';
import { h } from 'preact';

/**
 * Adapter utility to mount Preact components into vanilla DOM elements
 * This enables gradual migration from vanilla TS to Preact
 * 
 * @param component - Preact component to mount
 * @param props - Props to pass to the component
 * @param container - DOM element to mount into
 * @returns Cleanup function to unmount the component
 * 
 * @example
 * const unmount = mountPreactComponent(MyComponent, { title: 'Hello' }, document.getElementById('root'));
 * // Later: unmount();
 */
export function mountPreactComponent<P extends object>(
    component: ComponentType<P>,
    props: P,
    container: HTMLElement
): () => void {
    // Mount the Preact component
    render(h(component, props as P), container);

    // Return cleanup function
    return () => {
        render(null, container);
    };
}
