import { DiscoveryPaths } from '@l2beat/discovery'
import * as fs from 'fs'
import * as path from 'path'
import type {
  ApiFunctionsResponse,
  ApiFunctionsUpdateRequest,
  FunctionEntry,
  ContractFunctions,
  OwnerDefinition,
} from './types'
import { DiscoveredDataAccess, resolvePathExpression } from './ownerResolution'

// Interface for resolved owner information
export interface ResolvedOwner {
  address: string
  source: OwnerDefinition
  isResolved: boolean
  error?: string
  // If the resolved value is an object/array with structure, preserve it
  structuredValue?: any
}

// Interface for resolved delay information
export interface ResolvedDelay {
  seconds: number
  isResolved: boolean
  error?: string
}

// Cache for discovered functions to avoid repeated file parsing
const discoveredFunctionsCache = new Map<string, {
  contracts: Record<string, ContractFunctions>
  mtime: number
}>()

export function getFunctions(
  paths: DiscoveryPaths,
  project: string,
): ApiFunctionsResponse {
  const functionsPath = getFunctionsPath(paths, project)
  const discoveredPath = getDiscoveredPath(paths, project)

  // Load user functions
  let userContracts: Record<string, ContractFunctions> = {}
  if (fs.existsSync(functionsPath)) {
    try {
      const fileContent = fs.readFileSync(functionsPath, 'utf8')
      const data = JSON.parse(fileContent) as ApiFunctionsResponse
      userContracts = data.contracts || {}
    } catch (error) {
      console.error('Error parsing functions file:', error)
    }
  }

  // Load discovered functions and convert to contract-grouped format
  const discoveredContracts = loadDiscoveredFunctions(discoveredPath)

  // Merge: user functions take precedence over discovered functions
  const allContracts = mergeContractFunctions(discoveredContracts, userContracts)

  return {
    version: '1.0',
    lastModified: new Date().toISOString(),
    contracts: allContracts,
  }
}

