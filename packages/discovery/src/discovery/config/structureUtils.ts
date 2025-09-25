import type { ChainSpecificAddress } from '@l2beat/shared-pure'
import merge from 'lodash/merge'
import type { Analysis } from '../analysis/AddressAnalyzer'
import { ConfigReader } from './ConfigReader'
import { getDiscoveryPaths } from './getDiscoveryPaths'
import { type StructureConfig, StructureContract, type DefiDiscoConfig } from './StructureConfig'

export interface SharedModuleIndexEntry {
  name?: string
  address: ChainSpecificAddress
  project: string
  type: Analysis['type']
}

export function buildSharedModuleIndex(
  config: StructureConfig,
  configReader?: ConfigReader,
): Record<ChainSpecificAddress, SharedModuleIndexEntry> {
  const result: Record<ChainSpecificAddress, SharedModuleIndexEntry> = {}
  configReader ??= new ConfigReader(getDiscoveryPaths().discovery)

  for (const sharedModule of config.sharedModules) {
    const discovery = configReader?.readDiscovery(sharedModule)
    for (const entry of discovery.entries) {
      result[entry.address] = {
        name: entry.name,
        address: entry.address,
        project: sharedModule,
        type: entry.type,
      }
    }
  }
  return result
}

export type StructureContractOverrides = StructureContract & {
  address: ChainSpecificAddress
}

export type StructureContractConfig = StructureContractOverrides & {
  pushValues: (arg: StructureContract) => void
  defidisco?: DefiDiscoConfig
}

export function makeEntryStructureConfig(
  config: Pick<StructureConfig, 'overrides' | 'types'> & { defidisco?: DefiDiscoConfig },
  address: ChainSpecificAddress,
): StructureContractConfig {
  const override =
    config.overrides?.[address.toString()] ?? StructureContract.parse({})

  const overrides = { address, ...override }

  const result = {
    ...overrides,
    types: merge({}, config.types ?? {}, overrides.types),
    defidisco: config.defidisco,
    pushValues: function (values: StructureContract) {
      const newState = {
        address: this.address,
        ...StructureContract.parse(merge({}, values, this)),
      }
      Object.assign(this, newState)
    },
  }
  return result
}
