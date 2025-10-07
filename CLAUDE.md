# DefidDisco Development Guide

## L2BEAT Architecture Reference

### Core System Overview
**L2BEAT** is a TypeScript monorepo for analyzing Ethereum Layer 2 protocols. **DefidDisco** is a fork enhanced for DeFi analysis.

**Key Packages:**
- **`discovery`**: Core contract analysis engine (keep unchanged)
- **`protocolbeat`**: React UI with Monaco editor
- **`l2b`**: CLI tool and API server
- **`config`**: Project configurations and results

**Commands:**
```bash
# Setup and run
pnpm install && pnpm build:dependencies
cd ~/defidisco/packages/config && l2b ui  # http://localhost:2021/ui

# Sync upstream
git fetch upstream && git merge upstream/main
```

### Discovery System
**Automated Analysis:** Discovery automatically analyzes any contract by:
- Calling all view/pure functions with 0 parameters
- Testing array functions with indices 0-4
- Detecting proxy patterns and relationships
- Applying templates for known contract types

**Template System:** Contracts matched by bytecode hash to templates in `packages/config/src/projects/_templates/`

**Handler System:** Custom handlers in `packages/discovery/src/discovery/handlers/user/` for specialized analysis

### Data Flow
1. **Config** (`config.jsonc`) → Discovery engine
2. **Analysis** → Results in `discovered.json`
3. **Backend** monitors changes → Frontend displays data

---

## DefidDisco Architecture

### Minimal Integration Principle ⭐
**Core Philosophy**: Minimize modifications to original L2BEAT files to ensure easy upstream merges

### Code Organization
**DefidDisco folders** (keep all our code here):
- `packages/protocolbeat/src/defidisco/` - All UI components, extensions, icons
- `packages/l2b/src/implementations/discovery-ui/defidisco/` - All backend modules
- `packages/discovery/src/discovery/handlers/defidisco/` - Discovery handlers

**Integration points** (minimal modifications only):
- `ValuesPanel.tsx` - Single `<ValuesPanelExtensions>` line
- `TerminalPanel.tsx` - Single `<TerminalExtensions>` line
- `main.ts` - API endpoint registrations (unavoidable)
- `api.ts` - DefidDisco API functions (unavoidable)

### Repository Setup
- **Fork**: `~/defidisco/` (complete L2BEAT fork)
- **Why Fork**: Avoids dependency issues with unpublished internal packages
- **Benefits**: Full toolchain access, easy upstream sync

## DefidDisco Features

### AI-Based Permission Detection ✅
**Manual Detection System**: AI-powered permission analysis with UI button
- **File**: `/defidisco/aiPermissionDetection.ts` - OpenAI (GPT-4) and Claude (Sonnet 3.5) support
- **UI**: "AI Permissions" button in `ValuesPanel.tsx` (once per contract, disabled if permissions exist)
- **Config**: `.env` file with `AI_PROVIDER` (openai/claude) and `AI_API_KEY`
- **Endpoint**: `POST /api/projects/:project/ai-detect-permissions/:address`
- **Features**:
  - Analyzes contract source code to identify permissioned functions
  - Maps functions to correct addresses (proxy vs implementation via .p.sol naming)
  - Validates against ABI to filter hallucinated functions
  - Saves to `permission-overrides.json` with `aiClassification` field (not currently used in UI)
- **Prompt Engineering**: Instructs AI to identify owners with `sourceField` (e.g., "owner", "accessControl") and `dataPath` (e.g., "$self", "DEFAULT_ADMIN_ROLE")

### Interactive Permission Management ✅
**UI System**: Complete permission management in `/defidisco/ValuesPanelExtensions.tsx`
- **Data Structure**: Contract-grouped permissions for O(1) lookups (`contracts[address].functions[]`)
- **Data Separation**: Discovered permissions vs user overrides (persistent)
- **Four Attributes**: Checked (✓), Permission (🔒), Risk Score (⚡), Delay (⏱️)
- **Features**: Expandable functions, code navigation, owner tracking, delay field specification
- **Performance**: File caching, optimistic updates, debounced inputs, efficient contract-specific queries

