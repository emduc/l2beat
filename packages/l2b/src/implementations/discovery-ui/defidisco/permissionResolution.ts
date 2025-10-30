import { DiscoveryPaths } from '@l2beat/discovery'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import type {
  ApiResolvedPermissionsResponse,
  ResolvedContractPermissions,
  ResolvedFunctionPermission,
  UltimateOwner,
  ViaStep,
  ApiPermissionOverridesResponse,
  PermissionOverride,
  OwnerDefinition,
  ApiAddressType,
} from './types'
import { resolveOwnersFromDiscovered, resolveDelayFromDiscovered, type ResolvedOwner } from './permissionOverrides'

/**
 * Internal data structure for ownership graph
 * Maps contract address -> owners (with their owner definitions)
 */
interface OwnershipGraph {
  [contractAddress: string]: {
    functionOwners: {
      [functionName: string]: {
        ownerDefinitions: OwnerDefinition[]
        delay?: { contractAddress: string; fieldName: string }
      }
    }
  }
}

/**
 * Discovered entry from discovered.json
 */
interface DiscoveredEntry {
  address: string
  type: ApiAddressType
  fields?: any[]
  values?: any
}

/**
 * Get the type of an address from discovered.json
 */
export function getAddressType(
  address: string,
  discovered: { entries: DiscoveredEntry[] }
): ApiAddressType {
  const entry = discovered.entries.find(e => e.address === address)
  return entry?.type ?? 'Unknown'
}

/**
 * Check if an address type is terminal (stops resolution)
 * Terminal addresses: EOA, Multisig, Unknown
 */
export function isTerminalAddress(addressType: ApiAddressType): boolean {
  return addressType === 'EOA' ||
         addressType === 'Multisig' ||
         addressType === 'Unknown'
}

/**
 * Build ownership graph from permission-overrides.json
 * Parses all contracts and their permissioned functions' owner definitions
 */
export function buildOwnershipGraph(
  permissionOverrides: ApiPermissionOverridesResponse
): OwnershipGraph {
  const graph: OwnershipGraph = {}

  for (const [contractAddress, contractPerms] of Object.entries(permissionOverrides.contracts)) {
    // Initialize contract entry
    graph[contractAddress] = { functionOwners: {} }

    for (const func of contractPerms.functions) {
      // Only process permissioned functions with owner definitions
      if (func.userClassification === 'permissioned' && func.ownerDefinitions) {
        graph[contractAddress]!.functionOwners[func.functionName] = {
          ownerDefinitions: func.ownerDefinitions,
          delay: func.delay
        }
      }
    }
  }

  return graph
}

/**
 * Resolve owner definitions to actual addresses
 * Uses existing resolution logic from permissionOverrides.ts
 */
export function resolveOwnerDefinitionsToAddresses(
  paths: DiscoveryPaths,
  project: string,
  contractAddress: string,
  ownerDefinitions: OwnerDefinition[]
): string[] {
  const resolvedOwners = resolveOwnersFromDiscovered(
    paths,
    project,
    contractAddress,
    ownerDefinitions
  )

  // Extract successfully resolved addresses
  return resolvedOwners
    .filter(owner => owner.isResolved)
    .map(owner => owner.address)
}

/**
 * Result of tracing an owner path
 * Can contain multiple ultimate owners if there are multiple paths
 */
interface TraceResult {
  ultimateOwners: Array<{
    address: string
    addressType: ApiAddressType
    via: ViaStep[]
    delays: number[]
  }>
  warnings: string[]
}

/**
 * Trace owner path recursively with cycle detection
 * Follows ownership chain until reaching a terminal address (EOA, Multisig, Unknown)
 * Returns ALL ultimate owners reachable through all possible paths
 *
 * @param currentAddress - Address we're currently examining
 * @param paths - Discovery paths for file access
 * @param project - Project name
 * @param visited - Set of addresses already visited (for cycle detection)
 * @param graph - Ownership graph from permission-overrides.json
 * @param discovered - Discovered.json data
 * @param viaPath - Current path of intermediate contracts
 * @param delays - Delays accumulated at each step
 * @returns TraceResult with all ultimate owners and warnings
 */
