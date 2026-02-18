import { CHANGELOG, type ChangelogEntry } from '../../constants/changelog';

const CHANGELOG_SECTION_STYLE = {
    marginBottom: '2rem',
    borderTop: '1px solid var(--glass-border)',
    paddingTop: '1.5rem'
};

const CHANGELOG_TITLE_STYLE = {
    fontSize: '1.1rem',
    marginBottom: '1rem',
    color: 'var(--text-primary)'
};

const CHANGELOG_ENTRY_HEADER_STYLE = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: '0.5rem'
};

const CHANGELOG_ENTRY_TITLE_STYLE = {
    fontSize: '0.95rem',
    margin: 0,
    color: 'var(--text-primary)',
    fontWeight: '600'
};

const CHANGELOG_ENTRY_META_STYLE = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
};

const CHANGELOG_ENTRY_DATE_STYLE = {
    fontSize: '0.75rem',
    color: 'var(--text-secondary)'
};

const CHANGELOG_VERSION_BADGE_STYLE = {
    background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
    padding: '0.15rem 0.5rem',
    borderRadius: '6px',
    fontSize: '0.7rem',
    fontWeight: '600',
    color: 'white'
};

const CHANGELOG_CHANGES_CONTAINER_STYLE = {
    marginTop: '0.75rem'
};

const CHANGELOG_CHANGE_ROW_BASE_STYLE = {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    display: 'flex',
    gap: '0.6rem',
    alignItems: 'flex-start'
};

const CHANGELOG_CHANGE_TAG_BASE_STYLE = {
    display: 'inline-block',
    padding: '0.15rem 0.4rem',
    borderRadius: '4px',
    fontSize: '0.65rem',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    minWidth: '55px',
    textAlign: 'center',
    flexShrink: 0
};

const CHANGELOG_CHANGE_DESCRIPTION_STYLE = {
    flex: 1,
    lineHeight: '1.5'
};

function getChangelogEntryStyle(isLast: boolean) {
    return {
        marginBottom: isLast ? 0 : '1.5rem',
        paddingBottom: isLast ? 0 : '1.5rem',
        borderBottom: isLast ? 'none' : '1px solid var(--surface-border)'
    };
}

function getChangelogChangeRowStyle(isLast: boolean) {
    return {
        ...CHANGELOG_CHANGE_ROW_BASE_STYLE,
        marginBottom: isLast ? 0 : '0.6rem'
    };
}

function getChangelogTypeTagStyle(type: ChangelogEntry['changes'][number]['type']) {
    if (type === 'new') {
        return {
            ...CHANGELOG_CHANGE_TAG_BASE_STYLE,
            background: 'rgba(16, 185, 129, 0.15)',
            color: '#10b981',
            border: '1px solid rgba(16, 185, 129, 0.3)'
        };
    }

    if (type === 'improved') {
        return {
            ...CHANGELOG_CHANGE_TAG_BASE_STYLE,
            background: 'rgba(59, 130, 246, 0.15)',
            color: '#3b82f6',
            border: '1px solid rgba(59, 130, 246, 0.3)'
        };
    }

    return {
        ...CHANGELOG_CHANGE_TAG_BASE_STYLE,
        background: 'rgba(251, 191, 36, 0.15)',
        color: '#fbbf24',
        border: '1px solid rgba(251, 191, 36, 0.3)'
    };
}

function getChangelogTypeLabel(type: ChangelogEntry['changes'][number]['type']) {
    if (type === 'new') return 'Nytt';
    if (type === 'improved') return 'Bättre';
    return 'Fixat';
}

export function ChangelogPanel() {
    return (
        <section style={CHANGELOG_SECTION_STYLE}>
            <h3 style={CHANGELOG_TITLE_STYLE}>Nyheter & Uppdateringar</h3>
            <div>
                {CHANGELOG.map((entry: ChangelogEntry, index: number) => (
                    <div key={entry.version} style={getChangelogEntryStyle(index === CHANGELOG.length - 1)}>
                        <div style={CHANGELOG_ENTRY_HEADER_STYLE}>
                            <h4 style={CHANGELOG_ENTRY_TITLE_STYLE}>
                                {entry.title}
                            </h4>
                            <div style={CHANGELOG_ENTRY_META_STYLE}>
                                <span style={CHANGELOG_ENTRY_DATE_STYLE}>
                                    {entry.date}
                                </span>
                                <span style={CHANGELOG_VERSION_BADGE_STYLE}>
                                    v{entry.version}
                                </span>
                            </div>
                        </div>
                        <div style={CHANGELOG_CHANGES_CONTAINER_STYLE}>
                            {entry.changes.map((change, idx) => (
                                <div key={idx} style={getChangelogChangeRowStyle(idx === entry.changes.length - 1)}>
                                    <span style={getChangelogTypeTagStyle(change.type)}>
                                        {getChangelogTypeLabel(change.type)}
                                    </span>
                                    <span style={CHANGELOG_CHANGE_DESCRIPTION_STYLE}>{change.description}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
