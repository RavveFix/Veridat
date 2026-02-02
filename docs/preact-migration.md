# Preact Gradvis Migrations-Guide

## Översikt

Detta dokument beskriver hur vi gradvis migrerar från vanilla TypeScript till Preact-komponenter i Veridat-projektet. Den första migrerade komponenten är **VATReportCard**.

## Varför Preact?

- **Minimal storlek**: ~3-4 KB gzipped
- **Bättre underhållbarhet**: Komponent-baserad arkitektur
- **Type-säkerhet**: Type-safe props med TypeScript
- **Gradvis migration**: Fungerar sömlöst bredvid vanilla kod

## Aktuell Status

### ✅ Migrerade Komponenter

- **VATReportCard** (`src/components/VATReportCard.tsx`)
  - Använder Preact hooks för state management
  - Uppdelad i tre sub-komponenter för bättre struktur
  - Monteras via adapter i `ExcelWorkspace.ts`

### 📦 Legacy Komponenter

- **VATReportCard.legacy.ts** - Bevarad för referens

## Hur man skapar nya Preact-komponenter

### 1. Skapa komponenten

Skapa en `.tsx` fil i `src/components/`:

```typescript
import { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';

interface MyComponentProps {
    title: string;
    onAction?: () => void;
}

export const MyComponent: FunctionComponent<MyComponentProps> = ({ title, onAction }) => {
    const [count, setCount] = useState(0);

    return (
        <div class="my-component">
            <h2>{title}</h2>
            <button onClick={() => setCount(count + 1)}>
                Clicked {count} times
            </button>
            {onAction && (
                <button onClick={onAction}>Action</button>
            )}
        </div>
    );
};
```

**Viktiga detaljer:**
- Använd `class` istället för `className` (Preact skillnad)
- Använd `FunctionComponent` type för komponenter
- Importera hooks från `preact/hooks`

### 2. Montera i vanilla kod

Använd `mountPreactComponent` adapter:

```typescript
import { MyComponent } from './components/MyComponent';
import { mountPreactComponent } from './components/preact-adapter';

// Montera komponenten
const container = document.getElementById('my-container');
const unmount = mountPreactComponent(
    MyComponent,
    { 
        title: 'Hello Preact',
        onAction: () => console.log('Action!')
    },
    container
);

// Viktigt: Rensa upp när komponenten inte längre behövs
// unmount();
```

### 3. Hantera cleanup

**Alltid** spara unmount-funktionen och anropa den när komponenten ska tas bort:

```typescript
class MyManager {
    private componentUnmount?: () => void;

    showComponent() {
        // Unmount previous if exists
        this.componentUnmount?.();

        this.componentUnmount = mountPreactComponent(
            MyComponent,
            { title: 'New instance' },
            container
        );
    }

    cleanup() {
        // VIKTIGT: Anropa vid cleanup
        this.componentUnmount?.();
        this.componentUnmount = undefined;
    }
}
```

## Nästa komponenter att migrera

Rekommenderad migreringsordning (från enklast till svårast):

### 🟢 Låg komplexitet
1. **Validation badges** (redan sub-komponent i VATReportCard)
2. **Transaction lists** (redan sub-komponent i VATReportCard)

### 🟡 Medel komplexitet
3. **Chat message bubbles** - Mycket repetitiv rendering för tillfället
4. **Company selector** - Modal + form hantering
5. **File preview component** - Enkel state management

### 🔴 Hög komplexitet
6. **ExcelWorkspace** - Stor komponent, hantera först när du har mer erfarenhet
7. **Main chat container** - Central del av appen, migrera sist

## Bundle Size Impact

- **Före Preact**: 195.79 kB gzipped
- **Efter Preact**: 201.17 kB gzipped
- **Ökning**: +5.38 kB gzipped

Detta är en acceptabel ökning för att få alla fördelar med en modern komponent-arkitektur.

## Best Practices

### ✅ DO

- Använd `FunctionComponent` type
- Bryt ner stora komponenter i mindre sub-komponenter
- Använd hooks för state management
- Spara och anropa unmount-funktioner
- Använd `class` attribut (inte `className`)

### ❌ DON'T

- Glöm att anropa unmount() vid cleanup
- Blanda vanilla och Preact state management i samma komponent
- Importera `h` manuellt (JSX transform hanterar det)
- Använd `className` (Preact använder `class`)

## Felsökning

### TypeScript-fel: "No overload matches this call"

Om du ser detta fel i `mountPreactComponent`:
- Se till att props-typen är ett `Record<string, any>`
- Komponenten måste ha en riktig `ComponentType` signatur

### Komponenten renderar inte

1. Kontrollera att container-elementet finns i DOM
2. Se till att Preact-komponenten exporteras korrekt
3. Verifiera att props matchar interface-definitionen

### Memory leaks

Om du ser minnesläckor:
- Dubbelkolla att `unmount()` anropas vid cleanup
- Kontrollera att event listeners rensas i `useEffect` cleanup

## Exempel från projektet

Se `src/components/VATReportCard.tsx` för ett fullständigt exempel på:
- State management med `useState`
- Event handlers
- Conditional rendering
- Sub-komponenter
- Props interfaces
