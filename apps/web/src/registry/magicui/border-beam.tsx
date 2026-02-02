import { FunctionComponent, type JSX } from 'preact';
import { cn } from '@/lib/utils';

type BorderBeamStyle = JSX.CSSProperties & Record<`--${string}`, string>;

interface BorderBeamProps {
    className?: string;
    size?: number;
    duration?: number;
    borderWidth?: number;
    anchor?: number;
    colorFrom?: string;
    colorTo?: string;
    delay?: number;
    style?: BorderBeamStyle;
}

/**
 * BorderBeam Component
 * Adds a moving light beam along the border of the parent container.
 * Parent container MUST have position: relative and overflow: hidden/clip.
 */
export const BorderBeam: FunctionComponent<BorderBeamProps> = ({
    className,
    size = 150,
    duration = 10,
    anchor = 90,
    borderWidth = 1.5,
    colorFrom,
    colorTo,
    delay = 0,
    style
}) => {
    return (
        <div 
            className={cn("border-beam", className)}
            style={{
                '--size': `${size}px`,
                '--duration': `${duration}s`,
                '--anchor': `${anchor}%`,
                '--border-width': `${borderWidth}px`,
                '--delay': `${delay}s`,
                ...(colorFrom ? { '--color-from': colorFrom } : {}),
                ...(colorTo ? { '--color-to': colorTo } : {}),
                ...style
            } as BorderBeamStyle}
        />
    );
};

export default BorderBeam;
