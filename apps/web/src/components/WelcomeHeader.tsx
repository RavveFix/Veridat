import { FunctionComponent } from 'preact';
import { TypingAnimation } from '../registry/magicui/typing-animation';

interface WelcomeHeaderProps {
    title: string;
    subtitle: string;
}

export const WelcomeHeader: FunctionComponent<WelcomeHeaderProps> = ({ title, subtitle }) => {
    return (
        <>
            <h1 class="welcome-header-title">
                <TypingAnimation duration={80}>{title}</TypingAnimation>
            </h1>
            <p class="welcome-header-subtitle">
                {subtitle}
            </p>
            <style>{`
                .welcome-header-subtitle {
                    opacity: 0;
                    animation: fadeIn 0.8s ease forwards;
                    animation-delay: 1.2s;
                }
            `}</style>
        </>
    );
};