export function traceOwnerPath(
  currentAddress: string,
  paths: DiscoveryPaths,
  project: string,
  visited: Set<string>,
  graph: OwnershipGraph,
  discovered: { entries: DiscoveredEntry[] },
  viaPath: ViaStep[],
  delays: number[]
): TraceResult {
  // Check for cycles
  if (visited.has(currentAddress)) {
    // Build cycle path string
    const cycleStartIndex = viaPath.findIndex(step => step.address === currentAddress)
    const cyclePath = cycleStartIndex >= 0
      ? [...viaPath.slice(cycleStartIndex), { address: currentAddress, addressType: getAddressType(currentAddress, discovered) }]
          .map(step => step.address)
          .join(' → ')
      : `${currentAddress} (cycle detected)`

    return {
      ultimateOwners: [],
      warnings: [`Cycle detected: ${cyclePath}`]
    }
  }

  // Get address type
  const addressType = getAddressType(currentAddress, discovered)

  // Check if terminal address
  if (isTerminalAddress(addressType)) {
    return {
      ultimateOwners: [{
        address: currentAddress,
        addressType,
        via: viaPath,
        delays
      }],
      warnings: []
    }
  }

  // Not terminal - need to resolve further
  // Check if this contract has permission owners defined
  const contractPerms = graph[currentAddress]
  if (!contractPerms || Object.keys(contractPerms.functionOwners).length === 0) {
    // This contract has no permission owners defined
    // Treat it as terminal (can't resolve further)
    return {
      ultimateOwners: [{
        address: currentAddress,
        addressType,
        via: viaPath,
        delays
      }],
      warnings: []
    }
  }

  // Contract has permission owners - collect all unique owners across all functions
  const allOwnerDefs: OwnerDefinition[] = []
  const functionDelays: Array<{ contractAddress: string; fieldName: string }> = []

  for (const funcData of Object.values(contractPerms.functionOwners)) {
    if (funcData.ownerDefinitions) {
      allOwnerDefs.push(...funcData.ownerDefinitions)
    }
    if (funcData.delay) {
      functionDelays.push(funcData.delay)
    }
  }

  // Resolve owner definitions to addresses
  const ownerAddresses = resolveOwnerDefinitionsToAddresses(
    paths,
    project,
    currentAddress,
    allOwnerDefs
  )

  if (ownerAddresses.length === 0) {
    // No owners resolved - treat as terminal
    return {
      ultimateOwners: [{
        address: currentAddress,
        addressType,
        via: viaPath,
        delays
      }],
      warnings: []
    }
  }

  // Recursively trace each owner and collect ALL ultimate owners
  const allUltimateOwners: Array<{
    address: string
    addressType: ApiAddressType
    via: ViaStep[]
    delays: number[]
  }> = []
  const allWarnings: string[] = []

  // Create a new visited set for child paths (includes current address)
  // This allows parallel branches to explore the same addresses independently
  const newVisited = new Set(visited)
  newVisited.add(currentAddress)

  for (const ownerAddress of ownerAddresses) {
    // Calculate delay for this step
    let stepDelay = 0
    for (const delayRef of functionDelays) {
      const resolvedDelay = resolveDelayFromDiscovered(paths, project, delayRef)
      if (resolvedDelay.isResolved) {
        stepDelay = Math.max(stepDelay, resolvedDelay.seconds)
      }
    }

    // Add current address to via path
    const newViaPath: ViaStep[] = [
      ...viaPath,
      {
        address: currentAddress,
        addressType,
        delay: stepDelay > 0 ? stepDelay : undefined,
        delayFormatted: stepDelay > 0 ? formatDelay(stepDelay) : undefined
      }
    ]

    // Add delay to delays array
    const newDelays = [...delays]
    if (stepDelay > 0) {
      newDelays.push(stepDelay)
    }

    // Recursively trace with the new visited set (per-path)
    const result = traceOwnerPath(
      ownerAddress,
      paths,
      project,
      newVisited, // Use the new visited set for this branch
      graph,
      discovered,
      newViaPath,
      newDelays
    )

    // Collect all ultimate owners and warnings from this path
    allUltimateOwners.push(...result.ultimateOwners)
    allWarnings.push(...result.warnings)
  }

  return {
    ultimateOwners: allUltimateOwners,
    warnings: allWarnings
  }
}

/**
 * Resolve permissions for a project
 * Main entry point for permission resolution
 */
