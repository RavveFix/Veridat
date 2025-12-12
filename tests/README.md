# Britta Test Suite

## Directory Structure

```
tests/
├── unit/              # Fast, isolated tests
│   ├── services/      # Service unit tests
│   ├── controllers/   # Controller unit tests
│   ├── utils/         # Utility function tests
│   └── parsers/       # Parser-specific tests (e.g., Monta)
├── integration/       # Cross-module tests
├── fixtures/          # Test data files (sample Excel, mock responses)
├── setup.ts           # Test configuration
└── README.md          # This file
```

## Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- tests/unit/parsers/monta-parser.test.ts

# Run with coverage
npm test -- --coverage
```

## Test Guidelines

1. **Naming**: `*.test.ts` suffix for all test files
2. **Isolation**: Unit tests should mock external dependencies
3. **Fixtures**: Store sample data in `fixtures/` directory
4. **Coverage**: Aim for 80%+ coverage on critical paths (services, parsers)

## Key Test Areas

- **Monta Parser**: Deterministic Excel parsing for EV charging exports
- **Services**: ChatService, FileService, CompanyService logic
- **Controllers**: UI interaction flows (after main.ts refactor)