**Delay Field Feature**: Associate delays with permissioned functions
- **UI**: Select contract + numeric field to specify delay reference
- **Backend**: Resolves delay value from discovered.json in real-time
- **Display**: Shows resolved delay in seconds, indicator icon (⏱️) in collapsed view
- **Storage**: Delay reference stored in `permission-overrides.json` as `{ contractAddress, fieldName }`

### Permissions Report Generation ✅
**Terminal Integration**: Button in `/defidisco/TerminalExtensions.tsx`
- Generates markdown table from contract-grouped `permission-overrides.json`
- Maps addresses to contract names, resolves owner definitions
- Server-Sent Events API for real-time output
- Efficiently processes contract-grouped data structure

### DeFiScan Panel ✅
**Overview Panel**: Contract analysis dashboard in `/defidisco/DeFiScanPanel.tsx`
- **Status Section**: Initial vs discovered contract counts, address type breakdown
- **Contract Types**: Contracts, EOAs, Multisigs, External addresses
- **Permissions Dashboard**: Shows permissioned functions count and review progress
- **Data Sources**: Uses `getProject`, `useContractTags`, and `getPermissionOverrides` APIs
- **Integration**: Registered in `ProjectPage.tsx` and `store.ts` following panel patterns

### External Contract Attributes ✅
**Contract Tagging Enhancement**: Extended contract tags with centralization/mitigation attributes
- **Data Structure**: `contract-tags.json` stores `centralization` (high/medium/low) and `mitigations` (complete/partial/none)
- **UI Component**: `/defidisco/ExternalButton.tsx` with dropdown picker (ColorButton pattern)
- **Features**:
  - Mark contracts as external/internal
  - Two-column attribute selector (Centralization | Mitigations)
  - Reads current values from tags and displays them in picker
  - Async mutations with proper cache invalidation
- **Backend**: `/defidisco/contractTags.ts` preserves attributes across updates
- **Address Format**: Normalizes `eth:0x...` → `0x...` when comparing with tags

### AccessControl Role Support ✅
**OpenZeppelin AccessControl Integration**: Full support for role-based access control
- **Handler**: Use `accessControl` handler in templates or config overrides
  ```jsonc
  "fields": {
    "accessControl": {
      "handler": { "type": "accessControl" }
    }
  }
  ```
