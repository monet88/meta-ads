```markdown
# meta-ads Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches the core development patterns and conventions used in the `meta-ads` repository, a TypeScript codebase for ad-related backend and frontend systems. It covers file naming, import/export styles, commit message conventions, testing practices with Vitest, and step-by-step workflows for feature development, shared type synchronization, and test suite expansion.

---

## Coding Conventions

### File Naming
- **Source files:** Use `camelCase` (e.g., `adManager.ts`, `userProfile.tsx`)
- **Test files:** Suffix with `.spec.ts` (e.g., `adManager.spec.ts`)

### Imports

Supports both default and named imports, but prefers named imports for clarity.

```typescript
// Named import (preferred)
import { getAdData, updateAd } from './adService';

// Mixed style (also seen)
import React, { useState } from 'react';
```

### Exports

Prefer **named exports** for modules.

```typescript
// Named export (preferred)
export function getAdData() { /* ... */ }
export const AD_STATUS_ACTIVE = 'active';
```

### Commit Messages

- **Conventional commits**: Use prefixes like `fix:`, `chore:`, `feat:`, `test:`
- **Average length:** ~55 characters
- **Examples:**
  - `feat: add campaign targeting options`
  - `fix: correct ad impression counting logic`
  - `test: add coverage for bidding engine`

---

## Workflows

### Feature Development with Tests and Schema
**Trigger:** When adding a significant new feature or system capability that affects both backend and frontend, requires schema changes, and needs tests.  
**Command:** `/new-feature-with-schema`

1. **Update or add SQL migration files** for any schema changes  
   _Example:_
   ```sql
   -- worker/migrations/20240610_add_campaign_table.sql
   CREATE TABLE campaign (...);
   ```
2. **Modify backend logic or API handlers**  
   _Example:_
   ```typescript
   // worker/src/campaignManager.ts
   export function createCampaign(data: CampaignInput) { ... }
   ```
3. **Update shared type definitions**  
   Edit both:
   - `frontend/src/types.ts`
   - `worker/src/types.ts`
   ```typescript
   // types.ts
   export type Campaign = { id: string; name: string; ... };
   ```
4. **Update or add frontend components if needed**  
   _Example:_
   ```tsx
   // frontend/src/components/CampaignForm.tsx
   ```
5. **Update package files** if dependencies or scripts change  
   - `worker/package.json`
   - `worker/package-lock.json`
6. **Write or update Vitest test files** for new logic  
   _Example:_
   ```typescript
   // worker/test/campaignManager.spec.ts
   import { createCampaign } from '../src/campaignManager';
   ```
7. **Update configuration files** for test/build as needed  
   - `worker/vitest.config.ts`

---

### Add or Update Shared Types
**Trigger:** When adding or modifying TypeScript types shared between frontend and backend.  
**Command:** `/sync-types`

1. **Edit shared type definitions**  
   - `frontend/src/types.ts`
   - `worker/src/types.ts`
   _Example:_
   ```typescript
   // types.ts
   export type AdStatus = 'active' | 'paused' | 'archived';
   ```
2. **Update related implementation files** to use new or changed types

---

### Test Suite Expansion or Setup
**Trigger:** When adding new tests or test setup/configuration for backend logic.  
**Command:** `/add-test-suite`

1. **Add new test files** under `worker/test/`  
   _Example:_
   ```typescript
   // worker/test/adManager.spec.ts
   import { getAdData } from '../src/adManager';
   ```
2. **Edit or add test setup/configuration files**  
   - `worker/test/tsconfig.json`
   - `worker/vitest.config.ts`
3. **Update or add test cases** for new or changed logic

---

## Testing Patterns

- **Framework:** [Vitest](https://vitest.dev/)
- **Test file pattern:** `*.spec.ts` inside `worker/test/`
- **Test example:**
  ```typescript
  // worker/test/adManager.spec.ts
  import { describe, it, expect } from 'vitest';
  import { getAdData } from '../src/adManager';

  describe('getAdData', () => {
    it('returns ad details for valid ID', () => {
      expect(getAdData('123')).toMatchObject({ id: '123' });
    });
  });
  ```
- **Configuration:** `worker/vitest.config.ts`, `worker/test/tsconfig.json`

---

## Commands

| Command                   | Purpose                                                             |
|---------------------------|---------------------------------------------------------------------|
| /new-feature-with-schema  | Start a feature with schema, logic, types, and tests                |
| /sync-types               | Synchronize or update shared TypeScript types                       |
| /add-test-suite           | Add or expand test files and configuration                          |
```
