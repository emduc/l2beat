import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getFunctions, updateFunction, getCode } from '../../../api/api'
import { useMultiViewStore } from '../multi-view/store'
import { useCodeStore } from '../../../components/editor/store'
import { usePanelStore } from '../store/panel-store'
import type { ApiAbi, ApiAbiEntry, FunctionEntry, OwnerDefinition } from '../../../api/types'
import { partition } from '../../../utils/partition'
import { AddressDisplay } from '../panel-values/AddressDisplay'
import { Folder } from '../panel-values/Folder'
import { FunctionFolder } from './FunctionFolder'

// Extended type for local display with contractAddress
interface FunctionEntryWithContract extends FunctionEntry {
  contractAddress: string
}

// Helper function to find all function occurrences in source code
function findAllFunctionOccurrences(sources: Array<{ name: string; code: string }>, functionName: string): Array<{ startOffset: number; length: number; sourceIndex: number }> {
  const occurrences: Array<{ startOffset: number; length: number; sourceIndex: number }> = []

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex++) {
    const source = sources[sourceIndex]
    if (!source) continue

    // Look for function definition with various patterns
    const patterns = [
      new RegExp(`function\\s+${functionName}\\s*\\(`, 'gi'),
      new RegExp(`\\b${functionName}\\s*\\(.*?\\)\\s*(?:public|external|internal|private)?(?:\\s+\\w+)*\\s*(?:returns\\s*\\([^)]*\\))?\\s*{`, 'gi')
    ]

    for (const pattern of patterns) {
      let match
      while ((match = pattern.exec(source.code)) !== null) {
        const startOffset = match.index
        // Try to find the end of the function signature (up to opening brace or semicolon)
        const remainingCode = source.code.slice(startOffset)
        const endMatch = remainingCode.match(/[{;]/)
        const length = endMatch ? endMatch.index! + 1 : functionName.length + 10

        occurrences.push({ startOffset, length, sourceIndex })
      }
    }
  }

  return occurrences
}


