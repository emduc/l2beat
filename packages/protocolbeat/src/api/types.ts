// This file is duplicated in protocolbeat and l2b!

import type { ChainSpecificAddress } from '@l2beat/shared-pure'

export type ApiProjectsResponse = ApiProjectEntry[]

export interface ApiProjectEntry {
  name: string
  addresses: string[]
  contractNames: string[]
}

export interface ApiProjectResponse {
  entries: ApiProjectChain[]
}

export interface ApiPreviewResponse {
  permissionsPerChain: { chain: string; permissions: ApiPreviewPermissions }[]
  contractsPerChain: { chain: string; contracts: ApiPreviewContract[] }[]
}

export interface ApiPreviewPermissions {
  roles: ApiPreviewPermission[]
  actors: ApiPreviewPermission[]
}

export interface ApiPreviewPermission {
  addresses: AddressFieldValue[]
  name: string
  description: string
  multisigParticipants: AddressFieldValue[] | undefined
}

export interface ApiPreviewContract {
  addresses: AddressFieldValue[]
  name: string
  description: string
  upgradableBy: UpgradeabilityActor[] | undefined
}

export interface ApiProjectChain {
  project: string
  initialContracts: ApiProjectContract[]
  discoveredContracts: ApiProjectContract[]
  eoas: ApiAddressEntry[]
  blockNumbers: Record<string, number>
}

export type ApiAddressType =
  | 'EOA'
  | 'EOAPermissioned'
  | 'Unverified'
  | 'Token'
  | 'Multisig'
  | 'Diamond'
  | 'Timelock'
  | 'Contract'
  | 'Unknown'

export interface ApiAddressEntry {
  name?: string
  description?: string
  roles: string[]
  type: ApiAddressType
  referencedBy: ApiAddressReference[]
  address: ChainSpecificAddress
  chain: string
}

export interface ApiAddressReference extends AddressFieldValue {
  fieldNames: string[]
}

export interface Field {
  name: string
  value: FieldValue
  ignoreInWatchMode?: boolean
  ignoreRelatives?: boolean
  handler?: { type: string } & Record<string, unknown>
  description?: string
  severity?: 'HIGH' | 'LOW'
}

export type FieldValue =
  | AddressFieldValue
  | HexFieldValue
  | StringFieldValue
  | NumberFieldValue
  | BooleanFieldValue
  | ArrayFieldValue
  | ObjectFieldValue
  | UnknownFieldValue
  | ErrorFieldValue

export interface AddressFieldValue {
  type: 'address'
  name?: string
  addressType: ApiAddressType
  address: string
}

export interface HexFieldValue {
  type: 'hex'
  value: string
}

export interface StringFieldValue {
  type: 'string'
  value: string
}

export interface NumberFieldValue {
  type: 'number'
  value: string
}

export interface BooleanFieldValue {
  type: 'boolean'
  value: boolean
}

export interface ArrayFieldValue {
  type: 'array'
  values: FieldValue[]
}

export interface ObjectFieldValue {
  type: 'object'
  values: [FieldValue, FieldValue][]
}

export interface UnknownFieldValue {
  type: 'unknown'
  value: string
}

export interface ErrorFieldValue {
  type: 'error'
  error: string
}

export interface ApiProjectContract extends ApiAddressEntry {
  template?: {
    id: string
    shape?: {
      name: string
      hasCriteria: boolean
    }
  }
  proxyType?: string
  fields: Field[]
  abis: ApiAbi[]
  implementationNames?: Record<string, string>
}

export interface ApiAbi {
  address: string
  entries: ApiAbiEntry[]
}

export interface ApiAbiEntry {
  value: string
  signature?: string
  topic?: string
}

export interface ApiCodeResponse {
  entryName: string | undefined
  sources: { name: string; code: string }[]
}

export interface ApiCodeSearchResponse {
  matches: {
    name: string | undefined
    address: string
    codeLocation: {
      line: string
      fileName: string
      index: number
      offset: number
    }[]
  }[]
}

export interface UpgradeabilityActor {
  name: string
  delay: string
}

// Permission overrides types
export interface ApiPermissionOverridesResponse {
  version: string
  lastModified: string
  contracts: Record<string, ContractPermissions>
}

export interface ContractPermissions {
  functions: PermissionOverride[]
}

