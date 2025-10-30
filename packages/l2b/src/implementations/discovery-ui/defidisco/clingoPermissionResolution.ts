import {
  DiscoveryPaths,
  parseClingoFact,
  runClingoForSingleModel,
  KnowledgeBase,
  ModelIdRegistry,
  type ClingoFact,
} from '@l2beat/discovery'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { generateDefidiscoClingoFacts } from './generateDefidiscoClingo'
import type {
  ApiResolvedPermissionsResponse,
  ResolvedContractPermissions,
  ResolvedFunctionPermission,
  UltimateOwner,
  ViaStep,
  ApiAddressType,
} from './types'

/**
 * Resolve permissions for a project using Clingo (L2BEAT's approach)
 * Main entry point for permission resolution
 */
export async function resolvePermissionsForProject(
  paths: DiscoveryPaths,
  project: string
): Promise<ApiResolvedPermissionsResponse> {
  // Generate Clingo facts from permission-overrides.json
  const defidiscoFacts = generateDefidiscoClingoFacts(paths, project)

  // Load modelPermissions.lp rules
  const modelPermissionsPath = path.join(paths.discovery, '_clingo', 'modelPermissions.lp')
  if (!fs.existsSync(modelPermissionsPath)) {
    throw new Error('modelPermissions.lp not found')
  }
  const modelPermissionsRules = fs.readFileSync(modelPermissionsPath, 'utf8')

  // Combine facts and rules
  const clingoInput = defidiscoFacts + '\n' + modelPermissionsRules

  // Debug: Save Clingo input for inspection
  const debugPath = path.join(paths.discovery, project, 'clingo-debug.lp')
  fs.writeFileSync(debugPath, clingoInput)
  console.log(`Clingo input saved to ${debugPath}`)

  // Run Clingo
  const facts = await runClingoForSingleModel(clingoInput)

  // Parse Clingo output
  const parsedFacts = facts.map(parseClingoFact)

  // Build knowledge base and registry
  const kb = new KnowledgeBase(parsedFacts)
  const modelIdRegistry = new ModelIdRegistry(kb)

  // Get ultimatePermission facts
  const ultimatePermissionFacts = kb.getFacts('ultimatePermission')

  // Load discovered.json for metadata
  const discoveredPath = path.join(paths.discovery, project, 'discovered.json')
  const discoveredContent = fs.readFileSync(discoveredPath, 'utf8')
  const discovered = JSON.parse(discoveredContent)
  const discoveredHash = crypto.createHash('sha256').update(discoveredContent).digest('hex').substring(0, 16)

  // Load permission-overrides.json for version
  const overridesPath = path.join(paths.discovery, project, 'permission-overrides.json')
  const permissionOverrides = JSON.parse(fs.readFileSync(overridesPath, 'utf8'))

  // Group permissions by contract and function
  const resolvedContracts: Record<string, ResolvedContractPermissions> = {}

  for (const fact of ultimatePermissionFacts) {
    const parsed = parseUltimatePermissionFact(fact, modelIdRegistry, discovered)

    // Get contract address (receiver)
    const contractAddress = parsed.receiver

    // Get function name (role)
    const functionName = parsed.role

    // Get direct owner (giver)
    const directOwner = parsed.from

    // Get ultimate owner
    const ultimateOwner: UltimateOwner = {
      address: parsed.from,
      addressType: parsed.addressType,
      via: parsed.via,
      delays: parsed.delays,
      cumulativeDelay: parsed.cumulativeDelay,
      cumulativeDelayFormatted: formatDelay(parsed.cumulativeDelay)
    }

    // Initialize contract if needed
    if (!resolvedContracts[contractAddress]) {
      resolvedContracts[contractAddress] = {
        functions: []
      }
    }

    // Find or create function entry
    let functionEntry = resolvedContracts[contractAddress]!.functions.find(
      f => f.functionName === functionName
    )

    if (!functionEntry) {
      functionEntry = {
        functionName,
        directOwners: [],
        ultimateOwners: [],
        warnings: []
      }
      resolvedContracts[contractAddress]!.functions.push(functionEntry)
    }

    // Add direct owner if not already present
    if (!functionEntry.directOwners.includes(directOwner)) {
      functionEntry.directOwners.push(directOwner)
    }

    // Add ultimate owner (Clingo already handles deduplication)
    functionEntry.ultimateOwners.push(ultimateOwner)
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
 * Parse ultimatePermission fact from Clingo output
 */
function parseUltimatePermissionFact(
  fact: ClingoFact,
  modelIdRegistry: ModelIdRegistry,
  discovered: any
) {
  // ultimatePermission(Receiver, OriginalPermission, Giver, OriginalDelay, OriginalDescription, OriginalRole, OriginalCondition, TotalDelay, Via, isFinal)
  const receiver = modelIdRegistry.idToChainSpecificAddress(String(fact.params[0]))
  const permissionType = String(fact.params[1])
  const giver = modelIdRegistry.idToChainSpecificAddress(String(fact.params[2]))
  const originalDelay = Number(fact.params[3])
  const description = fact.params[4] === undefined ? '' : String(fact.params[4])
  const role = fact.params[5] === undefined ? '' : String(fact.params[5])
  const totalDelay = Number(fact.params[7])
  const viaParam = fact.params[8]

  // Parse via chain
  const via: ViaStep[] = []
  const delays: number[] = []

  if (viaParam !== undefined && Array.isArray(viaParam)) {
    // Via is a cons list of tuples: [(Via, ViaPermission, ViaDelay, ViaCondition), ...]
    for (const viaItem of viaParam) {
      if (viaItem !== null && typeof viaItem === 'object' && 'params' in viaItem) {
        const viaFact = viaItem as ClingoFact
        if (viaFact.atom === 'tuple' && viaFact.params.length >= 3) {
          const viaAddress = modelIdRegistry.idToChainSpecificAddress(String(viaFact.params[0]))
          const viaDelay = Number(viaFact.params[2])

          // Get address type
          const addressType = getAddressType(viaAddress, discovered)

          via.push({
            address: viaAddress,
            addressType,
            delay: viaDelay > 0 ? viaDelay : undefined,
            delayFormatted: viaDelay > 0 ? formatDelay(viaDelay) : undefined
          })

          if (viaDelay > 0) {
            delays.push(viaDelay)
          }
        }
      }
    }
  }

  // Get address type for giver
  const giverAddressType = getAddressType(giver, discovered)

  return {
    receiver,
    permissionType,
    from: giver,
    addressType: giverAddressType,
    originalDelay,
    description,
    role,
    cumulativeDelay: totalDelay,
    via,
    delays
  }
}

/**
 * Get the type of an address from discovered.json
 */
function getAddressType(address: string, discovered: { entries: any[] }): ApiAddressType {
  const entry = discovered.entries.find((e: any) => e.address === address)
  return (entry?.type as ApiAddressType) ?? 'Unknown'
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