export function resolvePermissionsForProject(
  paths: DiscoveryPaths,
  project: string
): ApiResolvedPermissionsResponse {
  // Load permission-overrides.json
  const overridesPath = path.join(paths.discovery, project, 'permission-overrides.json')
  if (!fs.existsSync(overridesPath)) {
    throw new Error(`permission-overrides.json not found for project ${project}`)
  }

  const permissionOverrides: ApiPermissionOverridesResponse = JSON.parse(
    fs.readFileSync(overridesPath, 'utf8')
  )

  // Load discovered.json
  const discoveredPath = path.join(paths.discovery, project, 'discovered.json')
  if (!fs.existsSync(discoveredPath)) {
    throw new Error(`discovered.json not found for project ${project}`)
  }

  const discoveredContent = fs.readFileSync(discoveredPath, 'utf8')
  const discovered = JSON.parse(discoveredContent)

  // Calculate hash of discovered.json for tracking
  const discoveredHash = crypto.createHash('sha256').update(discoveredContent).digest('hex').substring(0, 16)

  // Build ownership graph
  const graph = buildOwnershipGraph(permissionOverrides)

  // Resolve permissions for each contract
  const resolvedContracts: Record<string, ResolvedContractPermissions> = {}

  for (const [contractAddress, contractPerms] of Object.entries(permissionOverrides.contracts)) {
    const resolvedFunctions: ResolvedFunctionPermission[] = []

    for (const func of contractPerms.functions) {
      // Only resolve permissioned functions
      if (func.userClassification !== 'permissioned') {
        continue
      }

      // Resolve direct owners
      const directOwners = func.ownerDefinitions
        ? resolveOwnerDefinitionsToAddresses(paths, project, contractAddress, func.ownerDefinitions)
        : []

      // Trace to ultimate owners
      // Use a PER-PATH visited set to allow exploring the same address
      // from different paths (to find all ultimate owners)
      const ultimateOwners: UltimateOwner[] = []
      const warnings: string[] = []

      for (const directOwner of directOwners) {
        const result = traceOwnerPath(
          directOwner,
          paths,
          project,
          new Set(), // separate visited set for each path to allow finding all owners
          graph,
          discovered,
          [], // empty via path
          [] // empty delays
        )

        // Collect all ultimate owners from this trace
        for (const ultimateOwner of result.ultimateOwners) {
          // Calculate cumulative delay
          const cumulativeDelay = ultimateOwner.delays.reduce((sum, d) => sum + d, 0)

          ultimateOwners.push({
            address: ultimateOwner.address,
            addressType: ultimateOwner.addressType,
            via: ultimateOwner.via,
            delays: ultimateOwner.delays,
            cumulativeDelay,
            cumulativeDelayFormatted: formatDelay(cumulativeDelay)
          })
        }

        // Collect warnings
        warnings.push(...result.warnings)
      }

      // Deduplicate ultimate owners by (address, via path)
      const deduplicatedOwners = deduplicateUltimateOwners(ultimateOwners)

      // Add resolved function
      resolvedFunctions.push({
        functionName: func.functionName,
        directOwners,
        ultimateOwners: deduplicatedOwners,
        warnings
      })
    }

    // Only include contracts with permissioned functions
    if (resolvedFunctions.length > 0) {
      resolvedContracts[contractAddress] = {
        functions: resolvedFunctions
      }
    }
  }

  return {
    version: '1.0',
    lastModified: new Date().toISOString(),
    generatedFrom: {
      permissionOverridesVersion: permissionOverrides.version,
      discoveredJsonHash: discoveredHash
    },
    contracts: resolvedContracts
  }
}

/**
 * Deduplicate ultimate owners by (address, via path)
 * Two owners are considered duplicates if they have the same address
 * and the same via chain (same addresses in the same order)
 */
function deduplicateUltimateOwners(owners: UltimateOwner[]): UltimateOwner[] {
  const seen = new Map<string, UltimateOwner>()

  for (const owner of owners) {
    // Create a unique key based on address and via path
    const viaKey = owner.via.map(step => step.address).join('→')
    const key = `${owner.address}|${viaKey}`

    // Only keep the first occurrence
    if (!seen.has(key)) {
      seen.set(key, owner)
    }
  }

  return Array.from(seen.values())
}

/**
 * Format delay in seconds to human-readable string
 */
function formatDelay(seconds: number): string {
  if (seconds === 0) return '0s'

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (secs > 0) parts.push(`${secs}s`)

  return parts.join(' ')
}

/**
 * Save resolved permissions to resolved-permissions.json
 */
export function saveResolvedPermissions(
  paths: DiscoveryPaths,
  project: string,
  resolved: ApiResolvedPermissionsResponse
): void {
  const resolvedPath = path.join(paths.discovery, project, 'resolved-permissions.json')

  // Ensure directory exists
  const dir = path.dirname(resolvedPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Write file
  fs.writeFileSync(resolvedPath, JSON.stringify(resolved, null, 2))
}