- **Discovery**: Automatically detects roles from `RoleGranted`/`RoleRevoked` events
- **Data Structure**: Roles stored in `values.accessControl` with `adminRole` and `members[]`
- **Owner Tracking with Path Expressions**:
  - `$self.accessControl.ROLE_NAME.members` - Only the members array
  - `$self.accessControl.ROLE_NAME` - All addresses in the role (members + any address in adminRole field if it's an address)
  - `@fieldName.accessControl.ROLE_NAME.members` - Members in another contract
  - Example: `{ "path": "$self.accessControl.DEFAULT_ADMIN_ROLE.members" }`
- **Cross-Contract**: Can reference AccessControl roles in external contracts via address fields
- **Resolution**: Works like any other path - navigates the data structure and recursively extracts all addresses
- **Display**: Shows all resolved addresses with click-to-select functionality

---

## Development Guidelines

### 🎯 Minimal Integration Principle
**ALWAYS write new code in `/defidisco/` folders**
- UI components → `packages/protocolbeat/src/defidisco/`
- Backend modules → `packages/l2b/src/implementations/discovery-ui/defidisco/`
- Discovery handlers → `packages/discovery/src/discovery/handlers/defidisco/`

**Integration points should be minimal:**
- Single import + single component usage in UI files
- API functions in `api.ts` (unavoidable for frontend consumption)
- Endpoint registration in `main.ts` (unavoidable for routing)

### Development Patterns
**Handler Development:**
1. Create in `/defidisco/` folder, register in main `index.ts`
2. **Critical**: Run `pnpm run generate-schemas && pnpm build`
3. Handler config must wrap in `"handler"` object

**UI Development:**
1. Create extension components in `/defidisco/`
2. Use React Query with proper cache invalidation
3. Implement optimistic updates with error rollback

**Common Mistakes:**
- ❌ Writing DefidDisco code in original L2BEAT files
- ❌ Not regenerating schemas after handler changes
- ❌ Mixing discovered data with user data
- ❌ Using non-existent hooks (check existing patterns in `/defidisco/` files)
- ❌ Address format mismatches (contracts use `eth:0x...`, tags use `0x...`)
- ❌ Using `??` instead of `!== undefined` for optional fields that can be explicitly cleared
- ❌ Forgetting to rebuild both `protocolbeat` AND `l2b` after backend changes

**Proxy/Implementation Pattern:**
- Proxy contracts contain **both** proxy and implementation ABIs in their `contract.abis[]` array
- When rendering ABIs, each address gets a separate section (implementation functions shown under implementation address)
- Fields are stored on the **proxy contract**, not implementations
- Use `findContractForAddress()` helper in `FunctionFolder.tsx` - automatically resolves implementation addresses to their parent proxy
- Backend converts all `contract.values` to `contract.fields[]` array, so always use fields (no need for values fallback)

### File Structure
```
packages/
├── discovery/src/discovery/handlers/defidisco/
│   └── WriteFunctionPermissionHandler.ts
├── protocolbeat/src/defidisco/
│   ├── ValuesPanelExtensions.tsx
│   ├── TerminalExtensions.tsx
│   ├── DeFiScanPanel.tsx
│   ├── PermissionsDisplay.tsx
│   ├── FunctionFolder.tsx
│   ├── ExternalButton.tsx
│   └── icons/
├── l2b/src/implementations/discovery-ui/defidisco/
│   ├── permissionOverrides.ts
│   ├── contractTags.ts
│   └── generatePermissionsReport.ts
└── config/src/projects/compound-v3/
    └── permission-overrides.json
```

### Data Access Patterns
**API Access**: For new components, follow existing patterns:
- **Project Data**: Use `useQuery` with `getProject(project)` from `api.ts`
- **Contract Tags**: Use `useContractTags(project)` hook for external address marking
- **Permission Overrides**: Use `useQuery` with `getPermissionOverrides(project)` directly (no hook exists)
- **Address Format**: Always normalize `contract.address.replace('eth:', '').toLowerCase()` when matching with tags
- **EOA Counting**: EOAs stored separately in `entry.eoas[]` array, not mixed with contracts

**Contract Tags Data Structure**:
```json
{
  "version": "1.0",
  "lastModified": "2025-09-30T19:47:51.353Z",
  "tags": [
    {
      "contractAddress": "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6",
      "isExternal": true,
      "centralization": "high",
      "mitigations": "complete",
      "timestamp": "2025-09-30T19:47:42.278Z"
    }
  ]
}
```
- **File Location**: `packages/config/src/projects/{project}/contract-tags.json`
- **Fields**: `isExternal` (boolean), `centralization` (high/medium/low), `mitigations` (complete/partial/none)
- **Update Pattern**: Backend preserves existing attributes when updating individual fields

### Permission Overrides Data Structure ✅
**Contract-Grouped Format**: Optimized for O(1) contract lookups and efficient data access
```json
{
  "version": "1.0",
  "lastModified": "2025-09-30T15:21:54.826Z",
  "contracts": {
    "eth:0x123...": {
      "functions": [
        {
          "functionName": "pause",
          "userClassification": "permissioned",
          "checked": true,
          "score": "high-risk",
          "description": "Emergency pause function",
          "ownerDefinitions": [
            {
              "path": "$self.$admin"
            }
          ],
          "delay": {
            "contractAddress": "eth:0x456...",
            "fieldName": "delay"
          },
          "aiClassification": "permissioned",
          "timestamp": "2025-09-30T15:21:54.826Z"
        }
      ]
    }
  }
}
```

**Owner Definitions**:
- **Unified Path Expression**: Single path string that navigates any data structure
- **Path Format**: `<contractRef>.<valuePath>`
  - `<contractRef>`: `$self` (current contract), `@fieldName` (follow address field), or `eth:0xAddress` (absolute)
  - `<valuePath>`: JSONPath-like navigation in contract.values
- **Path Syntax**:
  - Object keys: `field.subfield`
  - Array indices: `field[0]`
  - Dynamic keys: `field[eth:0x123]` or `field[ROLE_HASH]`
- **Examples**:
  - `{ "path": "$self.owner" }` - owner field in current contract
  - `{ "path": "$self.getOwner" }` - call getOwner() in current contract
  - `{ "path": "@governor.signers[0]" }` - follow governor field, get first signer
  - `{ "path": "$self.accessControl.DEFAULT_ADMIN_ROLE.members" }` - AccessControl role members only
  - `{ "path": "$self.accessControl.DEFAULT_ADMIN_ROLE" }` - Entire role object structure preserved (shows admin + members)
  - `{ "path": "@kernel.accessControl.PAUSER_ROLE.members" }` - Role in external contract
  - `{ "path": "eth:0x123...acl.permissions[eth:0x456][ROLE].entities" }` - Complex ACL structure
  - `{ "path": "$self" }` - current contract itself is the owner
- **Structured Value Preservation**: When a path resolves to an object with properties (not just a simple address or array), the entire JSON object structure is preserved and displayed in the UI. This maintains important contextual information like distinguishing between role admins and members. Arrays are not considered structured values to avoid redundancy.
- Multiple owner definitions supported via array
- Use `ownerDefinitions !== undefined` pattern (not `??`) to handle explicit clearing
- **Resolution**: Both frontend (`FunctionFolder.tsx`) and backend (`generatePermissionsReport.ts`) use same logic
  - Parses contract reference and value path separately
  - Navigates any structure with recursive descent
  - **Preserves JSON object structure**: If path resolves to an object (like a role with `{ adminRole, members }`), the entire object structure is preserved
  - **Extracts addresses for listing**: While preserving the structure, also extracts all addresses recursively for address-based operations
  - **Display**: UI shows the full JSON structure when present, plus clickable links to all contained addresses
  - Works with any handler's data format (ACL, AccessControl, custom handlers)
  - Shows contract names with click-to-select functionality

**Delay Field**:
- Stores reference to numeric field (not the value itself)
- Backend resolves value at runtime from discovered.json
- Use `delay !== undefined` pattern (not `??`) to handle explicit clearing

**Access Patterns**:
- **Direct Contract Access**: `permissionOverrides.contracts[contractAddress]` - O(1) lookup
- **Function Lookup**: `contracts[address].functions.find(f => f.functionName === name)` - O(n) only within contract
- **Global Operations**: `Object.values(contracts).flatMap(c => c.functions)` when needed
- **UI Components**: Use `getOverridesForContract(address)` helper for contract-specific data

**Panel Development**: To add new panels:
1. Add panel ID to `PANEL_IDS` in `store.ts`
2. Register component in `PANELS` and `READONLY_PANELS` in `ProjectPage.tsx`
3. Create panel component in `/defidisco/` folder following existing patterns
4. Import and register in `ProjectPage.tsx` with single line addition

**Important Notes**:
- **Permission Owner System**: Uses generalized path expressions that work with **any** handler's data structure (ACL, AccessControl, custom handlers, future handlers). No special cases or hardcoded logic needed.
- **Migration**: All existing permission-overrides.json files have been migrated to the new unified path format (one-off migration, October 2025).

**Future Development:** Follow the minimal integration principle to ensure easy upstream merges and maintainable code separation.