export function PermissionsDisplay({ abis }: { abis: ApiAbi[] }) {
  const { project } = useParams()
  const queryClient = useQueryClient()
  const [localFunctions, setLocalFunctions] = useState<FunctionEntryWithContract[]>([])

  // Track current occurrence index for each function (key: "contractAddress:functionName")
  const [functionOccurrenceCounters, setFunctionOccurrenceCounters] = useState<Record<string, number>>({})

  // Multi-view store for panel management
  const ensurePanel = useMultiViewStore((state) => state.ensurePanel)
  const setActivePanel = useMultiViewStore((state) => state.setActivePanel)

  // Code store for editor operations
  const { showRange, setSourceIndex } = useCodeStore()


  // Load functions data for this project
  const { data: functionsData } = useQuery({
    queryKey: ['functions', project],
    queryFn: () => project ? getFunctions(project) : null,
    enabled: !!project,
  })

  // Get functions for the specific contracts we're displaying (much more efficient!)
  const getFunctionsForContract = (contractAddress: string) => {
    const contractFunctions = functionsData?.contracts?.[contractAddress]?.functions || []
    const localFunctionsForContract = localFunctions.filter(o => o.contractAddress === contractAddress)

    // Map contract functions to include contractAddress (functions in contracts don't have it)
    const withContractAddress = contractFunctions.map(func => ({
      ...func,
      contractAddress
    }))

    return [...withContractAddress, ...localFunctionsForContract]
  }

  const handlePermissionToggle = async (contractAddress: string, functionName: string, currentIsPermissioned: boolean) => {
    if (!project) return

    const newIsPermissioned = !currentIsPermissioned

    await updateFunctionEntry(contractAddress, functionName, { isPermissioned: newIsPermissioned })
  }

  const handleCheckedToggle = async (contractAddress: string, functionName: string, currentChecked: boolean) => {
    if (!project) return

    await updateFunctionEntry(contractAddress, functionName, { checked: !currentChecked })
  }

  const handleScoreToggle = async (contractAddress: string, functionName: string, currentScore: 'unscored' | 'low-risk' | 'medium-risk' | 'high-risk') => {
    if (!project) return

    const scoreOrder: Array<'unscored' | 'low-risk' | 'medium-risk' | 'high-risk'> = ['unscored', 'low-risk', 'medium-risk', 'high-risk']
    const currentIndex = scoreOrder.indexOf(currentScore)
    const nextIndex = (currentIndex + 1) % scoreOrder.length
    const newScore = scoreOrder[nextIndex]

    await updateFunctionEntry(contractAddress, functionName, { score: newScore })
  }

  const handleDescriptionUpdate = async (contractAddress: string, functionName: string, description: string) => {
    if (!project) return

    await updateFunctionEntry(contractAddress, functionName, { description })
  }

  const handleOwnerDefinitionsUpdate = async (contractAddress: string, functionName: string, ownerDefinitions: OwnerDefinition[]) => {
    if (!project) return

    await updateFunctionEntry(contractAddress, functionName, { ownerDefinitions })
  }

  const handleDelayUpdate = async (contractAddress: string, functionName: string, delay?: { contractAddress: string; fieldName: string }) => {
    if (!project) return

    await updateFunctionEntry(contractAddress, functionName, { delay })
  }

  const handleOpenInCode = async (contractAddress: string, functionName: string) => {
    if (!project) return

    try {
      // Ensure Code panel is open and active
      ensurePanel('code')
      setActivePanel('code')

      // Get the currently selected contract (this is what the CodePanel is displaying)
      const selectedAddress = usePanelStore.getState().selected

      if (!selectedAddress) {
        console.warn('No contract selected')
        return
      }

      // Get the source code for the selected contract (proxy), which includes both proxy and implementation
      const codeResponse = await getCode(project, selectedAddress)

      // Get all occurrences first
      const allOccurrences = findAllFunctionOccurrences(codeResponse.sources, functionName)

      if (allOccurrences.length === 0) {
        console.warn(`Function "${functionName}" not found in any source file`)
        return
      }

      // Create a key for this function
      const functionKey = `${selectedAddress}:${functionName}`

      // Get current counter for this function (defaults to 0)
      const currentCounter = functionOccurrenceCounters[functionKey] || 0

      // Calculate next occurrence index (cycle through all occurrences)
      const nextOccurrenceIndex = currentCounter % allOccurrences.length
      const functionLocation = allOccurrences[nextOccurrenceIndex]


      if (functionLocation) {
        // Update the counter for next time
        setFunctionOccurrenceCounters(prev => ({
          ...prev,
          [functionKey]: currentCounter + 1
        }))

        // Navigate to the selected occurrence
        setSourceIndex(selectedAddress, functionLocation.sourceIndex)
        showRange(selectedAddress, {
          startOffset: functionLocation.startOffset,
          length: functionLocation.length
        })

      }

    } catch (error) {
      console.error('Failed to navigate to function:', error)
    }
  }

  const updateFunctionEntry = async (
    contractAddress: string,
    functionName: string,
    updates: Partial<Pick<FunctionEntry, 'isPermissioned' | 'checked' | 'score' | 'description' | 'ownerDefinitions' | 'delay'>>
  ) => {
    // Get current function data from contract-specific functions
    const contractFunctionsData = getFunctionsForContract(contractAddress)
    const currentFunction = contractFunctionsData.find(o => o.functionName === functionName)

    // Create optimistic update
    const newFunction: FunctionEntryWithContract = {
      contractAddress,
      functionName,
      isPermissioned: updates.isPermissioned ?? currentFunction?.isPermissioned ?? false,
      checked: updates.checked ?? currentFunction?.checked,
      score: updates.score ?? currentFunction?.score,
      description: updates.description ?? currentFunction?.description,
      ownerDefinitions: updates.ownerDefinitions ?? currentFunction?.ownerDefinitions,
      delay: updates.delay !== undefined ? updates.delay : currentFunction?.delay,
      timestamp: new Date().toISOString(),
    }

    setLocalFunctions(prev => [
      ...prev.filter(o => !(o.contractAddress === contractAddress && o.functionName === functionName)),
      newFunction
    ])

    try {
      if (!project) return
      await updateFunction(project, {
        contractAddress,
        functionName,
        ...updates,
      })

      // Invalidate and refetch the query to get fresh data
      await queryClient.invalidateQueries({
        queryKey: ['functions', project]
      })

      // Clear local functions since we now have fresh server data
      setLocalFunctions([])
    } catch (error) {
      console.error('Failed to update function:', error)
      // Revert optimistic update on error
      setLocalFunctions(prev => prev.filter(o => !(o.contractAddress === contractAddress && o.functionName === functionName)))
    }
  }

  // Filter to only show ABIs that have write functions
  const abisWithWriteFunctions = abis.filter(abi => {
    const readMarkers = [' view ', ' pure ']
    const [, nonErrors] = partition(abi.entries, (e) => e.value.startsWith('error'))
    const [, nonEvents] = partition(nonErrors, (e) => e.value.startsWith('event'))
    const [, write] = partition(nonEvents, (e) => readMarkers.some((marker) => e.value.includes(marker)))
    return write.length > 0
  })

  if (abisWithWriteFunctions.length === 0) {
    return null
  }

  return (
    <ol>
      {abisWithWriteFunctions.map((abi) => (
        <li key={abi.address}>
          <div className="px-5 pt-[3px] pb-0.5 font-mono text-xs">
            <AddressDisplay
              simplified
              value={{
                type: 'address',
                address: abi.address,
                addressType: 'Unknown',
              }}
            />
          </div>
          <PermissionsCode
            entries={abi.entries}
            contractAddress={abi.address}
            functions={getFunctionsForContract(abi.address)}
            onPermissionToggle={handlePermissionToggle}
            onCheckedToggle={handleCheckedToggle}
            onScoreToggle={handleScoreToggle}
            onDescriptionUpdate={handleDescriptionUpdate}
            onOpenInCode={handleOpenInCode}
            onOwnerDefinitionsUpdate={handleOwnerDefinitionsUpdate}
            onDelayUpdate={handleDelayUpdate}
          />
        </li>
      ))}
    </ol>
  )
}

