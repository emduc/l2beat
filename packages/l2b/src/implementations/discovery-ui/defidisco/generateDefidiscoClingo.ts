import { DiscoveryPaths } from '@l2beat/discovery'
import * as fs from 'fs'
import * as path from 'path'
import { resolveOwnersFromDiscovered, resolveDelayFromDiscovered } from './permissionOverrides'
import type {
  ApiPermissionOverridesResponse,
  ApiAddressType,
  OwnerDefinition,
} from './types'

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
 * Generate Clingo facts from DefidDisco permission-overrides.json
 * Produces facts compatible with L2BEAT's modelPermissions.lp
 */
export function generateDefidiscoClingoFacts(
  paths: DiscoveryPaths,
  project: string
): string {
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

  const discovered = JSON.parse(fs.readFileSync(discoveredPath, 'utf8'))

  const facts: string[] = []

  // Collect all addresses we'll reference and track who passes act permissions
  const allAddresses = new Set<string>()
  const addressesPassingActPermission = new Set<string>()

  // Add all contract addresses from permission-overrides
  for (const contractAddress of Object.keys(permissionOverrides.contracts)) {
    allAddresses.add(contractAddress)
  }

  // Generate permission facts
  for (const [contractAddress, contractPerms] of Object.entries(permissionOverrides.contracts)) {
    for (const func of contractPerms.functions) {
      // Only process permissioned functions with owner definitions
      if (func.userClassification !== 'permissioned' || !func.ownerDefinitions) {
        continue
      }

      // Resolve owner definitions to addresses
      const resolvedOwners = resolveOwnersFromDiscovered(
        paths,
        project,
        contractAddress,
        func.ownerDefinitions
      )

      // Get permission types from owner definitions (defaults to undefined, will be determined below)
      const explicitPermissionTypes = func.ownerDefinitions.map(od => od.permissionType)

      // Resolve delay if present
      let delaySeconds = 0
      if (func.delay) {
        const resolvedDelay = resolveDelayFromDiscovered(paths, project, func.delay)
        if (resolvedDelay.isResolved) {
          delaySeconds = resolvedDelay.seconds
        }
      }

      // Generate a permission fact for each resolved owner
      resolvedOwners.forEach((owner, index) => {
        if (!owner.isResolved) {
          return
        }

        // Add owner address to the set
        allAddresses.add(owner.address)

        // Determine permission type based on owner address type
        // If explicit permission type is set, use it
        // Otherwise, use 'act' for EOAs/Multisigs, 'admin' for contracts
        const explicitType = explicitPermissionTypes[index % explicitPermissionTypes.length]
        let permissionType: string

        if (explicitType) {
          permissionType = explicitType
        } else {
          // Look up owner's address type in discovered.json
          const ownerEntry = discovered.entries.find((e: DiscoveredEntry) => e.address === owner.address)
          const ownerType = ownerEntry?.type

          // EOAs and Multisigs get 'act' (can execute transactions)
          // All other types get 'admin' (administrative control, non-transitive)
          if (ownerType === 'EOA' || ownerType === 'EOAPermissioned' || ownerType === 'Multisig') {
            permissionType = 'act'
          } else {
            permissionType = 'admin'
          }
        }

        // Track addresses that pass act permission
        if (permissionType === 'act') {
          addressesPassingActPermission.add(owner.address)
        }

        // Create role name from function name (escaped for Clingo)
        const role = escapeString(func.functionName)

        // Use nil for description to avoid escaping issues for now
        // TODO: Implement proper description escaping
        const description = 'nil'

        // Generate permission fact
        // Format: permission(receiver, "type", giver, delay, description, "role")
        // receiver = contract with the function
        // giver = owner who has the permission
        facts.push(
          `permission(${formatAddress(contractAddress)}, "${permissionType}", ${formatAddress(owner.address)}, ${delaySeconds}, ${description}, "${role}").`
        )
      })
    }
  }

  // Generate address and addressType facts for all referenced addresses
  for (const address of allAddresses) {
    const entry = discovered.entries.find((e: DiscoveredEntry) => e.address === address)

    // Extract chain from address (format: "eth:0x...")
    const chain = address.includes(':') ? address.split(':')[0] : 'eth'
    const fullAddress = address.includes(':') ? address : `${chain}:${address}`

    // Generate address fact
    // The third parameter should be the full chain-specific address for ModelIdRegistry
    facts.push(
      `address(${formatAddress(address)}, "${chain}", "${fullAddress}").`
    )

    // Generate addressType fact
    // If address is not in entries, treat it as unknown (likely an external address)
    const addressType = entry ? mapAddressType(entry.type) : 'unknown'
    facts.push(
      `addressType(${formatAddress(address)}, ${addressType}).`
    )

    // Generate canActIndependently fact for addresses that don't pass act permission
    // This is critical for performance - without it, Clingo has to use expensive negation inference
    if (!addressesPassingActPermission.has(address)) {
      facts.push(
        `canActIndependently(${formatAddress(address)}).`
      )
    }
  }

  // Add empty defaults for optional predicates to prevent Clingo warnings
  // These are referenced in modelPermissions.lp but not always needed
  facts.push('% Empty defaults for optional predicates')
  facts.push('msig("_dummy", 0) :- #false.')
  facts.push('member("_dummy", "_dummy") :- #false.')
  facts.push('permissionCondition("_dummy", "_dummy", "_dummy", 0, "_dummy", "_dummy", "_dummy") :- #false.')
  facts.push('preventActingIndependently("_dummy") :- #false.')

  return facts.join('\n')
}

/**
 * Format address for Clingo
 * Converts "eth:0x..." to "eth_0x..."
 */
function formatAddress(address: string): string {
  return address.replace(':', '_')
}

/**
 * Escape strings for Clingo
 * Must escape backslashes first, then quotes
 */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/"/g, '\\"')     // Then escape quotes
    .replace(/\n/g, '\\n')    // Escape newlines
    .replace(/\r/g, '\\r')    // Escape carriage returns
    .replace(/\t/g, '\\t')    // Escape tabs
}

/**
 * Map DefidDisco address types to Clingo address types
 */
function mapAddressType(apiType: ApiAddressType): string {
  switch (apiType) {
    case 'EOA':
    case 'EOAPermissioned':
      return 'eoa'
    case 'Multisig':
      return 'multisig'
    case 'Contract':
    case 'Diamond':
    case 'Timelock':
      return 'contract'
    case 'Unverified':
    case 'Token':
    case 'Unknown':
    default:
      return 'unknown'
  }
}