export interface PermissionOverride {
  functionName: string
  userClassification: 'permissioned' | 'non-permissioned'
  aiClassification?: 'permissioned' | 'non-permissioned'  // NEW: AI-detected classification
  checked?: boolean
  score?: 'unscored' | 'low-risk' | 'medium-risk' | 'high-risk'
  reason?: string
  description?: string
  timestamp: string
  // NEW: Multiple owner definitions using L2BEAT's existing handlers
  ownerDefinitions?: OwnerDefinition[]
  // Delay field reference
  delay?: {
    contractAddress: string
    fieldName: string
  }
}

// Owner definition types - unified path expression approach
// Path format: <contractRef>.<valuePath>
// - <contractRef>: $self (current contract), @fieldName (follow address field), or eth:0xAddress (absolute address)
// - <valuePath>: JSONPath-like navigation in contract.values (e.g., owner, signers[0], accessControl.ADMIN.members)
// Examples:
//   "$self.owner" - owner field in current contract
//   "@governor.accessControl.PAUSER_ROLE.members" - follow governor field, get role members
//   "eth:0x123...acl.permissions[eth:0x456][ROLE].entities" - absolute address for complex structures
//   "$self" - current contract itself is the owner (shorthand for no value path)

// Permission types - matches L2BEAT's permission system
// Only "act" permissions chain transitively in permission resolution
export type PermissionType =
  // Base permissions
  | 'member'      // Membership in a group/multisig
  | 'act'         // Can perform actions (transitive) - only for EOAs/Multisigs
  | 'admin'       // Administrative control (non-transitive) - for contract-to-contract
  | 'interact'    // Can interact with contract
  | 'upgrade'     // Can upgrade contract
  // Role-specific permissions
  | 'challenge'   // Can challenge state
  | 'guard'       // Security guardian role
  | 'propose'     // Can propose changes
  | 'sequence'    // Can sequence transactions
  | 'validate'    // Can validate state
  | 'disperse'    // Can disperse funds
  | 'relayDA'     // Can relay data availability
  | 'operateLinea' // Linea operator
  | 'fastconfirm' // Fast confirmation role
  | 'configure'   // Can configure parameters
  | 'whitelist'   // Can whitelist addresses

export interface OwnerDefinition {
  path: string              // Unified path expression
  permissionType?: PermissionType  // Permission type (defaults to "act" for backward compatibility)
}

export interface ApiPermissionOverridesUpdateRequest {
  contractAddress: string
  functionName: string
  userClassification?: 'permissioned' | 'non-permissioned'
  checked?: boolean
  score?: 'unscored' | 'low-risk' | 'medium-risk' | 'high-risk'
  reason?: string
  description?: string
  ownerDefinitions?: OwnerDefinition[]
  delay?: {
    contractAddress: string
    fieldName: string
  }
}

// Contract tags types
export interface ApiContractTagsResponse {
  version: string
  lastModified: string
  tags: ContractTag[]
}

export interface ContractTag {
  contractAddress: string
  isExternal: boolean
  centralization?: 'high' | 'medium' | 'low'
  mitigations?: 'complete' | 'partial' | 'none'
  timestamp: string
}

export interface ApiContractTagsUpdateRequest {
  contractAddress: string
  isExternal?: boolean
  centralization?: 'high' | 'medium' | 'low'
  mitigations?: 'complete' | 'partial' | 'none'
}

// Resolved permissions types
export interface ApiResolvedPermissionsResponse {
  version: string
  lastModified: string
  generatedFrom: {
    permissionOverridesVersion: string
    discoveredJsonHash: string
  }
  contracts: Record<string, ResolvedContractPermissions>
}

export interface ResolvedContractPermissions {
  functions: ResolvedFunctionPermission[]
}

export interface ResolvedFunctionPermission {
  functionName: string
  directOwners: string[]  // Addresses resolved from ownerDefinitions
  ultimateOwners: UltimateOwner[]
  warnings: string[]
}

export interface UltimateOwner {
  address: string
  addressType: ApiAddressType  // Reuse existing type
  via: ViaStep[]
  delays: number[]  // Individual delays in seconds at each step
  cumulativeDelay: number  // Sum of all delays
  cumulativeDelayFormatted?: string  // Human-readable format
}

export interface ViaStep {
  address: string
  addressType: ApiAddressType
  delay?: number  // Delay in seconds
  delayFormatted?: string  // Human-readable format
}