function PermissionsCode({
  entries,
  contractAddress,
  functions,
  onPermissionToggle,
  onCheckedToggle,
  onScoreToggle,
  onDescriptionUpdate,
  onOpenInCode,
  onOwnerDefinitionsUpdate,
  onDelayUpdate
}: {
  entries: ApiAbiEntry[]
  contractAddress: string
  functions: FunctionEntryWithContract[]
  onPermissionToggle: (contractAddress: string, functionName: string, currentIsPermissioned: boolean) => void
  onCheckedToggle: (contractAddress: string, functionName: string, currentChecked: boolean) => void
  onScoreToggle: (contractAddress: string, functionName: string, currentScore: 'unscored' | 'low-risk' | 'medium-risk' | 'high-risk') => void
  onDescriptionUpdate: (contractAddress: string, functionName: string, description: string) => void
  onOpenInCode: (contractAddress: string, functionName: string) => void
  onOwnerDefinitionsUpdate: (contractAddress: string, functionName: string, ownerDefinitions: OwnerDefinition[]) => void
  onDelayUpdate: (contractAddress: string, functionName: string, delay?: { contractAddress: string; fieldName: string }) => void
}) {
  const readMarkers = [' view ', ' pure ']

  const [, nonErrors] = partition(entries, (e) =>
    e.value.startsWith('error'),
  )
  const [, nonEvents] = partition(nonErrors, (e) =>
    e.value.startsWith('event'),
  )
  const [, write] = partition(nonEvents, (e) =>
    readMarkers.some((marker) => e.value.includes(marker)),
  )

  return (
    <div>
      <Folder
        title={`Write Functions (${write.length})`}
        collapsed={write.length === 0}
      >
        <WritePermissionsCodeEntries
          entries={write}
          contractAddress={contractAddress}
          functions={functions}
          onPermissionToggle={onPermissionToggle}
          onCheckedToggle={onCheckedToggle}
          onScoreToggle={onScoreToggle}
          onDescriptionUpdate={onDescriptionUpdate}
          onOpenInCode={onOpenInCode}
          onOwnerDefinitionsUpdate={onOwnerDefinitionsUpdate}
          onDelayUpdate={onDelayUpdate}
        />
      </Folder>
    </div>
  )
}

function WritePermissionsCodeEntries({
  entries,
  contractAddress,
  functions,
  onPermissionToggle,
  onCheckedToggle,
  onScoreToggle,
  onDescriptionUpdate,
  onOpenInCode,
  onOwnerDefinitionsUpdate,
  onDelayUpdate
}: {
  entries: ApiAbiEntry[]
  contractAddress: string
  functions: FunctionEntryWithContract[]
  onPermissionToggle: (contractAddress: string, functionName: string, currentIsPermissioned: boolean) => void
  onCheckedToggle: (contractAddress: string, functionName: string, currentChecked: boolean) => void
  onScoreToggle: (contractAddress: string, functionName: string, currentScore: 'unscored' | 'low-risk' | 'medium-risk' | 'high-risk') => void
  onDescriptionUpdate: (contractAddress: string, functionName: string, description: string) => void
  onOpenInCode: (contractAddress: string, functionName: string) => void
  onOwnerDefinitionsUpdate: (contractAddress: string, functionName: string, ownerDefinitions: OwnerDefinition[]) => void
  onDelayUpdate: (contractAddress: string, functionName: string, delay?: { contractAddress: string; fieldName: string }) => void
}) {
  const extractFunctionName = (abiEntry: string): string | null => {
    const match = abiEntry.match(/function\s+(\w+)\s*\(/)
    return match ? match[1] || null : null
  }

  if (entries.length === 0) {
    return (
      <div className="bg-coffee-900 p-3">
        <span className="text-coffee-400 font-mono text-xs">// No write functions</span>
      </div>
    )
  }

  return (
    <div>
      {entries.map((entry, i) => {
        const functionName = extractFunctionName(entry.value)

        if (!functionName) {
          return null // Skip entries without function names
        }

        return (
          <FunctionFolder
            key={i}
            entry={entry}
            contractAddress={contractAddress}
            functionName={functionName}
            functions={functions}
            onPermissionToggle={onPermissionToggle}
            onCheckedToggle={onCheckedToggle}
            onScoreToggle={onScoreToggle}
            onDescriptionUpdate={onDescriptionUpdate}
            onOpenInCode={onOpenInCode}
            onOwnerDefinitionsUpdate={onOwnerDefinitionsUpdate}
            onDelayUpdate={onDelayUpdate}
          />
        )
      })}
    </div>
  )
}