export function updateFunction(
  paths: DiscoveryPaths,
  project: string,
  updateRequest: ApiFunctionsUpdateRequest,
): void {
  const functionsPath = getFunctionsPath(paths, project)

  // Load existing USER functions only (not merged data)
  let userContracts: Record<string, ContractFunctions> = {}
  if (fs.existsSync(functionsPath)) {
    try {
      const fileContent = fs.readFileSync(functionsPath, 'utf8')
      const data = JSON.parse(fileContent) as ApiFunctionsResponse
      userContracts = data.contracts || {}
    } catch (error) {
      console.error('Error parsing functions file:', error)
    }
  }

  const contractAddress = updateRequest.contractAddress
  const functionName = updateRequest.functionName

  // Get or create contract entry
  if (!userContracts[contractAddress]) {
    userContracts[contractAddress] = { functions: [] }
  }

  // Find existing function entry for the same function
  const existingFunctionIndex = userContracts[contractAddress].functions.findIndex(
    (func) => func.functionName === functionName
  )
  const existingFunction = existingFunctionIndex >= 0 ? userContracts[contractAddress].functions[existingFunctionIndex] : undefined

  // Create new function entry, merging with existing data
  const newFunction: FunctionEntry = {
    functionName: updateRequest.functionName,
    isPermissioned: updateRequest.isPermissioned ?? existingFunction?.isPermissioned ?? false,
    checked: updateRequest.checked ?? existingFunction?.checked,
    score: updateRequest.score ?? existingFunction?.score,
    probability: updateRequest.probability ?? existingFunction?.probability,
    reason: updateRequest.reason ?? existingFunction?.reason,
    description: updateRequest.description ?? existingFunction?.description,
    constraints: updateRequest.constraints ?? existingFunction?.constraints,
    ownerDefinitions: updateRequest.ownerDefinitions ?? existingFunction?.ownerDefinitions,
    delay: updateRequest.delay !== undefined ? updateRequest.delay : existingFunction?.delay,
    timestamp: new Date().toISOString(),
  }

  // Update or add the function entry
  if (existingFunctionIndex >= 0) {
    userContracts[contractAddress].functions[existingFunctionIndex] = newFunction
  } else {
    userContracts[contractAddress].functions.push(newFunction)
  }

  // Create updated data
  const updatedData: ApiFunctionsResponse = {
    version: '1.0',
    lastModified: new Date().toISOString(),
    contracts: userContracts,
  }

  // Ensure directory exists
  const dir = path.dirname(functionsPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // Write updated data
  fs.writeFileSync(functionsPath, JSON.stringify(updatedData, null, 2))
}

function getFunctionsPath(
  paths: DiscoveryPaths,
  project: string,
): string {
  // The discovery path points to packages/config/src/projects
  return path.join(
    paths.discovery,
    project,
    'functions.json',
  )
}

function getDiscoveredPath(
  paths: DiscoveryPaths,
  project: string,
): string {
  return path.join(
    paths.discovery,
    project,
    'discovered.json',
  )
}

function loadDiscoveredFunctions(discoveredPath: string): Record<string, ContractFunctions> {
  if (!fs.existsSync(discoveredPath)) {
    return {}
  }

  try {
    // Check cache first
    const stats = fs.statSync(discoveredPath)
    const currentMtime = stats.mtimeMs
    const cached = discoveredFunctionsCache.get(discoveredPath)

    if (cached && cached.mtime === currentMtime) {
      // Return cached result if file hasn't changed
      return cached.contracts
    }

    // File has changed or not cached, parse it
    console.log(`Parsing discovered.json for functions (${Math.round(stats.size / 1024)}KB)...`)
    const fileContent = fs.readFileSync(discoveredPath, 'utf8')
    const discovered = JSON.parse(fileContent)
    const contracts: Record<string, ContractFunctions> = {}

    // Iterate through discovered contracts
    if (discovered.entries && Array.isArray(discovered.entries)) {
      for (const entry of discovered.entries) {
        if (entry.type === 'Contract' && entry.values?.writeFunctionPermissions) {
          const contractAddress = entry.address
          const permissions = entry.values.writeFunctionPermissions

          // Skip if it's a skipped entry
          if (Array.isArray(permissions)) {
            const functions: FunctionEntry[] = []
            for (const permission of permissions) {
              if (permission.function && permission.permissionType) {
                // Convert discovered permission to function entry format
                const isPermissioned = permission.permissionType === 'modifier' ||
                                     permission.permissionType === 'msgSender'

                functions.push({
                  functionName: permission.function,
                  isPermissioned: isPermissioned,
                  timestamp: new Date().toISOString(),
                  reason: `Auto-detected: ${permission.permissionType}${permission.modifiers ? ` (${permission.modifiers.join(', ')})` : ''}`,
                })
              }
            }

            if (functions.length > 0) {
              contracts[contractAddress] = { functions }
            }
          }
        }
      }
    }

    // Cache the result
    discoveredFunctionsCache.set(discoveredPath, {
      contracts,
      mtime: currentMtime
    })

    const totalFunctions = Object.values(contracts).reduce((sum, contract) => sum + contract.functions.length, 0)
    console.log(`Cached ${totalFunctions} discovered functions across ${Object.keys(contracts).length} contracts`)
    return contracts
  } catch (error) {
    console.error('Error parsing discovered.json:', error)
    return {}
  }
}

function mergeContractFunctions(
  discoveredContracts: Record<string, ContractFunctions>,
  userContracts: Record<string, ContractFunctions>
): Record<string, ContractFunctions> {
  const result: Record<string, ContractFunctions> = {}

  // Start with discovered contracts
  for (const [contractAddress, discoveredContract] of Object.entries(discoveredContracts)) {
    const userContract = userContracts[contractAddress]

    if (!userContract) {
      // No user functions for this contract, use discovered functions
      result[contractAddress] = { functions: [...discoveredContract.functions] }
    } else {
      // Merge discovered and user functions, user takes precedence
      const userFunctionMap = new Map<string, FunctionEntry>()

      // Index user functions by function name
      for (const func of userContract.functions) {
        userFunctionMap.set(func.functionName, func)
      }

      const mergedFunctions: FunctionEntry[] = []

      // Add discovered functions that don't have user functions
      for (const discoveredFunc of discoveredContract.functions) {
        if (!userFunctionMap.has(discoveredFunc.functionName)) {
          mergedFunctions.push(discoveredFunc)
        }
      }

      // Add all user functions (these take precedence)
      mergedFunctions.push(...userContract.functions)

      result[contractAddress] = { functions: mergedFunctions }
    }
  }

  // Add user-only contracts (contracts that have user functions but no discovered data)
  for (const [contractAddress, userContract] of Object.entries(userContracts)) {
    if (!discoveredContracts[contractAddress]) {
      result[contractAddress] = { functions: [...userContract.functions] }
    }
  }

  return result
}

/**
 * Resolves owner definitions using unified path expressions with shared utility:
 * Path format: <contractRef>.<valuePath>
 * - $self: current contract
 * - @fieldName: follow address field in current contract
 * - eth:0xAddress: absolute contract address
 */
export function resolveOwnersFromDiscovered(
  paths: DiscoveryPaths,
  project: string,
  contractAddress: string,
  ownerDefinitions: OwnerDefinition[]
): ResolvedOwner[] {
  const discoveredPath = getDiscoveredPath(paths, project)

  if (!fs.existsSync(discoveredPath)) {
    return ownerDefinitions.map(definition => ({
      address: 'DISCOVERY_NOT_FOUND',
      source: definition,
      isResolved: false,
      error: 'No discovered.json file found for project'
    }))
  }

  try {
    const fileContent = fs.readFileSync(discoveredPath, 'utf8')
    const discovered = JSON.parse(fileContent)
    const dataAccess = new DiscoveredDataAccess(discovered)

    const resolved: ResolvedOwner[] = []

    for (const definition of ownerDefinitions) {
      const result = resolvePathExpression(dataAccess, contractAddress, definition.path)

      if (result.error) {
        resolved.push({
          address: 'RESOLUTION_FAILED',
          source: definition,
          isResolved: false,
          error: result.error,
        })
      } else if (result.addresses.length === 1 && typeof result.structuredValue === 'string') {
        // If there's only one address and no complex structure, create one resolved owner
        resolved.push({
          address: result.addresses[0]!,
          source: definition,
          isResolved: true,
        })
      } else {
        // Multiple addresses or complex structure - create entries with structured value
        resolved.push(...result.addresses.map(address => ({
          address,
          source: definition,
          isResolved: true,
          structuredValue: result.structuredValue,
        })))
      }
    }

    return resolved
  } catch (error) {
    console.error('Error parsing discovered.json:', error)
    return ownerDefinitions.map(definition => ({
      address: 'PARSE_ERROR',
      source: definition,
      isResolved: false,
      error: 'Failed to parse discovered.json'
    }))
  }
}


/**
 * Resolves a delay field value from discovered data.
 * Extracts numeric value from a contract field and returns it in seconds.
 */
export function resolveDelayFromDiscovered(
  paths: DiscoveryPaths,
  project: string,
  delayRef: { contractAddress: string; fieldName: string }
): ResolvedDelay {
  const discoveredPath = getDiscoveredPath(paths, project)

  if (!fs.existsSync(discoveredPath)) {
    return {
      seconds: 0,
      isResolved: false,
      error: 'No discovered.json file found for project'
    }
  }

  try {
    const fileContent = fs.readFileSync(discoveredPath, 'utf8')
    const discovered = JSON.parse(fileContent)

    // Find the contract in discovered data
    if (!discovered.entries || !Array.isArray(discovered.entries)) {
      return {
        seconds: 0,
        isResolved: false,
        error: 'No entries found in discovered data'
      }
    }

    const contractEntry = discovered.entries.find((entry: any) =>
      entry.type === 'Contract' && entry.address === delayRef.contractAddress
    )

    if (!contractEntry) {
      return {
        seconds: 0,
        isResolved: false,
        error: `Contract ${delayRef.contractAddress} not found in discovered data`
      }
    }

    // Look for the field in the contract's fields
    if (!contractEntry.fields || !Array.isArray(contractEntry.fields)) {
      return {
        seconds: 0,
        isResolved: false,
        error: `No fields found for contract ${delayRef.contractAddress}`
      }
    }

    const field = contractEntry.fields.find((f: any) => f.name === delayRef.fieldName)

    if (!field) {
      return {
        seconds: 0,
        isResolved: false,
        error: `Field ${delayRef.fieldName} not found in contract ${delayRef.contractAddress}`
      }
    }

    // Extract numeric value from field
    if (field.value && field.value.type === 'number') {
      // Parse the string value to a number
      const numValue = parseInt(field.value.value, 10)
      if (isNaN(numValue)) {
        return {
          seconds: 0,
          isResolved: false,
          error: `Field ${delayRef.fieldName} contains non-numeric value`
        }
      }
      return {
        seconds: numValue,
        isResolved: true
      }
    }

    return {
      seconds: 0,
      isResolved: false,
      error: `Field ${delayRef.fieldName} is not a number type`
    }
  } catch (error) {
    console.error('Error parsing discovered.json:', error)
    return {
      seconds: 0,
      isResolved: false,
      error: 'Failed to parse discovered.json'
    }
  }
}